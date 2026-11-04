/**
 * Self-test: the chat hooks the module relies on, the roll methods of the system's adapter on a real character,
 * the roll choices, the texts, and a judging round trip.
 */

import {getAdapter, rollGroups} from "./adapters/index.mjs";
import {MODULE_ID, TESTED_VERSIONS, esc, t} from "./config.mjs";
import {judge, summarize} from "./request-model.mjs";

/** The roll method each adapter needs on an actor, by roll type. */
const METHODS = {
  dnd5e: {save: "rollSavingThrow", check: "rollAbilityCheck", skill: "rollSkill", tool: "rollToolCheck", combat: "rollDeathSave"},
  pf2e: {save: "getStatistic", skill: "getStatistic"},
  swade: {attribute: "rollAttribute", skill: "rollSkill"},
  crucible: {skill: "rollSkill"}
};

/**
 * Run all checks.
 * @returns {Promise<{problems: string[], checks: number}>}
 */
async function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  const ChatMessage = foundry.documents?.ChatMessage ?? globalThis.ChatMessage;
  check(typeof ChatMessage?.implementation?.getSpeakerActor === "function", "SRR.SELFTEST.Speaker");
  check(typeof ChatMessage?.implementation?.prototype?.updateSource === "function", "SRR.SELFTEST.Message");
  check(!!game.users.activeGM, "SRR.SELFTEST.NoGM");

  const adapter = getAdapter();
  const groups = rollGroups();
  check((adapter.id === "generic") || (groups.length > 1), "SRR.SELFTEST.Choices", {system: game.system.id});
  const methods = METHODS[adapter.id];
  if ( methods ) {
    const actor = game.actors.find(a => adapter.isCharacter(a)) ?? game.actors.contents[0];
    if ( actor ) {
      for ( const [type, method] of Object.entries(methods) ) {
        if ( !groups.some(g => g.type === type) ) continue;
        check(typeof actor[method] === "function", "SRR.SELFTEST.Method", {method, actor: actor.name});
      }
    }
  }
  const scheme = adapter.scheme ?? "d20";
  const judged = judge({total: 15, natural: 10}, 12, scheme);
  check(judged.success === true, "SRR.SELFTEST.Judge");
  check(summarize({entries: [{id: "a"}], results: {a: {success: true}}}).complete, "SRR.SELFTEST.Judge");

  const keys = ["SRR.Request.title", "SRR.Card.roll", "SRR.Prompt.title", "SRR.Mode.public", "SRR.Type.formula"];
  const missing = keys.filter(key => !game.i18n.has(key));
  check(!missing.length, "SRR.SELFTEST.Texts", {keys: missing.join(", ")});
  return {problems, checks, adapter: adapter.id};
}

/**
 * Run the self-test and report the result.
 * @param {object} [options]
 * @param {boolean} [options.report=true]
 * @returns {Promise<{problems: string[], checks: number, adapter: string}>}
 */
export async function runSelfTest({report=true}={}) {
  const outcome = await checkAll();
  const {problems, checks} = outcome;
  const summary = problems.length ? t("SRR.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SRR.SELFTEST.Passed", {checks});
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    const system = TESTED_VERSIONS[game.system.id];
    const versions = t("SRR.SELFTEST.Version", {current: game.version, tested: TESTED_VERSIONS.core});
    const systemLine = system ? t("SRR.SELFTEST.SystemVersion", {system: game.system.title, current: game.system.version,
      tested: system}) : (outcome.adapter === "generic") ? t("SRR.SELFTEST.Generic", {system: game.system.title})
      : t("SRR.SELFTEST.Untested", {system: game.system.title, current: game.system.version});
    let content = `<h3>${esc(t("SRR.SELFTEST.Title"))}</h3><p>${esc(summary)}</p>`
      + `<p><small>${esc(versions)}<br>${esc(systemLine)}</small></p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id],
      speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return outcome;
}

/**
 * Tell the GM once when Foundry or the system is newer than the versions the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  const newer = [];
  if ( foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core) ) newer.push(`core ${game.version}`);
  const system = TESTED_VERSIONS[game.system.id];
  if ( system && foundry.utils.isNewerVersion(game.system.version, system) ) newer.push(`${game.system.id} ${game.system.version}`);
  if ( !newer.length ) return;
  const signature = newer.join(", ");
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SRR.SELFTEST.NewVersions", {versions: signature}), {permanent: true});
}
