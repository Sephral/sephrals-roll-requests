/**
 * The small window a player gets when the GM asks one of their characters to roll. It lists every open request
 * for the player's characters and closes by itself when nothing is left to roll.
 */

import {addSettingsGear, esc, isShown, setting, t} from "./config.mjs";
import {pendingFor} from "./request-model.mjs";
import {canRoll, describe, openCards, requestOf} from "./requests.mjs";
import {advantageLabel, choiceButtons, metaLine} from "./card.mjs";
import {rollEntry} from "./rolling.mjs";

const {ApplicationV2} = foundry.applications.api;

export class RollPrompt extends ApplicationV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "srr-prompt",
    classes: ["srr-app", "srr-prompt"],
    tag: "section",
    window: {title: "SRR.Prompt.title", icon: "fa-solid fa-dice-d20"},
    position: {width: 400, height: "auto", top: 90},
    actions: {
      srrPromptRoll: RollPrompt.#onRoll
    }
  };

  /** @override */
  get title() {
    return t("SRR.Prompt.title");
  }

  /**
   * The open requests with the entries this user still has to roll.
   * @returns {{card: ChatMessage, request: object, entries: object[]}[]}
   */
  static items() {
    if ( game.user.isGM ) return [];
    // Every client holds whispered cards too, a silent request must not show here
    return openCards().filter(card => card.visible).map(card => {
      const request = requestOf(card);
      return {card, request, entries: pendingFor(request, entry => canRoll(entry))};
    }).filter(item => item.entries.length);
  }

  /** @override */
  async _prepareContext() {
    return {items: RollPrompt.items(), theme: setting("theme")};
  }

  /** @override */
  async _renderHTML(context) {
    const blocks = context.items.map(({card, request, entries}) => {
      const meta = metaLine(request, !!request.showDc);
      const hint = request.advantage !== "normal" ? `<p class="srr-prompt-hint">${esc(advantageLabel(request))}</p>` : "";
      const note = request.note ? `<p class="srr-card-note">${esc(request.note)}</p>` : "";
      const rows = entries.map(entry => `<li class="srr-entry is-pending">
        <img class="srr-entry-img" src="${esc(entry.img || "icons/svg/mystery-man.svg")}" alt="">
        <span class="srr-entry-name">${esc(entry.name)}</span>
        ${request.choices?.length ? choiceButtons(request, "srrPromptRoll", entry, ` data-card-id="${esc(card.id)}"`)
          : `<button type="button" class="srr-roll" data-action="srrPromptRoll" data-card-id="${esc(card.id)}"
          data-entry-id="${esc(entry.id)}"><i class="fa-solid fa-dice-d20" inert></i> ${esc(t("SRR.Card.roll"))}</button>`}
        </li>`).join("");
      return `<article class="srr-prompt-request">
        <header><strong>${esc(describe(request))}</strong>${meta ? `<span class="srr-card-meta">${esc(meta)}</span>` : ""}</header>
        ${note}${hint}<ol class="srr-entries">${rows}</ol></article>`;
    }).join("");
    return `<div class="srr-body" data-srr-theme="${esc(context.theme)}">
      <p class="srr-prompt-intro">${esc(t("SRR.Prompt.intro"))}</p>${blocks}</div>`;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    addSettingsGear(frame);
    return frame;
  }

  /**
   * Roll for one character.
   * @this {RollPrompt}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRoll(event, target) {
    const card = game.messages.get(target.dataset.cardId);
    const entry = requestOf(card)?.entries.find(e => e.id === target.dataset.entryId);
    if ( !card || !entry ) return;
    target.disabled = true;
    try {
      await rollEntry(card, entry, {event, choice: target.dataset.choice ?? null});
    } finally {
      target.disabled = false;
    }
  }
}

/** The prompt of this client. */
let prompt = null;

/** The rolls this client was asked for already, as "card:entry". A roll taken back by the GM counts as new. */
const known = new Set();

/**
 * Open, redraw or close the prompt after requests changed. It opens when a roll is new for this player: a new
 * request, a result the GM took back, or open requests at login.
 * @param {object} [options]
 * @param {boolean} [options.sound]   Play the notification sound for new rolls
 */
export function refreshPrompt({sound=false}={}) {
  if ( game.user.isGM ) return;
  const items = RollPrompt.items();
  const keys = items.flatMap(item => item.entries.map(entry => `${item.card.id}:${entry.id}`));
  const fresh = keys.some(key => !known.has(key));
  known.clear();
  for ( const key of keys ) known.add(key);
  if ( !items.length ) {
    if ( isShown(prompt) ) prompt.close();
    return;
  }
  if ( fresh && sound && setting("promptSound") ) {
    const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    AudioHelper?.play({src: CONFIG.sounds.notification, volume: 0.8, autoplay: true, loop: false}, false);
  }
  if ( isShown(prompt) ) {
    prompt.render();
    return;
  }
  if ( !fresh || !setting("promptWindow") ) return;
  prompt ??= new RollPrompt();
  prompt.render({force: true});
}

/**
 * Open the prompt by hand (also when it was closed or switched off).
 */
export function openPrompt() {
  if ( !RollPrompt.items().length ) {
    ui.notifications.info(t("SRR.Prompt.nothing"));
    return;
  }
  prompt ??= new RollPrompt();
  prompt.render({force: true});
}
