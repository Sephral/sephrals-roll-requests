import assert from "node:assert/strict";
import test from "node:test";
import {firstTotal, naturalD20, rollsOf, sortByLabel} from "../scripts/adapters/common.mjs";
import {crucible, crucibleGroups, crucibleRollArgs} from "../scripts/adapters/crucible.mjs";
import {dnd5e, dnd5eGroups, dnd5eRollArgs, dnd5eRollKind} from "../scripts/adapters/dnd5e.mjs";
import {ADAPTERS, generic, getAdapter} from "../scripts/adapters/index.mjs";
import {pf2e, pf2eGroups, pf2eRollArgs} from "../scripts/adapters/pf2e.mjs";
import {findSkill, swade, swadeGroups, swadeSlug} from "../scripts/adapters/swade.mjs";

/** A roll as messages hold it: the dice with their results and the total. */
const roll = (total, d20=null, extra={}) => ({total, dice: d20 === null ? [] : [{faces: 20, results: d20}], ...extra});
const message = (rolls, flags={}) => ({rolls, flags});

test("the adapter follows the system, others get formulas", () => {
  assert.equal(getAdapter("dnd5e"), dnd5e);
  assert.equal(getAdapter("pf2e"), pf2e);
  assert.equal(getAdapter("swade"), swade);
  assert.equal(getAdapter("crucible"), crucible);
  assert.equal(getAdapter("coc7"), generic);
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ["crucible", "dnd5e", "pf2e", "swade"]);
});

test("the kept d20 and the total of a message", () => {
  assert.equal(naturalD20(roll(18, [{result: 4, active: false, discarded: true}, {result: 15}])), 15);
  assert.equal(naturalD20(roll(7)), null);
  assert.deepEqual(firstTotal(message([roll(12, [{result: 9}])])).total, 12);
  assert.equal(firstTotal(message([])).total, null);
  const rsr = message([], {rsr5e: {rolls: [{total: 21, dice: []}]}});
  assert.equal(rollsOf(rsr).length, 1);
  assert.equal(firstTotal(rsr).total, 21);
  assert.deepEqual(sortByLabel([{key: "b", label: "Zeta"}, {key: "a", label: "alpha"}]).map(o => o.key), ["a", "b"]);
});

test("D&D 5e offers saves, checks, skills and tools", () => {
  const config = {
    abilities: {str: {label: "Strength"}, dex: {label: "Dexterity"}},
    skills: {prc: {label: "Perception"}, ath: {label: "Athletics"}},
    tools: {thief: {}, herb: {}}
  };
  const groups = dnd5eGroups(config, key => ({thief: "Thieves' Tools", herb: "Herbalism Kit"})[key]);
  assert.deepEqual(groups.map(g => g.type), ["save", "check", "skill", "tool"]);
  assert.deepEqual(groups[2].options.map(o => o.key), ["ath", "prc"]);
  assert.deepEqual(groups[3].options.map(o => o.label), ["Herbalism Kit", "Thieves' Tools"]);
  assert.deepEqual(dnd5eGroups({abilities: {}}, k => k), []);
});

test("D&D 5e rolls pass the DC only when the players may see it", () => {
  const base = {type: "save", key: "dex", dc: 15, showDc: true, advantage: "advantage"};
  const [config, dialog, msg] = dnd5eRollArgs(base, {fastForward: true});
  assert.deepEqual(config, {ability: "dex", target: 15, advantage: true});
  assert.deepEqual(dialog, {configure: false});
  assert.deepEqual(msg, {create: true});
  const event = {type: "click"};
  const [hidden, hiddenDialog] = dnd5eRollArgs({...base, showDc: false, advantage: "disadvantage"}, {event});
  assert.deepEqual(hidden, {ability: "dex", disadvantage: true, event});
  assert.deepEqual(hiddenDialog, {});
  assert.equal(dnd5eRollArgs({type: "skill", key: "prc", dc: null})[0].skill, "prc");
  assert.equal(dnd5eRollArgs({type: "tool", key: "thief", dc: null})[0].tool, "thief");
});

test("D&D 5e calls the actor's roll method and judges the message", async () => {
  const calls = [];
  const actor = Object.fromEntries(["rollSavingThrow", "rollAbilityCheck", "rollSkill", "rollToolCheck"]
    .map(name => [name, async (...args) => calls.push([name, ...args])]));
  for ( const type of ["save", "check", "skill", "tool"] ) await dnd5e.roll(actor, {type, key: "x", dc: null});
  assert.deepEqual(calls.map(c => c[0]), ["rollSavingThrow", "rollAbilityCheck", "rollSkill", "rollToolCheck"]);
  const result = dnd5e.evaluate(message([roll(19, [{result: 20}])]), {dc: 20});
  assert.deepEqual(result, {total: 19, natural: 20, success: false, degree: "failure"});
  assert.equal(dnd5e.isCharacter({type: "character"}), true);
  assert.equal(dnd5e.isCharacter({type: "npc"}), false);
});

test("PF2e offers saves and skills with perception first", () => {
  const groups = pf2eGroups({
    saves: {fortitude: "PF2E.SavesFortitude", reflex: "PF2E.SavesReflex"},
    skills: {stealth: {label: "Stealth"}, acrobatics: {label: "Acrobatics"}, arcana: "Arcana"}
  });
  assert.deepEqual(groups.map(g => g.type), ["save", "skill"]);
  assert.deepEqual(groups[1].options.map(o => o.key), ["perception", "acrobatics", "arcana", "stealth"]);
});

test("PF2e statistic rolls get the DC, fortune and the dialog setting", () => {
  assert.deepEqual(pf2eRollArgs({dc: 18, showDc: true, advantage: "advantage"}, {fastForward: true}),
    {dc: {value: 18}, rollTwice: "keep-higher", skipDialog: true});
  const event = {};
  assert.deepEqual(pf2eRollArgs({dc: 18, showDc: false, advantage: "disadvantage"}, {event}),
    {rollTwice: "keep-lower", event});
});

test("PF2e uses the system's degree when it knew the same DC", async () => {
  const msg = message([roll(14, [{result: 12}])], {pf2e: {context: {dc: {value: 15}, outcome: "success"}}});
  assert.equal(pf2e.evaluate(msg, {dc: 15}).degree, "success");
  assert.equal(pf2e.evaluate(msg, {dc: 16}).degree, "failure");
  const statistic = {roll: async args => args};
  const actor = {getStatistic: key => (key === "will" ? statistic : null)};
  assert.deepEqual(await pf2e.roll(actor, {type: "save", key: "will", dc: null}, {fastForward: true}), {skipDialog: true});
  await assert.rejects(() => pf2e.roll({getStatistic: () => null, name: "X"}, {type: "skill", key: "lore"}));
});

test("SWADE offers attributes and the core and own skills", () => {
  assert.equal(swadeSlug("Common Knowledge"), "common-knowledge");
  assert.equal(swadeSlug("  Überleben "), "überleben");
  const actors = [{items: [{type: "skill", name: "Riding", system: {swid: "riding"}}, {type: "edge", name: "Alertness"},
    {type: "skill", name: "Unskilled", system: {swid: "unskilled-attempt"}}]}];
  const groups = swadeGroups({attributes: {agility: {long: "Agility"}, vigor: {long: "Vigor"}}},
    "Athletics, Common Knowledge, Notice", actors);
  assert.deepEqual(groups[0].options.map(o => o.key), ["agility", "vigor"]);
  assert.deepEqual(groups[1].options.map(o => o.key), ["athletics", "common-knowledge", "notice", "riding"]);
  const actor = {items: [{type: "skill", name: "Notice", system: {swid: "notice"}, id: "s1"}]};
  assert.equal(findSkill(actor, "notice")?.id, "s1");
  assert.equal(findSkill(actor, "stealth"), null);
});

test("SWADE rolls the skill or an unskilled attempt and judges raises", async () => {
  const calls = [];
  const actor = {
    items: [{type: "skill", name: "Notice", system: {swid: "notice"}, id: "s1"}],
    rollAttribute: async (...a) => calls.push(["attribute", ...a]),
    rollSkill: async (...a) => calls.push(["skill", ...a]),
    makeUnskilledAttempt: async (...a) => calls.push(["unskilled", ...a])
  };
  await swade.roll(actor, {type: "attribute", key: "vigor"});
  await swade.roll(actor, {type: "skill", key: "notice"});
  await swade.roll(actor, {type: "skill", key: "stealth"});
  assert.deepEqual(calls.map(c => c[0]), ["attribute", "skill", "unskilled"]);
  assert.equal(calls[1][1], "s1");
  assert.deepEqual(swade.evaluate(message([roll(9)]), {dc: null}), {total: 9, natural: null, success: true,
    degree: "criticalSuccess", raises: 1});
  assert.equal(swade.evaluate(message([roll(9, null, {isCritfail: true})]), {dc: null}).degree, "criticalFailure");
});

test("Crucible offers its skills and judges above the DC", () => {
  const groups = crucibleGroups({stealth: {label: "Stealth"}, athletics: {label: "Athletics"}});
  assert.deepEqual(groups[0].options.map(o => o.key), ["athletics", "stealth"]);
  assert.deepEqual(crucibleRollArgs({dc: 15, showDc: true}, {fastForward: true}), {chatMessage: true, dialog: false, dc: 15});
  assert.deepEqual(crucibleRollArgs({dc: 15, showDc: false}), {chatMessage: true, dialog: true});
  assert.equal(crucible.evaluate(message([roll(15)]), {dc: 15}).success, false);
  assert.equal(crucible.evaluate(message([roll(16)]), {dc: 15}).success, true);
  // Thresholds of the check itself: by more than 4 is critical when the roll says so
  assert.equal(crucible.evaluate(message([roll(20, null, {data: {criticalSuccessThreshold: 4}})]), {dc: 15}).degree, "criticalSuccess");
  assert.equal(crucible.evaluate(message([roll(20)]), {dc: 15}).degree, "success");
  assert.equal(crucible.evaluate(message([roll(11, null, {data: {criticalFailureThreshold: 4}})]), {dc: 15}).degree, "criticalFailure");
  assert.equal(crucible.isCharacter({type: "hero"}), true);
});

test("the generic adapter only judges formulas", () => {
  assert.deepEqual(generic.groups(), []);
  assert.equal(generic.isCharacter({hasPlayerOwner: true}), true);
  assert.deepEqual(generic.evaluate(message([roll(11, [{result: 1}])]), {dc: 10}),
    {total: 11, natural: 1, success: true, degree: "success"});
});

test("D&D 5e tells the kind of a roll message in 5.x and 6.x", () => {
  assert.deepEqual(dnd5eRollKind({type: "save", system: {ability: "dex"}}), {type: "save", key: "dex"});
  assert.deepEqual(dnd5eRollKind({type: "check", system: {ability: "wis", skill: "prc"}}), {type: "skill", key: "prc"});
  assert.deepEqual(dnd5eRollKind({type: "check", system: {ability: "int", tool: "thief"}}), {type: "tool", key: "thief"});
  assert.deepEqual(dnd5eRollKind({type: "check", system: {ability: "str"}}), {type: "check", key: "str"});
  assert.deepEqual(dnd5eRollKind({type: "base", flags: {dnd5e: {roll: {type: "save", ability: "con"}}}}), {type: "save", key: "con"});
  assert.deepEqual(dnd5eRollKind({flags: {dnd5e: {roll: {type: "skill", skillId: "ste"}}}}), {type: "skill", key: "ste"});
  assert.deepEqual(dnd5eRollKind({flags: {dnd5e: {roll: {type: "ability", ability: "str"}}}}), {type: "check", key: "str"});
  assert.equal(dnd5eRollKind({type: "base", flags: {}}), null);
  assert.equal(dnd5e.matches({type: "save", system: {ability: "dex"}}, {type: "save", key: "dex"}), true);
  assert.equal(dnd5e.matches({type: "save", system: {ability: "dex"}}, {type: "skill", key: "prc"}), false);
  assert.equal(dnd5e.matches({type: "base"}, {type: "save", key: "dex"}), null);
});

test("PF2e tells which statistic a check message rolled", () => {
  const msg = domains => ({flags: {pf2e: {context: {domains}}}});
  assert.equal(pf2e.matches(msg(["reflex", "saving-throw", "check"]), {type: "save", key: "reflex"}), true);
  assert.equal(pf2e.matches(msg(["acrobatics", "skill-check"]), {type: "save", key: "reflex"}), false);
  assert.equal(pf2e.matches(msg(["mercantile-lore", "skill-check"]), {type: "skill", key: "mercantile-lore"}), true);
  assert.equal(pf2e.matches({flags: {}}, {type: "save", key: "reflex"}), null);
  assert.equal(pf2e.matches(msg(["reflex"]), {type: "formula", key: ""}), null);
});
