// Sample windows (api.samples, contract in samples.mjs): the request window, the player window, the dialogs and the
// result cards filled with made-up requests, so translators and testers see every text in its place without sending a
// request first. Nothing here writes: the windows read their lists from memory, every button that would send, save or
// roll only says that it does nothing, no usage counter counts, the cards are never saved.
import {MODULE_ID, esc, sampleDocs, setting, t} from "./config.mjs";
import {hudButton} from "./entry-points.mjs";
import {checkSelect} from "./planned.mjs";
import {RollPrompt} from "./prompt-app.mjs";
import {RequestWindow, pickerHtml, plannedFormHtml, wirePicker} from "./request-app.mjs";
import {parseRollId} from "./request-model.mjs";
import {describeRoll} from "./requests.mjs";
import {PARTY, sampleCards, sampleLists, samplePrompts} from "./sample-data.mjs";
import {blockedForm, closeSample, markSample, openSampleChat, openSampleHtml, sampleActions, sampleCast, sampleId} from "./samples.mjs";

/** Actions of the request window that only look: pick a roll, a tab, a DC, an option, tick who rolls. */
const LOOKING = ["srrPick", "srrQuick", "srrToolTab", "srrNone", "srrRemove", "srrDcChip", "srrDcShown", "srrOption"];

const say = key => t(`SRR.Sample.${key}`);

/* -------------------------------------------- */
/*  Made-up actors and texts                    */
/* -------------------------------------------- */

/**
 * The party as actors in memory, found by their uuid like any actor of the world. Never saved. The player who looks
 * owns the first two, the other players the rest, so cards and the player window show what a player sees.
 * @returns {Map<string, Actor>}
 */
export function sampleActors() {
  const Actor = getDocumentClass("Actor");
  const types = game.documentTypes?.Actor ?? [];
  const type = types.includes("character") ? "character" : (types.find(item => item !== "base") ?? "character");
  const players = game.users.filter(user => !user.isGM);
  const mine = game.user.isGM ? null : game.user;
  const actors = new Map();
  sampleCast().filter(member => member.side === "party").forEach((member, index) => {
    const others = players.filter(user => user !== mine);
    const owner = (mine && (index < 2)) ? mine : others[index % Math.max(others.length, 1)];
    const _id = `srrSample${member.id}`.padEnd(16, "0").slice(0, 16);
    const actor = new Actor({_id, name: member.name, img: member.img, type,
      ownership: {default: 0, ...(owner ? {[owner.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER} : {})}});
    sampleDocs.set(actor.uuid, actor);
    actors.set(member.id, actor);
  });
  return actors;
}

/**
 * Titles and notes of the made-up requests, in the language of the user.
 * @returns {{titles: Record<string, string>, notes: Record<string, string>}}
 */
function sampleTexts() {
  const titles = Object.fromEntries(["perception", "dexterity", "strength", "stealth", "insight", "athletics", "acrobatics", "survival",
    "investigation", "constitution", "wisdom", "reflex", "fighting", "agility"].map(key => [key, say(`roll.${key}`)]));
  const notes = Object.fromEntries(["ledge", "wall", "door", "formulaLabel", "formulaNote", "plannedBridge", "plannedRiver"]
    .map(key => [key, say(`note.${key}`)]));
  return {titles, notes};
}

/** The context the pure builders (sample-data.mjs) need. */
function sampleContext() {
  const actors = sampleActors();
  return {uuidOf: id => actors.get(id).uuid, userId: game.user.id, ...sampleTexts(), actors};
}

/* -------------------------------------------- */
/*  The windows                                 */
/* -------------------------------------------- */

/**
 * The request window with sent requests, planned checks and presets in its lists, the party picked.
 * @returns {Promise<Application>}
 */
async function openRequest() {
  const id = sampleId(MODULE_ID, "request");
  await closeSample(id);
  const ctx = sampleContext();
  const keyTitles = {prc: ctx.titles.perception, dex: ctx.titles.dexterity, ste: ctx.titles.stealth, inv: ctx.titles.investigation,
    con: ctx.titles.constitution, wis: ctx.titles.wisdom};
  const describe = (rolls, dc) => {
    const {type, key} = parseRollId(rolls[0]);
    return `${describeRoll({type, key, title: keyTitles[key]})}, ${t("SRR.Card.dc", {dc})}`;
  };
  const app = new RequestWindow({actors: PARTY.map(member => ctx.actors.get(member))}, {
    id,
    actions: sampleActions(RequestWindow, LOOKING),
    form: {handler: blockedForm}
  });
  app.sample = sampleLists(ctx, describe);
  markSample(app);
  await app.render({force: true});
  return app;
}

/**
 * The player window with open requests of the player's two characters.
 * @param {"single"|"choice"} kind
 * @returns {Promise<Application>}
 */
async function openPrompt(kind) {
  const id = sampleId(MODULE_ID, `prompt-${kind}`);
  await closeSample(id);
  const list = samplePrompts(sampleContext())[kind];
  class SamplePrompt extends RollPrompt {
    items() {
      return list;
    }
  }
  const app = new SamplePrompt({id, actions: sampleActions(RollPrompt, [])});
  markSample(app);
  await app.render({force: true});
  return app;
}

/**
 * A result card of the chat log, drawn by the real card code from a request in memory.
 * @param {string} kind      The key of `sampleCards`
 * @returns {Promise<Application>}
 */
async function openCard(kind) {
  const ctx = sampleContext();
  const request = sampleCards(ctx)[kind];
  return openSampleChat({moduleId: MODULE_ID, id: `card-${kind}`, title: say(`entry.card.${kind}`),
    content: `<p>${esc(request.title || request.label || request.formula)}</p>`, flags: {[MODULE_ID]: {request}}, width: (kind === "daggerheart") ? 440 : 360});
}

/**
 * A dialog of the module as a framed window: its content from the real code and a button that does nothing.
 * @param {object} options
 * @returns {Promise<Application>}
 */
async function openDialog({id, title, build, ok}) {
  return openSampleHtml({moduleId: MODULE_ID, id, title, width: 400, body: () => {
    const element = document.createElement("div");
    element.innerHTML = build() + `<footer class="form-footer" style="display:flex;justify-content:flex-end;margin-top:8px">
      <button type="button" class="default"><i class="fa-solid fa-check" inert></i> ${esc(ok)}</button></footer>`;
    wirePicker(element);
    return element;
  }});
}

/** The rows of the add dialog: actors not in the list yet. */
function pickerRows(withHeroes) {
  const cast = sampleCast();
  return cast.filter(member => withHeroes || (member.side !== "party")).map(member => ({
    uuid: `Actor.${member.id}`, name: member.name, img: member.img, owners: member.side === "party" ? member.player : ""
  }));
}

/** The token HUD button and the entry of the actor directory menu. */
async function openHud() {
  return openSampleHtml({moduleId: MODULE_ID, id: "hud", title: say("entry.hud"), width: 340, body: () => {
    const element = document.createElement("div");
    element.className = "srr-body";
    element.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:4px;";
    const button = hudButton();
    button.style.cssText = "width:36px;height:36px;flex:0 0 auto;";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;";
    const box = document.createElement("div");
    box.style.cssText = "padding:6px;border-radius:6px;background:#1c1c1c;";
    box.append(button);
    const label = document.createElement("span");
    label.textContent = t("SRR.Hud.button");
    row.append(box, label);
    const menu = document.createElement("ul");
    menu.style.cssText = "list-style:none;margin:0;padding:6px 10px;border-radius:6px;background:#1c1c1c;color:#ddd;display:flex;gap:8px;align-items:center;";
    menu.innerHTML = `<li style="display:flex;gap:8px;align-items:center;"><i class="fa-solid fa-dice-d20" inert></i><span>${esc(t("SRR.Hud.entry"))}</span></li>`;
    element.append(row, menu);
    return element;
  }});
}

/** The settings of the Region behavior that runs a planned check, in the form of Foundry's behavior sheet. */
async function openBehavior() {
  return openSampleHtml({moduleId: MODULE_ID, id: "behavior", title: say("entry.behavior"), width: 420, body: () => {
    const lists = sampleLists({...sampleContext()}, () => "");
    const group = (key, field) => `<div class="form-group"><label>${esc(t(`SRR.BEHAVIOR.FIELDS.${key}.label`))}</label>
      <div class="form-fields">${field}</div><p class="hint">${esc(t(`SRR.BEHAVIOR.FIELDS.${key}.hint`))}</p></div>`;
    const select = (name, options, value) => `<select name="${name}">${options.map(option =>
      `<option value="${option}"${option === value ? " selected" : ""}>${esc(t(`SRR.BEHAVIOR.${name}.${option}`))}</option>`).join("")}</select>`;
    const element = document.createElement("div");
    element.className = "srr-body";
    element.innerHTML = `<h3>${esc(t("SRR.BEHAVIOR.label"))}</h3><p class="hint">${esc(t("SRR.BEHAVIOR.hint"))}</p>`
      + group("check", "<span data-check></span>") + group("who", select("who", ["token", "region"], "token"))
      + group("times", select("times", ["once", "always"], "once"))
      + group("playersOnly", `<input type="checkbox" name="playersOnly" checked>`);
    element.querySelector("[data-check]").replaceWith(checkSelect(lists.planned[0].id, lists.planned));
    return element;
  }});
}

/* -------------------------------------------- */
/*  The list                                    */
/* -------------------------------------------- */

/** Result cards: sample id and group. */
const CARDS = ["half", "all", "any", "secret", "blind", "choice", "formula", "passive"];
const SYSTEM_CARDS = ["pf2e", "swade", "crucible", "daggerheart"];

/**
 * The sample entries of this module (api.samples).
 * @returns {{id: string, label: string, group: string, open: () => Promise<Application>}[]}
 */
export function sampleWindows() {
  const entry = (id, group, label, open) => ({id, group: say(`group.${group}`), label, open});
  return [
    entry("request", "window", say("entry.request"), openRequest),
    entry("prompt", "player", say("entry.prompt"), () => openPrompt("single")),
    entry("prompt-choice", "player", say("entry.promptChoice"), () => openPrompt("choice")),
    ...CARDS.map(kind => entry(`card-${kind}`, "card", say(`entry.card.${kind}`), () => openCard(kind))),
    ...SYSTEM_CARDS.map(kind => entry(`card-${kind}`, "system", say(`entry.card.${kind}`), () => openCard(kind))),
    entry("add-player", "dialog", say("entry.addPlayer"), () => openDialog({id: "add-player", title: t("SRR.Request.drop"),
      ok: t("SRR.Request.addPlayerOk"), build: () => pickerHtml(pickerRows(true))})),
    entry("add-player-empty", "dialog", say("entry.addPlayerEmpty"), () => openDialog({id: "add-player-empty", title: t("SRR.Request.drop"),
      ok: t("SRR.Request.addPlayerOk"), build: () => pickerHtml([])})),
    entry("plan", "dialog", say("entry.plan"), () => openDialog({id: "plan", title: t("SRR.Planned.dialogTitle"), ok: t("SRR.Planned.ok"),
      build: () => plannedFormHtml({text: `${describeRoll({type: "save", key: "dex", title: say("roll.dexterity")})}, ${t("SRR.Card.dc", {dc: 14})}`,
        label: say("note.plannedBridge"), who: "party", after: "done", full: true, values: {dc: 14, showDc: true, mode: "public", group: "half"}})})),
    entry("hud", "dialog", say("entry.hud"), openHud),
    entry("behavior", "dialog", say("entry.behavior"), openBehavior)
  ];
}

export const __test__ = {LOOKING, CARDS, SYSTEM_CARDS};
