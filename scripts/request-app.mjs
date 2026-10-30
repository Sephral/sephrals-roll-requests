/**
 * The GM's request window: who rolls, what, against which DC and who sees the results. It starts from the last
 * request of this GM and from the tokens selected on the canvas.
 */

import {getAdapter, rollGroups} from "./adapters/index.mjs";
import {MODULE_ID, addSettingsGear, esc, fromUuidQuiet, isShown, setting, t} from "./config.mjs";
import {ADVANTAGE, MODES, parseDc} from "./request-model.mjs";
import {createRequest, entriesFrom, playerOwners} from "./requests.mjs";

const {ApplicationV2} = foundry.applications.api;

/**
 * The candidate key of a token: a linked token rolls as its actor, an unlinked one as itself.
 * @param {TokenDocument} doc
 * @returns {string}
 */
function candidateUuid(doc) {
  return (doc.actorLink && doc.actor) ? doc.actor.uuid : doc.uuid;
}

export class RequestWindow extends ApplicationV2 {
  /**
   * @param {object} [defaults]   Values to start with instead of the last request
   */
  constructor(defaults={}) {
    super();
    this.defaults = defaults;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "srr-request",
    classes: ["srr-app", "srr-request"],
    tag: "form",
    window: {title: "SRR.Request.title", icon: "fa-solid fa-dice-d20", resizable: true},
    position: {width: 520, height: "auto"},
    form: {handler: RequestWindow.#onSubmit, submitOnChange: false, closeOnSubmit: false},
    actions: {
      srrUseSelected: RequestWindow.#onUseSelected,
      srrUseCharacters: RequestWindow.#onUseCharacters,
      srrSelectNone: RequestWindow.#onSelectNone,
      srrRemove: RequestWindow.#onRemove,
      srrCancel: RequestWindow.#onCancel
    }
  };

  /** Candidates by uuid: {uuid, checked, added}. */
  #candidates = new Map();

  /** The values of the form between redraws. */
  #values = null;

  /** @override */
  get title() {
    return t("SRR.Request.title");
  }

  /**
   * The values to start with: given defaults over the last request.
   * @returns {object}
   */
  #startValues() {
    let last = {};
    try {
      last = setting("lastRequest") ?? {};
    } catch {}
    return {type: "", key: "", formula: "", label: "", dc: null, showDc: true, mode: "public", advantage: "normal",
      group: false, autoRollNpcs: true, note: "", ...last, ...this.defaults};
  }

  /**
   * Fill the candidates: the given actors, otherwise the selected tokens, otherwise the player characters.
   */
  #initCandidates() {
    if ( this.#candidates.size ) return;
    const given = this.defaults.actors;
    if ( Array.isArray(given) && given.length ) {
      for ( const source of given ) {
        const doc = typeof source === "string" ? fromUuidQuiet(source) : (source?.document ?? source);
        const uuid = doc?.documentName === "Token" ? candidateUuid(doc) : (doc?.uuid ?? (typeof source === "string" ? source : null));
        if ( uuid ) this.#candidates.set(uuid, {uuid, checked: true, added: true});
      }
      return;
    }
    const selected = this.#selectedTokens();
    for ( const uuid of selected ) this.#candidates.set(uuid, {uuid, checked: true, added: false});
    for ( const actor of this.#playerCharacters() ) {
      if ( !this.#candidates.has(actor.uuid) ) {
        this.#candidates.set(actor.uuid, {uuid: actor.uuid, checked: !selected.length, added: false});
      }
    }
  }

  /**
   * The selected tokens as candidates: a linked token rolls as its actor, an unlinked one as itself.
   * @returns {string[]}
   */
  #selectedTokens() {
    const docs = (canvas?.ready ? canvas.tokens.controlled : []).map(token => token.document).filter(doc => doc?.actor);
    return [...new Set(docs.map(doc => candidateUuid(doc)))];
  }

  /** @returns {Actor[]} */
  #playerCharacters() {
    const adapter = getAdapter();
    return game.actors.filter(actor => actor.hasPlayerOwner && adapter.isCharacter(actor))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  /** @override */
  async _prepareContext() {
    this.#initCandidates();
    this.#values ??= this.#startValues();
    const candidates = [...this.#candidates.values()].map(c => {
      const doc = fromUuidQuiet(c.uuid);
      const entry = doc ? entriesFrom([doc])[0] : null;
      if ( !entry ) return null;
      const owners = playerOwners(doc.actor ?? doc).map(u => u.name);
      return {...c, name: entry.name, img: entry.img, owners: owners.join(", "), token: doc.documentName === "Token"};
    }).filter(Boolean);
    const actors = candidates.map(c => fromUuidQuiet(c.uuid)).map(doc => doc?.actor ?? doc).filter(Boolean);
    return {candidates, groups: rollGroups(actors), values: this.#values, adapter: getAdapter(), theme: setting("theme")};
  }

  /** @override */
  async _renderHTML(context) {
    const {values, adapter} = context;
    const choice = values.type === "formula" ? "formula:" : `${values.type}:${values.key}`;
    const groups = context.groups.map(group => {
      if ( group.type === "formula" ) {
        return `<option value="formula:"${choice === "formula:" ? " selected" : ""}>${esc(t("SRR.Type.formula"))}</option>`;
      }
      // "Dexterity saving throw" rather than "Dexterity", so the chosen roll reads clearly when the list is closed
      const labelKey = `SRR.Label.${group.type}`;
      const options = group.options.map(o => {
        const value = `${group.type}:${o.key}`;
        const text = game.i18n.has(labelKey) ? t(labelKey, {name: o.label}) : o.label;
        return `<option value="${esc(value)}"${value === choice ? " selected" : ""}>${esc(text)}</option>`;
      }).join("");
      return `<optgroup label="${esc(t(`SRR.Type.${group.type}`))}">${options}</optgroup>`;
    }).join("");
    const rows = context.candidates.map(c => `<li class="srr-candidate${c.checked ? " is-checked" : ""}">
      <label><input type="checkbox" name="actor" value="${esc(c.uuid)}"${c.checked ? " checked" : ""}>
      <img src="${esc(c.img || "icons/svg/mystery-man.svg")}" alt="">
      <span class="srr-candidate-name">${esc(c.name)}${c.token ? ` <i class="fa-solid fa-chess-pawn" data-tooltip="${esc(t("SRR.Request.fromToken"))}" inert></i>` : ""}</span>
      <span class="srr-candidate-owner">${esc(c.owners || t("SRR.Request.npc"))}</span></label>
      ${c.added ? `<button type="button" class="srr-icon" data-action="srrRemove" data-uuid="${esc(c.uuid)}"
        data-tooltip="${esc(t("SRR.Request.remove"))}" aria-label="${esc(t("SRR.Request.remove"))}"><i class="fa-solid fa-xmark" inert></i></button>` : ""}
      </li>`).join("");
    const modes = MODES.map(m => `<option value="${m}"${values.mode === m ? " selected" : ""}>${esc(t(`SRR.Mode.${m}`))}</option>`).join("");
    const advantage = adapter.advantage ? `<div class="form-group"><label>${esc(t("SRR.Request.advantage"))}</label>
      <select name="advantage">${ADVANTAGE.map(a => {
        const key = adapter.advantageLabels?.[a] ?? `SRR.Advantage.${a}`;
        return `<option value="${a}"${values.advantage === a ? " selected" : ""}>${esc(t(key))}</option>`;
      }).join("")}</select></div>` : "";
    const dcName = adapter.dcName ?? "dc";
    const dcValue = values.dc ?? "";
    return `<div class="srr-body" data-srr-theme="${esc(context.theme)}">
      <section class="srr-section">
        <header class="srr-section-head"><h3>${esc(t("SRR.Request.who"))}</h3>
          <div class="srr-section-tools">
            <button type="button" data-action="srrUseSelected"><i class="fa-solid fa-expand" inert></i> ${esc(t("SRR.Request.selected"))}</button>
            <button type="button" data-action="srrUseCharacters"><i class="fa-solid fa-users" inert></i> ${esc(t("SRR.Request.characters"))}</button>
            <button type="button" data-action="srrSelectNone">${esc(t("SRR.Request.none"))}</button>
          </div></header>
        ${rows ? `<ul class="srr-candidates">${rows}</ul>` : `<p class="srr-empty">${esc(t("SRR.Request.noCandidates"))}</p>`}
        <p class="srr-drop-hint"><i class="fa-solid fa-hand-pointer" inert></i> ${esc(t("SRR.Request.dropHint"))}</p>
      </section>
      <section class="srr-section">
        <h3>${esc(t("SRR.Request.what"))}</h3>
        <div class="form-group"><label>${esc(t("SRR.Request.roll"))}</label>
          <select name="choice">${groups}</select></div>
        <div class="srr-formula${choice === "formula:" ? "" : " is-hidden"}">
          <div class="form-group"><label>${esc(t("SRR.Request.formula"))}</label>
            <input type="text" name="formula" value="${esc(values.formula)}" placeholder="1d20 + @abilities.dex.mod"></div>
          <div class="form-group"><label>${esc(t("SRR.Request.label"))}</label>
            <input type="text" name="label" value="${esc(values.label)}" placeholder="${esc(t("SRR.Request.labelHint"))}"></div>
        </div>
        <div class="form-group"><label>${esc(t(`SRR.Request.${dcName}`))}</label>
          <input type="number" name="dc" min="0" max="999" step="1" value="${esc(dcValue)}" placeholder="${esc(adapter.defaultDc ?? t("SRR.Request.noDc"))}">
          <label class="srr-check"><input type="checkbox" name="showDc"${values.showDc ? " checked" : ""}> ${esc(t("SRR.Request.showDc"))}</label></div>
        ${advantage}
        <div class="form-group"><label>${esc(t("SRR.Request.mode"))}</label><select name="mode">${modes}</select></div>
        <p class="hint srr-mode-hint">${esc(t(`SRR.Mode.${values.mode}Hint`))}</p>
        <div class="form-group"><label>${esc(t("SRR.Request.note"))}</label>
          <input type="text" name="note" maxlength="200" value="${esc(values.note)}" placeholder="${esc(t("SRR.Request.noteHint"))}"></div>
        <label class="srr-check"><input type="checkbox" name="group"${values.group ? " checked" : ""}> ${esc(t("SRR.Request.group"))}</label>
        <label class="srr-check"><input type="checkbox" name="autoRollNpcs"${values.autoRollNpcs ? " checked" : ""}> ${esc(t("SRR.Request.autoRollNpcs"))}</label>
      </section>
      <footer class="srr-buttons">
        <button type="submit" class="srr-primary"><i class="fa-solid fa-paper-plane" inert></i> ${esc(t("SRR.Request.send"))}</button>
        <button type="button" data-action="srrCancel">${esc(t("SRR.Request.cancel"))}</button>
      </footer></div>`;
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

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const form = this.element;
    form.querySelector("select[name=choice]")?.addEventListener("change", event => {
      form.querySelector(".srr-formula")?.classList.toggle("is-hidden", event.target.value !== "formula:");
    });
    form.querySelector("select[name=mode]")?.addEventListener("change", event => {
      const hint = form.querySelector(".srr-mode-hint");
      if ( hint ) hint.textContent = t(`SRR.Mode.${event.target.value}Hint`);
    });
    for ( const box of form.querySelectorAll("input[name=actor]") ) {
      box.addEventListener("change", () => {
        const candidate = this.#candidates.get(box.value);
        if ( candidate ) candidate.checked = box.checked;
        box.closest(".srr-candidate")?.classList.toggle("is-checked", box.checked);
      });
    }
    form.addEventListener("dragover", event => event.preventDefault());
    form.addEventListener("drop", event => this.#onDrop(event));
  }

  /**
   * Read the form into the kept values.
   * @returns {object}
   */
  #readForm() {
    const form = this.element;
    const value = name => form.querySelector(`[name="${name}"]`);
    const [type, ...rest] = String(value("choice")?.value ?? "").split(":");
    this.#values = {
      type,
      key: rest.join(":"),
      formula: value("formula")?.value ?? "",
      label: value("label")?.value ?? "",
      dc: value("dc")?.value ?? "",
      showDc: !!value("showDc")?.checked,
      mode: value("mode")?.value ?? "public",
      advantage: value("advantage")?.value ?? "normal",
      note: value("note")?.value ?? "",
      group: !!value("group")?.checked,
      autoRollNpcs: !!value("autoRollNpcs")?.checked
    };
    return this.#values;
  }

  /**
   * Add actors or tokens dropped onto the window.
   * @param {DragEvent} event
   */
  async #onDrop(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
    } catch {
      return;
    }
    const uuid = data.uuid ?? ((data.type === "Actor" && data.id) ? `Actor.${data.id}` : null);
    const doc = fromUuidQuiet(uuid) ?? (uuid ? await fromUuid(uuid) : null);
    if ( !["Actor", "Token"].includes(doc?.documentName) ) return;
    this.#readForm();
    const key = doc.documentName === "Token" ? candidateUuid(doc) : doc.uuid;
    this.#candidates.set(key, {uuid: key, checked: true, added: true});
    this.render();
  }

  /**
   * Take the selected tokens.
   * @this {RequestWindow}
   */
  static #onUseSelected() {
    this.#readForm();
    const selected = this.#selectedTokens();
    if ( !selected.length ) {
      ui.notifications.info(t("SRR.Request.noneSelected"));
      return;
    }
    for ( const c of this.#candidates.values() ) c.checked = false;
    for ( const uuid of selected ) this.#candidates.set(uuid, {uuid, checked: true, added: this.#candidates.get(uuid)?.added ?? false});
    this.render();
  }

  /**
   * Take all player characters.
   * @this {RequestWindow}
   */
  static #onUseCharacters() {
    this.#readForm();
    for ( const c of this.#candidates.values() ) c.checked = false;
    for ( const actor of this.#playerCharacters() ) {
      this.#candidates.set(actor.uuid, {uuid: actor.uuid, checked: true, added: this.#candidates.get(actor.uuid)?.added ?? false});
    }
    this.render();
  }

  /**
   * Clear every check.
   * @this {RequestWindow}
   */
  static #onSelectNone() {
    this.#readForm();
    for ( const c of this.#candidates.values() ) c.checked = false;
    this.render();
  }

  /**
   * Take a dropped actor off the list.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onRemove(event, target) {
    this.#readForm();
    this.#candidates.delete(target.dataset.uuid);
    this.render();
  }

  /**
   * Close without a request.
   * @this {RequestWindow}
   */
  static #onCancel() {
    this.close();
  }

  /**
   * Send the request.
   * @this {RequestWindow}
   * @param {SubmitEvent} event
   */
  static async #onSubmit(event) {
    event?.preventDefault?.();
    const values = this.#readForm();
    const actors = [...this.#candidates.values()].filter(c => c.checked).map(c => c.uuid);
    if ( !actors.length ) {
      ui.notifications.warn(t("SRR.Error.noActors"));
      return;
    }
    try {
      await createRequest({...values, actors});
    } catch(err) {
      const key = String(err?.message ?? err);
      ui.notifications.warn(game.i18n.has(key) ? t(key) : key);
      return;
    }
    // The note belongs to this one request
    const {note, ...remember} = values;
    await game.settings.set(MODULE_ID, "lastRequest", {...remember, dc: parseDc(values.dc)});
    this.close();
  }
}

/**
 * Open the request window (GM). A window that is open already comes to the front.
 * @param {object} [defaults]   Values and `actors` to start with
 * @returns {RequestWindow|null}
 */
export function openRequestWindow(defaults={}) {
  if ( !game.user.isGM ) {
    ui.notifications.warn(t("SRR.Error.gmOnly"));
    return null;
  }
  const open = foundry.applications.instances.get("srr-request");
  if ( isShown(open) && !Object.keys(defaults).length ) {
    open.bringToFront();
    return open;
  }
  open?.close();
  const app = new RequestWindow(defaults);
  app.render({force: true});
  return app;
}
