/**
 * Planned checks: requests a GM prepares for a scene and sends later. Pure helpers without Foundry, the storage and
 * the sending are in `planned.mjs`. A planned check has the shape of a recent request (rolls, values) plus a label,
 * who rolls, and what happens after its use.
 */

import {ADVANTAGE, GROUP_RULES, MODES, recentRecord} from "./request-model.mjs";

/** Who rolls when a planned check is sent from the window. */
export const PLANNED_WHO = ["scene", "party", "selected", "all"];

/** What happens to a planned check after it was sent: it stays, or it is marked done. */
export const PLANNED_AFTER = ["keep", "done"];

/** How often the Region behavior runs a planned check: once per token (once per Region for all tokens) or every time. */
export const REGION_TIMES = ["once", "always"];

/** Whom the Region behavior asks: the token that entered, or every token in the Region. */
export const REGION_WHO = ["token", "region"];

/** The most planned checks of one scene. */
export const PLANNED_LIMIT = 30;

/** The longest label. */
export const LABEL_LENGTH = 60;

/**
 * Make a planned check from loose input. Unknown values fall back to the defaults.
 * @param {object} input
 * @param {string[]} input.rolls
 * @param {object} [input.values]
 * @param {string} [input.label]
 * @param {string} [input.who]
 * @param {string} [input.after]
 * @param {boolean} [input.done]
 * @param {string} [input.id]
 * @param {string} [fallbackId]      Id for a check without one
 * @returns {object|null}            Null when no roll is given
 */
export function normalizePlanned(input={}, fallbackId="") {
  const rolls = (Array.isArray(input.rolls) ? input.rolls : []).map(String).filter(Boolean);
  if ( !rolls.length ) return null;
  const base = recentRecord({rolls, actors: [], name: "", values: input.values ?? {}});
  const values = base.values;
  if ( !MODES.includes(values.mode) ) values.mode = "public";
  if ( !ADVANTAGE.includes(values.advantage) ) values.advantage = "normal";
  if ( (values.group !== "off") && !GROUP_RULES.includes(values.group) ) values.group = "off";
  const label = String(input.label ?? "").trim().slice(0, LABEL_LENGTH);
  return {
    id: String(input.id || fallbackId),
    label,
    rolls: base.rolls,
    values,
    who: PLANNED_WHO.includes(input.who) ? input.who : "scene",
    after: PLANNED_AFTER.includes(input.after) ? input.after : "keep",
    done: !!input.done
  };
}

/**
 * The stored list of a scene, cleaned.
 * @param {*} stored
 * @returns {object[]}
 */
export function plannedList(stored) {
  if ( !Array.isArray(stored) ) return [];
  const seen = new Set();
  const list = [];
  for ( const item of stored ) {
    const record = normalizePlanned(item ?? {}, item?.id);
    if ( !record || !record.id || seen.has(record.id) ) continue;
    seen.add(record.id);
    list.push(record);
  }
  return list;
}

/**
 * Add a check at the end. The oldest one drops out when the list is full.
 * @param {object[]} list
 * @param {object} record
 * @returns {object[]}
 */
export function addPlanned(list, record) {
  return [...list.filter(item => item.id !== record.id), record].slice(-PLANNED_LIMIT);
}

/**
 * Change one check. A change of what is asked (rolls or values) clears the done mark.
 * @param {object[]} list
 * @param {string} id
 * @param {object} patch
 * @returns {object[]}
 */
export function updatePlanned(list, id, patch) {
  return list.map(item => {
    if ( item.id !== id ) return item;
    const merged = {...item, ...patch, values: {...item.values, ...(patch.values ?? {})}, id};
    const record = normalizePlanned(merged, id) ?? item;
    const changed = patch.rolls || patch.values;
    if ( changed && !("done" in patch) ) record.done = false;
    return record;
  });
}

/**
 * Take a check out of the list.
 * @param {object[]} list
 * @param {string} id
 * @returns {object[]}
 */
export function removePlanned(list, id) {
  return list.filter(item => item.id !== id);
}

/**
 * Mark a check as used: it is done when it was set to be, otherwise it stays as it is.
 * @param {object[]} list
 * @param {string} id
 * @returns {object[]}
 */
export function markUsed(list, id) {
  return list.map(item => ((item.id === id) && (item.after === "done")) ? {...item, done: true} : item);
}

/**
 * The text of a check on its button: the label, or the description of the request.
 * @param {object} record
 * @param {string} described    What the request asks, as the window words it
 * @returns {string}
 */
export function plannedText(record, described) {
  return record.label || described;
}

/**
 * Whether a Region runs its check for a token now.
 * @param {object} options
 * @param {string} options.times        "once" or "always"
 * @param {string[]} options.fired      The keys that ran before
 * @param {string} options.key          The key of this run (the token id, or "*" for a whole Region)
 * @returns {boolean}
 */
export function shouldFire({times, fired, key}) {
  if ( times === "always" ) return true;
  return !(fired ?? []).includes(key);
}

/**
 * The key a Region run is remembered under.
 * @param {string} who         "token" or "region"
 * @param {string} tokenId
 * @returns {string}
 */
export function regionKey(who, tokenId) {
  return who === "region" ? "*" : String(tokenId);
}

/**
 * Add a key to the list of the ones that ran.
 * @param {string[]} fired
 * @param {string} key
 * @returns {string[]}
 */
export function rememberFired(fired, key) {
  return [...new Set([...(fired ?? []), key])];
}
