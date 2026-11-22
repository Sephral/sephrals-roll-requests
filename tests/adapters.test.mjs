import assert from "node:assert/strict";
import test from "node:test";
import {firstTotal, naturalD20, rollsOf, sortByLabel} from "../scripts/adapters/common.mjs";
import {crucible, crucibleGroups, crucibleRollArgs} from "../scripts/adapters/crucible.mjs";
import {bestTrait, daggerheart, daggerheartGroups, daggerheartRollArgs, dualityMatches, dualityOf, experienceSlug,
  experiencesOf} from "../scripts/adapters/daggerheart.mjs";
import {dnd5e, dnd5eGroups, dnd5eMessage, dnd5eRollArgs, dnd5eRollKind} from "../scripts/adapters/dnd5e.mjs";
import {ADAPTERS, generic, getAdapter} from "../scripts/adapters/index.mjs";
import {checkContext, flatFormula, pf2e, pf2eGroups, pf2eRollArgs} from "../scripts/adapters/pf2e.mjs";
import {findSkill, swade, swadeGroups, swadeSlug} from "../scripts/adapters/swade.mjs";
import {shiftSkipsDialog, tormenta20, tormenta20Groups, tormenta20Label, tormenta20RollArgs} from "../scripts/adapters/tormenta20.mjs";

/** A roll as messages hold it: the dice with their results and the total. */
const roll = (total, d20=null, extra={}) => ({total, dice: d20 === null ? [] : [{faces: 20, results: d20}], ...extra});
const message = (rolls, flags={}) => ({rolls, flags});

test("the adapter follows the system, others get formulas", () => {
  assert.equal(getAdapter("dnd5e"), dnd5e);
  assert.equal(getAdapter("pf2e"), pf2e);
  assert.equal(getAdapter("swade"), swade);
  assert.equal(getAdapter("crucible"), crucible);
  assert.equal(getAdapter("daggerheart"), daggerheart);
  assert.equal(getAdapter("tormenta20"), tormenta20);
  assert.equal(getAdapter("coc7"), generic);
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ["crucible", "daggerheart", "dnd5e", "pf2e", "sf2e", "swade", "tormenta20"]);
  assert.equal(getAdapter("sf2e"), pf2e);
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
  assert.deepEqual(groups.map(g => g.type), ["save", "check", "skill", "combat", "passive", "tool"]);
  assert.deepEqual(groups[2].options.map(o => o.key), ["ath", "prc"]);
  assert.deepEqual(groups.at(-1).options.map(o => o.label), ["Herbalism Kit", "Thieves' Tools"]);
  assert.deepEqual(groups[3].options.map(o => o.key), ["initiative", "death", "concentration", "hitDie"]);
  assert.deepEqual(groups[4].options.map(o => o.key), ["prc"]);
  assert.deepEqual(groups.at(-1).options.map(o => o.tab), ["kits", "kits"]);
  assert.ok(groups[2].options.every(o => o.icon));
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

test("D&D 5e rolls initiative, death saves, concentration and hit dice", async () => {
  const calls = [];
  const called = name => async (...args) => {
    calls.push([name, ...args]);
    return {};
  };
  const actor = {system: {attributes: {hd: {value: 2}}}, rollInitiative: called("rollInitiative"), rollInitiativeDialog: called("rollInitiativeDialog"),
    rollDeathSave: called("rollDeathSave"), rollConcentration: called("rollConcentration"), rollHitDie: called("rollHitDie")};
  const request = key => ({type: "combat", key, dc: 12, showDc: true, advantage: "advantage", mode: "gm"});
  await dnd5e.roll(actor, request("initiative"), {fastForward: true});
  assert.deepEqual(calls.at(-1)[1], {createCombatants: true, rerollInitiative: true});
  assert.equal(calls.at(-1)[2].advantage, true);
  await dnd5e.roll(actor, request("initiative"));
  assert.equal(calls.at(-1)[0], "rollInitiativeDialog");
  await dnd5e.roll(actor, request("death"), {fastForward: true});
  assert.deepEqual([calls.at(-1)[0], calls.at(-1)[1].target, calls.at(-1)[2].configure], ["rollDeathSave", 12, false]);
  await dnd5e.roll(actor, {...request("concentration"), showDc: false});
  assert.deepEqual(calls.at(-1)[1], {advantage: true});
  await dnd5e.roll(actor, request("hitDie"));
  assert.equal(calls.at(-1)[0], "rollHitDie");
  actor.system.attributes.hd.value = 0;
  assert.equal(await dnd5e.roll(actor, request("hitDie")), false);
  await assert.rejects(dnd5e.roll(actor, request("nothing")));
});

test("D&D 5e gets the visibility of a request from the start", () => {
  const generation = (value, run) => {
    globalThis.game = {release: {generation: value}};
    try {
      run();
    } finally {
      delete globalThis.game;
    }
  };
  assert.deepEqual(dnd5eMessage({}), {create: true});
  generation(13, () => {
    assert.equal(dnd5eMessage({mode: "gm"}).rollMode, "gmroll");
    assert.equal(dnd5eMessage({mode: "silent"}).rollMode, "gmroll");
    assert.equal(dnd5eMessage({mode: "blind"}).rollMode, "blindroll");
  });
  generation(14, () => {
    assert.equal(dnd5eMessage({mode: "public"}).rollMode, "public");
    assert.equal(dnd5eMessage({mode: "silent"}).rollMode, "gm");
    assert.equal(dnd5eRollArgs({type: "save", key: "dex", dc: null, mode: "blind"})[2].rollMode, "blind");
  });
});

test("D&D 5e tells an attack from the roll a request waits for", () => {
  const request = {type: "skill", key: "prc"};
  assert.equal(dnd5e.matches({flags: {dnd5e: {roll: {type: "attack"}}}}, request), false);
  assert.equal(dnd5e.matches({flags: {dnd5e: {roll: {type: "skill", skillId: "prc"}}}}, request), true);
  assert.equal(dnd5e.matches({flags: {}}, request), null);
});

test("a death save counts against 10 without a DC of the request", () => {
  const roll = {total: 9, dice: [{faces: 20, results: [{result: 9, active: true}]}]};
  assert.equal(dnd5e.evaluate({rolls: [roll]}, {type: "combat", key: "death", dc: null}).success, false);
  assert.equal(dnd5e.evaluate({rolls: [roll]}, {type: "combat", key: "initiative", dc: null}).success, null);
});

test("D&D 5e reads passive values", () => {
  const actor = {system: {skills: {prc: {passive: 14}}}};
  assert.equal(dnd5e.passive(actor, "prc"), 14);
  assert.equal(dnd5e.passive(actor, "ins"), null);
  assert.equal(dnd5e.passive(null, "prc"), null);
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
  assert.deepEqual(groups.map(g => g.type), ["save", "skill", "flat"]);
  assert.deepEqual(groups[2].options.map(o => o.key), ["flat"]);
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

test("a PF2e flat check has two outcomes and no modifiers", () => {
  const flat = (total, natural, dc) => pf2e.evaluate(message([roll(total, [{result: natural}])]), {type: "flat", dc});
  assert.equal(flat(20, 20, 11).degree, "success");
  assert.equal(flat(1, 1, 5).degree, "failure");
  assert.equal(flat(1, 1, 5).success, false);
  assert.equal(flat(11, 11, 11).success, true);
  assert.equal(flat(10, 10, 11).degree, "failure");
  // The same rolls as a formula keep the four degrees of a check
  assert.equal(pf2e.evaluate(message([roll(20, [{result: 20}])]), {type: "formula", dc: 11}).degree, "criticalSuccess");
  assert.equal(flatFormula({}), "1d20");
  assert.equal(flatFormula({advantage: "advantage"}), "2d20kh");
  assert.equal(flatFormula({advantage: "disadvantage"}), "2d20kl");
  assert.equal(pf2e.matches({flags: {pf2e: {context: {domains: ["flat-check"]}}}}, {type: "flat", key: "flat"}), null);
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

test("Starfinder 2e reads its check context from either flag scope", () => {
  const msg = (scope, domains) => ({flags: {[scope]: {context: {domains, dc: {value: 15}, outcome: "success"}}}});
  assert.deepEqual(checkContext(msg("sf2e", ["will"]), "sf2e").domains, ["will"]);
  assert.deepEqual(checkContext(msg("pf2e", ["will"]), "sf2e").domains, ["will"]);
  assert.deepEqual(checkContext(msg("sf2e", ["will"]), "pf2e").domains, ["will"]);
  assert.equal(checkContext({flags: {}}, "sf2e"), undefined);
  const both = {flags: {pf2e: {context: {domains: ["a"]}}, sf2e: {context: {domains: ["b"]}}}};
  assert.deepEqual(checkContext(both, "sf2e").domains, ["b"]);
  assert.deepEqual(checkContext(both, "pf2e").domains, ["a"]);
  globalThis.game = {system: {id: "sf2e"}};
  try {
    assert.equal(pf2e.matches(msg("sf2e", ["reflex", "saving-throw"]), {type: "save", key: "reflex"}), true);
    assert.equal(pf2e.matches(msg("sf2e", ["stealth"]), {type: "save", key: "reflex"}), false);
    assert.equal(pf2e.evaluate({...msg("sf2e", ["reflex"]), rolls: [{total: 14, dice: [{results: [{result: 12}]}]}]}, {dc: 15}).degree, "success");
  } finally {
    delete globalThis.game;
  }
});

/** A duality roll as the message holds it: Hope die, Fear die, the total with all modifiers. */
const duality = (hope, fear, total, extra={}) => ({total, dice: [{class: "HopeDie", faces: 12, total: hope}, {class: "FearDie", faces: 12, total: fear}], ...extra});

const TRAITS = {agility: {label: "Agility"}, strength: {label: "Strength"}, finesse: {label: "Finesse"},
  instinct: {label: "Instinct"}, presence: {label: "Presence"}, knowledge: {label: "Knowledge"}};
const hero = (traits={}, experiences={}) => ({type: "character", system: {traits, experiences}});

test("Daggerheart offers the six traits, reaction rolls and the experiences of the characters", () => {
  const actors = [hero({}, {a: {name: "Tracker", value: 2}, b: {name: "Street rat", value: 2}}), hero({}, {c: {name: "tracker", value: 2}})];
  const groups = daggerheartGroups(TRAITS, actors);
  assert.deepEqual(groups.map(g => g.type), ["trait", "reaction", "experience"]);
  assert.deepEqual(groups[0].options.map(o => o.key), ["agility", "strength", "finesse", "instinct", "presence", "knowledge"]);
  assert.deepEqual(groups[2].options.map(o => o.key), ["street-rat", "tracker"]);
  // Without characters there are no experiences to offer
  assert.deepEqual(daggerheartGroups(TRAITS).map(g => g.type), ["trait", "reaction"]);
  assert.equal(experienceSlug("Street rat!"), "street-rat");
  assert.deepEqual(experiencesOf(actors[0]).map(e => e.id), ["a", "b"]);
  assert.equal(daggerheart.isCharacter({type: "character"}), true);
  assert.equal(daggerheart.isCharacter({type: "adversary"}), false);
  assert.equal(daggerheart.dcName, "difficulty");
});

test("Daggerheart rolls the trait with the difficulty, advantage and reaction the request asks for", () => {
  const actor = hero({agility: {value: 1}, instinct: {value: 3}, presence: {value: 3}}, {a: {name: "Tracker", value: 2}});
  const trait = daggerheartRollArgs({type: "trait", key: "agility", dc: 12, showDc: true, advantage: "advantage", mode: "public"}, actor, {});
  assert.equal(trait.trait, "agility");
  assert.deepEqual(trait.args.roll, {type: "trait", trait: "agility", difficulty: 12, advantage: 1});
  assert.equal(trait.args.actionType, "action");
  assert.equal(trait.args.event, undefined);
  // A hidden difficulty stays out of the system's own card, a quick roll acts as if Shift was held
  const hidden = daggerheartRollArgs({type: "reaction", key: "agility", dc: 12, showDc: false, advantage: "disadvantage", mode: "gm"}, actor, {fastForward: true});
  assert.deepEqual(hidden.args.roll, {type: "trait", trait: "agility", advantage: -1});
  assert.equal(hidden.args.actionType, "reaction");
  assert.equal(hidden.args.event.shiftKey, true);
  // A secret roll moves no Hope, Fear or countdown
  assert.deepEqual(daggerheartRollArgs({type: "trait", key: "agility", dc: null, mode: "silent"}, actor, {}).args.skips,
    {resources: true, updateCountdowns: true, triggers: true});
  // An experience starts selected, on the strongest trait (the first on the sheet when equal)
  const experience = daggerheartRollArgs({type: "experience", key: "tracker", dc: 10, showDc: true, mode: "public"}, actor, {});
  assert.equal(experience.trait, "instinct");
  assert.deepEqual(experience.args.experiences, ["a"]);
  assert.deepEqual(experience.args.costs, [{extKey: "a", key: "hope", value: 1, name: "Tracker"}]);
  assert.equal(bestTrait(actor), "instinct");
  assert.equal(bestTrait(hero()), "agility");
  const click = {shiftKey: false};
  assert.equal(daggerheartRollArgs({type: "trait", key: "agility", mode: "public"}, actor, {event: click}).args.event, click);
});

test("Daggerheart reads Hope and Fear and judges against the difficulty", () => {
  assert.equal(dualityOf(duality(9, 4, 15)).duality, "hope");
  assert.equal(dualityOf(duality(3, 11, 15)).duality, "fear");
  assert.equal(dualityOf(duality(7, 7, 15)).duality, "critical");
  assert.equal(dualityOf({total: 4, dice: []}), null);
  // Dice without class names count in order: Hope first, then Fear; kept results are read from the dice
  assert.equal(dualityOf({options: {roll: {type: "trait"}}, dice: [{results: [{result: 8}]}, {results: [{result: 2}]}]}).duality, "hope");
  assert.equal(dualityOf({dice: [{results: [{result: 8}]}, {results: [{result: 2}]}]}), null);
  assert.equal(dualityOf({guaranteedCritical: true, dice: []}).duality, "critical");
  const one = (hope, fear, total, dc) => daggerheart.evaluate(message([duality(hope, fear, total)]), {type: "trait", dc});
  assert.deepEqual(one(9, 4, 15, 12), {total: 15, natural: null, duality: "hope", success: true, degree: "success"});
  assert.deepEqual(one(3, 11, 11, 12), {total: 11, natural: null, duality: "fear", success: false, degree: "failure"});
  assert.equal(one(11, 11, 5, 20).degree, "criticalSuccess");
  assert.equal(one(11, 11, 5, 20).success, true);
  assert.equal(one(5, 4, 12, 12).success, true);
  // No difficulty: no judgment, but Hope and Fear still show
  assert.deepEqual(one(9, 4, 15, null), {total: 15, natural: null, duality: "hope", success: null, degree: null});
  assert.equal(daggerheart.evaluate(message([roll(14)]), {type: "formula", dc: 12}).success, true);
});

test("Daggerheart tells which message answers which request", () => {
  const made = (trait, actionType="action") => ({rolls: [{total: 9, options: {roll: {type: "trait", trait}, actionType}}]});
  assert.equal(dualityMatches(made("agility"), {type: "trait", key: "agility"}), true);
  assert.equal(dualityMatches(made("agility"), {type: "trait", key: "presence"}), false);
  assert.equal(dualityMatches(made("agility", "reaction"), {type: "trait", key: "agility"}), null);
  assert.equal(dualityMatches(made("presence", "reaction"), {type: "trait", key: "agility"}), false);
  assert.equal(dualityMatches(made("agility", "reaction"), {type: "reaction", key: "agility"}), true);
  assert.equal(dualityMatches(made("finesse"), {type: "experience", key: "tracker"}), true);
  assert.equal(dualityMatches({rolls: [roll(9)]}, {type: "trait", key: "agility"}), null);
  assert.equal(dualityMatches(made("agility"), {type: "formula"}), null);
});

test("Daggerheart: an actor without traits (an adversary) rolls a plain d20 against the difficulty", async () => {
  const posted = [];
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; this.total = 14; }
    async evaluate() { return this; }
    async toMessage(data) { posted.push({formula: this.formula, flavor: data.flavor}); }
  };
  globalThis.ChatMessage = {getSpeaker: () => ({})};
  try {
    const bandit = {name: "Bandit", type: "adversary", system: {traits: {}}, getRollData: () => ({}), rollTrait: async () => { throw new Error("no"); }};
    await daggerheart.roll(bandit, {type: "trait", key: "agility", formula: "", dc: 10}, {});
    assert.deepEqual(posted.map(p => p.formula), ["1d20"]);
    assert.deepEqual(daggerheart.evaluate(message([roll(14, [{result: 14}])]), {type: "trait", dc: 10}),
      {total: 14, natural: null, duality: null, success: true, degree: "success"});
  } finally {
    delete globalThis.Roll;
    delete globalThis.ChatMessage;
  }
});

/** The configuration of Tormenta20 the adapter reads (CONFIG.T20): skills with their attribute, attributes, saves. */
const T20 = {
  atributos: {for: "x", des: "x", con: "x", int: "x", sab: "x", car: "x"},
  resistencias: {fort: "x", refl: "x", vont: "x"},
  pericias: {acro: {}, perc: {}, fort: {}, refl: {}, vont: {}, inic: {}, luta: {}, alfa: {}, ofic: {}}
};
const t20Texts = {"SRR.T20.attribute.for": "Strength", "SRR.T20.attribute.des": "Dexterity", "SRR.T20.attribute.con": "Constitution",
  "SRR.T20.attribute.int": "Intelligence", "SRR.T20.attribute.sab": "Wisdom", "SRR.T20.attribute.car": "Charisma",
  "SRR.T20.short.for": "Str", "SRR.T20.short.des": "Dex", "SRR.T20.short.con": "Con", "SRR.T20.short.int": "Int", "SRR.T20.short.sab": "Wis", "SRR.T20.short.car": "Cha",
  "SRR.T20.save.fort": "Fortitude", "SRR.T20.save.refl": "Reflexes", "SRR.T20.save.vont": "Will",
  "SRR.T20.skill.acro": "Acrobatics", "SRR.T20.skill.perc": "Perception", "SRR.T20.skill.inic": "Initiative", "SRR.T20.skill.luta": "Fight",
  "SRR.T20.skill.alfa": "Craft: Tailor"};

function withT20Game(extra={}, fn) {
  globalThis.game = {i18n: {has: key => key in t20Texts, localize: key => t20Texts[key] ?? key, lang: "en"}, ...extra};
  try {
    return fn();
  } finally {
    delete globalThis.game;
  }
}

test("Tormenta20 offers the attributes, the three saves and every skill but the crafting stub", () => {
  withT20Game({}, () => {
    const groups = tormenta20Groups(T20);
    assert.deepEqual(groups.map(g => g.type), ["attribute", "save", "skill"]);
    assert.deepEqual(groups[0].options.map(o => o.key), ["for", "des", "con", "int", "sab", "car"]);
    assert.deepEqual(groups[0].options.map(o => o.label), ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]);
    // The attribute buttons are narrow: they show the three letters and name the attribute in the tooltip
    assert.deepEqual(groups[0].options.map(o => o.short), ["Str", "Dex", "Con", "Int", "Wis", "Cha"]);
    assert.deepEqual(groups[1].options.map(o => o.label), ["Fortitude", "Reflexes", "Will"]);
    // The saves are skills of the system, they get their own group and stay out of the skills
    assert.deepEqual(groups[2].options.map(o => o.key), ["acro", "alfa", "luta", "inic", "perc"]);
    assert.ok(groups.every(g => g.options.every(o => o.icon)));
    assert.equal(groups[2].options.find(o => o.key === "alfa").label, "Craft: Tailor");
    // A skill a newer version adds falls back to the name the system gives it
    assert.equal(tormenta20Label("skill", "nova", "New skill"), "New skill");
    assert.deepEqual(tormenta20Groups({}).map(g => g.type), ["attribute", "save"]);
  });
});

test("Tormenta20: the keys of the roll are the ones the system reads, a quick roll acts as if the skipping key was held", () => {
  const plain = {type: "skill", key: "perc", advantage: "normal"};
  assert.deepEqual(tormenta20RollArgs(plain, {}).event, {shiftKey: false, altKey: false, ctrlKey: false, metaKey: false});
  assert.equal(tormenta20RollArgs(plain, {fastForward: true}).event.shiftKey, true);
  // The system opens its dialog with Shift when the client setting says so: a quick roll must not hold it then
  assert.equal(tormenta20RollArgs(plain, {fastForward: true, skipsWithShift: false}).event.shiftKey, false);
  assert.equal(tormenta20RollArgs({...plain, advantage: "advantage"}, {}).event.altKey, true);
  assert.equal(tormenta20RollArgs({...plain, advantage: "disadvantage"}, {}).event.ctrlKey, true);
  // A real click keeps its keys, the hint of the request wins over a held key of the other kind
  const click = {shiftKey: true, altKey: true, ctrlKey: false};
  assert.deepEqual(tormenta20RollArgs(plain, {event: click}).event, {shiftKey: true, altKey: true, ctrlKey: false, metaKey: false});
  assert.deepEqual(tormenta20RollArgs({...plain, advantage: "disadvantage"}, {event: click}).event, {shiftKey: true, altKey: false, ctrlKey: true, metaKey: false});
});

test("Tormenta20: Shift skips the dialog unless the client setting turns it round", () => {
  const settings = value => ({settings: {get: () => value}});
  assert.equal(withT20Game(settings("default"), () => shiftSkipsDialog()), true);
  assert.equal(withT20Game(settings("shift"), () => shiftSkipsDialog()), false);
  assert.equal(withT20Game({}, () => shiftSkipsDialog()), true);
});

test("Tormenta20 knows characters, rolls through the actor and judges the plain total", async () => {
  assert.equal(tormenta20.isCharacter({type: "character"}), true);
  assert.equal(tormenta20.isCharacter({type: "npc"}), false);
  assert.equal(tormenta20.advantage, true);
  assert.equal(tormenta20.scheme, "d20");
  const calls = [];
  const actor = {name: "Ayla", system: {atributos: {for: {}}, pericias: {perc: {}, fort: {}}},
    rollAtributo: async (key, args) => { calls.push(["attribute", key, args.event]); },
    rollPericia: async (key, args) => { calls.push(["pericia", key, args.event]); }};
  await withT20Game({settings: {get: () => "default"}}, async () => {
    await tormenta20.roll(actor, {type: "attribute", key: "for", advantage: "normal"}, {fastForward: true});
    await tormenta20.roll(actor, {type: "skill", key: "perc", advantage: "advantage"}, {fastForward: false});
    await tormenta20.roll(actor, {type: "save", key: "fort", advantage: "normal"}, {});
    await assert.rejects(tormenta20.roll(actor, {type: "skill", key: "acro"}, {}), /has no acro/);
    await assert.rejects(tormenta20.roll(actor, {type: "attribute", key: "des"}, {}), /has no des/);
  });
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [["attribute", "for"], ["pericia", "perc"], ["pericia", "fort"]]);
  assert.equal(calls[0][2].shiftKey, true);
  assert.equal(calls[1][2].altKey, true);
  assert.equal(calls[1][2].shiftKey, false);
  const roll = (total, natural) => ({total, dice: [{faces: 20, results: [{result: natural}]}]});
  assert.deepEqual(tormenta20.evaluate(message([roll(16, 11)]), {type: "skill", dc: 15}), {total: 16, natural: 11, success: true, degree: "success"});
  assert.deepEqual(tormenta20.evaluate(message([roll(14, 20)]), {type: "skill", dc: 15}), {total: 14, natural: 20, success: false, degree: "failure"});
  assert.equal(tormenta20.evaluate(message([roll(14, 2)]), {type: "skill", dc: null}).success, null);
});

test("Tormenta20: the card of an item is no answer to a request, the card of a test is accepted", () => {
  const request = {type: "skill", key: "perc"};
  assert.equal(tormenta20.matches(message([], {tormenta20: {itemData: {rolls: []}}}), request), false);
  assert.equal(tormenta20.matches(message([], {tormenta20: {rollTotal: 12}}), request), null);
  assert.equal(tormenta20.matches(message([]), {type: "formula"}), null);
});
