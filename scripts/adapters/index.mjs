/**
 * The adapter of the running game system. Systems without an adapter get the generic one: a formula with the
 * actor's roll data (for example 1d20 + @abilities.dex.mod).
 */

import {judge} from "../request-model.mjs";
import {firstTotal, naturalD20, rollFormula} from "./common.mjs";
import {crucible} from "./crucible.mjs";
import {dnd5e} from "./dnd5e.mjs";
import {pf2e} from "./pf2e.mjs";
import {swade} from "./swade.mjs";

/** Every system adapter by system id. */
export const ADAPTERS = {dnd5e, pf2e, swade, crucible};

/** The adapter for any other system: formula rolls only. */
export const generic = {
  id: "generic",
  scheme: "d20",
  advantage: false,
  defaultDc: null,

  /** @returns {object[]} */
  groups() {
    return [];
  },

  /**
   * Player characters are actors a player owns.
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return !!actor?.hasPlayerOwner;
  },

  /**
   * @param {Actor} actor
   * @param {object} request
   * @param {object} options
   * @returns {Promise<*>}
   */
  async roll(actor, request, options={}) {
    return rollFormula(actor, request, options);
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

/**
 * The adapter for a system id.
 * @param {string} [systemId]
 * @returns {object}
 */
export function getAdapter(systemId=globalThis.game?.system?.id) {
  return ADAPTERS[systemId] ?? generic;
}

/**
 * The roll choices of the running system, with the formula at the end.
 * @param {Actor[]} [actors]   Actors whose own choices count (SWADE skills)
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function rollGroups(actors=[]) {
  let groups = [];
  try {
    groups = getAdapter().groups(actors);
  } catch(err) {
    console.warn("sephrals-roll-requests | The roll choices of the system could not be read", err);
  }
  return [...groups, {type: "formula", options: [{key: "", label: ""}]}];
}

/**
 * The label of a choice of the running system.
 * @param {string} type
 * @param {string} key
 * @param {object[]} [groups]
 * @returns {string|null}
 */
export function choiceLabel(type, key, groups=rollGroups()) {
  return groups.find(g => g.type === type)?.options.find(o => o.key === key)?.label ?? null;
}
