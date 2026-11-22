/**
 * Tormenta20: attribute tests, skill tests (initiative is a skill) and the three saving throws through the actor's own
 * methods (`rollAtributo`, `rollPericia`), so the system's roll dialog, bonuses and chat card stay as players know them.
 * A test succeeds when the total reaches the DC. The system names no degrees and a natural 20 is no special result of a
 * test, so a request judges the plain total.
 */

import {judge} from "../request-model.mjs";
import {firstTotal, loc, naturalD20, rollFormula, sortByLabel} from "./common.mjs";

/** The six attributes in the order of the character sheet, with icon and color (Font Awesome, part of Foundry). */
const ATTRIBUTE_LOOKS = {
  for: ["fa-dumbbell", "str"], des: ["fa-feather", "dex"], con: ["fa-heart", "con"],
  int: ["fa-lightbulb", "int"], sab: ["fa-compass", "wis"], car: ["fa-comment", "cha"]
};

/** The attribute each skill is tested with by default, for its color. */
const SKILL_ATTRIBUTE = {
  acro: "des", ades: "car", atle: "for", atua: "car", cava: "des", conh: "int", cura: "sab", dipl: "car", enga: "car",
  furt: "des", guer: "int", inic: "des", inti: "car", intu: "sab", inve: "int", joga: "car", ladi: "des", luta: "for",
  mist: "int", nobr: "int", perc: "sab", pilo: "des", pont: "des", reli: "sab", sobr: "sab", alfa: "int", alqu: "int",
  arme: "int", arte: "int", cozi: "int", enge: "int"
};

/** Icons of the skills. */
const SKILL_ICONS = {
  acro: "fa-person-running", ades: "fa-paw", atle: "fa-mountain", atua: "fa-music", cava: "fa-horse", conh: "fa-book",
  cura: "fa-kit-medical", dipl: "fa-comments", enga: "fa-masks-theater", furt: "fa-eye-slash", guer: "fa-chess-knight",
  inic: "fa-bolt", inti: "fa-skull", intu: "fa-bullseye", inve: "fa-magnifying-glass", joga: "fa-dice", ladi: "fa-hand-sparkles",
  luta: "fa-hand-fist", mist: "fa-wand-sparkles", nobr: "fa-crown", perc: "fa-eye", pilo: "fa-ship", pont: "fa-crosshairs",
  reli: "fa-sun", sobr: "fa-campground", alfa: "fa-scissors", alqu: "fa-flask", arme: "fa-shield", arte: "fa-palette",
  cozi: "fa-utensils", enge: "fa-gears"
};

/** The three saving throws of the system. */
const SAVES = {fort: "fa-heart", refl: "fa-feather", vont: "fa-compass"};
const SAVE_ATTRIBUTE = {fort: "con", refl: "des", vont: "sab"};

/**
 * The text of a roll choice: the module's own English or German name, or what the system calls a skill it has but the
 * module does not know (a skill added by a newer version).
 * @param {string} group      attribute, skill or save
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
export function tormenta20Label(group, key, fallback=key) {
  return loc(game.i18n?.has?.(`SRR.T20.${group}.${key}`) ? `SRR.T20.${group}.${key}` : String(fallback ?? key));
}

/**
 * The roll choices of Tormenta20.
 * @param {object} config   CONFIG.T20 (the skills, attributes and resistances the system defines)
 * @returns {{type: string, options: {key: string, label: string}[]}[]}
 */
export function tormenta20Groups(config) {
  const attributeKeys = Object.keys(config?.atributos ?? ATTRIBUTE_LOOKS).filter(key => key in ATTRIBUTE_LOOKS);
  const attributes = (attributeKeys.length ? attributeKeys : Object.keys(ATTRIBUTE_LOOKS)).map(key => ({
    key, label: tormenta20Label("attribute", key), short: tormenta20Label("short", key), icon: ATTRIBUTE_LOOKS[key][0],
    tint: ATTRIBUTE_LOOKS[key][1]}));
  const saveKeys = Object.keys(config?.resistencias ?? SAVES);
  const saves = saveKeys.map(key => ({key, label: tormenta20Label("save", key), icon: SAVES[key] ?? null,
    tint: SAVE_ATTRIBUTE[key] ?? null}));
  const skills = Object.entries(config?.pericias ?? {}).filter(([key]) => !saveKeys.includes(key) && (key !== "ofic"))
    .map(([key]) => ({key, label: tormenta20Label("skill", key), icon: SKILL_ICONS[key] ?? null,
      tint: SKILL_ATTRIBUTE[key] ?? null}));
  return [
    {type: "attribute", icon: "fa-dice-d20", cols: 6, options: attributes},
    {type: "save", icon: "fa-shield-halved", cols: 3, options: saves},
    {type: "skill", icon: "fa-star", cols: 3, options: sortByLabel(skills)}
  ].filter(group => group.options.length);
}

/**
 * Whether Shift skips the system's roll dialog. The client setting "UsageConfig" decides: by default the dialog opens
 * and Shift skips it, the other way round when it is set to Shift.
 * @returns {boolean}
 */
export function shiftSkipsDialog() {
  try {
    return game.settings.get("tormenta20", "UsageConfig") !== "shift";
  } catch {
    return true;
  }
}

/**
 * The options of a Tormenta20 roll. The system reads the keys held during the click: Shift to skip or open its dialog,
 * Alt for a second d20 keeping the higher one, Ctrl keeping the lower one. A roll made for a request carries them
 * as a plain object, so the advantage hint of the request works without a click.
 * @param {object} request
 * @param {object} [options]
 * @param {Event|null} [options.event]
 * @param {boolean} [options.fastForward]
 * @param {boolean} [options.skipsWithShift=true]
 * @returns {{event: object}}
 */
export function tormenta20RollArgs(request, {event=null, fastForward=false, skipsWithShift=true}={}) {
  const keys = {
    shiftKey: !!event?.shiftKey, altKey: !!event?.altKey, ctrlKey: !!(event?.ctrlKey || event?.metaKey),
    metaKey: false
  };
  // A quick roll behaves as if the key which skips the dialog was held
  if ( fastForward ) keys.shiftKey = !!skipsWithShift;
  if ( request.advantage === "advantage" ) {
    keys.altKey = true;
    keys.ctrlKey = false;
  } else if ( request.advantage === "disadvantage" ) {
    keys.ctrlKey = true;
    keys.altKey = false;
  }
  return {event: keys};
}

/** The Tormenta20 adapter. */
export const tormenta20 = {
  id: "tormenta20",
  scheme: "d20",
  advantage: true,
  defaultDc: null,
  dcChips: [10, 15, 20, 25, 30, 35, 40],
  quick: ["skill:perc", "save:refl", "save:fort", "save:vont", "skill:furt"],

  /** @returns {object[]} */
  groups() {
    return tormenta20Groups(globalThis.CONFIG?.T20);
  },

  /**
   * Player characters are the actors of type character, threats and simple actors are not.
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
    const args = tormenta20RollArgs(request, {...options, skipsWithShift: shiftSkipsDialog()});
    if ( request.type === "attribute" ) {
      if ( !actor.system?.atributos?.[request.key] ) throw new Error(`${actor.name} has no ${request.key}`);
      return actor.rollAtributo(request.key, args);
    }
    if ( !actor.system?.pericias?.[request.key] ) throw new Error(`${actor.name} has no ${request.key}`);
    return actor.rollPericia(request.key, args);
  },

  /**
   * Whether a roll message can answer the request: the card of an item (attack, spell, power) never does. The card
   * of a test names no kind, so a test message is accepted as it comes (null).
   * @param {object} message
   * @param {{type: string, key: string}} request
   * @returns {boolean|null}
   */
  matches(message, request) {
    if ( request.type === "formula" ) return null;
    return message?.flags?.tormenta20?.itemData ? false : null;
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
