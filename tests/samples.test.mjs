import assert from "node:assert/strict";
import test from "node:test";
import {PARTY, sampleCards, sampleLists, samplePrompts} from "../scripts/sample-data.mjs";
import {summarize} from "../scripts/request-model.mjs";

const titles = new Proxy({}, {get: (_, key) => String(key)});
const notes = new Proxy({}, {get: (_, key) => String(key)});
const ctx = {uuidOf: id => `Actor.${id}`, userId: "u1", titles, notes};

test("every sample card is a valid request with results from the real judge", () => {
  const cards = sampleCards(ctx);
  assert.deepEqual(Object.keys(cards).sort(), ["all", "any", "blind", "choice", "crucible", "daggerheart", "formula", "half", "pf2e", "passive", "secret", "swade"].sort());
  for ( const request of Object.values(cards) ) {
    assert.equal(request.entries.length, PARTY.length);
    for ( const entry of request.entries ) assert.match(entry.actorUuid, /^Actor\./);
    for ( const id of Object.keys(request.results) ) assert.ok(request.entries.some(entry => entry.id === id));
  }
});

test("the group cards show the states they promise", () => {
  const {half, all, any, pf2e, swade, daggerheart} = sampleCards(ctx);
  assert.equal(summarize(half).complete, false);
  assert.equal(summarize(half).rolled, 3);
  assert.equal(summarize(all).group, "failure");
  assert.equal(summarize(any).group, "success");
  assert.equal(summarize(pf2e).group, "success");
  assert.deepEqual(Object.values(pf2e.results).map(r => r.degree), ["criticalSuccess", "success", "failure", "criticalFailure"]);
  assert.equal(swade.results["s-ari"].raises, 1);
  assert.equal(daggerheart.results["s-tovin"].degree, "criticalSuccess");
});

test("the player window holds pending rolls of two characters only", () => {
  const {single, choice} = samplePrompts(ctx);
  assert.equal(single.length, 2);
  assert.equal(choice[0].request.choices.length, 3);
  for ( const item of [...single, ...choice] ) assert.deepEqual(item.entries.map(e => e.id), ["s-ari", "s-mira"]);
});

test("the request window lists have sent, planned and saved entries", () => {
  const lists = sampleLists(ctx, (rolls, dc) => `${rolls[0]} ${dc}`);
  assert.equal(lists.recent.length, 3);
  assert.equal(lists.planned.length, 3);
  assert.ok(lists.planned.some(p => p.done));
  assert.equal(lists.presets.length, 2);
});
