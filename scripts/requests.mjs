/**
 * Requests and their result cards. A GM creates the card, a chat message that holds the request. Players answer
 * with a normal roll of their own: the roll message carries a mark which request and character it answers, and the
 * client of the active GM writes the result into the card. Players never change a message of the GM, and the author
 * of a roll message is confirmed by the server, so a player can only answer for characters they own.
 */

import {getAdapter, rollGroups, choiceLabel} from "./adapters/index.mjs";
import {HOOKS, MODULE_ID, esc, fromUuidQuiet, gmIds, t} from "./config.mjs";
import {debugTrace} from "./debug.mjs";
import {buildRequest, cardRecipients, normalizeOptions, publicResult, summarize} from "./request-model.mjs";
import {countFeature} from "./usage.mjs";

/** Writes to a card on the active GM's client, one after the other per card. */
const queues = new Map();

/** What this client has seen of each card: the results with their rolls, and whether it was complete. */
const seen = new Map();

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The request stored on a chat message, or null.
 * @param {ChatMessage|null} message
 * @returns {object|null}
 */
export function requestOf(message) {
  const request = message?.flags?.[MODULE_ID]?.request;
  return (request && Array.isArray(request.entries)) ? request : null;
}

/**
 * The actor of an entry: the token's actor for unlinked tokens, otherwise the actor.
 * @param {object} entry
 * @returns {Actor|null}
 */
export function entryActor(entry) {
  const token = fromUuidQuiet(entry?.tokenUuid);
  return token?.actor ?? fromUuidQuiet(entry?.actorUuid);
}

/**
 * The token document of an entry, if it came from a token.
 * @param {object} entry
 * @returns {TokenDocument|null}
 */
export function entryToken(entry) {
  return fromUuidQuiet(entry?.tokenUuid);
}

/**
 * May a user roll for an entry? GMs for everyone, players for the characters they own.
 * @param {object} entry
 * @param {User} [user]
 * @returns {boolean}
 */
export function canRoll(entry, user=game.user) {
  if ( user?.isGM ) return true;
  const actor = entryActor(entry);
  return !!actor?.testUserPermission?.(user, "OWNER");
}

/**
 * The players (not GMs) who own an actor.
 * @param {Actor|null} actor
 * @returns {User[]}
 */
export function playerOwners(actor) {
  if ( !actor ) return [];
  return game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/**
 * The text of what a request asks for, in the language of this client.
 * @param {object} request
 * @returns {string}
 */
export function describe(request) {
  if ( request.type === "formula" ) return request.label || request.formula;
  // The stored name covers choices only some characters have (a Savage Worlds skill outside the core skills)
  const name = choiceLabel(request.type, request.key) ?? (request.title || request.key);
  const key = `SRR.Label.${request.type}`;
  return game.i18n.has(key) ? t(key, {name}) : name;
}

/* -------------------------------------------- */
/*  Creating                                    */
/* -------------------------------------------- */

/**
 * One entry per actor, from actors, tokens or their uuids. Unlinked tokens keep their own actor.
 * @param {Array<Actor|TokenDocument|Token|string>} sources
 * @returns {object[]}
 */
export function entriesFrom(sources) {
  const entries = [];
  const seenActors = new Set();
  for ( let source of sources ?? [] ) {
    if ( typeof source === "string" ) source = fromUuidQuiet(source);
    if ( source?.document && (source.document.documentName === "Token") ) source = source.document;
    let actor = null;
    let token = null;
    if ( source?.documentName === "Token" ) {
      token = source;
      actor = source.actor;
    }
    else if ( source?.documentName === "Actor" ) actor = source;
    if ( !actor ) continue;
    const linked = !token || token.actorLink;
    if ( seenActors.has(actor.uuid) ) continue;
    seenActors.add(actor.uuid);
    const image = token && !linked ? (token.texture?.src || actor.img) : (actor.img || token?.texture?.src);
    entries.push({
      id: foundry.utils.randomID(8),
      actorUuid: actor.uuid,
      tokenUuid: linked ? null : token.uuid,
      name: (token && !linked) ? token.name : actor.name,
      img: /\.(webm|mp4|ogv|m4v)$/i.test(image ?? "") ? actor.img : image,
      npc: !actor.hasPlayerOwner
    });
  }
  return entries;
}

/**
 * The plain content of a card, for anyone who reads it without the module.
 * @param {object} request
 * @returns {string}
 */
function plainContent(request) {
  const dc = (request.dc !== null) && request.showDc ? ` (${t("SRR.Card.dc", {dc: request.dc})})` : "";
  const names = request.entries.map(e => `<li>${esc(e.name)}</li>`).join("");
  return `<p><strong>${esc(describe(request))}</strong>${esc(dc)}</p><ul>${names}</ul>`;
}

/**
 * Create a request and its card (GM). NPCs roll at once when the request says so.
 * @param {object} input   Options of the request plus `actors`
 * @returns {Promise<ChatMessage>}
 */
export async function createRequest(input={}) {
  if ( !game.user.isGM ) throw new Error(t("SRR.Error.gmOnly"));
  const options = normalizeOptions(input);
  const adapter = getAdapter();
  if ( options.advantage !== "normal" && !adapter.advantage ) options.advantage = "normal";
  const entries = entriesFrom(input.actors);
  // The characters' own choices count too (a Savage Worlds skill outside the core skills)
  const groups = rollGroups(entries.map(e => entryActor(e)).filter(Boolean));
  if ( (options.type !== "formula") && !choiceLabel(options.type, options.key, groups) ) {
    throw new Error(t("SRR.Error.unknownChoice"));
  }
  const request = buildRequest(options, entries, {
    id: foundry.utils.randomID(12),
    system: game.system.id,
    title: "",
    createdAt: Date.now(),
    userId: game.user.id
  });
  request.title = (options.type === "formula") ? "" : choiceLabel(options.type, options.key, groups);
  const players = [...new Set(entries.flatMap(e => playerOwners(entryActor(e)).map(u => u.id)))];
  const message = await ChatMessage.implementation.create({
    content: plainContent(request),
    speaker: {alias: game.user.name, scene: null, actor: null, token: null},
    whisper: cardRecipients(request.mode, gmIds(), players),
    flags: {[MODULE_ID]: {request}}
  });
  debugTrace.add("requested", {messageId: message?.id, requestId: request.id, type: request.type, key: request.key,
    entries: entries.length, mode: request.mode, dc: request.dc});
  countFeature(MODULE_ID, "request");
  if ( request.group ) countFeature(MODULE_ID, "groupCheck");
  if ( request.type === "formula" ) countFeature(MODULE_ID, "formula");
  Hooks.callAll(HOOKS.requested, publicResult(request, message.id));
  if ( request.autoRollNpcs ) {
    const {rollEntry} = await import("./rolling.mjs");
    for ( const entry of entries.filter(e => e.npc) ) {
      await rollEntry(message, entry, {fastForward: true}).catch(err => console.error(`${MODULE_ID} |`, err));
    }
  }
  return message;
}

/* -------------------------------------------- */
/*  Answers (active GM)                         */
/* -------------------------------------------- */

/**
 * Hook "createChatMessage": the active GM writes the result of an answering roll into its card.
 * @param {ChatMessage} message
 */
export function onCreateChatMessage(message) {
  const answer = message.flags?.[MODULE_ID]?.answer;
  if ( !answer || !game.user.isActiveGM ) return;
  enqueue(answer.cardId, () => recordAnswer(message, answer));
}

/**
 * Run writes to a card one after the other.
 * @param {string} cardId
 * @param {Function} task
 * @returns {Promise<void>}
 */
function enqueue(cardId, task) {
  const previous = queues.get(cardId) ?? Promise.resolve();
  const next = previous.then(task).catch(err => console.error(`${MODULE_ID} | Recording a result failed`, err));
  queues.set(cardId, next);
  return next;
}

/**
 * Hook "updateChatMessage": the active GM reads an answering roll again when the system changed it (Savage Worlds
 * adds the die that confirms a critical failure to the same message).
 * @param {ChatMessage} message
 */
export function onUpdateAnswer(message) {
  const answer = message.flags?.[MODULE_ID]?.answer;
  if ( !answer || !game.user.isActiveGM ) return;
  enqueue(answer.cardId, () => recordAnswer(message, answer, {update: true}));
}

/**
 * Check an answer and write its result. A new roll for a character that has a result replaces it when it comes from
 * the same player or a GM: rerolls with a hero point or a benny copy the mark of the request to their new message.
 * @param {ChatMessage} message
 * @param {{cardId: string, requestId: string, entryId: string}} answer
 * @param {object} [options]
 * @param {boolean} [options.update]   The roll message was changed, not created
 */
async function recordAnswer(message, answer, {update=false, late=false}={}) {
  const card = game.messages.get(answer.cardId);
  const request = requestOf(card);
  const trace = (event, extra={}) => debugTrace.add(event, {messageId: message.id, cardId: answer.cardId,
    requestId: answer.requestId, entryId: answer.entryId, ...extra});
  if ( !request || (request.id !== answer.requestId) ) return trace("answer to an unknown request");
  const entry = request.entries.find(e => e.id === answer.entryId);
  if ( !entry ) return trace("answer for an unknown character");
  const author = message.author;
  const before = request.results?.[entry.id] ?? null;
  if ( update && (before?.messageId !== message.id) ) return;
  if ( before && !update && !(author?.isGM || (author?.id === before.userId)) ) return trace("already rolled");
  if ( !author || !canRoll(entry, author) ) return trace("answer from a user without rights", {user: author?.id});
  let result;
  try {
    result = getAdapter(request.system).evaluate(message, request);
  } catch(err) {
    console.error(`${MODULE_ID} | Reading the roll failed`, err);
    result = {total: null, success: null, degree: null};
  }
  if ( !Number.isFinite(result.total) ) return trace("answer without a total");
  if ( update && (before.total === result.total) && (before.success === result.success) ) return;
  const stored = {...result, messageId: message.id, userId: author.id, at: Date.now()};
  await card.update({[`flags.${MODULE_ID}.request.results.${entry.id}`]: stored});
  const event = !before ? (late ? "recorded late" : "recorded") : update ? "updated" : "rerolled";
  trace(event, {total: result.total, success: result.success, user: author.id, before: before?.total ?? null});
}

/**
 * Write the results of answers that came while no GM was online (active GM): for every open card the newest answer
 * of each character without a result. Answers from before the GM took a result back stay out.
 */
export function catchUp() {
  if ( !game.user.isActiveGM ) return;
  const answers = new Map();
  for ( const message of game.messages ) {
    const answer = message.flags?.[MODULE_ID]?.answer;
    if ( !answer ) continue;
    if ( !answers.has(answer.cardId) ) answers.set(answer.cardId, []);
    answers.get(answer.cardId).push(message);
  }
  for ( const card of openCards() ) {
    const request = requestOf(card);
    for ( const entry of request.entries ) {
      if ( request.results?.[entry.id] ) continue;
      const after = request.resets?.[entry.id] ?? 0;
      const latest = (answers.get(card.id) ?? []).filter(m => {
        const answer = m.flags[MODULE_ID].answer;
        return (answer.requestId === request.id) && (answer.entryId === entry.id) && ((m.timestamp ?? 0) > after);
      }).at(-1);
      if ( latest ) enqueue(card.id, () => recordAnswer(latest, latest.flags[MODULE_ID].answer, {late: true}));
    }
  }
}

/** Waits for the user list to settle before catching up. */
let catchUpTimer = null;

/**
 * Catch up a moment later: at "ready" and when the active GM changes (the GM before left).
 * @param {number} [delay]
 */
export function scheduleCatchUp(delay=1500) {
  clearTimeout(catchUpTimer);
  catchUpTimer = setTimeout(() => {
    try {
      catchUp();
    } catch(err) {
      console.error(`${MODULE_ID} | Catching up on results failed`, err);
    }
  }, delay);
}

/**
 * Take back the result of an entry, so it can be rolled again (GM). The card remembers when, so a GM catching up
 * later does not bring the old roll back.
 * @param {ChatMessage} card
 * @param {string} entryId
 */
export async function resetEntry(card, entryId) {
  const request = requestOf(card);
  if ( !game.user.isGM || !request ) return;
  const old = request.results?.[entryId];
  const stamp = game.messages.get(old?.messageId)?.timestamp ?? Date.now();
  await card.update({
    [`flags.${MODULE_ID}.request.results.-=${entryId}`]: null,
    [`flags.${MODULE_ID}.request.resets.${entryId}`]: stamp
  });
  debugTrace.add("reset", {messageId: card.id, entryId});
}

/* -------------------------------------------- */
/*  Hooks for other modules                     */
/* -------------------------------------------- */

/**
 * Hook "updateChatMessage" on every client: announce new results and finished requests once.
 * @param {ChatMessage} message
 */
export function onUpdateChatMessage(message) {
  const request = requestOf(message);
  if ( !request ) return;
  const before = seen.get(message.id) ?? {results: new Map(), complete: false};
  const now = snapshot(request);
  seen.set(message.id, now);
  const result = publicResult(request, message.id);
  for ( const [id, signature] of now.results ) {
    if ( before.results.get(id) === signature ) continue;
    const entry = request.entries.find(e => e.id === id);
    if ( entry ) Hooks.callAll(HOOKS.result, result, result.entries[request.entries.indexOf(entry)]);
  }
  if ( now.complete && !before.complete ) Hooks.callAll(HOOKS.completed, result);
}

/**
 * Remember what a card shows when this client first sees it, so a reload does not announce old results again.
 * @param {ChatMessage} message
 */
export function rememberCard(message) {
  const request = requestOf(message);
  if ( !request || seen.has(message.id) ) return;
  seen.set(message.id, snapshot(request));
}

/**
 * What a card shows right now: each result by the roll it came from, and whether all have rolled.
 * @param {object} request
 * @returns {{results: Map<string, string>, complete: boolean}}
 */
function snapshot(request) {
  const results = new Map(Object.entries(request.results ?? {}).map(([id, r]) => [id, `${r?.messageId}:${r?.total}`]));
  return {results, complete: summarize(request).complete};
}

/**
 * The open requests on this client, newest first.
 * @param {number} [maxAgeMs]   Older cards are left out
 * @returns {ChatMessage[]}
 */
export function openCards(maxAgeMs=6 * 60 * 60 * 1000) {
  const now = Date.now();
  return game.messages.contents
    .filter(m => {
      const request = requestOf(m);
      return request && !summarize(request).complete && ((now - (request.createdAt ?? 0)) < maxAgeMs);
    })
    .reverse();
}

export const __test__ = {plainContent};
