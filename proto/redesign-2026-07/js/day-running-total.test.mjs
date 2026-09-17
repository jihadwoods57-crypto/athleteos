/* "Today after this meal" counts the DAY, not the plate (founder report 2026-09-16).
 *
 * The meal read card's target bars sit under a heading that says "Today after this meal" and a
 * subline that says "74g left". They were fed the single plate's own macros. So a 106g lunch drew
 * the day at 106 of 180, and a 35g dinner three hours later drew it at 35 of 180 — the founder's
 * own words: "I was at 106g of protein at lunch but it went back down to 35 at dinner which is
 * impossible." A running day total is monotonic by definition. This file pins that:
 *
 *  - S.dayTotalsThrough(slot) accumulates and never shrinks as the day fills;
 *  - it is a total THROUGH that plate, so re-opening breakfast at night shows breakfast's moment,
 *    not the whole day;
 *  - a duplicate-flagged plate banks nothing (the same evidence rule the score uses);
 *  - the renderers read it rather than the plate (source regexes, in the manner of
 *    null-macro.test.mjs — the three screens that draw this card cannot each be booted here).
 *
 * Run: node --test proto/redesign-2026-07/js/day-running-total.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

// The same headless shim state-memo.test.mjs uses to import state.js under node.
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
const { DAY } = await import('./day.js');
RT.userId = 'u-running-total';

/** The founder's own day, to the minute: an 8am breakfast, the 12:50 PM lunch from the report,
 *  and a 7pm dinner. Written straight onto DAY because dayLogMeal stamps minutesNow() and this
 *  test is about the ordering, which a wall clock cannot supply. */
function seedDay() {
  for (const k of Object.keys(DAY.meals)) { DAY.meals[k] = false; delete DAY.slotMacros[k]; delete DAY.mealLoggedAt[k]; }
  DAY.meals.breakfast = true; DAY.mealLoggedAt.breakfast = 8 * 60;
  DAY.slotMacros.breakfast = { protein: 40, kcal: 600, quality: 80 };
  DAY.meals.lunch = true; DAY.mealLoggedAt.lunch = 12 * 60 + 50;
  DAY.slotMacros.lunch = { protein: 106, kcal: 1311, quality: 78 };
  DAY.meals.dinner = true; DAY.mealLoggedAt.dinner = 19 * 60;
  DAY.slotMacros.dinner = { protein: 35, kcal: 700, quality: 74 };
}

test('THE BUG, pinned: the day climbs from meal to meal and never falls back', () => {
  seedDay();
  const b = S.dayTotalsThrough('breakfast');
  const l = S.dayTotalsThrough('lunch');
  const d = S.dayTotalsThrough('dinner');
  assert.equal(b.protein, 40);
  assert.equal(l.protein, 146, 'lunch is breakfast + lunch, not lunch alone');
  assert.equal(d.protein, 181, 'dinner is the whole day — never the 35 the plate carried');
  assert.ok(b.protein <= l.protein && l.protein <= d.protein, 'a running total cannot go backwards');
  assert.equal(b.cals, 600);
  assert.equal(l.cals, 1911);
  assert.equal(d.cals, 2611);
});

test('it is a total THROUGH that plate: opening breakfast at night shows breakfast\'s moment', () => {
  seedDay();
  assert.equal(S.dayTotalsThrough('breakfast').protein, 40, 'the later plates had not landed yet');
});

test('a duplicate-flagged plate banks nothing, the same evidence rule the score uses', () => {
  seedDay();
  DAY.slotMacros.lunch = { ...DAY.slotMacros.lunch, flagged: 'dup' };
  assert.equal(S.dayTotalsThrough('dinner').protein, 75, 'breakfast + dinner; the duplicate earns nothing');
  // Opening the duplicate itself still shows a real day — what WAS banked by the time it landed,
  // with its own figures excluded. The day is true; the plate simply did not count toward it,
  // which is the same thing the suppressed day-credit line on that card already says.
  assert.equal(S.dayTotalsThrough('lunch').protein, 40, 'breakfast only; the duplicate banks nothing, not even for itself');
});

test('a slot that was never logged has no day to report, so the caller draws no bars', () => {
  seedDay();
  assert.equal(S.dayTotalsThrough('snack'), null);
});

test('the bars read the day total; the Nutrition tiles above still read the plate', () => {
  const meal = read('screens', 'meal.js');
  assert.match(meal, /\['Protein', dayT\.protein, T\.protein/, 'the protein bar is the day');
  assert.match(meal, /\['Calories', dayT\.cals, T\.calories/, 'the calorie bar is the day');
  assert.doesNotMatch(meal, /\['Protein', raw\.protein/, 'never the plate again');
  assert.doesNotMatch(meal, /\['Calories', raw\.cals/, 'never the plate again');
  // The tiles under "Nutrition" are THIS plate and must stay that way — they are the only place
  // the athlete reads what they just ate.
  assert.match(meal, /tile\('protein', raw\.protein/, "the plate's own figure still leads the tiles");
});

test('every caller supplies a day it can stand behind, or none at all', () => {
  const meal = read('screens', 'meal.js');
  const trust = read('screens', 'trust.js');
  const coach = read('screens', 'coach.js');
  // Today's live plate falls back to the engine.
  assert.match(meal, /const dayT = dayTotals \|\| \(!past && you \? S\.dayTotalsThrough\(M\.slot\) : null\);/);
  // A past plate sums that day's stored rows.
  assert.match(trust, /function pastDayTotalsThrough\(m\)/);
  assert.match(trust, /dayTotals: pastDayTotalsThrough\(m\)/);
  // The coach screen holds ONE meals row, so it passes nothing and the bars stand down rather
  // than measuring one plate against a whole day's target.
  assert.doesNotMatch(coach, /dayTotals:/, 'the coach has no day in hand and must not invent one');
});

test('the forecast ghost rides only the latest plate', () => {
  const meal = read('screens', 'meal.js');
  assert.match(meal, /const latestPlate = !!dayT && dayT\.protein === \(Number\(dayProg\.proteinSoFar\) \|\| 0\);/);
  assert.match(meal, /latestPlate \? project\(T\.protein, dayT\.protein\) : null/);
});
