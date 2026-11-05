/**
 * Constants and small helpers shared by the scripts of the module. The module runs on Foundry 13 and 14, so it uses
 * game.i18n instead of the v14 global _loc.
 */

/** The id of this module. */
export const MODULE_ID = "sephrals-roll-requests";

/** The Foundry and system versions the module was verified against (see the self-test). */
export const TESTED_VERSIONS = {core: "14.370", dnd5e: "6.0.6", pf2e: "8.6.1", swade: "6.0.4", crucible: "0.11.3"};

/** The hooks other modules can listen to. */
export const HOOKS = {
  requested: `${MODULE_ID}.requested`,
  result: `${MODULE_ID}.result`,
  completed: `${MODULE_ID}.completed`
};

/**
 * Read a setting of this module.
 * @param {string} key
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Localize a key, with optional data.
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/**
 * Escape a value for HTML.
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
    "'": "&#39;"})[ch]);
}

/**
 * The generation of Foundry (13 or 14).
 * @returns {number}
 */
export function generation() {
  return game.release?.generation ?? 13;
}

/**
 * The ids of all GM users.
 * @returns {string[]}
 */
export function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/**
 * Is a window open or on its way? While an application renders, its "rendered" flag is false, and a redraw asked
 * for in that moment would be lost.
 * @param {ApplicationV2|undefined} app
 * @returns {boolean}
 */
export function isShown(app) {
  const states = foundry.applications.api.ApplicationV2.RENDER_STATES;
  return !!app && ((app.state === states.RENDERED) || (app.state === states.RENDERING));
}

/**
 * Open Foundry's settings on the tab of this module.
 */
export async function openSettings() {
  const sheet = game.settings.sheet;
  await sheet.render({force: true});
  try {
    sheet.changeTab(MODULE_ID, "categories");
  } catch(err) {
    console.warn(`${MODULE_ID} | The settings have no tab for this module`, err);
  }
  sheet.bringToFront?.();
}

/**
 * Put a gear into the title bar of a window that opens the settings of this module. Every user has client settings
 * of the module (language, look, prompt window), so everyone gets it.
 * @param {HTMLElement} frame   The window frame
 */
export function addSettingsGear(frame) {
  const header = frame?.querySelector(".window-header");
  if ( !header || header.querySelector(".srr-settings") ) return;
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "header-control icon fa-solid fa-gear srr-settings";
  gear.dataset.tooltip = t("SRR.gear");
  gear.setAttribute("aria-label", t("SRR.gear"));
  gear.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings();
  });
  const anchor = header.querySelector("[data-action=toggleControls]") ?? header.querySelector("[data-action=close]");
  if ( anchor ) anchor.before(gear);
  else header.append(gear);
}

/**
 * Resolve a document reference without waiting (actors and tokens of this world or a scene).
 * @param {string|null} uuid
 * @returns {foundry.abstract.Document|null}
 */
export function fromUuidQuiet(uuid) {
  if ( !uuid ) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}
