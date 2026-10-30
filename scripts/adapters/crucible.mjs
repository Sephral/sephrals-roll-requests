/**
 * Crucible: skill checks through the actor (three dice plus ability and skill against a DC). A check succeeds above
 * the DC and is critical by more than 6, like the system judges it.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, rollFormula, sortByLabel} from "./common.mjs";

/**
 * The roll choices of Crucible.
 * @param {object} skills   SYSTEM.SKILLS
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function crucibleGroups(skills) {
  const options = Object.entries(skills ?? {}).map(([key, s]) => ({key, label: loc(s?.label ?? key)}));
  return [{type: "skill", options: sortByLabel(options)}].filter(group => group.options.length);
}

/**
 * The options of a Crucible skill roll.
 * @param {object} request
 * @param {object} [options]
 * @param {boolean} [options.fastForward]
 * @returns {object}
 */
export function crucibleRollArgs(request, {fastForward=false}={}) {
  const args = {chatMessage: true, dialog: !fastForward};
  // Without a DC Crucible judges against its default; a hidden DC stays out of the system's card
  if ( Number.isFinite(request.dc) && request.showDc ) args.dc = request.dc;
  return args;
}

/** The Crucible adapter. */
export const crucible = {
  id: "crucible",
  scheme: "crucible",
  advantage: false,
  defaultDc: null,

  /** @returns {object[]} */
  groups() {
    return crucibleGroups(globalThis.SYSTEM?.SKILLS);
  },

  /**
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return actor?.type === "hero";
  },

  /**
   * @param {Actor} actor
   * @param {object} request
   * @param {object} options
   * @returns {Promise<*>}
   */
  async roll(actor, request, options={}) {
    if ( request.type === "formula" ) return rollFormula(actor, request, options);
    return actor.rollSkill(request.key, crucibleRollArgs(request, options));
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    // The check carries its own thresholds for critical results (talents and actions change them)
    const data = roll?.data ?? {};
    return {total, natural: null, ...judge({total}, request.dc, "crucible",
      {critical: data.criticalSuccessThreshold ?? null, fumble: data.criticalFailureThreshold ?? null})};
  }
};
