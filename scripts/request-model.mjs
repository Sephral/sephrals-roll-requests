/**
 * The request and its results as plain data, without Foundry: checking the options of a request, judging a total
 * against the DC, what each viewer may see, and the summary of a card. Everything here is pure and has unit tests.
 */

/**
 * How the results show: public, for the GM only, blind (the roller does not see the own result either), or silent
 * (the GM rolls for everyone and the players hear nothing of it).
 */
export const MODES = ["public", "gm", "blind", "silent"];

/** When a group check succeeds: at least half of the group succeed, all of them, or one is enough. */
export const GROUP_RULES = ["half", "all", "any"];

/** Roll types the players can get to choose between. */
export const CHOOSABLE = ["save", "check", "skill", "tool", "attribute"];

/** The advantage hint of a request. */
export const ADVANTAGE = ["normal", "advantage", "disadvantage"];

/** The version of the stored request. */
export const REQUEST_VERSION = 1;

/** Longest note on a card. */
const NOTE_LENGTH = 200;

/**
 * A DC from user input: a whole number from 0 to 999, or null for none.
 * @param {*} value
 * @returns {number|null}
 */
export function parseDc(value) {
  if ( (value === null) || (value === undefined) || (String(value).trim() === "") ) return null;
  const number = Number(value);
  if ( !Number.isFinite(number) ) return null;
  return Math.min(999, Math.max(0, Math.round(number)));
}

/**
 * Check and complete the options of a request. Throws with a message key when the request cannot be made.
 * @param {object} input
 * @param {string} input.type        Roll type of the adapter (check, save, skill, tool, formula, ...)
 * @param {string} [input.key]       Which check, save or skill
 * @param {string} [input.formula]   For type "formula"
 * @param {string} [input.label]     Label of a formula roll
 * @param {*} [input.dc]
 * @param {boolean} [input.showDc=true]
 * @param {string} [input.mode="public"]
 * @param {string} [input.advantage="normal"]
 * @param {boolean|string} [input.group=false]     true or a rule of GROUP_RULES
 * @param {string} [input.groupRule="half"]
 * @param {{type: string, key: string}[]} [input.choices]   Two or more rolls, each character rolls one of them
 * @param {boolean} [input.autoRollNpcs=true]
 * @param {string} [input.note]
 * @returns {object}
 */
export function normalizeOptions(input={}) {
  const choices = normalizeChoices(input.choices);
  const type = choices.length ? choices[0].type : String(input.type ?? "").trim();
  if ( !type ) throw new Error("SRR.Error.noType");
  const key = choices.length ? choices[0].key : String(input.key ?? "").trim();
  const formula = String(input.formula ?? "").trim();
  if ( (type === "formula") && !formula ) throw new Error("SRR.Error.noFormula");
  if ( (type !== "formula") && !key ) throw new Error("SRR.Error.noKey");
  const rule = GROUP_RULES.find(r => (r === input.group) || (r === input.groupRule)) ?? "half";
  return {
    type,
    key: type === "formula" ? "" : key,
    formula: type === "formula" ? formula : "",
    label: String(input.label ?? "").trim().slice(0, 80),
    dc: parseDc(input.dc),
    showDc: input.showDc !== false,
    // A passive value is no roll: only the GM gets to see the comparison
    mode: type === "passive" ? "silent" : MODES.includes(input.mode) ? input.mode : "public",
    // A passive value is no roll and a hit die knows no advantage
    advantage: ((type === "passive") || (key === "hitDie")) ? "normal"
      : ADVANTAGE.includes(input.advantage) ? input.advantage : "normal",
    group: !!input.group,
    groupRule: rule,
    autoRollNpcs: input.autoRollNpcs !== false,
    note: String(input.note ?? "").trim().slice(0, NOTE_LENGTH),
    choices
  };
}

/**
 * The rolls of a request that lets each character pick one. Fewer than two different rolls are no choice.
 * @param {*} list
 * @returns {{type: string, key: string}[]}
 */
export function normalizeChoices(list) {
  if ( !Array.isArray(list) ) return [];
  const seen = new Map();
  for ( const item of list ) {
    const type = String(item?.type ?? "").trim();
    const key = String(item?.key ?? "").trim();
    if ( CHOOSABLE.includes(type) && key ) seen.set(rollId(type, key), {type, key});
  }
  return seen.size > 1 ? [...seen.values()] : [];
}

/**
 * The id of a roll, as the request window and the marks of a roll use it.
 * @param {string} type
 * @param {string} [key]
 * @returns {string}
 */
export function rollId(type, key="") {
  return `${type}:${key}`;
}

/**
 * The type and key of a roll id.
 * @param {string} id
 * @returns {{type: string, key: string}}
 */
export function parseRollId(id) {
  const [type, ...rest] = String(id ?? "").split(":");
  return {type, key: rest.join(":")};
}

/**
 * The roll a character makes: the one of the given id when the request offers it, otherwise the first.
 * @param {object} request
 * @param {string|null} [id]
 * @returns {{type: string, key: string}}
 */
export function pickChoice(request, id=null) {
  const choices = request?.choices ?? [];
  if ( !choices.length ) return {type: request?.type, key: request?.key};
  const wanted = id ? parseRollId(id) : null;
  const choice = choices.find(c => (c.type === wanted?.type) && (c.key === wanted?.key)) ?? choices[0];
  return {type: choice.type, key: choice.key};
}

/**
 * The stored request of a card.
 * @param {object} options     Result of normalizeOptions
 * @param {object[]} entries   {id, actorUuid, tokenUuid, name, img, npc}
 * @param {object} extra       {id, system, label, createdAt, userId}
 * @returns {object}
 */
export function buildRequest(options, entries, extra) {
  if ( !entries.length ) throw new Error("SRR.Error.noActors");
  return {v: REQUEST_VERSION, ...extra, ...options, entries, results: {}};
}

/* -------------------------------------------- */
/*  Judging a total                             */
/* -------------------------------------------- */

/** Degrees of success in order from worst to best. */
const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/**
 * Judge a total against the DC. Without a DC there is no outcome, except in Savage Worlds where the target number is
 * 4 unless the GM sets another.
 * @param {object} roll
 * @param {number} roll.total
 * @param {number|null} [roll.natural]      The kept d20 (d20 systems)
 * @param {number|null} dc
 * @param {"d20"|"pf2e"|"swade"|"crucible"} [scheme="d20"]
 * @param {object} [extra]
 * @param {boolean} [extra.critfail]        Savage Worlds: snake eyes on trait and wild die
 * @param {string|null} [extra.outcome]     A degree the system has decided itself (PF2e)
 * @param {number|null} [extra.critical]    Crucible: margin above the DC for a critical success (default 6)
 * @param {number|null} [extra.fumble]      Crucible: margin below the DC for a critical failure (default 6)
 * @returns {{success: boolean|null, degree: string|null, raises?: number}}
 */
export function judge({total, natural=null}, dc, scheme="d20", {critfail=false, outcome=null, critical=null, fumble=null}={}) {
  if ( !Number.isFinite(total) ) return {success: null, degree: null};
  if ( scheme === "swade" ) {
    const tn = Number.isFinite(dc) ? dc : 4;
    if ( critfail ) return {success: false, degree: "criticalFailure", raises: 0};
    if ( total < tn ) return {success: false, degree: "failure", raises: 0};
    const raises = Math.floor((total - tn) / 4);
    return {success: true, degree: raises > 0 ? "criticalSuccess" : "success", raises};
  }
  if ( !Number.isFinite(dc) ) return {success: null, degree: null};
  if ( scheme === "pf2e" ) {
    let degree = DEGREES.includes(outcome) ? outcome : null;
    if ( !degree ) {
      let index = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
      if ( natural === 20 ) index = Math.min(3, index + 1);
      else if ( natural === 1 ) index = Math.max(0, index - 1);
      degree = DEGREES[index];
    }
    return {success: DEGREES.indexOf(degree) >= 2, degree};
  }
  if ( scheme === "crucible" ) {
    // Crucible: a check succeeds above the DC, by more than its threshold (6 unless the roll says otherwise) critical
    const up = Number.isFinite(critical) ? critical : 6;
    const down = Number.isFinite(fumble) ? fumble : 6;
    if ( total > dc + up ) return {success: true, degree: "criticalSuccess"};
    if ( total > dc ) return {success: true, degree: "success"};
    if ( total <= dc - down ) return {success: false, degree: "criticalFailure"};
    return {success: false, degree: "failure"};
  }
  const success = total >= dc;
  return {success, degree: success ? "success" : "failure"};
}

/* -------------------------------------------- */
/*  Summary and visibility                      */
/* -------------------------------------------- */

/**
 * Whether a group check succeeds. The default is the D&D rule: at least half of the group succeed.
 * @param {number} passed
 * @param {number} count
 * @param {string} [rule="half"]
 * @returns {boolean}
 */
export function groupSucceeds(passed, count, rule="half") {
  if ( count <= 0 ) return false;
  if ( rule === "all" ) return passed === count;
  if ( rule === "any" ) return passed > 0;
  return passed * 2 >= count;
}

/**
 * Counts of a request.
 * @param {object} request
 * @returns {{count: number, rolled: number, pending: number, passed: number, failed: number, complete: boolean,
 *   group: "success"|"failure"|null}}
 */
export function summarize(request) {
  const entries = request?.entries ?? [];
  const results = request?.results ?? {};
  let rolled = 0;
  let passed = 0;
  let failed = 0;
  for ( const entry of entries ) {
    const result = results[entry.id];
    if ( !result ) continue;
    rolled++;
    if ( result.success === true ) passed++;
    else if ( result.success === false ) failed++;
  }
  const count = entries.length;
  const complete = count > 0 && rolled === count;
  const judged = (request?.dc !== null && request?.dc !== undefined) || (passed + failed > 0);
  const group = (request?.group && complete && judged) ? (groupSucceeds(passed, count, request.groupRule) ? "success" : "failure") : null;
  return {count, rolled, pending: count - rolled, passed, failed, complete, group};
}

/**
 * What one viewer may see of a card.
 * - The GM sees everything.
 * - Players see totals in public requests; in GM-only requests only the totals of their own characters; in blind
 *   and silent requests no totals at all. Outcomes and the summary of passes only show with a visible DC.
 * @param {object} request
 * @param {object} viewer
 * @param {boolean} viewer.isGM
 * @param {(entry: object) => boolean} viewer.owns
 * @returns {{dc: boolean, summary: boolean, entry: (entry: object) => {total: boolean, outcome: boolean}}}
 */
export function viewFor(request, {isGM, owns}) {
  if ( isGM ) return {dc: true, summary: true, entry: () => ({total: true, outcome: true})};
  const dcShown = !!request.showDc;
  const mode = request.mode;
  return {
    dc: dcShown,
    summary: dcShown && (mode === "public"),
    entry: entry => {
      const total = (mode === "public") || ((mode === "gm") && owns(entry));
      return {total, outcome: total && dcShown};
    }
  };
}

/**
 * The visibility of a roll message of a request: public, whispered to the GMs (also for silent requests), or blind.
 * @param {string} mode
 * @param {string[]} gms   Ids of the GM users
 * @returns {{whisper: string[], blind: boolean}}
 */
export function rollVisibility(mode, gms) {
  if ( (mode === "gm") || (mode === "silent") ) return {whisper: [...gms], blind: false};
  if ( mode === "blind" ) return {whisper: [...gms], blind: true};
  return {whisper: [], blind: false};
}

/**
 * Who receives the card: everybody for public requests, only the GMs for silent ones, otherwise the GMs and the
 * players asked to roll.
 * @param {string} mode
 * @param {string[]} gms
 * @param {string[]} players
 * @returns {string[]}   An empty list means public
 */
export function cardRecipients(mode, gms, players) {
  if ( mode === "public" ) return [];
  if ( mode === "silent" ) return [...gms];
  return [...new Set([...gms, ...players])];
}

/**
 * The entries a user still has to roll.
 * @param {object} request
 * @param {(entry: object) => boolean} owns
 * @returns {object[]}
 */
export function pendingFor(request, owns) {
  return (request?.entries ?? []).filter(entry => !request.results?.[entry.id] && owns(entry));
}

/**
 * A short, stable version of a request for other modules and the hooks.
 * @param {object} request
 * @param {string} messageId
 * @returns {object}
 */
export function publicResult(request, messageId) {
  const summary = summarize(request);
  return {
    id: request.id,
    messageId,
    type: request.type,
    key: request.key,
    formula: request.formula,
    label: request.label,
    dc: request.dc,
    mode: request.mode,
    choices: request.choices ?? [],
    groupRule: request.groupRule ?? "half",
    group: summary.group,
    complete: summary.complete,
    passed: summary.passed,
    failed: summary.failed,
    entries: request.entries.map(entry => ({
      actorUuid: entry.actorUuid,
      tokenUuid: entry.tokenUuid ?? null,
      name: entry.name,
      result: request.results?.[entry.id] ? {...request.results[entry.id]} : null
    }))
  };
}

/**
 * The deleted answer a new roll message of a character replaces, if it came within a few seconds.
 * @param {{answer: object, actorUuid: string, until: number}[]} list
 * @param {string|null} actorUuid
 * @param {number} now
 * @returns {object|null}   The entry, removed from the list
 */
export function takeReplaced(list, actorUuid, now) {
  for ( let i = list.length - 1; i >= 0; i-- ) if ( list[i].until < now ) list.splice(i, 1);
  if ( !actorUuid ) return null;
  const index = list.findIndex(item => item.actorUuid === actorUuid);
  return index >= 0 ? list.splice(index, 1)[0] : null;
}

/**
 * The marker a roll answers among the open ones of its character: the first whose request matches the roll, else
 * the first one that does not contradict it, else the first.
 * @param {object[]} markers
 * @param {(marker: object) => boolean|null} matches
 * @returns {object|null}
 */
export function pickMarker(markers, matches) {
  if ( !markers.length ) return null;
  if ( markers.length === 1 ) return markers[0];
  const verdicts = markers.map(marker => matches(marker));
  const exact = markers.find((marker, i) => verdicts[i] === true);
  return exact ?? markers.find((marker, i) => verdicts[i] === null) ?? markers[0];
}

export const __test__ = {DEGREES, NOTE_LENGTH};
