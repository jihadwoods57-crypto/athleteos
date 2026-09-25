/* NO LOGGING WITHOUT A PHOTO (founder standing rule, goals and eating plan A1, 2026-09-25).
 *
 * Ideas, usuals, searches, labels, barcodes and chat picks may only PLAN a meal. The camera is the
 * only way a meal is logged. This file pins every path that used to commit a meal with no photo:
 *   - act.logMeal itself refuses a commit that carries no photo for that slot;
 *   - a staged no-photo meal restored from the session is dropped, never offered to commit;
 *   - the chat's Food Memory picks PLAN the next open slot (the same DAY.plans door Today uses)
 *     and confirm in place with a camera button;
 *   - food search, the label screen and the barcode screen plan, and say so;
 *   - the dead one-tap helpers (stageSavedMeal, captureManual, logDinner, day0Meal,
 *     dayToggleQuick) are gone from the proto.
 * The Trust Pass is the one sanctioned exception and is untouched: it never creates a meal (a
 * covered slot is scored from the athlete's own median on a clone of the day; pass.js).
 * Past no-photo meals still render: see the legacy-read test at the bottom.
 * Run: node --test proto/redesign-2026-07/js/no-photo-log.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };
const sess = new Map();
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
globalThis.location = globalThis.window.location;

const { RT, act, MEAL, mealDetail } = await import('./state.js');
const { DAY } = await import('./day.js');
const { warmFoodMemory } = await import('./food-memory-data.js');
const PT = await import('./plan-today.js');
const { mealSuggestHtml } = await import('./chat-view.js');
const { esc } = await import('./components.js');

const reset = () => {
  RT.userId = 'u-np'; RT.stdMeals = null;
  for (const k of Object.keys(DAY.meals)) DAY.meals[k] = false;
  DAY.slotMacros = {}; DAY.mealLoggedAt = {}; DAY.plans = {};
  act.clearMeal();
};

test('act.logMeal refuses a commit with no photo behind it, whatever staged it', () => {
  reset();
  MEAL.key = 'lunch'; MEAL.source = 'manual'; MEAL.result = { protein: 40, kcal: 600, carbs: 50, fat: 10, quality: null, detected: ['Chicken'], note: '' };
  assert.equal(act.logMeal('lunch'), false);
  assert.equal(DAY.meals.lunch, false, 'nothing was logged');
  act.clearMeal();
  assert.equal(act.logMeal('dinner'), false, 'a bare call (the old logDinner/day0Meal) logs nothing either');
  assert.equal(DAY.meals.dinner, false);
});

/* A photo still logs exactly as before: src/core/protoMealPhotoSlot.test.ts drives that path (it
   queues a real outbox job, which would keep this Node process alive). */

test('a staged no-photo meal left in the session is dropped on load, never offered to commit', () => {
  const st = read('state.js');
  assert.match(st, /if \(j && typeof j === 'object' && j\.photoBase64\) Object\.assign\(MEAL, j\);/);
});

const USUAL = { id: 'fm1', name: 'Chicken burrito bowl', protein: 52, kcal: 780, times_logged: 5 };

test('a chat pick PLANS the next open slot through the same DAY.plans door Today uses, and logs nothing', async () => {
  reset();
  DAY.meals.breakfast = true;
  await warmFoodMemory({ fetchFoodMemory: async () => ({ items: [USUAL], places: [] }) }, RT.userId, true);
  const r = PT.planSavedMeal('fm1');
  assert.ok(r && r.slot, 'a slot was planned');
  assert.equal(DAY.plans[r.slot].name, 'Chicken burrito bowl');
  assert.equal(DAY.plans[r.slot].source, 'usual');
  assert.equal(DAY.meals[r.slot], false, 'planned, not logged');
  assert.equal(PT.planSavedMeal('gone'), null, 'an item that is gone plans nothing');
});

test('the pick bubble: plan targets, then an in-place confirmation with a camera button', () => {
  const sug = { framing: 'Here is what usually gets you there.', fallback: 'x', proteinGap: 40 };
  const picks = [{ id: 'fm1', name: 'Chicken burrito bowl', protein: 52, kcal: 780 }];
  const before = mealSuggestHtml(sug, picks, esc);
  assert.match(before, /data-fm-plan="fm1"/);
  assert.doesNotMatch(before, /data-fm-log/);
  const after = mealSuggestHtml(sug, picks, esc, { slot: 'lunch', title: 'Lunch', name: 'Chicken burrito bowl' });
  assert.match(after, /Planned for lunch\. Snap it when you eat\./);
  assert.match(after, /data-fm-snap="lunch"/);
  assert.doesNotMatch(after, /data-fm-plan=/, 'the picks give way to the confirmation');
});

test('plannedPick finds the pick that is this slot\'s plan, and only for a slot still open', () => {
  reset();
  DAY.plans = { lunch: { name: 'Chicken burrito bowl', protein: 52, kcal: 780, source: 'usual', at: 'x' } };
  const picks = [{ id: 'fm1', name: 'Chicken burrito bowl' }, { id: 'fm2', name: 'Tuna melt' }];
  assert.deepEqual(PT.plannedPick(picks), { slot: 'lunch', title: 'Lunch', name: 'Chicken burrito bowl' });
  DAY.meals.lunch = true;
  assert.equal(PT.plannedPick(picks), null, 'once the photo is in, the bubble stops claiming a plan');
});

test('both chat screens plan on tap and snap on the confirmation; neither stages a log', () => {
  for (const f of ['meal.js', 'nutrition-chat.js']) {
    const src = read('screens', f);
    assert.match(src, /closest\('\[data-fm-plan\]'\)/, `${f} handles the plan tap`);
    assert.match(src, /planSavedMeal\(/, `${f} plans through plan-today.js`);
    assert.match(src, /closest\('\[data-fm-snap\]'\)/, `${f} handles the camera tap`);
    assert.match(src, /plannedPick\(/, `${f} renders the confirmation from DAY.plans`);
    assert.doesNotMatch(src, /stageSavedMeal|data-fm-log/);
  }
});

test('food search, the label screen and the barcode screen PLAN; none stages a meal to log', () => {
  const fs = read('screens', 'foodsearch.js');
  assert.doesNotMatch(fs, /captureManual|#meal-analysis|Log without a photo|Log \$\{/);
  assert.equal((fs.match(/planSlot\(/g) || []).length, 3, 'search, label and barcode each plan');
  assert.match(fs, /Snap it when you eat/);
});

test('no door in the proto still says it logs without a photo', () => {
  const cam = read('screens', 'camera.js');
  assert.doesNotMatch(cam, /Log without a camera|log without a camera/);
  const meal = read('screens', 'meal.js');
  assert.doesNotMatch(meal, /Log with Search|log the meal with Search/);
});

test('the dead one-tap helpers are gone from every shipped module', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? (e.name === 'vendor' ? [] : walk(join(d, e.name))) : (e.name.endsWith('.js') ? [join(d, e.name)] : [])));
  for (const f of walk(HERE)) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\bstageSavedMeal\b|\bcaptureManual\b|\blogDinner\b|\bday0Meal\b|\bdayToggleQuick\b|data-fm-log/, f);
  }
});

test('LEGACY: a past no-photo meal (manual, label, memory) still reads back', () => {
  reset();
  DAY.meals.dinner = true;
  DAY.slotMacros.dinner = { protein: 40, kcal: 600, carbs: 50, fat: 10, name: 'Plate from search', source: 'manual', foods: ['Chicken'] };
  const m = mealDetail('dinner');
  assert.equal(m.logged, true);
  assert.equal(m.source, 'manual');
  assert.equal(m.macros.protein, 40);
  // The score still reads quick_added days and manual slots (history is never rewritten).
  assert.match(read('day.js'), /day\.quickAdded \|\| \[\]/);
});
