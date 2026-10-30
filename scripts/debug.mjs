/**
 * Roll Requests' part of the debug file of Sephral's modules: the adapter of the system, the open requests with
 * their counts, and the recent decisions (requests made, rolls marked, results written or refused). Cards and the
 * roll messages that answer them are messages the module reads.
 */

import {MODULE_ID, t} from "./config.mjs";
import {DebugTrace, registerDebugMenu, registerDebugProvider} from "./debug-file.mjs";
import {summarize} from "./request-model.mjs";

/** The recent decisions of the module. */
export const debugTrace = new DebugTrace();

/**
 * Run one part and keep its error instead, so one broken reading does not cost the rest.
 * @param {Function} fn
 * @returns {*}
 */
function attempt(fn) {
  try {
    return fn();
  } catch(err) {
    return {error: String(err?.message ?? err)};
  }
}

/**
 * A short view of a request.
 * @param {object} request
 * @returns {object}
 */
function describeRequest(request) {
  return {
    id: request.id, system: request.system, type: request.type, key: request.key, formula: request.formula,
    dc: request.dc, showDc: request.showDc, mode: request.mode, advantage: request.advantage, group: request.group,
    entries: request.entries.map(e => ({id: e.id, actorUuid: e.actorUuid, tokenUuid: e.tokenUuid, npc: e.npc,
      result: request.results?.[e.id] ?? null})),
    summary: summarize(request)
  };
}

/**
 * The button in the settings and the module's part of the file. Call in "init".
 * @param {{adapter: Function, requestOf: Function, openCards: Function}} reader
 */
export function registerDebug(reader) {
  registerDebugMenu(MODULE_ID, {name: "SRR.DEBUG.Title", label: "SRR.DEBUG.Save", hint: "SRR.DEBUG.Hint"});
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SRR.DEBUG.Entry"),
    notice: file => t("SRR.DEBUG.Saved", {file}),
    recent: () => ({details: {
      adapter: attempt(() => reader.adapter().id),
      open: attempt(() => reader.openCards().map(m => ({messageId: m.id, ...describeRequest(reader.requestOf(m))})))
    }}),
    applies: message => !!(message?.flags?.[MODULE_ID]?.request || message?.flags?.[MODULE_ID]?.answer),
    message: message => {
      const request = reader.requestOf(message);
      if ( request ) return {card: describeRequest(request)};
      return {answer: message.flags?.[MODULE_ID]?.answer ?? null};
    },
    trace: debugTrace,
    omitSettings: ["lastRequest"]
  });
}
