/**
 * Savage Worlds (SWADE): attribute and skill rolls through the actor, with the target number 4 unless the GM sets
 * another, raises and critical failures. A character without the skill makes an unskilled attempt.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, rollFormula, sortByLabel} from "./common.mjs";

/**
 * The SWADE id of a skill name ("Common Knowledge" → "common-knowledge").
 * @param {string} name
 * @returns {string}
 */
export function swadeSlug(name) {
  return String(name ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/**
 * The roll choices of SWADE.
 * @param {object} config        CONFIG.SWADE
 * @param {string} coreSkills    The comma list of the core skills setting
 * @param {object[]} [actors]    Actors whose own skills are added
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function swadeGroups(config, coreSkills, actors=[]) {
  const attributes = Object.entries(config?.attributes ?? {}).map(([key, a]) => ({key, label: loc(a?.long ?? a)}));
  const skills = new Map();
  for ( const name of String(coreSkills ?? "").split(",").map(s => s.trim()).filter(Boolean) ) {
    skills.set(swadeSlug(name), name);
  }
  for ( const actor of actors ) {
    for ( const item of actor?.items ?? [] ) {
      if ( item.type !== "skill" ) continue;
      const key = item.system?.swid || swadeSlug(item.name);
      // The stand-in skill of an unskilled attempt is no choice of its own
      if ( key === "unskilled-attempt" ) continue;
      if ( !skills.has(key) ) skills.set(key, item.name);
    }
  }
  return [
    {type: "attribute", options: attributes},
    {type: "skill", options: sortByLabel([...skills].map(([key, label]) => ({key, label})))}
  ].filter(group => group.options.length);
}

/**
 * The skill item of an actor for a request key.
 * @param {Actor} actor
 * @param {string} key
 * @returns {Item|null}
 */
export function findSkill(actor, key) {
  return (actor?.items ?? []).find(i => (i.type === "skill")
    && ((i.system?.swid === key) || (swadeSlug(i.name) === key))) ?? null;
}

/** The SWADE adapter. */
export const swade = {
  id: "swade",
  scheme: "swade",
  advantage: false,
  defaultDc: 4,
  dcName: "tn",

  /**
   * @param {Actor[]} [actors]
   * @returns {object[]}
   */
  groups(actors=[]) {
    let core = "";
    try {
      core = game.settings.get("swade", "coreSkills");
    } catch {}
    return swadeGroups(CONFIG.SWADE, core, actors);
  },

  /**
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return actor?.type === "character";
  },

  /**
   * Players get the system's roll dialog. Rolls the GM makes for NPCs skip it: the system builds the roll with all
   * modifiers, and it goes to chat directly.
   * @param {Actor} actor
   * @param {object} request
   * @param {object} options
   * @returns {Promise<*>}
   */
  async roll(actor, request, options={}) {
    if ( request.type === "formula" ) return rollFormula(actor, request, options);
    const quiet = options.fastForward ? {suppressChat: true} : {};
    let result;
    let label;
    if ( request.type === "attribute" ) {
      label = loc(globalThis.CONFIG?.SWADE?.attributes?.[request.key]?.long ?? request.key);
      result = await actor.rollAttribute(request.key, {...quiet});
    }
    else {
      const skill = findSkill(actor, request.key);
      label = skill?.name ?? request.label ?? request.key;
      result = skill ? await actor.rollSkill(skill.id, {...quiet}) : await actor.makeUnskilledAttempt({...quiet});
    }
    if ( options.fastForward && result && !result._evaluated ) {
      await result.evaluate();
      await result.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor: label});
    }
    return result;
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    return {total, natural: null, ...judge({total}, request.dc, "swade", {critfail: !!roll?.isCritfail})};
  }
};
