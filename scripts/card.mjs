/**
 * The result card in the chat. The card is drawn from the stored request each time Foundry renders the message, in
 * the language and look of the viewer and with only what the viewer may see. Owners of a character find its roll
 * button on the card, the GM can roll for anyone and take a result back.
 */

import {getAdapter} from "./adapters/index.mjs";
import {MODULE_ID, esc, setting, t} from "./config.mjs";
import {summarize, viewFor} from "./request-model.mjs";
import {canRoll, describe, requestOf, resetEntry} from "./requests.mjs";
import {gmFastForward, rollEntry, rollRemaining} from "./rolling.mjs";

/**
 * The line under the title: DC, visibility and the advantage hint.
 * @param {object} request
 * @param {boolean} dcVisible
 * @returns {string}
 */
export function metaLine(request, dcVisible) {
  const parts = [];
  const adapter = getAdapter(request.system);
  const dcKey = `SRR.Card.${adapter.dcName ?? "dc"}`;
  if ( request.dc !== null ) {
    if ( dcVisible ) parts.push(t(dcKey, {dc: request.dc}) + (request.showDc ? "" : ` (${t("SRR.Card.hidden")})`));
    else parts.push(t("SRR.Card.dcHidden"));
  }
  // Savage Worlds always rolls against a target number, 4 unless the GM set one
  else if ( Number.isFinite(adapter.defaultDc) ) parts.push(t(dcKey, {dc: adapter.defaultDc}));
  if ( request.mode !== "public" ) parts.push(t(`SRR.Mode.${request.mode}`));
  if ( request.advantage !== "normal" ) parts.push(advantageLabel(request));
  if ( request.group ) parts.push(t("SRR.Card.groupCheck"));
  return parts.join(" · ");
}

/**
 * The label of the advantage hint in the words of the system.
 * @param {object} request
 * @returns {string}
 */
export function advantageLabel(request) {
  const key = getAdapter(request.system).advantageLabels?.[request.advantage] ?? `SRR.Advantage.${request.advantage}`;
  return t(key);
}

/**
 * The text of an outcome.
 * @param {object} result
 * @param {string} scheme
 * @returns {string}
 */
function outcomeText(result, scheme) {
  if ( result.success === null || result.success === undefined ) return "";
  if ( (scheme === "swade") && (result.raises > 0) ) return t("SRR.Outcome.raises", {count: result.raises});
  const degree = (scheme === "d20") ? (result.success ? "success" : "failure") : (result.degree ?? "");
  return game.i18n.has(`SRR.Outcome.${degree}`) ? t(`SRR.Outcome.${degree}`) : "";
}

/**
 * The result cell of an entry.
 * @param {object} request
 * @param {object} entry
 * @param {object} view
 * @param {boolean} rollable
 * @returns {string}
 */
function resultCell(request, entry, view, rollable) {
  const result = request.results?.[entry.id];
  if ( !result ) {
    if ( rollable ) {
      return `<button type="button" class="srr-roll" data-action="srrRoll" data-entry-id="${esc(entry.id)}">
        <i class="fa-solid fa-dice-d20" inert></i> ${esc(t("SRR.Card.roll"))}</button>`;
    }
    return `<span class="srr-waiting" data-tooltip="${esc(t("SRR.Card.waiting"))}">
      <i class="fa-solid fa-hourglass-half" inert></i></span>`;
  }
  const shown = view.entry(entry);
  if ( !shown.total ) {
    return `<span class="srr-rolled" data-tooltip="${esc(t("SRR.Card.rolled"))}"><i class="fa-solid fa-check" inert></i></span>`;
  }
  const scheme = getAdapter(request.system).scheme;
  const natural = (result.natural === 20) ? `<i class="fa-solid fa-star srr-nat srr-nat-20" data-tooltip="${esc(t("SRR.Card.nat20"))}" inert></i>`
    : (result.natural === 1) ? `<i class="fa-solid fa-skull srr-nat srr-nat-1" data-tooltip="${esc(t("SRR.Card.nat1"))}" inert></i>` : "";
  const outcome = shown.outcome ? outcomeText(result, scheme) : "";
  const icon = !shown.outcome || (result.success === null) ? ""
    : result.success ? `<i class="fa-solid fa-circle-check srr-pass" inert></i>`
    : `<i class="fa-solid fa-circle-xmark srr-fail" inert></i>`;
  return `<span class="srr-outcome">${natural}<strong class="srr-total">${esc(result.total)}</strong>${icon}`
    + `${outcome ? `<small>${esc(outcome)}</small>` : ""}</span>`;
}

/**
 * The HTML of a card for this viewer.
 * @param {object} request
 * @returns {string}
 */
export function cardHtml(request) {
  const isGM = game.user.isGM;
  const view = viewFor(request, {isGM, owns: entry => canRoll(entry)});
  const summary = summarize(request);
  const rows = request.entries.map(entry => {
    const result = request.results?.[entry.id];
    const rollable = !result && canRoll(entry);
    const shown = view.entry(entry);
    const state = !result ? "pending" : (!shown.outcome || (result.success === null)) ? "rolled"
      : result.success ? "success" : "failure";
    const reset = isGM && result ? `<button type="button" class="srr-reset" data-action="srrReset"
      data-entry-id="${esc(entry.id)}" data-tooltip="${esc(t("SRR.Card.reset"))}"
      aria-label="${esc(t("SRR.Card.reset"))}"><i class="fa-solid fa-rotate-left" inert></i></button>` : "";
    return `<li class="srr-entry is-${state}" data-entry-id="${esc(entry.id)}">
      <img class="srr-entry-img" src="${esc(entry.img || "icons/svg/mystery-man.svg")}" alt="">
      <span class="srr-entry-name">${esc(entry.name)}</span>
      <span class="srr-entry-result">${resultCell(request, entry, view, rollable)}</span>${reset}</li>`;
  }).join("");

  let foot;
  if ( !summary.complete ) foot = t("SRR.Card.progress", {rolled: summary.rolled, count: summary.count});
  else if ( view.summary && (request.dc !== null || summary.passed + summary.failed > 0) ) {
    foot = t("SRR.Card.passed", {passed: summary.passed, count: summary.count});
  }
  else foot = t("SRR.Card.allRolled");
  const group = (summary.group && view.summary) ? `<span class="srr-group is-${summary.group}">
    ${esc(t(`SRR.Card.group.${summary.group}`))}</span>` : "";
  const rest = isGM && summary.pending ? `<button type="button" class="srr-rest" data-action="srrRollRest">
    <i class="fa-solid fa-forward" inert></i> ${esc(t("SRR.Card.rollRest"))}</button>` : "";
  const note = request.note ? `<p class="srr-card-note">${esc(request.note)}</p>` : "";
  const meta = metaLine(request, view.dc);
  return `<div class="srr-card" data-srr-theme="${esc(theme())}">
    <header class="srr-card-head"><i class="fa-solid fa-dice-d20" inert></i><div>
      <strong>${esc(describe(request))}</strong>${meta ? `<span class="srr-card-meta">${esc(meta)}</span>` : ""}</div></header>
    ${note}<ol class="srr-entries">${rows}</ol>
    <footer class="srr-card-foot"><span>${esc(foot)}</span>${group}${rest}</footer></div>`;
}

/**
 * The look of this user.
 * @returns {string}
 */
function theme() {
  try {
    return setting("theme");
  } catch {
    return "signature";
  }
}

/**
 * Hook "renderChatMessageHTML": draw the card of a request.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderCard(message, html) {
  const request = requestOf(message);
  if ( !request ) return;
  const element = html?.jquery ? html[0] : html;
  const content = element?.querySelector(".message-content");
  if ( !content ) return;
  try {
    content.innerHTML = cardHtml(request);
  } catch(err) {
    console.error(`${MODULE_ID} | Drawing the card failed`, err);
    return;
  }
  element.classList.add("srr-message");
  // A redraw of a card already in the log keeps its listener
  if ( content.dataset.srrBound ) return;
  content.dataset.srrBound = "1";
  content.addEventListener("click", event => onCardClick(event, message));
}

/**
 * Clicks on a card.
 * @param {MouseEvent} event
 * @param {ChatMessage} message
 */
async function onCardClick(event, message) {
  const button = event.target.closest("button[data-action]");
  if ( !button ) return;
  event.preventDefault();
  event.stopPropagation();
  const card = game.messages.get(message.id) ?? message;
  const request = requestOf(card);
  if ( !request ) return;
  const entry = request.entries.find(e => e.id === button.dataset.entryId);
  button.disabled = true;
  try {
    switch ( button.dataset.action ) {
      case "srrRoll": {
        if ( !entry ) return;
        // The GM skips the dialog unless Shift says otherwise, players get the system's usual behavior
        const fastForward = game.user.isGM ? (gmFastForward() !== event.shiftKey) : false;
        await rollEntry(card, entry, {event: game.user.isGM ? null : event, fastForward});
        break;
      }
      case "srrReset":
        if ( entry ) await resetEntry(card, entry.id);
        break;
      case "srrRollRest":
        await rollRemaining(card);
        break;
    }
  } finally {
    button.disabled = false;
  }
}
