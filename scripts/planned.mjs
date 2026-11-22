/**
 * Planned checks: requests a GM prepares for a scene (stored as a scene flag), sends with one click from the request
 * window, or lets a Region run when a token walks in. Sending is the same `createRequest` as everywhere, nothing is
 * rolled or written before the GM or the Region asks.
 */

import {getAdapter} from "./adapters/index.mjs";
import {MODULE_ID, esc, fromUuidQuiet, t} from "./config.mjs";
import {REGION_TIMES, REGION_WHO, addPlanned, markUsed, normalizePlanned, plannedList, regionKey, rememberFired,
  removePlanned, shouldFire, updatePlanned} from "./planned-model.mjs";
import {parseRollId, requestFromRecent} from "./request-model.mjs";
import {createRequest, describeRoll, playerOwners} from "./requests.mjs";
import {countFeature} from "./usage.mjs";

/** The type of the Region behavior (Foundry puts the module id in front of the key of `documentTypes`). */
export const BEHAVIOR_TYPE = `${MODULE_ID}.plannedCheck`;

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/**
 * The scene of an id, a scene, or the viewed one.
 * @param {Scene|string|null} [scene]
 * @returns {Scene|null}
 */
export function sceneOf(scene) {
  if ( typeof scene === "string" ) return game.scenes.get(scene) ?? null;
  return scene ?? canvas?.scene ?? null;
}

/**
 * The planned checks of a scene.
 * @param {Scene|string|null} [scene]
 * @returns {object[]}
 */
export function planned(scene) {
  return plannedList(sceneOf(scene)?.getFlag(MODULE_ID, "planned"));
}

/**
 * @param {Scene} scene
 * @param {object[]} list
 * @returns {Promise<void>}
 */
async function store(scene, list) {
  await scene.setFlag(MODULE_ID, "planned", list);
}

/**
 * Plan a check for a scene (GM).
 * @param {Scene|string|null} scene
 * @param {object} input    rolls, values, label, who, after
 * @returns {Promise<object|null>}   The stored check, or null when it has no roll
 */
export async function createPlanned(scene, input) {
  const doc = sceneOf(scene);
  if ( !game.user.isGM || !doc ) return null;
  const record = normalizePlanned(input, foundry.utils.randomID(10));
  if ( !record ) return null;
  record.done = false;
  await store(doc, addPlanned(planned(doc), record));
  countFeature(MODULE_ID, "plannedCreated");
  return record;
}

/**
 * Change a planned check (GM).
 * @param {Scene|string|null} scene
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<void>}
 */
export async function editPlanned(scene, id, patch) {
  const doc = sceneOf(scene);
  if ( !game.user.isGM || !doc ) return;
  await store(doc, updatePlanned(planned(doc), id, patch));
}

/**
 * Delete a planned check (GM).
 * @param {Scene|string|null} scene
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePlanned(scene, id) {
  const doc = sceneOf(scene);
  if ( !game.user.isGM || !doc ) return;
  await store(doc, removePlanned(planned(doc), id));
}

/* -------------------------------------------- */
/*  Who rolls                                   */
/* -------------------------------------------- */

/**
 * Whether the players of a character are all away. A character nobody plays counts as here.
 * @param {string} uuid
 * @returns {boolean}
 */
function isAway(uuid) {
  const doc = fromUuidQuiet(uuid);
  const owners = playerOwners(doc?.actor ?? doc);
  return (owners.length > 0) && !owners.some(user => user.active);
}

/**
 * The characters a list names, like the lists of the request window.
 * @param {Scene} scene
 * @param {string} who      scene, party, selected or all
 * @returns {string[]}      uuids
 */
export function actorsFor(scene, who) {
  const adapter = getAdapter();
  const players = game.actors.filter(actor => actor.hasPlayerOwner && adapter.isCharacter(actor));
  let list = [];
  switch ( who ) {
    case "selected": {
      const docs = (canvas?.ready ? canvas.tokens.controlled : []).map(token => token.document).filter(doc => doc?.actor);
      return [...new Set(docs.map(doc => (doc.actorLink && doc.actor) ? doc.actor.uuid : doc.uuid))];
    }
    case "all":
      list = players.map(actor => actor.uuid);
      break;
    case "party": {
      let party = [];
      try {
        party = adapter.party?.() ?? [];
      } catch {}
      if ( !party.length ) party = game.users.filter(user => !user.isGM && user.character).map(user => user.character);
      list = [...new Set(party.map(actor => actor.uuid))];
      break;
    }
    default: {
      const onScene = new Set((scene?.tokens ?? []).map(token => token.actor?.id).filter(Boolean));
      list = players.filter(actor => onScene.has(actor.id)).map(actor => actor.uuid);
    }
  }
  const here = list.filter(uuid => !isAway(uuid));
  return here.length ? here : list;
}

/* -------------------------------------------- */
/*  Sending                                     */
/* -------------------------------------------- */

/**
 * The input of a request from a planned check.
 * @param {object} record
 * @returns {object}
 */
export function inputOf(record) {
  return requestFromRecent(record, record.rolls.map(parseRollId));
}

/**
 * The words of a planned check: its label, or what it asks.
 * @param {object} record
 * @returns {string}
 */
export function describePlanned(record) {
  if ( record.label ) return record.label;
  const rolls = record.rolls.map(parseRollId);
  const first = describeRoll({type: rolls[0].type, key: rolls[0].key, title: ""});
  return rolls.length > 1 ? `${first} +${rolls.length - 1}` : first;
}

/**
 * Send a planned check (GM).
 * @param {Scene|string|null} scene
 * @param {string} id
 * @param {object} [options]
 * @param {Array} [options.actors]      Actors, tokens or uuids; otherwise the list of the check
 * @param {string} [options.source]     "window" or "region"
 * @returns {Promise<ChatMessage|null>}
 */
export async function sendPlanned(scene, id, {actors, source="window"}={}) {
  const doc = sceneOf(scene);
  if ( !game.user.isGM ) throw new Error(t("SRR.Error.gmOnly"));
  const record = planned(doc).find(item => item.id === id);
  if ( !record ) {
    if ( source === "window" ) ui.notifications.warn(t("SRR.Planned.gone"));
    return null;
  }
  const who = actors ?? actorsFor(doc, record.who);
  if ( !who.length ) {
    if ( source === "window" ) ui.notifications.warn(t(record.who === "selected" ? "SRR.Request.noneSelected" : "SRR.Error.noActors"));
    return null;
  }
  let message;
  try {
    message = await createRequest({...inputOf(record), actors: who, rollActors: []});
  } catch(err) {
    const key = String(err?.message ?? err);
    ui.notifications.warn(game.i18n.has(key) ? t(key) : key);
    return null;
  }
  if ( source === "region" ) countFeature(MODULE_ID, "plannedRegion");
  else {
    countFeature(MODULE_ID, "plannedSent");
    await store(doc, markUsed(planned(doc), id));
  }
  return message;
}

/* -------------------------------------------- */
/*  The Region behavior                         */
/* -------------------------------------------- */

/** Runs in progress by behavior and key, so two tokens entering at once start one run. */
const running = new Set();

/**
 * Register the behavior type. Call in "init".
 */
export function registerBehavior() {
  const config = CONFIG.RegionBehavior;
  if ( !config || !foundry.data?.regionBehaviors?.RegionBehaviorType ) return;
  config.dataModels[BEHAVIOR_TYPE] = createBehaviorClass();
  config.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-calendar-check";
  (config.typeLabels ??= {})[BEHAVIOR_TYPE] = "SRR.BEHAVIOR.label";
  (config.typeHints ??= {})[BEHAVIOR_TYPE] = "SRR.BEHAVIOR.hint";
}

/**
 * A token entered the Region: run the check when the rules say so. Only the active GM does.
 * @param {RegionBehavior} behavior
 * @param {object} rules          check, who, times, playersOnly
 * @param {TokenDocument} token
 * @param {RegionDocument} region
 * @returns {Promise<ChatMessage|null>}
 */
export async function runRegionCheck(behavior, {check, who, times, playersOnly}, token, region) {
  if ( !game.user.isGM || (game.users.activeGM?.id !== game.user.id) ) return null;
  if ( !token?.actor || !check ) return null;
  if ( playersOnly && !token.actor.hasPlayerOwner ) return null;
  const scene = region?.parent ?? token.parent;
  const key = regionKey(who, token.id);
  const flagKey = `${behavior.id}:${key}`;
  const fired = behavior.getFlag(MODULE_ID, "fired") ?? [];
  if ( !shouldFire({times, fired, key}) || running.has(flagKey) ) return null;
  running.add(flagKey);
  try {
    let targets = [token];
    if ( who === "region" ) {
      targets = [...new Set([token, ...(region?.tokens ?? [])])].filter(doc => doc?.actor && (!playersOnly || doc.actor.hasPlayerOwner));
    }
    const message = await sendPlanned(scene, check, {actors: targets, source: "region"});
    if ( message && (times === "once") ) await behavior.setFlag(MODULE_ID, "fired", rememberFired(fired, key));
    return message;
  } finally {
    running.delete(flagKey);
  }
}

/**
 * The behavior class. It extends a Foundry class, so it is built when Foundry is there.
 * @returns {typeof foundry.data.regionBehaviors.RegionBehaviorType}
 */
function createBehaviorClass() {
  return class PlannedCheckBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
    /** @override */
    static LOCALIZATION_PREFIXES = ["SRR.BEHAVIOR", "BEHAVIOR.TYPES.base"];

    /** @override */
    static defineSchema() {
      const fields = foundry.data.fields;
      const E = CONST.REGION_EVENTS;
      const choices = (list, prefix) => Object.fromEntries(list.map(id => [id, `${prefix}.${id}`]));
      return {
        events: this._createEventsField({events: [E.TOKEN_ENTER], initial: [E.TOKEN_ENTER]}),
        check: new fields.StringField({required: true, blank: true, initial: ""}),
        who: new fields.StringField({required: true, blank: false, initial: "token", choices: choices(REGION_WHO, "SRR.BEHAVIOR.who")}),
        times: new fields.StringField({required: true, blank: false, initial: "once", choices: choices(REGION_TIMES, "SRR.BEHAVIOR.times")}),
        playersOnly: new fields.BooleanField({initial: true})
      };
    }

    /** @override */
    async _handleRegionEvent(event) {
      if ( event.name !== CONST.REGION_EVENTS.TOKEN_ENTER ) return;
      try {
        await runRegionCheck(this.behavior, this, event.data?.token, this.region);
      } catch(err) {
        console.error(`${MODULE_ID} | The region ${this.region?.name} could not run its planned check`, err);
      }
    }
  };
}

/**
 * Hook "renderRegionBehaviorConfig": the field of the check becomes a choice of the planned checks of the scene.
 * @param {ApplicationV2} app
 * @param {HTMLElement} html
 */
export function onRenderBehaviorConfig(app, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const input = element?.querySelector('input[name="system.check"]');
  if ( !input ) return;
  const scene = app.document?.parent?.parent ?? canvas?.scene;
  input.replaceWith(checkSelect(input.value, planned(scene)));
}

/**
 * The choice of the planned checks of a scene, for the check field of the Region behavior.
 * @param {string} value        The stored check id
 * @param {object[]} list       The planned checks
 * @returns {HTMLSelectElement}
 */
export function checkSelect(value, list) {
  const select = document.createElement("select");
  select.name = "system.check";
  const options = [{id: "", text: t("SRR.BEHAVIOR.none")}, ...list.map(item => ({id: item.id, text: describePlanned(item)}))];
  if ( value && !list.some(item => item.id === value) ) options.push({id: value, text: t("SRR.Planned.gone")});
  select.innerHTML = options.map(o => `<option value="${esc(o.id)}"${o.id === value ? " selected" : ""}>${esc(o.text)}</option>`).join("");
  return select;
}
