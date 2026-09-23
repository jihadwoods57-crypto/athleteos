/* A-B4 at render level (review pass 2026-09-23): the meal screens must not judge a carbs or fat
   figure the read never returned. The pure scorer handled null already; the screens were handing
   it a coerced 0 through M.macros. This renders the real read card off pastMealDetail. */
import assert from 'node:assert';
import test from 'node:test';

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

const { mealReadHtml } = await import('./screens/meal.js');
const { pastMealDetail } = await import('./screens/trust.js');
const { S } = await import('./state.js');

const row = (over) => ({ id: 'm1', type: 'lunch', name: 'Chicken bowl', logged_at: '2026-09-22T12:30:00', minutes_late: 0,
  quality: 84, protein: 52, carbs: null, fat: null, kcal: 780, fiber: 6, detected: [], photo_path: 'p.jpg', ...over });
const html = (M, viewer = 'athlete') => { const r = mealReadHtml(M, { past: true, viewer, planStyle: { showMacros: true, showCalories: true } }); return `${r.photoBlock}${r.breakdown}`; };

test('meal view: null fat and carbs earn no "in range" / "balanced" chip or rubric row', () => {
  for (const viewer of ['athlete', 'coach']) {
    const out = html(pastMealDetail(row({})), viewer);
    assert.doesNotMatch(out, /Fat in range|Carbs balanced|Carb-heavy|Fat a bit high|Fat high/, viewer);
    assert.doesNotMatch(out, /Fat within range|Carbohydrate balance/, viewer);
    assert.doesNotMatch(out, /NaN|nullg|undefined/, viewer);
  }
});

test('meal view: with every macro read, the verdicts still speak', () => {
  const out = html(pastMealDetail(row({ carbs: 60, fat: 20, kcal: 600 })));
  assert.match(out, /Fat within range/);
});

test('meal-detail (today): the model keeps null in macrosRaw and coerces only `macros`', () => {
  const src = (p) => import('node:fs').then((fs) => fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
  return src('state.js').then((s) => {
    assert.match(s, /macrosRaw: \{ protein: nullNum\(meta\.protein\), carbs: nullNum\(meta\.carbs\), fat: nullNum\(meta\.fat\), cals: nullNum\(meta\.kcal\) \}/);
    void S;
  });
});
