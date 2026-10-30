/**
 * Helpers the system adapters share: reading the first roll of a message, the kept d20, and the formula roll every
 * system offers.
 */

/**
 * The rolls of a chat message (Ready Set Roll keeps the rolls of its cards in a flag).
 * @param {object} message
 * @returns {object[]}
 */
export function rollsOf(message) {
  const stored = message?.flags?.rsr5e?.rolls;
  if ( Array.isArray(stored) && stored.length ) {
    const Roll = globalThis.Roll;
    return stored.map(data => {
      if ( typeof data?.total === "number" ) return data;
      try {
        return Roll?.fromData ? Roll.fromData(data) : data;
      } catch {
        return data;
      }
    });
  }
  return Array.isArray(message?.rolls) ? message.rolls : [];
}

/**
 * The kept result of the first d20 of a roll, or null.
 * @param {object} roll
 * @returns {number|null}
 */
export function naturalD20(roll) {
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const d20 = dice.find(die => die?.faces === 20);
  const kept = (d20?.results ?? []).find(r => (r.active !== false) && !r.discarded);
  return Number.isFinite(kept?.result) ? kept.result : null;
}

/**
 * The total of the first roll of a message.
 * @param {object} message
 * @returns {{roll: object|null, total: number|null}}
 */
export function firstTotal(message) {
  const roll = rollsOf(message)[0] ?? null;
  const total = Number(roll?.total);
  return {roll, total: roll && Number.isFinite(total) ? total : null};
}

/**
 * Roll a formula with the roll data of an actor and post it like a normal roll.
 * @param {Actor} actor
 * @param {object} request
 * @param {object} [options]
 * @param {TokenDocument|null} [options.token]
 * @returns {Promise<object>}
 */
export async function rollFormula(actor, request, {token=null}={}) {
  const roll = await new Roll(request.formula, actor?.getRollData?.() ?? {}).evaluate();
  const speaker = ChatMessage.getSpeaker(token ? {token} : {actor});
  await roll.toMessage({speaker, flavor: request.label || request.formula});
  return roll;
}

/**
 * Sort options by their label in the language of the user.
 * @param {{key: string, label: string}[]} options
 * @returns {{key: string, label: string}[]}
 */
export function sortByLabel(options) {
  const lang = globalThis.game?.i18n?.lang ?? "en";
  return [...options].sort((a, b) => a.label.localeCompare(b.label, lang));
}

/**
 * Localize when a translation exists, otherwise keep the text.
 * @param {*} value
 * @returns {string}
 */
export function loc(value) {
  const text = String(value ?? "");
  const i18n = globalThis.game?.i18n;
  return i18n?.has?.(text) ? i18n.localize(text) : text;
}
