/**
 * Pathfinder 2e: perception, saving throws and skills through the actor's statistics, with the four degrees of
 * success. Fortune and misfortune stand in for advantage and disadvantage.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, naturalD20, rollFormula, sortByLabel} from "./common.mjs";

/** Icons and the attribute color of saves and skills (Font Awesome, part of Foundry). */
const LOOKS = {
  fortitude: ["fa-heart", "con"], reflex: ["fa-feather", "dex"], will: ["fa-compass", "wis"],
  perception: ["fa-eye", "wis"], acrobatics: ["fa-person-running", "dex"], arcana: ["fa-wand-sparkles", "int"],
  athletics: ["fa-mountain", "str"], crafting: ["fa-hammer", "int"], deception: ["fa-masks-theater", "cha"],
  diplomacy: ["fa-comments", "cha"], intimidation: ["fa-skull", "cha"], medicine: ["fa-kit-medical", "wis"],
  nature: ["fa-leaf", "wis"], occultism: ["fa-book-skull", "int"], performance: ["fa-music", "cha"],
  religion: ["fa-sun", "wis"], society: ["fa-users", "int"], stealth: ["fa-eye-slash", "dex"],
  survival: ["fa-campground", "wis"], thievery: ["fa-hand-sparkles", "dex"]
};

/**
 * An option with its icon and color.
 * @param {string} key
 * @param {string} label
 * @returns {{key: string, label: string, icon: string|null, tint: string|null}}
 */
function option(key, label) {
  return {key, label, icon: LOOKS[key]?.[0] ?? null, tint: LOOKS[key]?.[1] ?? null};
}

/**
 * The roll choices of PF2e from its configuration.
 * @param {object} config   CONFIG.PF2E
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function pf2eGroups(config) {
  const saves = Object.entries(config?.saves ?? {}).map(([key, label]) => option(key, loc(label?.label ?? label)));
  const skills = Object.entries(config?.skills ?? {}).map(([key, s]) => option(key, loc(s?.label ?? s)));
  return [
    {type: "save", icon: "fa-shield-halved", cols: 3, options: saves},
    {type: "skill", icon: "fa-star", cols: 3, options: [option("perception", loc("PF2E.PerceptionLabel")), ...sortByLabel(skills)]}
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
  advantageShort: {advantage: "SRR.Short.fortune", disadvantage: "SRR.Short.misfortune"},
  defaultDc: null,
  dcChips: [10, 15, 20, 25, 30, 35, 40],
  quick: ["skill:perception", "save:reflex", "save:will", "skill:stealth", "skill:athletics"],

  /** @returns {Actor[]} */
  party() {
    return [...(game.actors.party?.members ?? [])];
  },

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
