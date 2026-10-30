/**
 * Rolling for a request. The roll runs through the system's own roll method, so the system's dialog, bonuses, chat
 * card and every module that watches rolls (Dice So Nice, Roll Breakdown, Midi-QOL) see a normal roll. While it runs,
 * the next roll message of that character on this client gets the mark of the request and the visibility the GM
 * chose.
 */

import {getAdapter} from "./adapters/index.mjs";
import {MODULE_ID, gmIds, setting, t} from "./config.mjs";
import {debugTrace} from "./debug.mjs";
import {pickMarker, rollVisibility, takeReplaced} from "./request-model.mjs";
import {canRoll, entryActor, entryToken, requestOf} from "./requests.mjs";
import {countFeature} from "./usage.mjs";

/** Rolls this client is waiting for: {cardId, requestId, entryId, actorUuid, mode, until}. */
const pending = [];

/**
 * Answers this client deleted a moment ago: {answer, actorUuid, mode, until}. Pathfinder 2e rerolls with a hero point
 * by deleting the roll message and posting a new one with only its own flags; the new one takes over the mark.
 */
const replaced = [];

/** How long after deleting an answer a new roll of the same character counts as its reroll. */
const REPLACE_MS = 5000;

/** How long a roll may take, dialogs included. */
const WAIT_MS = 10 * 60 * 1000;

/**
 * Roll for one entry of a card.
 * @param {ChatMessage} card
 * @param {object} entry
 * @param {object} [options]
 * @param {Event|null} [options.event]       The click, for the system's keys
 * @param {boolean} [options.fastForward]    Skip the system's dialog
 * @returns {Promise<boolean>}   Whether a roll was started
 */
export async function rollEntry(card, entry, {event=null, fastForward=false}={}) {
  const request = requestOf(card);
  if ( !request || request.results?.[entry.id] ) return false;
  const actor = entryActor(entry);
  if ( !actor ) {
    ui.notifications.warn(t("SRR.Error.noActor", {name: entry.name}));
    return false;
  }
  if ( !canRoll(entry) ) return false;
  const marker = {cardId: card.id, requestId: request.id, entryId: entry.id, actorUuid: actor.uuid, mode: request.mode,
    system: request.system, type: request.type, key: request.key, until: Date.now() + WAIT_MS};
  pending.push(marker);
  debugTrace.add("roll started", {messageId: card.id, entryId: entry.id, fastForward});
  try {
    await getAdapter(request.system).roll(actor, request, {event, fastForward, token: entryToken(entry)});
    // Only the active GM's browser counts, so this is the GM rolling for a character
    if ( game.user.isGM ) countFeature(MODULE_ID, "gmRoll");
    return true;
  } catch(err) {
    console.error(`${MODULE_ID} | The roll failed`, err);
    ui.notifications.error(t("SRR.Error.rollFailed", {name: entry.name}));
    return false;
  } finally {
    // The message is created inside the roll; a short grace keeps a late one from going unmarked
    setTimeout(() => removeMarker(marker), 1500);
  }
}

/**
 * Roll every open entry the GM may roll for (GM).
 * @param {ChatMessage} card
 * @param {object} [options]
 * @param {boolean} [options.npcsOnly]
 * @returns {Promise<number>}   How many rolls were made
 */
export async function rollRemaining(card, {npcsOnly=false}={}) {
  const request = requestOf(card);
  if ( !request || !game.user.isGM ) return 0;
  let count = 0;
  for ( const entry of request.entries ) {
    if ( request.results?.[entry.id] || (npcsOnly && !entry.npc) ) continue;
    if ( await rollEntry(card, entry, {fastForward: true}) ) count++;
  }
  return count;
}

/**
 * Whether GM rolls from the card skip the dialog.
 * @returns {boolean}
 */
export function gmFastForward() {
  try {
    return setting("gmFastForward");
  } catch {
    return true;
  }
}

/**
 * Remove a marker.
 * @param {object} marker
 */
function removeMarker(marker) {
  const index = pending.indexOf(marker);
  if ( index >= 0 ) pending.splice(index, 1);
}

/**
 * The marker a new roll message belongs to: the one of its speaker's actor, or the only one there is.
 * @param {ChatMessage} message
 * @returns {object|null}
 */
function markerFor(message) {
  const now = Date.now();
  for ( const marker of [...pending] ) if ( marker.until < now ) removeMarker(marker);
  if ( !pending.length ) return null;
  let actor = null;
  try {
    actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  } catch {}
  const mine = actor ? pending.filter(m => m.actorUuid === actor.uuid) : [];
  if ( actor && !mine.length ) mine.push(...pending.filter(m => fromUuidSync(m.actorUuid)?.id === actor.id));
  // Two requests open for one character: the roll of the kind a request asked for answers that request
  return pickMarker(mine, marker => getAdapter(marker.system).matches?.(message, marker) ?? null)
    ?? ((pending.length === 1) && !actor ? pending[0] : null);
}


/**
 * Hook "deleteChatMessage" on the deleting client: remember an answer this user deleted, in case a reroll follows.
 * @param {ChatMessage} message
 * @param {object} options
 * @param {string} userId
 */
export function onDeleteChatMessage(message, options, userId) {
  const answer = message.flags?.[MODULE_ID]?.answer;
  if ( !answer || (userId !== game.user.id) || !message.rolls?.length || options?.deleteAll ) return;
  // Only the roll that stands on its card: cleaning up the chat deletes cards and old answers, no reroll follows
  const request = requestOf(game.messages.get(answer.cardId));
  if ( request?.results?.[answer.entryId]?.messageId !== message.id ) return;
  let actor = null;
  try {
    actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  } catch {}
  if ( !actor ) return;
  const mode = request.mode ?? "public";
  replaced.push({answer: {...answer}, actorUuid: actor.uuid, mode, until: Date.now() + REPLACE_MS});
}

/**
 * Hook "preCreateChatMessage" on the rolling client: mark the roll message and give it the request's visibility.
 * @param {ChatMessage} message
 * @param {object} data
 * @param {object} options
 * @param {string} userId
 */
export function onPreCreateChatMessage(message, data, options, userId) {
  if ( userId !== game.user.id ) return;
  if ( !message.rolls?.length || message.flags?.[MODULE_ID]?.request || message.flags?.[MODULE_ID]?.answer ) return;
  // A roll that calls itself a reroll (PF2e marks the new roll and its context)
  const reroll = message.rolls.some(r => r?.options?.isReroll) || !!message.flags?.pf2e?.context?.isReroll;
  if ( replaced.length && reroll ) {
    let actor = null;
    try {
      actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
    } catch {}
    const item = takeReplaced(replaced, actor?.uuid ?? null, Date.now());
    if ( item ) {
      message.updateSource({flags: {[MODULE_ID]: {answer: item.answer}}, ...rollVisibility(item.mode, gmIds())});
      debugTrace.add("reroll marked", {messageId: item.answer.cardId, entryId: item.answer.entryId, mode: item.mode});
      return;
    }
  }
  if ( !pending.length ) return;
  const marker = markerFor(message);
  if ( !marker ) return;
  removeMarker(marker);
  const answer = {cardId: marker.cardId, requestId: marker.requestId, entryId: marker.entryId};
  message.updateSource({flags: {[MODULE_ID]: {answer}}, ...rollVisibility(marker.mode, gmIds())});
  debugTrace.add("roll marked", {messageId: marker.cardId, entryId: marker.entryId, mode: marker.mode});
}

export const __test__ = {pending, markerFor, replaced};
