/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language.
 */

import {MODULE_ID} from "./config.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, object>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: "language", choices: {
    [FOLLOW_FOUNDRY]: "SRR.LANGUAGE.default", de: "SRR.LANGUAGE.de", en: "SRR.LANGUAGE.en"}},
  theme: {type: String, default: "signature", scope: "client", onChange: "redraw", choices: {
    signature: "SRR.SETTINGS.theme.signature", foundry: "SRR.SETTINGS.theme.foundry"}},
  promptWindow: {type: Boolean, default: true, scope: "client"},
  promptSound: {type: Boolean, default: true, scope: "client"},
  gmFastForward: {type: Boolean, default: true, scope: "client", gm: true},
  sceneControl: {type: Boolean, default: true, scope: "client", gm: true, onChange: "controls"}
};

/**
 * Register one setting.
 * @param {string} key
 * @param {object} def
 * @param {object} handlers
 * @param {boolean} config
 */
function register(key, def, handlers, config) {
  game.settings.register(MODULE_ID, key, {
    name: `SRR.SETTINGS.${key}.name`,
    hint: `SRR.SETTINGS.${key}.hint`,
    scope: def.scope ?? "world",
    config,
    type: def.type,
    choices: def.choices,
    default: def.default,
    onChange: def.onChange ? value => handlers[def.onChange]?.(value) : undefined
  });
}

/** The handlers of the settings, kept for the settings registered in "setup". */
let settingHandlers = {};

/**
 * Register the settings of every user and the menus. Call in "init".
 * @param {{language: Function, redraw: Function, controls: Function}} handlers
 */
export function registerSettings(handlers) {
  settingHandlers = handlers;
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    if ( !def.gm ) register(key, def, handlers, true);
  }

  // The last request of this GM, to start the next one from it
  game.settings.register(MODULE_ID, "lastRequest", {scope: "client", config: false, type: Object, default: {}});
  // The saved presets and the last rolls of this GM, shown above the roll buttons
  game.settings.register(MODULE_ID, "presets", {scope: "client", config: false, type: Array, default: []});
  game.settings.register(MODULE_ID, "recentRolls", {scope: "client", config: false, type: Array, default: []});
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});

  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SRR.SELFTEST.Title",
    label: "SRR.SELFTEST.Run",
    hint: "SRR.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: RequestsSelfTestMenu,
    restricted: true
  });
}

/**
 * Register the settings only the GM needs. The user is known from "setup" on, and the players do not see them.
 */
export function registerGmSettings() {
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    if ( def.gm ) register(key, def, settingHandlers, !!game.user?.isGM);
  }
}

/** The menu button which runs the self-test. Foundry only accepts application classes as menus. */
class RequestsSelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/**
 * Switch the module strings when the user picks another module language, then redraw.
 * @param {string} value
 * @param {Function} redraw
 */
export function changeLanguage(value, redraw) {
  applyModuleLanguage(value).then(() => {
    redraw();
    ui.controls?.render?.({reset: true});
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}
