/* The Intuitive presentation gate on the LAST athlete-facing readback surfaces (2026-09-06).
 *
 * The red line (PRODUCT.md, 2026-09-05): an Intuitive athlete never has a stored calorie or
 * macro figure read back to them; the numbers are still computed, stored, and sent — hiding is
 * presentation only. The meal read, food search, barcode results, and saved-meal rows were
 * closed 09-05. This file pins the four readbacks that were still open:
 *   1. The Food Memory edit sheet pre-filled a saved item's kcal/protein/carbs/fat into inputs.
 *   2. Plan's "Save this as a usual?" suggestion card quoted protein and kcal on every style.
 *   3. Plan's goal panel printed goal-derived protein/calorie targets on every style.
 *   4. The PAST-meal view (trust.js mealView, meal.js's history twin) rendered the stored macro
 *      row and a numbers-tone analysis unconditionally — a meal whose numbers were hidden on
 *      the day it was logged revealed them from history, one tap off a notification.
 * Gates are PER FIGURE where a surface quotes both: protein behind showMacros, calories behind
 * showCalories — a pro can turn off calories alone (knobsFor surface overrides), and an OR-gate
 * would leak the hidden half.
 * TYPING numbers stays, on every style, wherever the athlete is transcribing a source they hold
 * (the label screen, a NEW manual memory item): that is the one fallback the red line allows,
 * and an item saved with no numbers at all could never score fueling honestly.
 *
 * Real renders for the edit sheet; regex over sources (in the manner of depill.test.mjs) for the
 * click-time save path and the two plan.js gates, whose full-screen renders want a page of state.
 * Run: node --test proto/redesign-2026-07/js/intuitive-surface.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* ---- the same minimal browser the state-memo tests stand up ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {},
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { S, RT } = await import('./state.js');
const { warmFoodMemory } = await import('./food-memory-data.js');
const memoryEdit = (await import('./screens/memory-edit.js')).default;

RT.userId = 'u-intuitive';
const ITEM = {
  id: 'fm-sub', name: 'Usual Subway order', kind: 'order', place_id: null,
  kcal: 787, protein: 443, carbs: 481, fat: 429, times_logged: 4,
};
await warmFoodMemory({ fetchFoodMemory: async () => ({ items: [ITEM], places: [] }) }, RT.userId, true);

const setStyle = (key) => {
  RT.profile = { ...(RT.profile || {}), planStyle: key };
  RT.planStyle = null; // force re-resolution from the profile choice
  assert.equal(S.planStyle.key, key, `style resolver honored the athlete's choice of ${key}`);
};

test('Structured: the edit sheet still pre-fills the saved numbers', () => {
  setStyle('structured');
  assert.equal(S.planStyle.showMacros, true);
  const html = memoryEdit.render({ sub: 'fm-sub' });
  assert.match(html, /me-kcal/);
  assert.match(html, /787/);
  assert.match(html, /Fix the name, place, or numbers/);
});

test('THE LEAK: Intuitive editing a saved meal gets no numbers section and no stored figure', () => {
  setStyle('intuitive');
  assert.equal(S.planStyle.showMacros, false);
  const html = memoryEdit.render({ sub: 'fm-sub' });
  assert.doesNotMatch(html, /me-kcal|me-p\b|The numbers/);
  assert.doesNotMatch(html, /787|443|481|429/);
  assert.match(html, /Usual Subway order/);          // name and place stay editable
  assert.match(html, /Fix the name or place/);       // the subtitle stops promising numbers
  assert.match(html, /me-save/);                     // and the sheet still saves
});

test('Intuitive saving a NEW usual keeps the typed fields — transcription is the allowed fallback', () => {
  setStyle('intuitive');
  const html = memoryEdit.render({ sub: 'new' });
  assert.match(html, /me-kcal/);
  assert.match(html, /The numbers/);
});

/* ---- click-time save: no fields in the DOM means the stored numbers pass through ---- */
const MEMORY_EDIT_SRC = read('screens', 'memory-edit.js');

test('the save handler reads the DOM for the fields and falls back to the stored item', () => {
  // Guard: with the section unrendered, root.querySelector('#me-kcal').value would throw at
  // click time (no bundler catches it). The handler must probe first, then use stored numbers.
  assert.match(MEMORY_EDIT_SRC, /const fieldsShown = !!root\.querySelector\('#me-kcal'\)/);
  for (const k of ['protein', 'kcal', 'carbs', 'fat']) {
    assert.match(MEMORY_EDIT_SRC, new RegExp(`stored\\('${k}'\\)`), `stored ${k} passes through unchanged`);
  }
  // The at-least-one-number validation only applies when the athlete could type one.
  assert.match(MEMORY_EDIT_SRC, /fieldsShown && p <= 0 && kcal <= 0/);
  // And a gated save with the item vanished from a refreshed cache is refused — never inserted
  // as a nameless all-zeros duplicate.
  assert.match(MEMORY_EDIT_SRC, /if \(!fieldsShown && !it\)/);
});

/* ---- the two plan.js readbacks ---- */
const PLAN_SRC = read('screens', 'plan.js');

test('the suggestion card gates each figure behind its own flag', () => {
  const line = PLAN_SRC.split('\n').find((l) => l.includes('g.protein}g protein'));
  assert.ok(line, 'the suggestion line still exists');
  assert.match(line, /showMacros \? `\$\{g\.protein\}g protein/);
  assert.match(line, /showCalories \? `\$\{g\.kcal\} kcal/);
  assert.match(line, /eaten \$\{g\.count\}/); // the numberless part survives on every style
});

test('the goal panel derived targets are gated per figure, like targetsRow', () => {
  const pLine = PLAN_SRC.split('\n').find((l) => l.includes('derivedProtein}g protein'));
  const kLine = PLAN_SRC.split('\n').find((l) => l.includes('derivedCalories} kcal'));
  assert.ok(pLine && kLine, 'both derived-target pushes still exist');
  assert.match(pLine, /S\.planStyle\.showMacros/);
  assert.match(kLine, /S\.planStyle\.showCalories/);
});

test('saved-meal rows (macroLine) gate protein and kcal independently', () => {
  const pLine = PLAN_SRC.split('\n').find((l) => l.includes('it.protein}g protein'));
  const kLine = PLAN_SRC.split('\n').find((l) => l.includes('it.kcal} kcal'));
  assert.ok(pLine && kLine, 'both macroLine pushes still exist');
  assert.match(pLine, /S\.planStyle\.showMacros/);
  assert.match(kLine, /S\.planStyle\.showCalories/);
});

/* ---- the past-meal view (trust.js), meal.js's history twin ---- */
const TRUST_SRC = read('screens', 'trust.js');

test('the past-meal macro row renders only behind showMacros', () => {
  assert.match(TRUST_SRC, /S\.planStyle\.showMacros \? `<h2 class="eyebrow">Nutrition<\/h2>/);
});

test('the past-meal analysis prose needs showMacros or a style-matched analysis', () => {
  // Older analyses were written in a numbers tone; the same styleApplied gate meal.js uses.
  assert.match(TRUST_SRC, /S\.planStyle\.showMacros \|\| m\.styleApplied === S\.planStyle\.key/);
});
