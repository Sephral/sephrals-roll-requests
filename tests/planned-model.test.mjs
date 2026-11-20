import assert from "node:assert/strict";
import test from "node:test";
import {PLANNED_LIMIT, addPlanned, markUsed, normalizePlanned, plannedList, plannedText, regionKey, rememberFired, removePlanned,
  shouldFire, updatePlanned} from "../scripts/planned-model.mjs";
import {requestFromRecent, parseRollId} from "../scripts/request-model.mjs";

const make = (extra = {}) => normalizePlanned({rolls: ["skill:prc"], values: {dc: 15, mode: "silent"}, label: "Perception", who: "scene", ...extra}, "p1");

test("a planned check needs a roll and gets defaults", () => {
  assert.equal(normalizePlanned({rolls: []}), null);
  const c = normalizePlanned({rolls: ["skill:ath"]}, "x");
  assert.deepEqual([c.id, c.who, c.after, c.done, c.values.mode, c.values.group], ["x", "scene", "keep", false, "public", "off"]);
});

test("unknown values fall back", () => {
  const c = make({who: "nobody", after: "later", values: {mode: "weird", group: "weird", advantage: "weird"}});
  assert.deepEqual([c.who, c.after, c.values.mode, c.values.group, c.values.advantage], ["scene", "keep", "public", "off", "normal"]);
});

test("the label is trimmed and cut", () => {
  assert.equal(make({label: "  Hi  "}).label, "Hi");
  assert.equal(make({label: "x".repeat(200)}).label.length, 60);
});

test("a stored list is cleaned of broken and doubled entries", () => {
  const list = plannedList([make(), make(), {id: "z", rolls: []}, null, {id: "q", rolls: ["save:dex"]}]);
  assert.deepEqual(list.map(c => c.id), ["p1", "q"]);
  assert.deepEqual(plannedList("nonsense"), []);
});

test("add, update, remove", () => {
  let list = addPlanned([], make());
  list = addPlanned(list, make({id: "p2", label: "Second"}));
  assert.equal(list.length, 2);
  list = updatePlanned(list, "p1", {label: "Changed", values: {dc: 20}});
  assert.equal(list[0].label, "Changed");
  assert.equal(list[0].values.dc, 20);
  assert.equal(list[0].values.mode, "silent");
  list = removePlanned(list, "p1");
  assert.deepEqual(list.map(c => c.id), ["p2"]);
});

test("the list keeps the newest checks", () => {
  let list = [];
  for ( let i = 0; i < PLANNED_LIMIT + 3; i++ ) list = addPlanned(list, make({id: `c${i}`}));
  assert.equal(list.length, PLANNED_LIMIT);
  assert.equal(list.at(-1).id, `c${PLANNED_LIMIT + 2}`);
});

test("done marks follow the setting after use", () => {
  let list = [make({after: "done"}), make({id: "k", after: "keep"})];
  list = markUsed(markUsed(list, "p1"), "k");
  assert.deepEqual(list.map(c => c.done), [true, false]);
  list = updatePlanned(list, "p1", {values: {dc: 9}});
  assert.equal(list[0].done, false, "a changed request is open again");
  list = updatePlanned(markUsed(list, "p1"), "p1", {done: false});
  assert.equal(list[0].done, false);
});

test("the button text is the label or the description", () => {
  assert.equal(plannedText(make(), "Perception 15"), "Perception");
  assert.equal(plannedText(make({label: ""}), "Perception 15"), "Perception 15");
});

test("a planned check turns into a request like a recent one", () => {
  const input = requestFromRecent(make({values: {dc: 15, mode: "silent", group: "half"}}), make().rolls.map(parseRollId));
  assert.deepEqual([input.type, input.key, input.dc, input.mode, input.group], ["skill", "prc", 15, "silent", "half"]);
  assert.equal(requestFromRecent(make(), ["skill:prc"].map(parseRollId)).group, false);
});

test("region runs: once per token, once per region, or every time", () => {
  assert.equal(shouldFire({times: "always", fired: ["a"], key: "a"}), true);
  assert.equal(shouldFire({times: "once", fired: [], key: "a"}), true);
  assert.equal(shouldFire({times: "once", fired: ["a"], key: "a"}), false);
  assert.equal(shouldFire({times: "once", fired: ["a"], key: "b"}), true);
  assert.equal(regionKey("token", "t1"), "t1");
  assert.equal(regionKey("region", "t1"), "*");
  assert.deepEqual(rememberFired(rememberFired(undefined, "a"), "a"), ["a"]);
  assert.equal(shouldFire({times: "once", fired: rememberFired([], regionKey("region", "t1")), key: regionKey("region", "t2")}), false);
});
