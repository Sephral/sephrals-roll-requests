/**
 * D&D 5e (5.x and 6.x): ability checks, saving throws, skills and tools through the actor's own roll methods, so
 * the system's dialog, bonuses and chat card stay as players know them.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, naturalD20, rollFormula, sortByLabel} from "./common.mjs";

/**
 * The roll choices of D&D 5e from its configuration.
 * @param {object} config        CONFIG.DND5E
 * @param {Function} toolLabel   (key) => label of a tool
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function dnd5eGroups(config, toolLabel) {
  const abilities = Object.entries(config?.abilities ?? {}).map(([key, a]) => ({key, label: loc(a?.label ?? key)}));
  const skills = Object.entries(config?.skills ?? {}).map(([key, s]) => ({key, label: loc(s?.label ?? key)}));
  const tools = Object.keys(config?.tools ?? {}).map(key => ({key, label: toolLabel(key) || key}));
  return [
    {type: "save", options: abilities},
    {type: "check", options: abilities},
    {type: "skill", options: sortByLabel(skills)},
    {type: "tool", options: sortByLabel(tools)}
  ].filter(group => group.options.length);
}

/**
 * The three configuration objects of a D&D 5e roll method.
 * @param {object} request
 * @param {object} [options]
 * @param {Event|null} [options.event]       The click, so the system's keys (Shift to skip the dialog) work
 * @param {boolean} [options.fastForward]    Skip the dialog (rolls the GM makes for NPCs)
 * @returns {[object, object, object]}
 */
export function dnd5eRollArgs(request, {event=null, fastForward=false}={}) {
  const config = {};
  if ( request.type === "skill" ) config.skill = request.key;
  else if ( request.type === "tool" ) config.tool = request.key;
  else config.ability = request.key;
  // The system marks success on its own card only when the players may know the DC
  if ( Number.isFinite(request.dc) && request.showDc ) config.target = request.dc;
  if ( request.advantage === "advantage" ) config.advantage = true;
  if ( request.advantage === "disadvantage" ) config.disadvantage = true;
  if ( event ) config.event = event;
  const dialog = fastForward ? {configure: false} : {};
  return [config, dialog, {create: true}];
}

/**
 * What a D&D 5e roll message is: {type, key} in the terms of a request, or null. D&D 5e 6 keeps it in the message
 * type and system data, 5.x in flags.dnd5e.roll.
 * @param {object} message
 * @returns {{type: string, key: string}|null}
 */
export function dnd5eRollKind(message) {
  const system = message?.system ?? {};
  if ( ["save", "check"].includes(message?.type) ) {
    if ( system.skill ) return {type: "skill", key: system.skill};
    if ( system.tool ) return {type: "tool", key: system.tool};
    return system.ability ? {type: message.type, key: system.ability} : null;
  }
  const roll = message?.flags?.dnd5e?.roll;
  if ( !roll?.type ) return null;
  if ( roll.type === "skill" ) return {type: "skill", key: roll.skillId};
  if ( roll.type === "tool" ) return {type: "tool", key: roll.toolId};
  if ( roll.type === "save" ) return {type: "save", key: roll.ability};
  if ( ["ability", "check"].includes(roll.type) ) return {type: "check", key: roll.ability};
  return null;
}

/** The D&D 5e adapter. */
export const dnd5e = {
  id: "dnd5e",
  scheme: "d20",
  advantage: true,
  defaultDc: null,

  /** @returns {object[]} */
  groups() {
    const keyLabel = globalThis.dnd5e?.documents?.Trait?.keyLabel;
    return dnd5eGroups(CONFIG.DND5E, key => {
      try {
        return keyLabel ? keyLabel(key, {trait: "tool"}) : key;
      } catch {
        return key;
      }
    });
  },

  /**
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return actor?.type === "character";
  },

  /**
   * @param {Actor} actor
   * @param {object} request
   * @param {object} options
   * @returns {Promise<*>}
   */
  async roll(actor, request, options={}) {
    if ( request.type === "formula" ) return rollFormula(actor, request, options);
    const args = dnd5eRollArgs(request, options);
    switch ( request.type ) {
      case "save": return actor.rollSavingThrow(...args);
      case "check": return actor.rollAbilityCheck(...args);
      case "skill": return actor.rollSkill(...args);
      case "tool": return actor.rollToolCheck(...args);
    }
    throw new Error(`Unknown roll type ${request.type}`);
  },

  /**
   * Whether a roll message is the kind a request asked for; null when the message does not say.
   * @param {object} message
   * @param {{type: string, key: string}} request
   * @returns {boolean|null}
   */
  matches(message, request) {
    if ( request.type === "formula" ) return null;
    const kind = dnd5eRollKind(message);
    return kind ? ((kind.type === request.type) && (kind.key === request.key)) : null;
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    const natural = naturalD20(roll);
    return {total, natural, ...judge({total, natural}, request.dc, "d20")};
  }
};
