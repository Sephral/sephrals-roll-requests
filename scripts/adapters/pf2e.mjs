/**
 * Pathfinder 2e: perception, saving throws and skills through the actor's statistics, with the four degrees of
 * success. Fortune and misfortune stand in for advantage and disadvantage.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, naturalD20, rollFormula, sortByLabel} from "./common.mjs";

/**
 * The roll choices of PF2e from its configuration.
 * @param {object} config   CONFIG.PF2E
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function pf2eGroups(config) {
  const saves = Object.entries(config?.saves ?? {}).map(([key, label]) => ({key, label: loc(label?.label ?? label)}));
  const skills = Object.entries(config?.skills ?? {}).map(([key, s]) => ({key, label: loc(s?.label ?? s)}));
  return [
    {type: "save", options: saves},
    {type: "skill", options: [{key: "perception", label: loc("PF2E.PerceptionLabel")}, ...sortByLabel(skills)]}
  ].filter(group => group.options.length);
}

/**
 * The options of a PF2e statistic roll.
 * @param {object} request
 * @param {object} [options]
 * @param {Event|null} [options.event]
 * @param {boolean} [options.fastForward]
 * @returns {object}
 */
export function pf2eRollArgs(request, {event=null, fastForward=false}={}) {
  const args = {};
  if ( Number.isFinite(request.dc) && request.showDc ) args.dc = {value: request.dc};
  if ( request.advantage === "advantage" ) args.rollTwice = "keep-higher";
  if ( request.advantage === "disadvantage" ) args.rollTwice = "keep-lower";
  if ( fastForward ) args.skipDialog = true;
  else if ( event ) args.event = event;
  return args;
}

/** The PF2e adapter. */
export const pf2e = {
  id: "pf2e",
  scheme: "pf2e",
  advantage: true,
  advantageLabels: {advantage: "SRR.Advantage.fortune", disadvantage: "SRR.Advantage.misfortune"},
  defaultDc: null,

  /** @returns {object[]} */
  groups() {
    return pf2eGroups(CONFIG.PF2E);
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
    const statistic = actor.getStatistic?.(request.key)
      ?? (request.type === "save" ? actor.saves?.[request.key] : actor.skills?.[request.key]);
    if ( !statistic?.roll ) throw new Error(`${actor.name} has no ${request.key}`);
    return statistic.roll(pf2eRollArgs(request, options));
  },

  /**
   * Whether a check message is the statistic a request asked for (its domains name the statistic); null when the
   * message does not say.
   * @param {object} message
   * @param {{type: string, key: string}} request
   * @returns {boolean|null}
   */
  matches(message, request) {
    if ( request.type === "formula" ) return null;
    const domains = message?.flags?.pf2e?.context?.domains;
    return Array.isArray(domains) ? domains.includes(request.key) : null;
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    const natural = naturalD20(roll);
    // PF2e decides the degree itself when it knew the DC (feats like Juggernaut change it)
    const context = message?.flags?.pf2e?.context;
    const outcome = (context?.dc?.value === request.dc) ? context?.outcome ?? null : null;
    return {total, natural, ...judge({total, natural}, request.dc, "pf2e", {outcome})};
  }
};
