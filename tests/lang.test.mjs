import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * All keys of a nested translation object, dotted.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keysOf(object, prefix="") {
  return Object.entries(object).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return (value && (typeof value === "object")) ? keysOf(value, full) : [full];
  });
}

/**
 * All files of a folder, recursively.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function files(dir) {
  const list = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(list.map(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])))).flat();
}

const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));
const enKeys = new Set(keysOf(en));
const get = (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj);

test("English and German have the same keys", () => {
  assert.deepEqual([...keysOf(de)].sort(), [...enKeys].sort());
});

test("no key is both a text and a group", () => {
  for ( const key of enKeys ) assert.ok(![...enKeys].some(other => other.startsWith(`${key}.`)), key);
});

test("placeholders match between English and German", () => {
  const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for ( const key of enKeys ) assert.deepEqual(holes(get(de, key)), holes(get(en, key)), key);
});

test("every key used by scripts exists", async () => {
  const used = new Set();
  for ( const file of await files(path.join(root, "scripts")) ) {
    if ( file.endsWith("usage.mjs") || file.endsWith("debug-file.mjs") ) continue;
    const text = await readFile(file, "utf8");
    for ( const match of text.matchAll(/["'`](SRR\.[A-Za-z0-9_.]+)["'`]/g) ) used.add(match[1]);
  }
  for ( const key of Object.keys(en.SRR.SETTINGS) ) {
    used.add(`SRR.SETTINGS.${key}.name`);
    used.add(`SRR.SETTINGS.${key}.hint`);
  }
  // Keys built from parts
  for ( const type of ["save", "check", "skill", "tool", "attribute", "formula"] ) used.add(`SRR.Type.${type}`);
  for ( const type of ["save", "check", "skill", "tool", "attribute"] ) used.add(`SRR.Label.${type}`);
  for ( const mode of ["public", "gm", "blind"] ) {
    used.add(`SRR.Mode.${mode}`);
    used.add(`SRR.Mode.${mode}Hint`);
  }
  for ( const a of ["normal", "advantage", "disadvantage", "fortune", "misfortune"] ) used.add(`SRR.Advantage.${a}`);
  for ( const o of ["success", "failure", "criticalSuccess", "criticalFailure", "raises"] ) used.add(`SRR.Outcome.${o}`);
  for ( const name of ["dc", "tn"] ) {
    used.add(`SRR.Card.${name}`);
    used.add(`SRR.Request.${name}`);
  }
  for ( const g of ["success", "failure"] ) used.add(`SRR.Card.group.${g}`);
  for ( const key of used ) if ( key.endsWith(".") ) used.delete(key);
  const missing = [...used].filter(key => !enKeys.has(key));
  assert.deepEqual(missing, []);
});

test("the strings contain no semicolons", () => {
  for ( const key of enKeys ) {
    assert.ok(!String(get(en, key)).includes(";"), key);
    assert.ok(!String(get(de, key)).includes(";"), key);
  }
});
