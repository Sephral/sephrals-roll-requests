/**
 * Daggerheart: trait checks and reaction rolls through the actor (a duality roll: a Hope die and a Fear die plus the
 * trait and its modifiers against a difficulty). A check succeeds when the total reaches the difficulty or Hope and
 * Fear show the same number (a critical success). Which die is higher says whether the roll is made with Hope or
 * with Fear, and the card shows that next to the result.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, rollFormula, sortByLabel} from "./common.mjs";

/** Icons and colors of the six traits (Font Awesome, part of Foundry). */
const TRAIT_LOOKS = {agility: ["fa-feather", "dex"], strength: ["fa-dumbbell", "str"], finesse: ["fa-hand", "cha"],
  instinct: ["fa-eye", "wis"], presence: ["fa-masks-theater", "con"], knowledge: ["fa-book-open", "int"]};

/** The order of the traits on the character sheet. */
const TRAIT_ORDER = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

/**
 * A key for an experience from its name ("Tracker!" → "tracker").
 * @param {string} name
 * @returns {string}
 */
export function experienceSlug(name) {
  return String(name ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/**
 * The experiences of an actor as {id, name, value}.
 * @param {Actor} actor
 * @returns {{id: string, name: string, value: number}[]}
 */
export function experiencesOf(actor) {
  const list = actor?.system?.experiences ?? {};
  return Object.entries(list).map(([id, e]) => ({id, name: String(e?.name ?? "").trim(), value: Number(e?.value) || 0}))
    .filter(e => e.name);
}

/**
 * The roll choices of Daggerheart.
 * @param {object} abilities     CONFIG.DH.ACTOR.abilities (the traits)
 * @param {object[]} [actors]    Actors whose experiences are added
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function daggerheartGroups(abilities, actors=[]) {
  const ids = TRAIT_ORDER.filter(id => abilities?.[id]).concat(Object.keys(abilities ?? {}).filter(id => !TRAIT_ORDER.includes(id)));
  const traits = ids.map(key => ({key, label: loc(abilities[key]?.label ?? key),
    icon: TRAIT_LOOKS[key]?.[0] ?? null, tint: TRAIT_LOOKS[key]?.[1] ?? null}));
  const experiences = new Map();
  for ( const actor of actors ) {
    for ( const {name} of experiencesOf(actor) ) {
      const key = experienceSlug(name);
      if ( key && !experiences.has(key) ) experiences.set(key, name);
    }
  }
  return [
    {type: "trait", icon: "fa-dice-d12", cols: 3, options: traits},
    {type: "reaction", icon: "fa-bolt", cols: 3, options: traits.map(o => ({...o}))},
    {type: "experience", icon: "fa-bookmark", cols: 3,
      options: sortByLabel([...experiences].map(([key, label]) => ({key, label, icon: "fa-bookmark"})))}
  ].filter(group => group.options.length);
}

/**
 * The trait with the highest modifier of an actor, the first on the sheet when they are equal.
 * @param {Actor} actor
 * @returns {string}
 */
export function bestTrait(actor) {
  const traits = actor?.system?.traits ?? {};
  let best = TRAIT_ORDER[0];
  let value = -Infinity;
  for ( const id of TRAIT_ORDER ) {
    const mod = Number(traits[id]?.value);
    if ( Number.isFinite(mod) && (mod > value) ) {
      best = id;
      value = mod;
    }
  }
  return best;
}

/**
 * What a request asks of the system: the trait, the experiences to start with and the options of the roll.
 * @param {object} request
 * @param {Actor} actor
 * @param {object} [options]
 * @param {Event|null} [options.event]
 * @param {boolean} [options.fastForward]
 * @returns {{trait: string, args: object}}
 */
export function daggerheartRollArgs(request, actor, {event=null, fastForward=false}={}) {
  const experience = request.type === "experience";
  const trait = experience ? bestTrait(actor) : request.key;
  const roll = {type: "trait", trait};
  // Without a difficulty the system rolls without judging; a hidden one stays out of the system's own card
  if ( Number.isFinite(request.dc) && request.showDc ) roll.difficulty = request.dc;
  if ( request.advantage === "advantage" ) roll.advantage = 1;
  if ( request.advantage === "disadvantage" ) roll.advantage = -1;
  const args = {roll, actionType: request.type === "reaction" ? "reaction" : "action"};
  if ( experience ) {
    const chosen = experiencesOf(actor).filter(e => experienceSlug(e.name) === request.key);
    args.experiences = chosen.map(e => e.id);
    // The roll dialog adds one Hope (one Fear for adversaries) per experience; started selected, it still costs that
    args.costs = chosen.map(e => ({extKey: e.id, key: actor?.type === "adversary" ? "fear" : "hope", value: 1, name: e.name}));
  }
  // The system skips its dialog when a modifier key is held; a quick roll acts as if Shift was
  if ( fastForward ) args.event = {shiftKey: true, altKey: false, ctrlKey: false, metaKey: false};
  else if ( event ) args.event = event;
  // A secret roll must not move the Hope and Fear counters or the countdowns the players can see, nor run triggers
  if ( request.mode === "silent" ) args.skips = {resources: true, updateCountdowns: true, triggers: true};
  return {trait, args};
}

/**
 * Hope, Fear and the kept dice of a duality roll.
 * @param {object} roll
 * @returns {{hope: number, fear: number, critical: boolean, duality: "hope"|"fear"|"critical"}|null}
 */
export function dualityOf(roll) {
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const named = name => dice.find(die => (die?.constructor?.name === name) || (die?.class === name));
  // Dice are taken by position only for a message that says it is a duality trait roll
  const duality = (roll?.constructor?.name === "DualityRoll") || (roll?.options?.roll?.type === "trait");
  const hopeDie = named("HopeDie") ?? (duality ? dice[0] : null);
  const fearDie = named("FearDie") ?? (duality ? dice[1] : null);
  const value = die => {
    const total = Number(die?.total);
    if ( Number.isFinite(total) ) return total;
    const kept = (die?.results ?? []).filter(r => (r.active !== false) && !r.discarded);
    return kept.length ? kept.reduce((sum, r) => sum + Number(r.result), 0) : null;
  };
  const hope = value(hopeDie);
  const fear = value(fearDie);
  const guaranteed = !!(roll?.guaranteedCritical ?? roll?.options?.guaranteedCritical);
  if ( !Number.isFinite(hope) || !Number.isFinite(fear) ) return guaranteed ? {hope: null, fear: null, critical: true, duality: "critical"} : null;
  const critical = guaranteed || (hope === fear);
  return {hope, fear, critical, duality: critical ? "critical" : hope > fear ? "hope" : "fear"};
}

/**
 * Whether a roll message is a duality roll of the trait a request asked for. Null when the message does not say.
 * @param {object} message
 * @param {{type: string, key: string}} request
 * @param {Actor} [actor]
 * @returns {boolean|null}
 */
export function dualityMatches(message, request, actor=null) {
  if ( request.type === "formula" ) return null;
  const roll = (message?.rolls ?? [])[0];
  const info = roll?.options?.roll;
  if ( !info || (typeof info !== "object") ) return null;
  const reaction = (roll.options?.actionType ?? message?.system?.actionType) === "reaction";
  // A player can flip the reaction toggle in the system dialog: the roll still answers the trait asked for
  const same = reaction === (request.type === "reaction");
  if ( request.type === "experience" ) return info.type === "trait" ? (same ? true : null) : false;
  if ( info.trait !== request.key ) return false;
  return same ? true : null;
}

/**
 * The name of the trait a request asks for, for a roll without a Daggerheart dialog.
 * @param {{type: string, key: string, title?: string}} request
 * @returns {string}
 */
function choiceLabelOf(request) {
  const abilities = globalThis.CONFIG?.DH?.ACTOR?.abilities;
  return request.type === "experience" ? (request.title || request.key) : loc(abilities?.[request.key]?.label ?? request.key);
}

/** The Daggerheart adapter. */
export const daggerheart = {
  id: "daggerheart",
  scheme: "daggerheart",
  advantage: true,
  defaultDc: null,
  dcName: "difficulty",
  rollsOfActors: true,
  dcChips: [8, 10, 12, 14, 16, 18, 20],
  quick: ["trait:agility", "trait:instinct", "trait:presence", "trait:knowledge", "trait:strength"],

  /**
   * @param {Actor[]} [actors]
   * @returns {object[]}
   */
  groups(actors=[]) {
    return daggerheartGroups(globalThis.CONFIG?.DH?.ACTOR?.abilities, actors);
  },

  /**
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return actor?.type === "character";
  },

  /**
   * The active party of the world, when it has one (the characters in it).
   * @returns {Actor[]}
   */
  party() {
    const party = game.actors?.party;
    return [...(party?.system?.partyMembers ?? [])].filter(actor => actor?.type === "character");
  },

  /**
   * Players get the system's roll dialog with its experiences, rallies and advantage. Rolls the GM makes for a
   * request skip it.
   * @param {Actor} actor
   * @param {object} request
   * @param {object} options
   * @returns {Promise<*>}
   */
  async roll(actor, request, options={}) {
    if ( request.type === "formula" ) return rollFormula(actor, request, options);
    // Adversaries and the like have no traits: they roll a plain d20 against the difficulty, as the GM does for them
    if ( (typeof actor.rollTrait !== "function") || !Object.keys(actor.system?.traits ?? {}).length ) {
      const label = choiceLabelOf(request);
      return rollFormula(actor, {...request, formula: "1d20", label}, options);
    }
    const {trait, args} = daggerheartRollArgs(request, actor, options);
    if ( !actor.system?.traits?.[trait] ) throw new Error(`${actor.name} has no ${trait}`);
    try {
      return await actor.rollTrait(trait, args);
    } catch(err) {
      // A silent roll never becomes a chat message, and a 3D dice module waits for the id of that message afterwards
      if ( (request.mode === "silent") && globalThis.game?.dice3d ) return true;
      throw err;
    }
  },

  /**
   * @param {object} message
   * @param {object} request
   * @returns {boolean|null}
   */
  matches(message, request) {
    return dualityMatches(message, request);
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    if ( request.type === "formula" ) return {total, natural: null, ...judge({total}, request.dc, "d20")};
    const duality = dualityOf(roll);
    return {total, natural: null, duality: duality?.duality ?? null,
      ...judge({total}, request.dc, "daggerheart", {crit: !!duality?.critical})};
  }
};
