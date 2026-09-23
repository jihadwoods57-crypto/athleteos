/* Round 2 of the review pass (2026-09-23): unknown stays unknown through the pre-log screen,
   every correction, and produce. */
import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applyMealCorrection, applyFoodRemoval, mealQualityScore, scoreReasons, normalizeDetected } from './meal-intel.js';

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
const { macroRow } = await import('./screens/meal.js');
const { S } = await import('./state.js');

const UNKNOWN = () => ({
  protein: 52, carbs: null, fat: null, kcal: 780, fiber: null, quality: 84,
  detectedRich: normalizeDetected([{ name: 'rice', quantity: '1 cup', protein: 5, kcal: 200, carbs: 45, fat: 1 }]),
  detected: ['rice'],
});

test('R2-I1: the pre-log macro row prints a dash for an unknown, never "nullg"', () => {
  const prev = S.planStyle;
  const html = macroRow({ protein: 40, carbs: null, fat: null, cals: 500 });
  assert.doesNotMatch(html, /null|undefined|NaN/);
  assert.ok(prev.showMacros, 'the default style shows macros');
  assert.match(html, /—/);
});

test('R2-I2: a portion change scales the known macros and leaves unknowns null', () => {
  const r = applyMealCorrection(UNKNOWN(), { kind: 'item', item: 'rice', quantity: '2 cups' });
  assert.ok(r, 'the correction applied');
  assert.equal(r.meta.carbs, null);
  assert.equal(r.meta.fat, null);
  assert.equal(r.meta.fiber, null);
  assert.notEqual(r.meta.protein, 52, 'the known macro was recomputed from the items');
  const chips = scoreReasons({ macros: r.meta, fiber: r.meta.fiber }).map((c) => c.label);
  assert.ok(!chips.some((l) => /Fat in range|Carbs balanced/.test(l)), chips.join(' | '));
  assert.equal(r.meta.orig.carbs, null, 'the audit anchor keeps the unknown too');
});

test('R2-I2: "cooked in oil" adds fat only when fat is known; otherwise it says so', () => {
  const r = applyMealCorrection(UNKNOWN(), { kind: 'cooking', value: 'oil' });
  assert.ok(r);
  assert.equal(r.meta.fat, null, 'an unmeasured fat stays unmeasured');
  assert.match(r.summary, /fat was not measured, so it stays unknown/);
  const known = applyMealCorrection({ ...UNKNOWN(), carbs: 60, fat: 10 }, { kind: 'cooking', value: 'oil' });
  assert.ok(known.meta.fat > 10, 'a known fat takes the oil');
});

test('R2-I2: removing a food and the coach re-score keep nulls', () => {
  const r = applyFoodRemoval(UNKNOWN(), 'rice', {});
  assert.equal(r.meta ? r.meta.carbs : r.carbs, null);
  const coach = readFileSync(new URL('./screens/coach.js', import.meta.url), 'utf8');
  assert.match(coach, /carbs: row\.carbs == null \? null : row\.carbs \|\| 0, fat: row\.fat == null \? null : row\.fat \|\| 0/);
  assert.match(coach, /fiber: row\.fiber == null \? null : row\.fiber \|\| 0/);
});

test('R2-I3: the same plate plus a salad never scores lower when fiber is unmeasured', () => {
  const macros = { protein: 40, carbs: 60, fat: 20, kcal: 580 };
  for (const minutesLate of [0, 30, 90]) {
    const plain = mealQualityScore({ macros, fiber: null, detected: normalizeDetected([{ name: 'chicken' }]), minutesLate });
    const salad = mealQualityScore({ macros, fiber: null, detected: normalizeDetected([{ name: 'chicken' }, { name: 'side salad' }, { name: 'broccoli' }]), minutesLate });
    assert.ok(salad >= plain, `late ${minutesLate}: ${salad} < ${plain}`);
  }
  const labels = scoreReasons({ macros, fiber: null, detected: normalizeDetected([{ name: 'broccoli' }]) });
  const produce = labels.find((c) => c.label === 'Produce showing');
  if (produce) assert.equal(produce.state, 'met', 'produce is a win, never a cost');
});
