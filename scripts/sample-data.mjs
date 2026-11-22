/**
 * Made-up requests for the sample windows (sample-windows.mjs), as plain data without Foundry: the cards of the chat
 * log in every state, the rolls of the player window, the lists of the request window. The same shape the real code
 * stores, so the real card and window code draws them. Nothing here is saved.
 */

import {buildRequest, judge, normalizeOptions, recentRecord, rollId} from "./request-model.mjs";
import {normalizePlanned} from "./planned-model.mjs";
import {sampleCast} from "./samples.mjs";

/** The scheme of each system for `judge`. */
const SCHEMES = {dnd5e: "d20", pf2e: "pf2e", swade: "swade", crucible: "crucible", daggerheart: "daggerheart"};

/** The party that rolls in the samples. */
export const PARTY = ["ari", "mira", "tovin", "sela"];

/**
 * The entries of a request for some of the cast.
 * @param {string[]} ids
 * @param {(id: string) => string} uuidOf   The uuid of the made-up actor
 * @returns {object[]}
 */
export function sampleEntries(ids, uuidOf) {
  const cast = sampleCast();
  return ids.map(id => {
    const member = cast.find(item => item.id === id);
    return {id: `s-${id}`, actorUuid: uuidOf(id), tokenUuid: null, name: member.name, img: member.img, npc: member.side !== "party"};
  });
}

/**
 * A request with results, the way `createRequest` and the answers of the players leave it on a card.
 * @param {object} spec
 * @param {object} ctx     {uuidOf, userId, titles: Record<string, string>}
 * @returns {object}
 */
function make(spec, ctx) {
  const {id, system = "dnd5e", entries = PARTY, results = [], title = "", choiceTitles = [], ...input} = spec;
  const options = normalizeOptions(input);
  options.choices = options.choices.map((choice, index) => ({...choice, title: choiceTitles[index] ?? ""}));
  const request = buildRequest(options, sampleEntries(entries, ctx.uuidOf), {
    id: `sample-${id}`, system, title: options.type === "formula" ? "" : title, createdAt: Date.UTC(2026, 10, 22, 19, 30), userId: ctx.userId
  });
  const scheme = SCHEMES[system] ?? "d20";
  for ( const [who, total, natural = null, extra = {}] of results ) {
    const {choice = null, duality = null, critfail = false, crit = false, ...rest} = extra;
    const judged = judge({total, natural}, request.dc, scheme, {critfail, crit: crit || duality === "critical", ...rest});
    request.results[`s-${who}`] = {total, natural, ...judged, messageId: null, userId: ctx.userId, at: Date.UTC(2026, 10, 22, 19, 31),
      ...(choice ? {choice} : {}), ...(duality ? {duality} : {})};
  }
  return request;
}

/**
 * The result cards, by sample id. Titles come from `ctx.titles` so they follow the language of the user.
 * @param {object} ctx     {uuidOf, userId, titles, notes}
 * @returns {Record<string, object>}
 */
export function sampleCards(ctx) {
  const T = ctx.titles;
  return {
    // A group check in progress: half must pass, a natural 20 and a natural 1, one still waiting
    half: make({id: "half", type: "skill", key: "prc", title: T.perception, dc: 15, group: "half",
      results: [["ari", 17, 12], ["mira", 9, 4], ["tovin", 22, 20]]}, ctx),
    // Everyone must pass and one did not: the group fails
    all: make({id: "all", type: "save", key: "dex", title: T.dexterity, dc: 14, group: "all", advantage: "disadvantage", note: ctx.notes.ledge,
      results: [["ari", 16, 11], ["mira", 3, 1], ["tovin", 15, 9], ["sela", 18, 13]]}, ctx),
    // One is enough
    any: make({id: "any", type: "check", key: "str", title: T.strength, dc: 18, group: "any",
      results: [["ari", 21, 15], ["mira", 8, 5], ["tovin", 10, 6], ["sela", 12, 7]]}, ctx),
    // A secret DC and results for the GM only
    secret: make({id: "secret", type: "skill", key: "ste", title: T.stealth, dc: 13, showDc: false, mode: "gm",
      results: [["ari", 14, 8], ["mira", 8, 3]]}, ctx),
    // Blind: nobody but the GM sees a total
    blind: make({id: "blind", type: "skill", key: "ins", title: T.insight, dc: 12, mode: "blind",
      results: [["ari", 15, 10], ["mira", 7, 2]]}, ctx),
    // Each character chose one of two rolls
    choice: make({id: "choice", type: "skill", key: "ath", title: T.athletics, dc: 14, note: ctx.notes.wall,
      choices: [{type: "skill", key: "ath"}, {type: "skill", key: "acr"}], choiceTitles: [T.athletics, T.acrobatics],
      results: [["ari", 18, 12, {choice: rollId("skill", "ath")}], ["tovin", 11, 5, {choice: rollId("skill", "acr")}]]}, ctx),
    // A formula roll without a DC
    formula: make({id: "formula", type: "formula", formula: "1d20 + 3", label: ctx.notes.formulaLabel, note: ctx.notes.formulaNote,
      results: [["ari", 17, 14], ["mira", 6, 3], ["tovin", 24, 20], ["sela", 11, 8]]}, ctx),
    // Passive values: nobody rolls, the GM compares
    passive: make({id: "passive", type: "passive", key: "prc", title: T.perception, dc: 13, mode: "silent",
      results: [["ari", 14], ["mira", 11], ["tovin", 16], ["sela", 18]]}, ctx),
    // Other systems: the card follows the scheme of the system
    pf2e: make({id: "pf2e", system: "pf2e", type: "save", key: "reflex", title: T.reflex, dc: 20, advantage: "advantage", group: "half",
      results: [["ari", 31, 18], ["mira", 22, 12], ["tovin", 12, 5], ["sela", 8, 3]]}, ctx),
    swade: make({id: "swade", system: "swade", type: "skill", key: "fighting", title: T.fighting, dc: 6, showDc: false,
      results: [["ari", 11], ["mira", 7], ["tovin", 3], ["sela", 2, null, {critfail: true}]]}, ctx),
    crucible: make({id: "crucible", system: "crucible", type: "skill", key: "athletics", title: T.athletics, dc: 12, group: "half",
      results: [["ari", 22], ["mira", 15], ["tovin", 9], ["sela", 4]]}, ctx),
    daggerheart: make({id: "daggerheart", system: "daggerheart", type: "trait", key: "agility", title: T.agility, dc: 14, showDc: false, mode: "gm",
      results: [["ari", 17, null, {duality: "hope"}], ["mira", 11, null, {duality: "fear"}], ["tovin", 12, null, {duality: "critical"}], ["sela", 9, null, {duality: "hope"}]]}, ctx)
  };
}

/**
 * The open requests of the player window: what the player's two characters still have to roll.
 * @param {object} ctx     {uuidOf, userId, titles, notes}
 * @returns {{single: object[], choice: object[]}}   Requests with their pending entries
 */
export function samplePrompts(ctx) {
  const T = ctx.titles;
  const own = ["ari", "mira"];
  const one = make({id: "prompt-1", type: "skill", key: "prc", title: T.perception, dc: 14, advantage: "advantage", note: ctx.notes.door, entries: own}, ctx);
  const two = make({id: "prompt-2", type: "save", key: "dex", title: T.dexterity, dc: 15, showDc: false, mode: "gm", advantage: "disadvantage", entries: own}, ctx);
  const pick = make({id: "prompt-3", type: "skill", key: "ath", title: T.athletics, dc: 15, note: ctx.notes.wall, entries: own,
    choices: [{type: "skill", key: "ath"}, {type: "skill", key: "acr"}, {type: "skill", key: "sur"}],
    choiceTitles: [T.athletics, T.acrobatics, T.survival]}, ctx);
  const item = request => ({card: {id: request.id}, request, entries: request.entries});
  return {single: [one, two].map(item), choice: [pick].map(item)};
}

/**
 * The sent requests, planned checks and saved presets of the request window.
 * @param {object} ctx     {uuidOf, titles, notes}
 * @param {(rolls: string[], dc: number|string) => string} describe   The text of a request as the window words it
 * @returns {{recent: object[], planned: object[], presets: object[]}}
 */
export function sampleLists(ctx, describe) {
  const actors = PARTY.map(ctx.uuidOf);
  const recent = [
    recentRecord({rolls: ["skill:prc"], actors, name: describe(["skill:prc"], 15), values: {dc: 15}}),
    recentRecord({rolls: ["save:dex"], actors: actors.slice(0, 3), name: describe(["save:dex"], 14),
      values: {dc: 14, group: "half", advantage: "disadvantage"}}),
    recentRecord({rolls: ["skill:ste"], actors, name: describe(["skill:ste"], 12), values: {dc: 12, mode: "silent"}})
  ];
  const planned = [
    normalizePlanned({id: "p1", label: ctx.notes.plannedBridge, rolls: ["save:dex"], values: {dc: 14, group: "half"}, who: "party", after: "done"}),
    normalizePlanned({id: "p2", rolls: ["skill:prc", "skill:inv"], values: {dc: 12, mode: "silent"}, who: "scene"}),
    normalizePlanned({id: "p3", label: ctx.notes.plannedRiver, rolls: ["save:con"], values: {dc: 13}, who: "all", after: "done", done: true})
  ];
  const presets = [
    {name: describe(["save:wis"], 13), rolls: ["save:wis"], values: {dc: 13}},
    {name: describe(["check:con"], 15), rolls: ["check:con"], values: {dc: 15, group: "half"}}
  ];
  return {recent, planned, presets};
}

export const __test__ = {SCHEMES, make};
