/**
 * The GM's request window: every roll of the system as a button on the left, who rolls and how on the right. It starts
 * from the last roll of this GM, with no DC or advantage left over from the request before, and from the tokens
 * selected on the canvas, otherwise from the characters of the scene.
 */

import {getAdapter, rollGroups} from "./adapters/index.mjs";
import {MODULE_ID, addSettingsGear, esc, fromUuidQuiet, isShown, setting, t} from "./config.mjs";
import {ADVANTAGE, CHOOSABLE, GROUP_RULES, MODES, parseRollId, rollId} from "./request-model.mjs";
import {createRequest, entriesFrom, playerOwners} from "./requests.mjs";
import {countFeature} from "./usage.mjs";

const {ApplicationV2} = foundry.applications.api;

/** The DC buttons of systems that name none. */
const DC_CHIPS = [5, 10, 12, 15, 18, 20, 25, 30];

/** How many saved presets and last rolls stand above the buttons. */
const PRESET_LIMIT = 12;
const RECENT_LIMIT = 5;

/** The icons of the choices on the right. */
const SCOPE_ICONS = {scene: "fa-map", party: "fa-users", selected: "fa-expand", all: "fa-border-all"};
const ADVANTAGE_ICONS = {normal: "fa-minus", advantage: "fa-angles-up", disadvantage: "fa-angles-down"};
const MODE_ICONS = {public: "fa-globe", gm: "fa-crown", blind: "fa-eye-slash", silent: "fa-volume-xmark"};
const GROUP_ICONS = {off: "fa-minus", half: "fa-circle-half-stroke", all: "fa-circle-check", any: "fa-user"};

/**
 * The candidate key of a token: a linked token rolls as its actor, an unlinked one as itself.
 * @param {TokenDocument} doc
 * @returns {string}
 */
function candidateUuid(doc) {
  return (doc.actorLink && doc.actor) ? doc.actor.uuid : doc.uuid;
}

/**
 * An icon element.
 * @param {string|null} icon     The Font Awesome class
 * @param {string} [extra]
 * @returns {string}
 */
function iconHtml(icon, extra="") {
  return icon ? `<i class="fa-solid ${esc(icon)}${extra ? ` ${esc(extra)}` : ""}" inert></i>` : "";
}

/**
 * Make a roll word findable: lower case, in the text of the roll and of its group.
 * @param {...string} parts
 * @returns {string}
 */
function searchText(...parts) {
  return parts.join(" ").toLocaleLowerCase(game.i18n.lang);
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
    window: {title: "SRR.Request.title", icon: "fa-solid fa-dice-d20"},
    position: {width: 760, height: "auto"},
    form: {handler: RequestWindow.#onSubmit, submitOnChange: false, closeOnSubmit: false},
    actions: {
      srrPick: RequestWindow.#onPick,
      srrQuick: RequestWindow.#onQuick,
      srrPresetRemove: RequestWindow.#onPresetRemove,
      srrPresetSave: RequestWindow.#onPresetSave,
      srrToolTab: RequestWindow.#onToolTab,
      srrScope: RequestWindow.#onScope,
      srrNone: RequestWindow.#onNone,
      srrRemove: RequestWindow.#onRemove,
      srrDcChip: RequestWindow.#onDcChip,
      srrDcShown: RequestWindow.#onDcShown,
      srrOption: RequestWindow.#onOption
    }
  };

  /** The values of the form. */
  #values = null;

  /** Which list "who rolls" shows: scene, party, selected, all, or given (the actors of a macro). */
  #scope = "scene";

  /** The uuids that roll. */
  #picked = new Set();

  /** Actors that were dropped onto the window or came with a macro. */
  #extra = new Set();

  /** The open tab of the tools. */
  #toolTab = null;

  /** The filter text. */
  #filter = "";

  /** Waits for the selection on the canvas to settle. */
  #selectionTimer = null;

  /** The roll groups of this drawing. */
  #groupCache = null;

  /** @override */
  get title() {
    return t("SRR.Request.title");
  }

  /* -------------------------------------------- */
  /*  Values                                      */
  /* -------------------------------------------- */

  /**
   * The values to start with. Only the roll stays from the last request: a leftover secret mode, DC or disadvantage
   * would change the next request without anyone noticing.
   * @returns {object}
   */
  #startValues() {
    let last = {};
    try {
      last = setting("lastRequest") ?? {};
    } catch {}
    const d = this.defaults;
    const given = Array.isArray(d.choices) && d.choices.length ? d.choices.map(c => rollId(c.type, c.key))
      : d.type ? [rollId(d.type, d.type === "formula" ? "" : d.key)] : null;
    const remembered = Array.isArray(last.rolls) ? last.rolls : last.type ? [rollId(last.type, last.key)] : null;
    const group = d.group === true ? (d.groupRule ?? "half") : GROUP_RULES.includes(d.group) ? d.group : "off";
    return {
      rolls: given ?? remembered ?? [],
      formula: d.formula ?? last.formula ?? "",
      label: d.label ?? last.label ?? "",
      dc: d.dc ?? "",
      showDc: d.showDc !== false,
      mode: MODES.includes(d.mode) ? d.mode : "public",
      advantage: ADVANTAGE.includes(d.advantage) ? d.advantage : "normal",
      group,
      note: d.note ?? "",
      autoRollNpcs: d.autoRollNpcs ?? last.autoRollNpcs ?? true
    };
  }

  /**
   * The roll groups in the order of the window, with every option as a known roll.
   * @returns {object[]}
   */
  #groups() {
    this.#groupCache ??= rollGroups(this.#shownActors());
    return this.#groupCache;
  }

  /**
   * The actors of the open list, ticked or not: the buttons offer what any of them can roll.
   * @returns {Actor[]}
   */
  #shownActors() {
    return [...this.#listOf(this.#scope), ...this.#extra].map(uuid => fromUuidQuiet(uuid)).map(doc => doc?.actor ?? doc).filter(Boolean);
  }

  /**
   * All rolls of the system by id.
   * @returns {Map<string, object>}
   */
  #rollsById() {
    const rolls = new Map();
    for ( const group of this.#groups() ) {
      if ( group.type === "formula" ) continue;
      for ( const option of group.options ) rolls.set(rollId(group.type, option.key), {...option, type: group.type});
    }
    return rolls;
  }

  /**
   * Keep only rolls this system has, and start from the first quick roll when nothing is left.
   */
  #checkRolls() {
    const rolls = this.#rollsById();
    const known = this.#values.rolls.filter(id => (id === "formula:") || rolls.has(id));
    if ( !known.length ) {
      const adapter = getAdapter();
      const first = (adapter.quick ?? []).find(id => rolls.has(id)) ?? rolls.keys().next().value;
      known.push(first ?? "formula:");
    }
    this.#values.rolls = known;
  }

  /* -------------------------------------------- */
  /*  Who rolls                                   */
  /* -------------------------------------------- */

  /** @returns {string[]} */
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

  /**
   * The player characters with a token on the viewed scene.
   * @returns {string[]}
   */
  #sceneCharacters() {
    const onScene = new Set((canvas?.scene?.tokens ?? []).map(token => token.actor?.id).filter(Boolean));
    return this.#playerCharacters().filter(actor => onScene.has(actor.id)).map(actor => actor.uuid);
  }

  /**
   * The party of the system, otherwise the characters assigned to the players.
   * @returns {string[]}
   */
  #partyCharacters() {
    let party = [];
    try {
      party = getAdapter().party?.() ?? [];
    } catch(err) {
      console.warn(`${MODULE_ID} | The party could not be read`, err);
    }
    if ( !party.length ) party = game.users.filter(user => !user.isGM && user.character).map(user => user.character);
    return [...new Set(party.map(actor => actor.uuid))];
  }

  /**
   * The uuids of a list.
   * @param {string} scope
   * @returns {string[]}
   */
  #listOf(scope) {
    switch ( scope ) {
      case "scene": return this.#sceneCharacters();
      case "party": return this.#partyCharacters();
      case "selected": return this.#selectedTokens();
      case "all": return this.#playerCharacters().map(actor => actor.uuid);
    }
    return [];
  }

  /**
   * Whether the players of a character are all away. A character nobody plays counts as here.
   * @param {string} uuid
   * @returns {boolean}
   */
  #isAway(uuid) {
    const doc = fromUuidQuiet(uuid);
    const owners = playerOwners(doc?.actor ?? doc);
    return (owners.length > 0) && !owners.some(user => user.active);
  }

  /**
   * Show a list and tick who is here. When nobody is, the GM prepares alone: everyone stays ticked.
   * @param {string} scope
   */
  #useScope(scope) {
    this.#scope = scope;
    const list = this.#listOf(scope);
    const here = (scope === "selected") ? list : list.filter(uuid => !this.#isAway(uuid));
    this.#picked = new Set([...(here.length ? here : list), ...this.#extra]);
  }

  /**
   * The list to start with: the given actors, the selected tokens, the scene, the party, all characters.
   */
  #startScope() {
    const given = this.defaults.actors;
    if ( Array.isArray(given) && given.length ) {
      for ( const source of given ) {
        const doc = typeof source === "string" ? fromUuidQuiet(source) : (source?.document ?? source);
        const uuid = doc?.documentName === "Token" ? candidateUuid(doc) : (doc?.uuid ?? (typeof source === "string" ? source : null));
        if ( uuid ) this.#extra.add(uuid);
      }
      this.#scope = "given";
      this.#picked = new Set(this.#extra);
      return;
    }
    const scope = ["selected", "scene", "party"].find(s => this.#listOf(s).length) ?? "all";
    this.#useScope(scope);
  }

  /**
   * The candidates of the open list and the added actors.
   * @returns {object[]}
   */
  #candidates() {
    const uuids = [...new Set([...this.#listOf(this.#scope), ...this.#extra])];
    return uuids.map(uuid => {
      const doc = fromUuidQuiet(uuid);
      const entry = doc ? entriesFrom([doc])[0] : null;
      if ( !entry ) return null;
      const owners = playerOwners(doc.actor ?? doc).map(user => user.name).join(", ");
      return {uuid, name: entry.name, img: entry.img, owners: owners || t("SRR.Request.npc"), away: this.#isAway(uuid),
        token: doc.documentName === "Token", added: this.#extra.has(uuid), checked: this.#picked.has(uuid)};
    }).filter(Boolean);
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    this.#groupCache = null;
    if ( !this.#values ) {
      this.#values = this.#startValues();
      this.#startScope();
    }
    this.#checkRolls();
    return {groups: this.#groups(), adapter: getAdapter(), theme: setting("theme")};
  }

  /**
   * The HTML of one roll button.
   * @param {object} group
   * @param {object} option
   * @returns {string}
   */
  #rollButton(group, option) {
    const id = rollId(group.type, option.key);
    const label = this.#rollText({...option, type: group.type});
    const title = t(`SRR.Type.${group.type}`);
    const center = (group.cols ?? 3) > 4 ? " is-center" : "";
    const tab = option.tab ? ` data-tab="${esc(option.tab)}"` : "";
    const text = option.short ?? option.label;
    // Tools can be long for their button, and a short word says less than the roll it stands for
    const tooltip = (text !== label) || option.tab ? ` data-tooltip="${esc(label)}"` : "";
    return `<button type="button" class="srr-rollbtn${center}" data-action="srrPick" data-roll="${esc(id)}"${tab}
      data-search="${esc(searchText(label, option.label, title))}"${tooltip} aria-pressed="false">
      ${iconHtml(option.icon, option.tint ? `srr-tint-${option.tint}` : "")}<span>${esc(text)}</span></button>`;
  }

  /**
   * The text of a roll, like the card names it.
   * @param {{type: string, label: string}} roll
   * @returns {string}
   */
  #rollText({type, label}) {
    const key = `SRR.Label.${type}`;
    return game.i18n.has(key) ? t(key, {name: label}) : label;
  }

  /**
   * The row of one roll group.
   * @param {object} group
   * @returns {string}
   */
  #groupHtml(group) {
    const head = `<h3>${iconHtml(group.icon)}<span>${esc(t(`SRR.Section.${group.type}`))}</span></h3>`;
    if ( group.type === "formula" ) {
      const values = this.#values;
      return `<section class="srr-rollgroup" data-group="formula" data-search="${esc(searchText(t("SRR.Section.formula"), t("SRR.Type.formula")))}">${head}
        <div class="srr-formula">
          <input type="text" name="formula" value="${esc(values.formula)}" placeholder="1d20 + @abilities.dex.mod" aria-label="${esc(t("SRR.Request.formula"))}">
          <input type="text" name="label" value="${esc(values.label)}" placeholder="${esc(t("SRR.Request.labelHint"))}" aria-label="${esc(t("SRR.Request.label"))}">
        </div></section>`;
    }
    const buttons = group.options.map(option => this.#rollButton(group, option)).join("");
    let tabs = "";
    if ( group.tabs ) {
      this.#toolTab ??= group.tabs[0].id;
      tabs = `<div class="srr-tabs srr-tooltabs">${group.tabs.map(tab => `<button type="button" data-action="srrToolTab"
        data-tab="${esc(tab.id)}" aria-pressed="false">${iconHtml(tab.icon)}<span>${esc(t(`SRR.ToolTab.${tab.id}`))}</span></button>`).join("")}</div>`;
    }
    return `<section class="srr-rollgroup" data-group="${esc(group.type)}">${head}<div>${tabs}
      <div class="srr-rollgrid${group.fit ? " is-fit" : ""}" style="--srr-cols: ${Number(group.cols) || 3}">${buttons}</div></div></section>`;
  }

  /** @returns {string} */
  #whoHtml() {
    const tiles = this.#candidates().map(c => `<div class="srr-tile${c.checked ? " is-checked" : ""}" data-tooltip="${esc(c.name)}, ${esc(c.owners)}${c.away ? `, ${esc(t("SRR.Request.offline"))}` : ""}">
      <label><input type="checkbox" name="actor" value="${esc(c.uuid)}"${c.checked ? " checked" : ""}>
      <img src="${esc(c.img || "icons/svg/mystery-man.svg")}" alt="">
      <span class="srr-tile-name">${esc(c.name)}</span>
      ${c.token ? iconHtml("fa-chess-pawn", "srr-tile-mark") : ""}
      ${c.away ? `<span class="srr-tile-away">${esc(t("SRR.Request.offlineShort"))}</span>` : ""}</label>
      ${c.added ? `<button type="button" class="srr-icon" data-action="srrRemove" data-uuid="${esc(c.uuid)}"
        data-tooltip="${esc(t("SRR.Request.remove"))}" aria-label="${esc(t("SRR.Request.remove"))}"><i class="fa-solid fa-xmark" inert></i></button>` : ""}
      </div>`).join("");
    return `${tiles}<p class="srr-drop" data-tooltip="${esc(t("SRR.Request.dropHint"))}">${iconHtml("fa-plus")}${esc(t("SRR.Request.drop"))}</p>`;
  }

  /**
   * One row of choices on the right.
   * @param {string} name
   * @param {string} title
   * @param {string} value
   * @param {{id: string, icon: string, label: string, tooltip: string}[]} options
   * @returns {string}
   */
  #optionRow(name, title, value, options) {
    const buttons = options.map(o => `<button type="button" data-action="srrOption" data-option="${esc(name)}" data-value="${esc(o.id)}"
      data-tooltip="${esc(o.tooltip)}" aria-label="${esc(o.tooltip)}" aria-pressed="${o.id === value}">${iconHtml(o.icon)}<span>${esc(o.label)}</span></button>`).join("");
    return `<div class="srr-option"><span class="srr-option-title">${esc(title)}</span><div class="srr-tabs">${buttons}</div></div>`;
  }

  /**
   * The chips above the buttons: the saved presets, then the last rolls.
   * @returns {string}
   */
  #quickHtml() {
    const rolls = this.#rollsById();
    const saved = this.#presets().map((preset, index) => {
      return `<span class="srr-chip is-preset"><button type="button" data-action="srrQuick" data-preset="${index}" data-tooltip="${esc(preset.name)}">
        ${iconHtml("fa-bookmark")}<span>${esc(preset.name)}</span></button>
        <button type="button" class="srr-chip-x" data-action="srrPresetRemove" data-preset="${index}"
          aria-label="${esc(t("SRR.Request.presetRemove"))}" data-tooltip="${esc(t("SRR.Request.presetRemove"))}"><i class="fa-solid fa-xmark" inert></i></button></span>`;
    }).join("");
    const recent = [...new Set([...this.#recent(), ...(getAdapter().quick ?? [])])].filter(id => rolls.has(id)).slice(0, RECENT_LIMIT);
    const chips = recent.map(id => {
      const roll = rolls.get(id);
      return `<span class="srr-chip"><button type="button" data-action="srrQuick" data-roll="${esc(id)}" data-tooltip="${esc(this.#rollText(roll))}">
        ${iconHtml(roll.icon, roll.tint ? `srr-tint-${roll.tint}` : "")}<span>${esc(this.#rollText(roll))}</span></button></span>`;
    }).join("");
    return saved + chips;
  }

  /** @returns {object[]} */
  #presets() {
    try {
      return setting("presets") ?? [];
    } catch {
      return [];
    }
  }

  /** @returns {string[]} */
  #recent() {
    try {
      return setting("recentRolls") ?? [];
    } catch {
      return [];
    }
  }

  /** @override */
  async _renderHTML(context) {
    const {adapter, groups} = context;
    const values = this.#values;
    const order = [...groups.filter(g => !["formula", "tool"].includes(g.type)), ...groups.filter(g => g.type === "formula"),
      ...groups.filter(g => g.type === "tool")];
    const scopes = ["scene", "party", "selected", "all"].map(id => `<button type="button" data-action="srrScope" data-scope="${id}"
      data-tooltip="${esc(t(`SRR.Scope.${id}`))}" aria-label="${esc(t(`SRR.Scope.${id}`))}" aria-pressed="false">
      ${iconHtml(SCOPE_ICONS[id])}<span>${esc(t(`SRR.Scope.${id}`))}</span></button>`).join("");
    const dcName = adapter.dcName ?? "dc";
    const chips = (adapter.dcChips ?? DC_CHIPS).map(value => `<button type="button" data-action="srrDcChip" data-dc="${value}" aria-pressed="false">${value}</button>`).join("");
    const advantage = adapter.advantage ? this.#optionRow("advantage", t("SRR.Request.advantage"), values.advantage, ADVANTAGE.map(id => {
      const short = adapter.advantageShort?.[id] ?? `SRR.Short.${id}`;
      const long = adapter.advantageLabels?.[id] ?? `SRR.Advantage.${id}`;
      return {id, icon: ADVANTAGE_ICONS[id], label: t(short), tooltip: id === "normal" ? t(short) : t(long)};
    })) : "";
    const modes = this.#optionRow("mode", t("SRR.Request.mode"), values.mode, MODES.map(id => ({id, icon: MODE_ICONS[id],
      label: t(`SRR.Short.${id}`), tooltip: t(`SRR.Mode.${id}`)})));
    const group = this.#optionRow("group", t("SRR.Request.group"), values.group, ["off", ...GROUP_RULES].map(id => ({id, icon: GROUP_ICONS[id],
      label: t(`SRR.Short.${id}`), tooltip: t(`SRR.GroupRule.${id}`)})));
    return `<div class="srr-body srr-rq" data-srr-theme="${esc(context.theme)}">
      <div class="srr-rq-top">
        <label class="srr-filter"><i class="fa-solid fa-magnifying-glass" inert></i>
          <input type="text" name="filter" value="${esc(this.#filter)}" autocomplete="off" placeholder="${esc(t("SRR.Request.filter"))}" aria-label="${esc(t("SRR.Request.filter"))}"></label>
        <div class="srr-quick">${this.#quickHtml()}</div>
      </div>
      <div class="srr-rq-panes">
        <div class="srr-rq-rolls">
          ${order.map(g => this.#groupHtml(g)).join("")}
          <p class="srr-empty srr-nothing is-hidden">${esc(t("SRR.Request.noRoll"))}</p>
        </div>
        <div class="srr-rq-side">
          <div><div class="srr-tabs srr-scopes">${scopes}<button type="button" data-action="srrNone" data-tooltip="${esc(t("SRR.Request.none"))}"
            aria-label="${esc(t("SRR.Request.none"))}">${iconHtml("fa-circle-xmark")}</button></div>
            <div class="srr-who">${this.#whoHtml()}</div></div>
          <div>
            <div class="srr-dc">
              <label for="srr-dc-input">${esc(t(`SRR.Request.${dcName}`))}</label>
              <input id="srr-dc-input" type="number" name="dc" min="0" max="999" step="1" value="${esc(values.dc)}" placeholder="${esc(adapter.defaultDc ?? t("SRR.Request.noDc"))}">
              <button type="button" class="srr-dc-shown" data-action="srrDcShown" aria-pressed="${values.showDc}"></button>
            </div>
            <div class="srr-dc-chips" style="--srr-cols: ${(adapter.dcChips ?? DC_CHIPS).length}">${chips}</div>
          </div>
          ${advantage}
          <div>${modes}<p class="srr-mode-hint"></p></div>
          ${group}
          <label class="srr-note"><i class="fa-solid fa-pen" inert></i>
            <input type="text" name="note" maxlength="200" value="${esc(values.note)}" placeholder="${esc(t("SRR.Request.noteHint"))}" aria-label="${esc(t("SRR.Request.note"))}"></label>
          <label class="srr-check" data-tooltip="${esc(t("SRR.Request.autoRollNpcs"))}"><input type="checkbox" name="autoRollNpcs"${values.autoRollNpcs ? " checked" : ""}> ${esc(t("SRR.Request.autoRollShort"))}</label>
        </div>
      </div>
      <footer class="srr-rq-foot">
        <button type="button" class="srr-preset-save" data-action="srrPresetSave" data-tooltip="${esc(t("SRR.Request.presetSave"))}" aria-label="${esc(t("SRR.Request.presetSave"))}"><i class="fa-solid fa-bookmark" inert></i></button>
        <span class="srr-rq-hint">${esc(t("SRR.Request.choiceHint"))}</span>
        <button type="submit" class="srr-primary"><i class="fa-solid fa-paper-plane" inert></i> <span class="srr-send"></span></button>
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
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // The form stays between redraws, so its listeners go on once
    this.element.addEventListener("dragover", event => event.preventDefault());
    this.element.addEventListener("drop", event => this.#onDrop(event));
    this.element.addEventListener("input", event => this.#onInput(event));
    this.element.addEventListener("change", event => this.#onChange(event));
    this.element.addEventListener("keydown", event => this.#onKeyDown(event));
    this.selectionHook = Hooks.on("controlToken", () => this.#onSelection());
    this.element.querySelector("input[name=filter]")?.focus();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    Hooks.off("controlToken", this.selectionHook);
    clearTimeout(this.#selectionTimer);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#sync();
    this.#applyFilter();
  }

  /**
   * Bring the buttons and the send button in line with the values.
   */
  #sync() {
    const form = this.element;
    const values = this.#values;
    const pressed = (button, on) => {
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("is-on", on);
    };
    for ( const button of form.querySelectorAll(".srr-rollbtn") ) pressed(button, values.rolls.includes(button.dataset.roll));
    form.querySelector("[data-group=formula] .srr-formula")?.classList.toggle("is-on", values.rolls.includes("formula:"));
    for ( const button of form.querySelectorAll("[data-action=srrScope]") ) pressed(button, button.dataset.scope === this.#scope);
    for ( const button of form.querySelectorAll("[data-action=srrToolTab]") ) pressed(button, button.dataset.tab === this.#toolTab);
    const passive = values.rolls.every(id => parseRollId(id).type === "passive");
    const plain = passive || values.rolls.includes("combat:hitDie");
    for ( const button of form.querySelectorAll("[data-action=srrOption]") ) {
      pressed(button, values[button.dataset.option] === button.dataset.value);
      const {option} = button.dataset;
      button.disabled = ((option === "mode") && passive) || ((option === "advantage") && plain);
    }
    for ( const button of form.querySelectorAll("[data-action=srrDcChip]") ) pressed(button, button.dataset.dc === String(values.dc));
    const shown = form.querySelector(".srr-dc-shown");
    if ( shown ) {
      const name = getAdapter().dcName ?? "dc";
      shown.setAttribute("aria-pressed", String(values.showDc));
      shown.classList.toggle("is-secret", !values.showDc);
      shown.innerHTML = `${iconHtml(values.showDc ? "fa-eye" : "fa-eye-slash")}<span>${esc(t(values.showDc ? "SRR.Request.showDc" : `SRR.Request.secret.${name}`))}</span>`;
    }
    const hint = form.querySelector(".srr-mode-hint");
    if ( hint ) hint.textContent = t(passive ? "SRR.Mode.passiveHint" : `SRR.Mode.${values.mode}Hint`);
    const send = form.querySelector(".srr-send");
    if ( send ) send.textContent = this.#sendLabel();
    form.querySelector(".srr-primary")?.toggleAttribute("disabled", !this.#picked.size);
    this.#applyToolTab();
  }

  /** Show the tools of the open tab; a filter looks through all of them. */
  #applyToolTab() {
    const filtering = !!this.#filter.trim();
    this.element.querySelector(".srr-tooltabs")?.classList.toggle("is-hidden", filtering);
    for ( const button of this.element.querySelectorAll(".srr-rollbtn[data-tab]") ) {
      button.classList.toggle("is-other-tab", !filtering && (button.dataset.tab !== this.#toolTab));
    }
  }

  /** Hide what the filter does not find. */
  #applyFilter() {
    const form = this.element;
    const words = searchText(this.#filter).split(/\s+/).filter(Boolean);
    const hit = text => words.every(word => text.includes(word));
    let found = 0;
    for ( const group of form.querySelectorAll(".srr-rollgroup") ) {
      if ( group.dataset.group === "formula" ) {
        const on = hit(group.dataset.search ?? "");
        group.classList.toggle("is-hidden", !on);
        found += on ? 1 : 0;
        continue;
      }
      let shown = 0;
      for ( const button of group.querySelectorAll(".srr-rollbtn") ) {
        const on = hit(button.dataset.search ?? "");
        button.classList.toggle("is-filtered", !on);
        shown += on ? 1 : 0;
      }
      group.classList.toggle("is-hidden", !shown);
      found += shown;
    }
    form.querySelector(".srr-nothing")?.classList.toggle("is-hidden", found > 0);
    this.#applyToolTab();
  }

  /**
   * What the send button says.
   * @returns {string}
   */
  #sendLabel() {
    const count = this.#picked.size;
    if ( !count ) return t("SRR.Request.pickWho");
    const form = this.#request();
    const what = this.#whatText(form);
    const passive = form.type === "passive";
    const kind = passive ? "compare" : (form.mode === "silent") ? "silent" : "ask";
    return t(`SRR.Request.${kind}.${count === 1 ? "one" : "many"}`, {count, what});
  }

  /**
   * The text of a request: which rolls and the DC.
   * @param {object} form    The input of a request
   * @returns {string}
   */
  #whatText(form) {
    const rolls = this.#rollsById();
    const name = id => {
      if ( id === "formula:" ) return form.label || form.formula || t("SRR.Type.formula");
      const roll = rolls.get(id);
      return roll ? this.#rollText(roll) : id;
    };
    const text = this.#values.rolls.map(name).join(` ${t("SRR.Request.or")} `);
    if ( form.dc === "" || form.dc === null ) return text;
    const dcName = getAdapter().dcName ?? "dc";
    return `${text}, ${form.showDc ? t(`SRR.Card.${dcName}`, {dc: form.dc}) : t(`SRR.Request.secretValue.${dcName}`, {dc: form.dc})}`;
  }

  /**
   * The input of a request from the values, without the actors.
   * @returns {object}
   */
  #request() {
    const values = this.#values;
    const first = parseRollId(values.rolls[0]);
    return {
      ...first,
      choices: values.rolls.length > 1 ? values.rolls.map(parseRollId) : undefined,
      formula: values.formula,
      label: values.label,
      dc: values.dc,
      showDc: values.showDc,
      mode: values.mode,
      advantage: values.advantage,
      group: values.group === "off" ? false : values.group,
      note: values.note,
      autoRollNpcs: values.autoRollNpcs
    };
  }

  /* -------------------------------------------- */
  /*  Events                                      */
  /* -------------------------------------------- */

  /**
   * Typing into a field.
   * @param {InputEvent} event
   */
  #onInput(event) {
    const {name, value} = event.target;
    if ( name === "filter" ) {
      this.#filter = value;
      this.#applyFilter();
      return;
    }
    if ( ["formula", "label"].includes(name) ) {
      this.#values[name] = value;
      this.#values.rolls = ["formula:"];
    }
    else if ( ["dc", "note"].includes(name) ) this.#values[name] = value;
    else return;
    this.#sync();
  }

  /**
   * Ticking a box.
   * @param {Event} event
   */
  #onChange(event) {
    const box = event.target;
    if ( box.name === "actor" ) {
      if ( box.checked ) this.#picked.add(box.value);
      else this.#picked.delete(box.value);
      box.closest(".srr-tile")?.classList.toggle("is-checked", box.checked);
      this.#sync();
    }
    else if ( box.name === "autoRollNpcs" ) this.#values.autoRollNpcs = box.checked;
  }

  /**
   * Enter in the filter takes the first roll it found, and the cursor moves on to the DC.
   * @param {KeyboardEvent} event
   */
  #onKeyDown(event) {
    if ( event.target.name !== "filter" ) return;
    if ( event.key === "Escape" ) {
      event.stopPropagation();
      event.target.value = "";
      this.#filter = "";
      this.#applyFilter();
      return;
    }
    if ( event.key !== "Enter" ) return;
    event.preventDefault();
    const first = [...this.element.querySelectorAll(".srr-rollbtn")].find(button => !button.closest(".is-hidden")
      && !button.classList.contains("is-filtered"));
    if ( !first ) return;
    this.#values.rolls = [first.dataset.roll];
    this.#filter = "";
    event.target.value = "";
    if ( first.dataset.tab ) this.#toolTab = first.dataset.tab;
    this.#applyFilter();
    this.#sync();
    this.element.querySelector("input[name=dc]")?.focus();
  }

  /** The tokens on the canvas changed: the list of selected tokens follows, a little later. */
  #onSelection() {
    if ( this.#scope !== "selected" ) return;
    clearTimeout(this.#selectionTimer);
    this.#selectionTimer = setTimeout(() => {
      if ( !isShown(this) || (this.#scope !== "selected") ) return;
      this.#useScope("selected");
      this.#drawWho();
    }, 150);
  }

  /** Draw "who rolls" again. */
  #drawWho() {
    // The rolls depend on who rolls in some systems
    if ( getAdapter().rollsOfActors ) {
      this.render();
      return;
    }
    const who = this.element.querySelector(".srr-who");
    if ( who ) who.innerHTML = this.#whoHtml();
    this.#sync();
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
    const key = doc.documentName === "Token" ? candidateUuid(doc) : doc.uuid;
    this.#extra.add(key);
    this.#picked.add(key);
    this.#drawWho();
  }

  /**
   * Pick a roll. Ctrl or Shift adds it, so each character picks one of the marked rolls.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onPick(event, target) {
    const id = target.dataset.roll;
    const values = this.#values;
    const {type} = parseRollId(id);
    const adds = (event.ctrlKey || event.metaKey || event.shiftKey) && CHOOSABLE.includes(type);
    if ( adds && values.rolls.every(roll => CHOOSABLE.includes(parseRollId(roll).type)) ) {
      const next = values.rolls.includes(id) ? values.rolls.filter(roll => roll !== id) : [...values.rolls, id];
      if ( next.length ) values.rolls = next;
    }
    else values.rolls = [id];
    this.#sync();
  }

  /**
   * Take a preset or one of the last rolls.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onQuick(event, target) {
    const values = this.#values;
    if ( target.dataset.roll ) values.rolls = [target.dataset.roll];
    else {
      const preset = this.#presets()[Number(target.dataset.preset)];
      if ( !preset ) return;
      Object.assign(values, preset.values, {rolls: preset.rolls});
      countFeature(MODULE_ID, "preset");
      for ( const name of ["dc", "note", "formula", "label"] ) {
        const field = this.element.querySelector(`input[name="${name}"]`);
        if ( field ) field.value = values[name] ?? "";
      }
    }
    this.#checkRolls();
    this.#sync();
  }

  /**
   * Save the request as a preset, without who rolls.
   * @this {RequestWindow}
   */
  static async #onPresetSave() {
    const {rolls, formula, label, dc, showDc, mode, advantage, group, note} = this.#values;
    const name = this.#whatText(this.#request());
    const presets = [...this.#presets(), {name, rolls, values: {formula, label, dc, showDc, mode, advantage, group, note}}].slice(-PRESET_LIMIT);
    await game.settings.set(MODULE_ID, "presets", presets);
    this.#drawQuick();
  }

  /**
   * Delete a preset.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onPresetRemove(event, target) {
    const presets = [...this.#presets()];
    presets.splice(Number(target.dataset.preset), 1);
    await game.settings.set(MODULE_ID, "presets", presets);
    this.#drawQuick();
  }

  /** Draw the chips above the buttons again. */
  #drawQuick() {
    const quick = this.element.querySelector(".srr-quick");
    if ( quick ) quick.innerHTML = this.#quickHtml();
  }

  /**
   * Open a tab of the tools.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onToolTab(event, target) {
    this.#toolTab = target.dataset.tab;
    this.#sync();
  }

  /**
   * Show another list of who rolls.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onScope(event, target) {
    const scope = target.dataset.scope;
    if ( (scope === "selected") && !this.#selectedTokens().length ) ui.notifications.info(t("SRR.Request.noneSelected"));
    this.#useScope(scope);
    this.#drawWho();
  }

  /**
   * Clear every tick.
   * @this {RequestWindow}
   */
  static #onNone() {
    this.#picked.clear();
    this.#drawWho();
  }

  /**
   * Take a dropped actor off the list.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onRemove(event, target) {
    this.#extra.delete(target.dataset.uuid);
    this.#picked.delete(target.dataset.uuid);
    this.#drawWho();
  }

  /**
   * Take a DC from its button, a second click clears it.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onDcChip(event, target) {
    const value = target.dataset.dc === String(this.#values.dc) ? "" : target.dataset.dc;
    this.#values.dc = value;
    const field = this.element.querySelector("input[name=dc]");
    if ( field ) field.value = value;
    this.#sync();
  }

  /**
   * Show the DC to the players or keep it secret.
   * @this {RequestWindow}
   */
  static #onDcShown() {
    this.#values.showDc = !this.#values.showDc;
    this.#sync();
  }

  /**
   * Choose advantage, how the results show, or the group rule.
   * @this {RequestWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onOption(event, target) {
    this.#values[target.dataset.option] = target.dataset.value;
    this.#sync();
  }

  /**
   * Send the request.
   * @this {RequestWindow}
   * @param {SubmitEvent} event
   */
  static async #onSubmit(event) {
    event?.preventDefault?.();
    const actors = [...this.#picked];
    if ( !actors.length ) {
      ui.notifications.warn(t("SRR.Error.noActors"));
      return;
    }
    const values = this.#values;
    try {
      await createRequest({...this.#request(), actors, rollActors: this.#shownActors()});
    } catch(err) {
      const key = String(err?.message ?? err);
      ui.notifications.warn(game.i18n.has(key) ? t(key) : key);
      return;
    }
    const {rolls, formula, label, autoRollNpcs} = values;
    await game.settings.set(MODULE_ID, "lastRequest", {rolls, formula, label, autoRollNpcs});
    const recent = [...rolls.filter(id => id !== "formula:"), ...this.#recent()];
    await game.settings.set(MODULE_ID, "recentRolls", [...new Set(recent)].slice(0, RECENT_LIMIT));
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
