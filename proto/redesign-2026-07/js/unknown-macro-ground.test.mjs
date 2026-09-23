/* Unknown is not zero, all the way to the stored quality (review pass rulings 2026-09-23).
   Fiber the read never measured earns no "No fiber showing"; carbs and fat a new read never
   returned stay null through grounding, so the quality stored for a new meal has no false 0. */
import assert from 'node:assert';
import test from 'node:test';
import { mealQualityScore, scoreReasons, scoreRubric, coachFocus, groundExtras, normalizeDetected } from './meal-intel.js';
import { groundMealTotals, groundMealFromFoods, isCompleteMealResult } from './nutrition.js';

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;
const { groundResult } = await import('./state.js');
const { mealReadHtml } = await import('./screens/meal.js');
const { pastMealDetail } = await import('./screens/trust.js');

const FULL = { protein: 40, carbs: 60, fat: 20, kcal: 580 };

test('fiber: unknown earns no chip, no rubric row, no focus line, and is left out of the score', () => {
  const labels = scoreReasons({ macros: FULL, fiber: null, detected: [] }).map((r) => r.label);
  assert.ok(!labels.some((l) => /fiber/i.test(l)), labels.join(' | '));
  assert.ok(!scoreRubric({ macros: FULL, fiber: null }).rows.some((r) => r.k === 'Produce & fiber'));
  assert.doesNotMatch(coachFocus({ macros: FULL, fiber: null, minutesLate: 0 }), /green/);
  // protein 35 + carbs 15 + fat 20 + timing 10 of 80 max = 100; a known 0 fiber costs its points.
  assert.equal(mealQualityScore({ macros: FULL, fiber: null, minutesLate: 0 }), 100);
  assert.ok(mealQualityScore({ macros: FULL, fiber: 0, minutesLate: 0 }) < 100);
  assert.equal(mealQualityScore({ macros: FULL, fiber: 6, minutesLate: 0 }), 100, 'a known fiber still scores as before');
});

test('fiber: unknown with visible produce is credited as produce, not called a fiber miss', () => {
  const detected = normalizeDetected([{ name: 'broccoli' }, { name: 'side salad' }]);
  const r = scoreReasons({ macros: FULL, fiber: null, detected }).map((x) => x.label);
  assert.ok(!r.includes('No fiber showing') && !r.includes('Fiber light'), r.join(' | '));
  const row = scoreRubric({ macros: FULL, fiber: null, detected }).rows.find((x) => x.k === 'Produce & fiber');
  if (row) assert.match(row.note, /fiber not measured/);
});

test('fiber: groundExtras keeps a missing fiber null, a real one numeric', () => {
  assert.equal(groundExtras({}).fiber, null);
  assert.equal(groundExtras({ fiber: null }).fiber, null);
  assert.equal(groundExtras({ fiber: 7 }).fiber, 7);
  assert.equal(groundExtras({ fiber: 0 }).fiber, 0, 'a measured zero is a number');
});

test('meal view: unknown fiber prints no "No fiber showing" (the salad screenshot)', () => {
  const M = pastMealDetail({ id: 'm1', type: 'lunch', quality: 84, protein: 52, carbs: null, fat: null, kcal: 780, fiber: null, detected: [], photo_path: 'p.jpg', minutes_late: 0 });
  const r = mealReadHtml(M, { past: true, planStyle: { showMacros: true, showCalories: true } });
  const out = `${r.photoBlock}${r.breakdown}`;
  assert.doesNotMatch(out, /No fiber showing|fiber estimated/);
});

test('groundMealTotals: an estimate with no carbs or fat grounds them to null, not 0', () => {
  const g = groundMealTotals({ protein: 50, kcal: 700 }, []);
  assert.equal(g.totals.carbs, null);
  assert.equal(g.totals.fat, null);
  assert.equal(g.totals.kcal, 700, 'no Atwater snap on an incomplete set');
  const full = groundMealTotals({ protein: 50, carbs: 60, fat: 20, kcal: 620 }, []);
  assert.equal(full.totals.carbs, 60);
});

test('groundMealFromFoods: a macro no food reported is null; one food missing it is a lower bound', () => {
  const none = groundMealFromFoods(normalizeDetected([{ name: 'zzz shake', protein: 40, kcal: 300 }]));
  assert.equal(none.totals.carbs, null);
  assert.equal(none.totals.fat, null);
  const some = groundMealFromFoods(normalizeDetected([{ name: 'zzz shake', protein: 40, kcal: 300 }, { name: 'zzz bar', protein: 10, carbs: 30, fat: 8, kcal: 230 }]));
  assert.ok(typeof some.totals.carbs === 'number' && some.totals.carbs > 0, 'the one food that reported carbs counts');
  assert.ok(typeof some.totals.fat === 'number' && some.totals.fat > 0);
});

test('groundResult: a new read with no carbs/fat/fiber stores null and a quality with no false 0', () => {
  const r = groundResult({ name: 'Shake', protein: 40, kcal: 400, quality: 70, detected: [] });
  assert.equal(r.carbs, null);
  assert.equal(r.fat, null);
  assert.equal(r.fiber, null);
  assert.ok(!Number.isNaN(r.kcal) && r.kcal === 400);
  // Old behaviour: carbs 0 and fat 0 of 400 kcal were judged "met", 35 fat/carb points free.
  const withZeros = mealQualityScore({ macros: { protein: 40, carbs: 0, fat: 0, kcal: 400 }, fiber: 0, minutesLate: 0 });
  assert.notEqual(r.quality, withZeros);
  assert.ok(r.quality == null || (r.quality >= 0 && r.quality <= 100));
  assert.equal(isCompleteMealResult({ ...r, detectedRich: [{ name: 'Shake' }] }), true, 'an honest unknown still lands');
});
