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

test('the past-meal screen renders through the same per-figure read card as today\'s meal', () => {
  // Since 2026-09-14 a past meal wears today's design: trust.js calls meal.js mealReadHtml, whose
  // nutrition strip is gated per figure (the card behind showMacros || showCalories, the macro
  // cells behind showMacros, the calorie cell behind showCalories). Pinned at the source of the
  // rule, and pinned that trust.js has no nutrition markup of its own any more.
  assert.match(TRUST_SRC, /mealReadHtml\(M, \{ exec: null, past: true, dayTotals: pastDayTotalsThrough\(m\) \}\)/);
  assert.doesNotMatch(TRUST_SRC, /<h2 class="eyebrow">Nutrition<\/h2>/);
  assert.doesNotMatch(TRUST_SRC, /class="macro-row/);
  const MEAL = read('screens', 'meal.js');
  assert.match(MEAL, /const showNums = PS\.showMacros \|\| PS\.showCalories;/);
  const kcalCell = MEAL.split('\n').find((l) => l.includes("tile('cals', raw.cals"));
  assert.ok(kcalCell, 'the kcal tile still exists (2026-09-15: the strip became four tiles, each behind its own flag)');
  assert.match(kcalCell, /PS\.showCalories/);
});

test('the past-meal screen prints no stored analysis prose of its own', () => {
  // The old twin gated a paragraph behind both figure flags. The AI's words now reach a past meal
  // only through the thread rows, which meal-chat wrote per plan style server-side. No prose, no
  // leak: pinned that the screen does not read m.analysis into markup at all.
  assert.doesNotMatch(TRUST_SRC, /class="ai-note"/);
  assert.doesNotMatch(TRUST_SRC, /esc\(m\.analysis/);
});

/* ---- the goal panel's strategy line (7 PM polish, 2026-09-06): the last sentence on Plan
        still naming a hidden mechanism. Real renders through S.planGoal — the line is spoken
        per figure like the rows above it, and the signals tone gets its own voice. ---- */

test('the strategy line speaks signals to Intuitive, never calorie or protein mechanics', () => {
  setStyle('intuitive');
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
  const s = S.planGoal.strategy;
  assert.match(s, /signals leading/i);
  assert.match(s, /Never restriction/);
  assert.doesNotMatch(s, /[Cc]alorie|protein|maintenance/);
});

test('the strategy line is unchanged where both figures show', () => {
  setStyle('structured');
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
  assert.equal(S.planGoal.strategy, 'Calorie target below maintenance, protein held high.');
  RT.profile = { ...RT.profile, baseGoal: 'gain' };
  assert.equal(S.planGoal.strategy, 'Calorie surplus with protein scaled to bodyweight.');
});

test('calories hidden alone: the strategy names the protein side only, and says the rest is deliberate', async () => {
  const { knobsFor } = await import('./plan-style.js');
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
  RT.planStyle = {
    style: 'structured', knobs: knobsFor('structured', { surface: { showCalories: false } }),
    source: 'coach', locked: false, canChoose: false, preference: null,
  };
  const s = S.planGoal.strategy;
  assert.match(s, /Protein held high/);
  assert.match(s, /off your screen on purpose/);
  assert.doesNotMatch(s, /[Cc]alorie target|maintenance/);
  RT.planStyle = null;
});

test('no goal means no strategy line, on the signals tone too (adversarial review, same evening)', () => {
  setStyle('intuitive');
  RT.profile = { ...RT.profile, baseGoal: null };
  assert.equal(S.planGoal.strategy, null, 'null goal stays null — plan.js renders its pick-a-goal prompt');
  RT.profile = { ...RT.profile, baseGoal: 'cut' };
  assert.equal(S.planGoal.strategy, null, 'an unmapped goal key stays null, as on the old static table');
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
});

test("tone alone can't earn the signals voice: 'Never restriction' requires adequacy scoring to be true", async () => {
  // A pro can stamp surface.tone:'signals' onto Structured, where calorie scoring stays
  // 'exact' — an athlete scored on exact adherence must not be told "Never restriction".
  const { knobsFor } = await import('./plan-style.js');
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
  RT.planStyle = {
    style: 'structured', knobs: knobsFor('structured', { surface: { tone: 'signals' } }),
    source: 'coach', locked: false, canChoose: false, preference: null,
  };
  const s = S.planGoal.strategy;
  assert.doesNotMatch(s, /Never restriction/);
  assert.equal(s, 'Calorie target below maintenance, protein held high.');
  RT.planStyle = null;
});

test('the perform goal names no figure, so its line holds on every style', () => {
  setStyle('intuitive');
  RT.profile = { ...RT.profile, baseGoal: 'perform' };
  assert.match(S.planGoal.strategy, /performance formula, not a weight formula/);
  assert.doesNotMatch(S.planGoal.strategy, /calorie|protein/i);
  RT.profile = { ...RT.profile, baseGoal: 'lose' };
});

/* ---- the QC/marketing stub: an Intuitive seed's thread must read like a real Intuitive
        thread. analyze-meal writes prose per style server-side, so the numbers-voice fixture
        under an Intuitive seed showed QA a screen no real athlete can reach. ---- */

test("the seed stub's signals voice carries no stored figure; the numbers voice is untouched", async () => {
  const { sbStubSource } = await import('../../../web/landing-src/lib/sb-stub.mjs');
  const base = { todayISO: '2026-09-06', athletes: [] };
  const numbers = sbStubSource(base);
  const signals = sbStubSource({ ...base, voice: 'signals' });
  assert.match(numbers, /52g of protein and 780 calories/);
  assert.match(numbers, /78g of protein and 980 calories/);
  const thread = signalsThreadText(signals);
  assert.ok(thread.length, 'the two AI rows are still found in the generated source');
  for (const leak of ['52g', '780 calories', '78g', '980 calories', 'of 180g']) {
    assert.ok(!thread.includes(leak), `signals voice leaks "${leak}"`);
  }
});

// The stub is one generated source string; the two seeded AI rows are the only style-written
// prose in it. Pull just their text lines so roster fixtures (which legitimately carry numbers
// for coach shots) don't false-positive the leak check.
function signalsThreadText(src) {
  return src.split('\n').filter((l) => l.includes('Good timing on lunch') || l.includes('Double chicken') || l.includes('double chicken')).join('\n');
}

/* ---- the live meal family (meal.js, foodsearch.js): the same per-figure rule (1 PM audit,
        2026-09-06). The morning's commit claimed per-figure; these surfaces still gated the
        calorie figure behind showMacros, which leaks it to an athlete whose professional hid
        calories alone. */
const MEAL_SRC = read('screens', 'meal.js');
const FS_SRC = read('screens', 'foodsearch.js');

test('meal.js: every calorie figure rides showCalories, every macro cell rides showMacros', () => {
  // The analysis screen's macroRow builds its cells per figure. Since 2026-09-22 each cell is the
  // settled meal page's Nutrition tile (nutTile) rather than a boxed .macro, so the pre-log check
  // and the logged plate read as one family; the per-figure gates are unchanged.
  assert.match(MEAL_SRC, /if \(S\.planStyle\.showCalories\) cells\.push\(nutTile\('cals', `\$\{m\.cals\}`/);
  assert.match(MEAL_SRC, /if \(S\.planStyle\.showMacros\) cells\.push\(\s*nutTile\('protein'/);
  // The thread's value strip: kcal cell behind showCalories, the three macro cells behind showMacros.
  // (Cells read through mg(raw.*) since 2026-09-14: null prints a dash, the gates are unchanged.)
  const kcalCell = MEAL_SRC.split('\n').find((l) => l.includes("tile('cals', raw.cals"));
  assert.ok(kcalCell, 'the thread kcal tile still exists');
  // Inside mealReadHtml the style is `PS`: the signed-in user's own S.planStyle unless a caller
  // (the coach's screen) overrides it. Same gates, one indirection.
  assert.match(MEAL_SRC, /const PS = planStyle \|\| S\.planStyle \|\| \{\};/);
  assert.match(kcalCell, /PS\.showCalories/);
  assert.match(MEAL_SRC, /\.\.\.\(PS\.showMacros \? \[tile\('protein', raw\.protein/);
  // The day bars: the calorie bar (value and target) behind showCalories, protein behind showMacros.
  // The VALUE is the day's running total through this plate (dayT), not the plate's own macros —
  // these bars say "Today after this meal" and "74g left", and until 2026-09-16 they printed the
  // single plate, so a 106g lunch was followed by a 35g dinner reading as the day going backwards.
  // The per-figure flag gating this test exists for is unchanged; only the source of the number is.
  assert.match(MEAL_SRC, /PS\.showCalories \? \[\['Calories', dayT\.cals, T\.calories/);
  assert.match(MEAL_SRC, /PS\.showMacros \? \[\['Protein', dayT\.protein, T\.protein/);
  // paceNote quotes a protein figure, so its input rides showMacros too — the card can be
  // visible for the calorie bar alone.
  assert.match(MEAL_SRC, /const projectedTotal = PS\.showMacros && T\.protein/);
  // So do the drawer's fiber note and the correction reference's two figures.
  assert.match(MEAL_SRC, /PS\.showMacros \? `<div class="est-note"[^`]*fiber estimated/);
  assert.match(MEAL_SRC, /if \(PS\.showMacros\) bits\.push\(`~\$\{M\.orig\.protein\}g protein`\)/);
  assert.match(MEAL_SRC, /if \(PS\.showCalories\) bits\.push\(`~\$\{M\.orig\.kcal\} kcal`\)/);
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
