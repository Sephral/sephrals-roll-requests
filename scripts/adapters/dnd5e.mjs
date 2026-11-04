/**
 * D&D 5e (5.x and 6.x): ability checks, saving throws, skills, tools, initiative, death saves, concentration and hit
 * dice through the actor's own roll methods, so the system's dialog, bonuses and chat card stay as players know them.
 * Passive values need no roll, they are read from the character.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, naturalD20, rollFormula, sortByLabel} from "./common.mjs";

/** Icons of the abilities (Font Awesome, part of Foundry). */
const ABILITY_ICONS = {str: "fa-dumbbell", dex: "fa-feather", con: "fa-heart", int: "fa-lightbulb", wis: "fa-compass",
  cha: "fa-comment"};

/** Icons of the skills. */
const SKILL_ICONS = {acr: "fa-person-running", ani: "fa-paw", arc: "fa-wand-sparkles", ath: "fa-mountain",
  dec: "fa-masks-theater", his: "fa-hourglass-half", ins: "fa-bullseye", itm: "fa-skull", inv: "fa-magnifying-glass",
  med: "fa-kit-medical", nat: "fa-leaf", prc: "fa-eye", prf: "fa-music", per: "fa-comments", rel: "fa-sun",
  slt: "fa-hand-sparkles", ste: "fa-eye-slash", sur: "fa-campground"};

/** The rolls of the group "combat": the key names the roll, its icon stands beside it. */
const COMBAT = {initiative: "fa-bolt", death: "fa-skull-crossbones", concentration: "fa-brain", hitDie: "fa-dice-d6"};

/** The passive values worth a button. */
const PASSIVE = ["prc", "ins", "inv"];

/** Which tab a tool sits on. Everything else, tools of the world included, goes to the kits. */
const TOOL_TABS = {
  art: ["alchemist", "brewer", "calligrapher", "carpenter", "cartographer", "cobbler", "cook", "glassblower", "jeweler",
    "leatherworker", "mason", "painter", "potter", "smith", "tinker", "weaver", "woodcarver"],
  game: ["card", "chess", "dice"],
  music: ["bagpipes", "drum", "dulcimer", "flute", "horn", "lute", "lyre", "panflute", "shawm", "viol"]
};

/**
 * The tab of a tool.
 * @param {string} key
 * @returns {string}
 */
function toolTab(key) {
  return Object.keys(TOOL_TABS).find(tab => TOOL_TABS[tab].includes(key)) ?? "kits";
}

/**
 * The roll choices of D&D 5e from its configuration.
 * @param {object} config        CONFIG.DND5E
 * @param {Function} toolLabel   (key) => label of a tool
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function dnd5eGroups(config, toolLabel) {
  const abilities = Object.entries(config?.abilities ?? {}).map(([key, a]) => ({key, label: loc(a?.label ?? key),
    short: loc(a?.abbreviation ?? key).slice(0, 3), icon: ABILITY_ICONS[key] ?? null, tint: key}));
  const skills = Object.entries(config?.skills ?? {}).map(([key, s]) => ({key, label: loc(s?.label ?? key),
    icon: SKILL_ICONS[key] ?? null, tint: s?.ability ?? null}));
  const tools = Object.keys(config?.tools ?? {}).map(key => ({key, label: toolLabel(key) || key, tab: toolTab(key)}));
  const combat = Object.entries(COMBAT).map(([key, icon]) => ({key, label: loc(`SRR.Roll.${key}`), icon}));
  const passive = skills.filter(s => PASSIVE.includes(s.key));
  return [
    {type: "save", icon: "fa-shield-halved", cols: 6, options: abilities},
    {type: "check", icon: "fa-dice-d20", cols: 6, options: abilities},
    {type: "skill", icon: "fa-star", cols: 3, options: sortByLabel(skills)},
    {type: "combat", icon: "fa-swords", cols: 4, fit: true, options: abilities.length ? combat : []},
    {type: "passive", icon: "fa-eye", cols: 3, options: sortByLabel(passive)},
    {type: "tool", icon: "fa-wrench", cols: 3, options: sortByLabel(tools), tabs: [
      {id: "kits", icon: "fa-toolbox"}, {id: "art", icon: "fa-hammer"}, {id: "game", icon: "fa-dice"},
      {id: "music", icon: "fa-music"}]}
  ].filter(group => group.options.length);
}

/** The roll modes by the results of a request: Foundry 14 named them new. */
const ROLL_MODES = {
  13: {public: "publicroll", gm: "gmroll", blind: "blindroll", silent: "gmroll"},
  14: {public: "public", gm: "gm", blind: "blind", silent: "gm"}
};

/**
 * The message options of a roll. The visibility goes in from the start: the mark of the request reaches the message
 * only when it is created, but Midi QOL shows its dice before that, and before version 6 dnd5e posts a text about a
 * critical or third death save that has no rolls and so no mark at all.
 * @param {object} request
 * @returns {object}
 */
export function dnd5eMessage(request) {
  const generation = globalThis.game?.release?.generation ?? 13;
  const rollMode = ROLL_MODES[generation >= 14 ? 14 : 13][request?.mode];
  return rollMode ? {create: true, rollMode} : {create: true};
}

/**
 * Roll initiative, a death save, concentration or a hit die.
 * @param {Actor} actor
 * @param {object} request
 * @param {object} [options]
 * @param {Event|null} [options.event]
 * @param {boolean} [options.fastForward]
 * @returns {Promise<*>}   False when the character cannot make the roll
 */
async function rollCombat(actor, request, {event=null, fastForward=false}={}) {
  const advantage = request.advantage === "advantage";
  const disadvantage = request.advantage === "disadvantage";
  const config = {};
  if ( Number.isFinite(request.dc) && request.showDc ) config.target = request.dc;
  if ( advantage ) config.advantage = true;
  if ( disadvantage ) config.disadvantage = true;
  if ( event ) config.event = event;
  const dialog = fastForward ? {configure: false} : {};
  switch ( request.key ) {
    case "initiative": {
      const options = {advantage, disadvantage};
      // Foundry skips a character that has rolled already unless told otherwise, and its dialog cannot be told
      const rolled = globalThis.game?.combat?.combatants.some(c => (c.actor === actor) && (c.initiative !== null));
      if ( fastForward || rolled ) return actor.rollInitiative({createCombatants: true, rerollInitiative: true}, options);
      return actor.rollInitiativeDialog({...options, event: event ?? undefined});
    }
    case "death": return actor.rollDeathSave(config, dialog, dnd5eMessage(request));
    case "concentration": return actor.rollConcentration(config, dialog, dnd5eMessage(request));
    case "hitDie":
      if ( !actor.system?.attributes?.hd?.value ) return false;
      return actor.rollHitDie({}, dialog, dnd5eMessage(request));
  }
  throw new Error(`Unknown roll ${request.key}`);
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
  return [config, dialog, dnd5eMessage(request)];
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
  dcChips: [5, 10, 12, 15, 18, 20, 25, 30],
  quick: ["skill:prc", "save:dex", "save:wis", "skill:ins", "skill:ste"],

  /** @returns {Actor[]} */
  party() {
    return (game.actors.party?.system?.members ?? []).map(member => member.actor).filter(Boolean);
  },

  /**
   * A passive value of a character.
   * @param {Actor} actor
   * @param {string} key
   * @returns {number|null}
   */
  passive(actor, key) {
    const value = Number(actor?.system?.skills?.[key]?.passive);
    return Number.isFinite(value) ? value : null;
  },

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
    if ( request.type === "combat" ) return rollCombat(actor, request, options);
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
    if ( ["formula", "combat"].includes(request.type) ) return null;
    const kind = dnd5eRollKind(message);
    if ( kind ) return (kind.type === request.type) && (kind.key === request.key);
    // A message that names another kind, like an attack or damage, is no answer either
    return message?.flags?.dnd5e?.roll?.type ? false : null;
  },

  /**
   * @param {ChatMessage} message
   * @param {object} request
   * @returns {object}
   */
  evaluate(message, request) {
    const {roll, total} = firstTotal(message);
    const natural = naturalD20(roll);
    // A death save has a DC of its own
    const dc = (request.type === "combat") && (request.key === "death") ? (request.dc ?? 10) : request.dc;
    return {total, natural, ...judge({total, natural}, dc, "d20")};
  }
};
