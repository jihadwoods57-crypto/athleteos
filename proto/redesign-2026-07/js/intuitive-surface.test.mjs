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
  // Guard: with a field unrendered, root.querySelector('#me-kcal').value would throw at
  // click time (no bundler catches it). The handler must probe first, then use stored numbers.
  // Per FIELD (the 1 PM audit, same day): the calorie input and the macro inputs are probed
  // separately, because a professional can hide calories alone.
  assert.match(MEMORY_EDIT_SRC, /const kcalShown = !!root\.querySelector\('#me-kcal'\)/);
  assert.match(MEMORY_EDIT_SRC, /const macrosShown = !!root\.querySelector\('#me-p'\)/);
  for (const k of ['protein', 'kcal', 'carbs', 'fat']) {
    assert.match(MEMORY_EDIT_SRC, new RegExp(`stored\\('${k}'\\)`), `stored ${k} passes through unchanged`);
  }
  // The at-least-one-number validation only applies when the athlete could type one.
  assert.match(MEMORY_EDIT_SRC, /p <= 0 && kcal <= 0 && \(kcalShown \|\| macrosShown\)/);
  // And a gated save with the item vanished from a refreshed cache is refused — never inserted
  // as a nameless duplicate with zeros in the hidden columns.
  assert.match(MEMORY_EDIT_SRC, /if \(\(!kcalShown \|\| !macrosShown\) && !it\)/);
});

test('a professional hiding calories alone: the edit sheet keeps the macro fields, drops the kcal field', async () => {
  const { knobsFor } = await import('./plan-style.js');
  RT.planStyle = {
    style: 'structured', knobs: knobsFor('structured', { surface: { showCalories: false } }),
    source: 'coach', locked: false, canChoose: false, preference: null,
  };
  assert.equal(S.planStyle.showMacros, true);
  assert.equal(S.planStyle.showCalories, false);
  const html = memoryEdit.render({ sub: 'fm-sub' });
  assert.match(html, /me-p/);                        // protein still editable
  assert.match(html, /443/);                         // and pre-filled
  assert.doesNotMatch(html, /me-kcal/);              // the calorie input is gone
  assert.doesNotMatch(html, /787/);                  // and the stored kcal is not read back
  RT.planStyle = null;
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

test('the past-meal nutrition section is per figure: macro cells behind showMacros, the kcal cell behind showCalories', () => {
  assert.match(TRUST_SRC, /S\.planStyle\.showMacros \|\| S\.planStyle\.showCalories \? `<h2 class="eyebrow">Nutrition<\/h2>/);
  const kcalCell = TRUST_SRC.split('\n').find((l) => l.includes('${m.kcal || 0}'));
  assert.ok(kcalCell, 'the kcal cell still exists');
  assert.match(kcalCell, /S\.planStyle\.showCalories/);
});

test('the past-meal analysis prose needs both figure flags or a style-matched analysis', () => {
  // A paragraph can quote any figure, so one hidden figure means only stamped prose — written
  // for this exact style — may show. Older analyses were written in a numbers tone.
  assert.match(TRUST_SRC, /\(S\.planStyle\.showMacros && S\.planStyle\.showCalories\) \|\| m\.styleApplied === S\.planStyle\.key/);
});

/* ---- the live meal family (meal.js, foodsearch.js): the same per-figure rule (1 PM audit,
        2026-09-06). The morning's commit claimed per-figure; these surfaces still gated the
        calorie figure behind showMacros, which leaks it to an athlete whose professional hid
        calories alone. */
const MEAL_SRC = read('screens', 'meal.js');
const FS_SRC = read('screens', 'foodsearch.js');

test('meal.js: every calorie figure rides showCalories, every macro cell rides showMacros', () => {
  // The analysis screen's macroRow builds its cells per figure.
  assert.match(MEAL_SRC, /if \(S\.planStyle\.showCalories\) cells\.push\(`<div class="macro"><div class="mv">\$\{m\.cals\}/);
  // The thread's value strip: kcal cell behind showCalories, the three macro cells behind showMacros.
  const kcalCell = MEAL_SRC.split('\n').find((l) => l.includes('${tilde}${M.macros.cals}'));
  assert.ok(kcalCell, 'the thread kcal cell still exists');
  assert.match(kcalCell, /S\.planStyle\.showCalories/);
  assert.match(MEAL_SRC, /\$\{S\.planStyle\.showMacros \? `\n\s*<div class="nv lead"><div class="mv">\$\{tilde\}\$\{M\.macros\.protein\}/);
  // The day bars: the calorie bar (value and target) behind showCalories, protein behind showMacros.
  assert.match(MEAL_SRC, /S\.planStyle\.showCalories \? \[\['Calories', M\.macros\.cals, T\.calories/);
  assert.match(MEAL_SRC, /S\.planStyle\.showMacros \? \[\['Protein', M\.macros\.protein, T\.protein/);
  // paceNote quotes a protein figure, so its input rides showMacros too — the card can be
  // visible for the calorie bar alone.
  assert.match(MEAL_SRC, /const projectedTotal = S\.planStyle\.showMacros && T\.protein/);
  // So do the drawer's fiber note and the correction reference's two figures.
  assert.match(MEAL_SRC, /S\.planStyle\.showMacros \? `<div class="est-note"[^`]*fiber estimated/);
  assert.match(MEAL_SRC, /if \(S\.planStyle\.showMacros\) bits\.push\(`~\$\{M\.orig\.protein\}g protein`\)/);
  assert.match(MEAL_SRC, /if \(S\.planStyle\.showCalories\) bits\.push\(`~\$\{M\.orig\.kcal\} kcal`\)/);
  // "No coach targets set yet" is claimed off the RAW targets — a hidden target still exists.
  assert.match(MEAL_SRC, /targetBars\.length \|\| T\.protein \|\| T\.calories \? '' :/);
  // Prose on both meal surfaces needs both flags or the stamp.
  const proseGates = MEAL_SRC.match(/\(S\.planStyle\.showMacros && S\.planStyle\.showCalories\) \|\| [LM]\.styleApplied === S\.planStyle\.key/g) || [];
  assert.equal(proseGates.length, 2, 'both styleSafeProse gates take the per-figure form');
});

test('foodsearch.js: totals, result rows, and the barcode card hide each figure behind its own flag', () => {
  // Plate totals and barcode cells stay in the DOM (paint writes into them) and hide
  // themselves with the hidden attribute (.macro[hidden] in app.css) — no inline style,
  // the ratchet stays where it is.
  assert.match(FS_SRC, /id="t-k".*Calories/s);
  for (const id of ['t-p', 't-c', 't-f', 'bc-p', 'bc-c', 'bc-f']) {
    const line = FS_SRC.split('\n').find((l) => l.includes(`id="${id}"`));
    assert.match(line, /S\.planStyle\.showMacros \? '' : ' hidden'/, `${id} rides showMacros`);
  }
  for (const id of ['t-k', 'bc-k']) {
    const line = FS_SRC.split('\n').find((l) => l.includes(`id="${id}"`));
    assert.match(line, /S\.planStyle\.showCalories \? '' : ' hidden'/, `${id} rides showCalories`);
  }
  // Result rows quote each figure behind its own flag, and the barcode subtitle only promises
  // "numbers below" when some figure will actually be below.
  assert.match(FS_SRC, /showMacros \? ` · \$\{x\.p\}g protein` : ''/);
  assert.match(FS_SRC, /showCalories \? ` · \$\{x\.kc\} kcal` : ''/);
  assert.match(FS_SRC, /\(S\.planStyle\.showMacros \|\| S\.planStyle\.showCalories\)\n\s*\? \(found\.serving/);
});
