import assert from "node:assert/strict";
import test from "node:test";
import {buildRequest, cardRecipients, groupSucceeds, judge, normalizeChoices, normalizeOptions, parseDc, parseRollId, pendingFor,
  pickChoice, publicResult, rollId, rollVisibility, summarize, viewFor, takeReplaced, pickMarker} from "../scripts/request-model.mjs";

const entries = [
  {id: "a", actorUuid: "Actor.a", name: "Ayla", npc: false},
  {id: "b", actorUuid: "Actor.b", name: "Bran", npc: false},
  {id: "c", actorUuid: "Actor.c", name: "Goblin", npc: true},
  {id: "d", actorUuid: "Actor.d", name: "Dara", npc: false}
];

const request = (overrides={}) => ({...buildRequest(normalizeOptions({type: "save", key: "dex", dc: 13, ...overrides}),
  entries, {id: "r1", system: "dnd5e"}), ...(overrides.results ? {results: overrides.results} : {})});

test("a DC is a whole number from 0 to 999 or none", () => {
  assert.equal(parseDc(""), null);
  assert.equal(parseDc(null), null);
  assert.equal(parseDc("abc"), null);
  assert.equal(parseDc("15"), 15);
  assert.equal(parseDc(12.6), 13);
  assert.equal(parseDc(-3), 0);
  assert.equal(parseDc(5000), 999);
});

test("options get their defaults", () => {
  const options = normalizeOptions({type: "skill", key: "prc"});
  assert.deepEqual(options, {type: "skill", key: "prc", formula: "", label: "", dc: null, showDc: true, mode: "public",
    advantage: "normal", group: false, groupRule: "half", autoRollNpcs: true, note: "", choices: []});
});

test("options keep valid choices and drop invalid ones", () => {
  const options = normalizeOptions({type: "save", key: "con", dc: "14", showDc: false, mode: "blind",
    advantage: "disadvantage", group: true, autoRollNpcs: false, note: "  Cold wind  "});
  assert.equal(options.dc, 14);
  assert.equal(options.showDc, false);
  assert.equal(options.mode, "blind");
  assert.equal(options.advantage, "disadvantage");
  assert.equal(options.group, true);
  assert.equal(options.autoRollNpcs, false);
  assert.equal(options.note, "Cold wind");
  assert.equal(normalizeOptions({type: "save", key: "con", mode: "self", advantage: "both"}).mode, "public");
  assert.equal(normalizeOptions({type: "save", key: "con", advantage: "both"}).advantage, "normal");
  assert.equal(normalizeOptions({type: "save", key: "con", note: "x".repeat(500)}).note.length, 200);
});

test("a request needs a type, a key or a formula, and characters", () => {
  assert.throws(() => normalizeOptions({}), /SRR.Error.noType/);
  assert.throws(() => normalizeOptions({type: "skill"}), /SRR.Error.noKey/);
  assert.throws(() => normalizeOptions({type: "formula"}), /SRR.Error.noFormula/);
  assert.throws(() => buildRequest(normalizeOptions({type: "skill", key: "ath"}), [], {}), /SRR.Error.noActors/);
  const formula = normalizeOptions({type: "formula", key: "ignored", formula: " 1d20 + 3 ", label: "Luck"});
  assert.equal(formula.key, "");
  assert.equal(formula.formula, "1d20 + 3");
  assert.equal(formula.label, "Luck");
});

test("d20 systems succeed at or above the DC", () => {
  assert.deepEqual(judge({total: 13, natural: 9}, 13), {success: true, degree: "success"});
  assert.deepEqual(judge({total: 12, natural: 20}, 13), {success: false, degree: "failure"});
  assert.deepEqual(judge({total: 12}, null), {success: null, degree: null});
  assert.deepEqual(judge({total: NaN}, 10), {success: null, degree: null});
});

test("PF2e has four degrees with the natural 20 and 1 shifting them", () => {
  assert.equal(judge({total: 25, natural: 10}, 15, "pf2e").degree, "criticalSuccess");
  assert.equal(judge({total: 15, natural: 10}, 15, "pf2e").degree, "success");
  assert.equal(judge({total: 14, natural: 10}, 15, "pf2e").degree, "failure");
  assert.equal(judge({total: 5, natural: 3}, 15, "pf2e").degree, "criticalFailure");
  assert.equal(judge({total: 16, natural: 20}, 15, "pf2e").degree, "criticalSuccess");
  assert.equal(judge({total: 14, natural: 20}, 15, "pf2e").degree, "success");
  assert.equal(judge({total: 15, natural: 1}, 15, "pf2e").degree, "failure");
  assert.equal(judge({total: 26, natural: 1}, 15, "pf2e").degree, "success");
  assert.equal(judge({total: 14, natural: 10}, 15, "pf2e", {outcome: "success"}).success, true);
});

test("Savage Worlds counts raises against target number 4 by default", () => {
  assert.deepEqual(judge({total: 3}, null, "swade"), {success: false, degree: "failure", raises: 0});
  assert.deepEqual(judge({total: 4}, null, "swade"), {success: true, degree: "success", raises: 0});
  assert.deepEqual(judge({total: 8}, null, "swade"), {success: true, degree: "criticalSuccess", raises: 1});
  assert.deepEqual(judge({total: 13}, 6, "swade"), {success: true, degree: "criticalSuccess", raises: 1});
  assert.deepEqual(judge({total: 14}, 6, "swade"), {success: true, degree: "criticalSuccess", raises: 2});
  assert.equal(judge({total: 9}, null, "swade", {critfail: true}).degree, "criticalFailure");
});

test("Crucible succeeds above the DC and is critical by more than 6", () => {
  assert.deepEqual(judge({total: 15}, 15, "crucible"), {success: false, degree: "failure"});
  assert.deepEqual(judge({total: 16}, 15, "crucible"), {success: true, degree: "success"});
  assert.deepEqual(judge({total: 22}, 15, "crucible"), {success: true, degree: "criticalSuccess"});
  assert.deepEqual(judge({total: 9}, 15, "crucible"), {success: false, degree: "criticalFailure"});
  assert.deepEqual(judge({total: 22}, null, "crucible"), {success: null, degree: null});
});

test("a group succeeds when at least half succeed", () => {
  assert.equal(groupSucceeds(2, 4), true);
  assert.equal(groupSucceeds(1, 4), false);
  assert.equal(groupSucceeds(2, 3), true);
  assert.equal(groupSucceeds(1, 3), false);
  assert.equal(groupSucceeds(0, 0), false);
});

test("the summary counts rolls, passes and the group", () => {
  const open = summarize(request({group: true, results: {a: {total: 15, success: true}}}));
  assert.deepEqual(open, {count: 4, rolled: 1, pending: 3, passed: 1, failed: 0, complete: false, group: null});
  const done = summarize(request({group: true, results: {a: {success: true}, b: {success: false}, c: {success: true},
    d: {success: false}}}));
  assert.equal(done.complete, true);
  assert.equal(done.passed, 2);
  assert.equal(done.group, "success");
  const failed = summarize(request({group: true, results: {a: {success: true}, b: {success: false}, c: {success: false},
    d: {success: false}}}));
  assert.equal(failed.group, "failure");
  const noDc = summarize(request({dc: "", group: true, results: {a: {success: null}, b: {success: null},
    c: {success: null}, d: {success: null}}}));
  assert.equal(noDc.group, null);
  assert.equal(summarize(null).count, 0);
});

test("the GM sees everything", () => {
  const view = viewFor(request({mode: "blind", showDc: false}), {isGM: true, owns: () => false});
  assert.equal(view.dc, true);
  assert.equal(view.summary, true);
  assert.deepEqual(view.entry(entries[0]), {total: true, outcome: true});
});

test("players see what the mode and the DC allow", () => {
  const owns = entry => entry.id === "a";
  const pub = viewFor(request({mode: "public"}), {isGM: false, owns});
  assert.deepEqual(pub.entry(entries[1]), {total: true, outcome: true});
  assert.equal(pub.summary, true);
  const hiddenDc = viewFor(request({mode: "public", showDc: false}), {isGM: false, owns});
  assert.deepEqual(hiddenDc.entry(entries[1]), {total: true, outcome: false});
  assert.equal(hiddenDc.summary, false);
  assert.equal(hiddenDc.dc, false);
  const gm = viewFor(request({mode: "gm"}), {isGM: false, owns});
  assert.deepEqual(gm.entry(entries[0]), {total: true, outcome: true});
  assert.deepEqual(gm.entry(entries[1]), {total: false, outcome: false});
  assert.equal(gm.summary, false);
  const blind = viewFor(request({mode: "blind"}), {isGM: false, owns});
  assert.deepEqual(blind.entry(entries[0]), {total: false, outcome: false});
});

test("roll messages and cards reach the right people", () => {
  assert.deepEqual(rollVisibility("public", ["gm1"]), {whisper: [], blind: false});
  assert.deepEqual(rollVisibility("gm", ["gm1", "gm2"]), {whisper: ["gm1", "gm2"], blind: false});
  assert.deepEqual(rollVisibility("blind", ["gm1"]), {whisper: ["gm1"], blind: true});
  assert.deepEqual(cardRecipients("public", ["gm1"], ["p1"]), []);
  assert.deepEqual(cardRecipients("gm", ["gm1"], ["p1", "p2", "p1"]), ["gm1", "p1", "p2"]);
});

test("pending entries of a user and the public view of a request", () => {
  const r = request({results: {a: {total: 17, success: true}}});
  assert.deepEqual(pendingFor(r, () => true).map(e => e.id), ["b", "c", "d"]);
  assert.deepEqual(pendingFor(r, e => e.id === "a"), []);
  const result = publicResult(r, "m1");
  assert.equal(result.messageId, "m1");
  assert.equal(result.entries.length, 4);
  assert.equal(result.entries[0].result.total, 17);
  assert.equal(result.entries[1].result, null);
  assert.equal(result.passed, 1);
  assert.equal(result.complete, false);
});

test("a reroll takes over the deleted answer of the same character within its time", () => {
  const list = [
    {answer: {cardId: "c", requestId: "r", entryId: "old"}, actorUuid: "Actor.a", until: 900},
    {answer: {cardId: "c", requestId: "r", entryId: "e1"}, actorUuid: "Actor.a", until: 2000},
    {answer: {cardId: "c", requestId: "r", entryId: "e2"}, actorUuid: "Actor.b", until: 2000}
  ];
  assert.equal(takeReplaced(list, "Actor.c", 1000), null);
  assert.equal(list.length, 2, "expired entries are dropped");
  assert.equal(takeReplaced(list, "Actor.a", 1000).answer.entryId, "e1");
  assert.equal(takeReplaced(list, "Actor.a", 1000), null, "an entry is taken once");
  assert.equal(takeReplaced(list, null, 1000), null);
  assert.equal(takeReplaced(list, "Actor.b", 2500), null, "too late");
  assert.equal(list.length, 0);
});

test("two open requests of one character: the roll goes to the request of its kind", () => {
  const save = {cardId: "a", type: "save", key: "dex"};
  const skill = {cardId: "b", type: "skill", key: "prc"};
  const kindOf = roll => marker => (marker.type === roll.type) && (marker.key === roll.key);
  assert.equal(pickMarker([], () => null), null);
  assert.equal(pickMarker([save], () => false), save, "a single open roll takes any message");
  assert.equal(pickMarker([save, skill], kindOf({type: "skill", key: "prc"})), skill);
  assert.equal(pickMarker([save, skill], kindOf({type: "save", key: "dex"})), save);
  assert.equal(pickMarker([save, skill], () => null), save, "unknown kind: the first open roll");
  assert.equal(pickMarker([save, skill], m => (m === skill ? null : false)), skill, "a request that does not contradict wins");
});

test("a silent request stays with the GMs", () => {
  assert.equal(normalizeOptions({type: "skill", key: "prc", mode: "silent"}).mode, "silent");
  assert.deepEqual(rollVisibility("silent", ["gm1"]), {whisper: ["gm1"], blind: false});
  assert.deepEqual(cardRecipients("silent", ["gm1"], ["p1"]), ["gm1"]);
  const view = viewFor(request({mode: "silent"}), {isGM: false, owns: () => true});
  assert.equal(view.entry({}).total, false);
});

test("a passive value needs no roll and only the GM sees it", () => {
  const options = normalizeOptions({type: "passive", key: "prc", mode: "public", advantage: "advantage"});
  assert.equal(options.mode, "silent");
  assert.equal(options.advantage, "normal");
  assert.equal(normalizeOptions({type: "combat", key: "hitDie", advantage: "advantage"}).advantage, "normal");
  assert.equal(normalizeOptions({type: "combat", key: "death", advantage: "advantage"}).advantage, "advantage");
});

test("group rules", () => {
  assert.equal(groupSucceeds(2, 4), true);
  assert.equal(groupSucceeds(1, 4), false);
  assert.equal(groupSucceeds(3, 4, "all"), false);
  assert.equal(groupSucceeds(4, 4, "all"), true);
  assert.equal(groupSucceeds(1, 4, "any"), true);
  assert.equal(groupSucceeds(0, 4, "any"), false);
  assert.equal(normalizeOptions({type: "skill", key: "prc", group: "all"}).groupRule, "all");
  assert.equal(normalizeOptions({type: "skill", key: "prc", group: true}).groupRule, "half");
  assert.equal(normalizeOptions({type: "skill", key: "prc", group: true, groupRule: "any"}).groupRule, "any");
  assert.equal(normalizeOptions({type: "skill", key: "prc", group: "all"}).group, true);
  const failed = request({group: "all"});
  failed.results = Object.fromEntries(failed.entries.map((e, i) => [e.id, {success: i === 0}]));
  assert.equal(summarize(failed).group, failed.entries.length > 1 ? "failure" : "success");
});

test("a choice needs two different rolls of a kind players can pick", () => {
  const list = [{type: "skill", key: "ath"}, {type: "skill", key: "acr"}];
  assert.deepEqual(normalizeChoices(list), list);
  assert.deepEqual(normalizeChoices([list[0], list[0]]), []);
  assert.deepEqual(normalizeChoices([list[0], {type: "formula", key: "x"}]), []);
  assert.deepEqual(normalizeChoices(null), []);
  const options = normalizeOptions({choices: list});
  assert.equal(options.type, "skill");
  assert.equal(options.key, "ath");
  assert.equal(options.choices.length, 2);
});

test("the roll of a choice", () => {
  const choices = [{type: "skill", key: "ath"}, {type: "save", key: "dex"}];
  assert.deepEqual(pickChoice({type: "skill", key: "ath", choices}, "save:dex"), {type: "save", key: "dex"});
  assert.deepEqual(pickChoice({type: "skill", key: "ath", choices}, "save:con"), {type: "skill", key: "ath"});
  assert.deepEqual(pickChoice({type: "skill", key: "ath", choices}), {type: "skill", key: "ath"});
  assert.deepEqual(pickChoice({type: "check", key: "str", choices: []}, "save:dex"), {type: "check", key: "str"});
});

test("roll ids", () => {
  assert.equal(rollId("skill", "prc"), "skill:prc");
  assert.deepEqual(parseRollId("skill:prc"), {type: "skill", key: "prc"});
  assert.deepEqual(parseRollId("formula:"), {type: "formula", key: ""});
  assert.deepEqual(parseRollId("skill:a:b"), {type: "skill", key: "a:b"});
});
