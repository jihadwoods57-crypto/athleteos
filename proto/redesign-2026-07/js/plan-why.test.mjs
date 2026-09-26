/* Plan > Why these numbers (goals and eating plan, A2, 2026-09-25).
 *
 * Pins: the explanation's math is the grading math (parity with state.js nutritionConfigForGoal,
 * which is goalDerivedTargets for a goal-derived athlete), coach-set numbers say so and drop the
 * comparison, a minor gets no bodyweight, no "per pound" and no weight goals, an Intuitive athlete
 * gets not one figure, and the live screen explains DAY's real targets.
 * Run: node --test proto/redesign-2026-07/js/plan-why.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const mem = new Map();
const fakeStore = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => {}, localStorage: fakeStore,
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = fakeStore;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { RT, nutritionConfigForGoal, goalBodyweight } = await import('./state.js');
const { DAY } = await import('./day.js');
const M = await import('./plan-why-model.js');
const { perMealShare } = await import('./plan-today-model.js');
const screen = (await import('./screens/plan-why.js')).default;
const { whyModel } = await import('./screens/plan-why.js');

const derive = (k, bw) => nutritionConfigForGoal(k, bw, null);
const base = { derive, requiredMeals: 3, showMacros: true, showCalories: true };
const WEIGHT_WORDS = /\b(lb|lbs|pounds?|per pound|bodyweight|weight|gain|gaining|lose|losing|lean out|leaning|deficit|surplus|burn)\b/i;

test('the numbers are the grading numbers: every goal, every size', () => {
  for (const goalKey of ['gain', 'build', 'lose', 'lose_fat', 'maintain', 'health', 'performance', 'perform']) {
    for (const bw of [95, 120, 150, 171, 187, 210, 265]) {
      const d = derive(goalKey, bw);
      const x = M.explainTargets({ ...base, goalKey, bodyweight: bw, protein: d.proteinTarget, kcal: d.calTarget });
      assert.equal(x.protein.value, `${d.proteinTarget.toLocaleString('en-US')}g`);
      assert.equal(x.calories.value, d.calTarget.toLocaleString('en-US'));
      // The comparison's own goal is the graded one, and every row is nutritionConfigForGoal's.
      for (const c of x.compare) {
        const g = M.GOALS.find((y) => y.fam === c.fam);
        assert.deepEqual([c.protein, c.kcal], [derive(g.key, bw).proteinTarget, derive(g.key, bw).calTarget]);
      }
      assert.equal(x.compare.filter((c) => c.mine).length, 1);
      assert.equal(x.compare.find((c) => c.mine).fam, M.goalFamily(goalKey));
    }
  }
});

test('"per pound" is read back off the real target: the factor the math used', () => {
  const d = derive('gain', 187);
  const x = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: d.proteinTarget, kcal: d.calTarget });
  assert.match(x.protein.basis, /^About 1g per pound of your 187 lb, for gaining\./);
  assert.match(x.calories.basis, /^About 17 calories per pound: more than you burn/);
  const l = derive('lose', 200);
  const y = M.explainTargets({ ...base, goalKey: 'lose', bodyweight: 200, protein: l.proteinTarget, kcal: l.calTarget });
  assert.match(y.protein.basis, /^About 0\.9g per pound of your 200 lb, for losing fat\./);
  assert.match(y.calories.basis, /^About 12 calories per pound/);
  const m = derive('maintain', 180);
  assert.match(M.explainTargets({ ...base, goalKey: 'maintain', bodyweight: 180, protein: m.proteinTarget, kcal: m.calTarget }).protein.basis, /^About 0\.8g per pound/);
});

test('the per-meal split is the Plan and opener split', () => {
  const d = derive('gain', 187);
  for (const n of [2, 3, 4, 6]) {
    const x = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: d.proteinTarget, kcal: d.calTarget, requiredMeals: n });
    assert.equal(x.protein.perMeal, `About ${perMealShare(d.proteinTarget, n)}g at each of your ${n} meals.`);
  }
});

test('with no weight on file it says which bodyweight it used', () => {
  const d = derive('gain', 171);
  const x = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: null, defaultBw: 171, protein: d.proteinTarget, kcal: d.calTarget });
  assert.match(x.protein.basis, /uses 171 lb until you log your weight/);
});

test('the 80g floor is named as the floor, never as per-pound math', () => {
  const d = derive('maintain', 90);
  assert.equal(d.proteinTarget, 80);
  const x = M.explainTargets({ ...base, goalKey: 'maintain', bodyweight: 90, protein: 80, kcal: d.calTarget });
  assert.match(x.protein.basis, /minimum/);
  assert.doesNotMatch(x.protein.basis, /per pound of/);
});

test('coach-set: says so, keeps the why, and the comparison is gone', () => {
  const x = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: 220, kcal: 3600, coachSet: { protein: true, calories: true } });
  assert.equal(x.source, 'coach');
  assert.equal(x.lead, 'Your coach set these numbers.');
  assert.match(x.protein.basis, /^Protein repairs training/);   // the lead already names who set both
  assert.match(x.calories.basis, /^Calories are the fuel/);
  assert.equal(x.compare, null);
  const t = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: 220, kcal: 3600, coachSet: { protein: true }, who: 'trainer' });
  assert.equal(t.lead, 'Your trainer set your protein target.');
  assert.equal(t.compare, null);
  assert.match(t.protein.basis, /^Protein repairs training/);   // the lead names it; the figure explains itself
  assert.match(t.calories.basis, /per pound/);   // the figure the trainer did not set keeps its own basis
});

test('a minor: no bodyweight, no per pound, no weight goals, no comparison', () => {
  for (const goalKey of ['gain', 'lose', 'maintain', 'performance', null]) {
    const d = derive(goalKey || 'performance', 150);
    const x = M.explainTargets({ ...base, goalKey, bodyweight: 150, protein: d.proteinTarget, kcal: d.calTarget, minor: true });
    const words = [x.lead, x.protein.basis, x.protein.perMeal, x.calories.basis, x.how].join(' ');
    assert.doesNotMatch(words, WEIGHT_WORDS, `${goalKey}: ${words}`);
    assert.doesNotMatch(words, /150/);
    assert.equal(x.compare, null);
    assert.match(x.lead + x.protein.basis, /your body and training/);
  }
});

test('Intuitive: "Why this plate", not one figure', () => {
  for (const goalKey of ['gain', 'lose', 'maintain', 'performance', null]) {
    for (const minor of [false, true]) {
      const x = M.explainTargets({ ...base, goalKey, bodyweight: 187, protein: 185, kcal: 3200, showMacros: false, showCalories: false, minor });
      assert.equal(x.mode, 'plate');
      assert.equal(x.title, 'Why this plate');
      assert.equal(x.compare, null);
      const words = [x.lead, ...x.plate, x.how].join(' ');
      assert.doesNotMatch(words, /\d/, words);
      assert.doesNotMatch(words, /calorie|macro|grams?\b/i);
      if (minor) assert.doesNotMatch(words, WEIGHT_WORDS);
    }
  }
});

test('the live screen explains DAY\'s real targets, and a coach number only when it is the graded one', () => {
  RT.userId = 'u1';
  RT.profile = { baseGoal: 'gain', baseWeight: 187 };
  DAY.proteinTarget = 185; DAY.calTarget = 3200;
  assert.deepEqual(goalBodyweight(), { bw: 187, known: true });
  let m = whyModel();
  assert.equal(m.protein.value, '185g');
  assert.equal(m.source, 'goal');
  // A coach target the day is NOT graded on (say, applied only once a goal exists) is not claimed.
  RT.profile = { baseGoal: 'gain', baseWeight: 187, targets: { protein: 240 } };
  m = whyModel();
  assert.equal(m.source, 'goal');
  DAY.proteinTarget = 240;
  m = whyModel();
  assert.equal(m.source, 'coach');
  const html = screen.render();
  assert.match(html, /Your coach set your protein target/);   // only protein is theirs here
  assert.doesNotMatch(html, /What each goal would mean/);
  assert.doesNotMatch(html, /—/);
});

/* ---------------- review fix round (2026-09-26) ---------------- */

test('fix: the lead names exactly what the coach set', () => {
  const both = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: 220, kcal: 3600, coachSet: { protein: true, calories: true } });
  assert.equal(both.lead, 'Your coach set these numbers.');
  const p = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: 220, kcal: 3200, coachSet: { protein: true } });
  assert.equal(p.lead, 'Your coach set your protein target.');
  assert.match(p.calories.basis, /per pound/);            // the calories keep their goal source
  assert.equal(p.compare, null);
  const c = M.explainTargets({ ...base, goalKey: 'gain', bodyweight: 187, protein: 185, kcal: 3600, coachSet: { calories: true }, who: 'trainer' });
  assert.equal(c.lead, 'Your trainer set your calorie target.');
  assert.match(c.protein.basis, /per pound/);
  assert.equal(c.compare, null);
});

test('fix: no goal set means no goal comparison, even though the defaults are not coach-set', () => {
  const x = M.explainTargets({ ...base, goalKey: null, bodyweight: 187, protein: 180, kcal: 3200 });
  assert.equal(x.source, 'default');
  assert.equal(x.compare, null);
});

test('fix: a calorie target set by the 1500 floor says so, never a per-pound figure', () => {
  const d = derive('lose', 100);
  assert.equal(d.calTarget, 1500);
  const x = M.explainTargets({ ...base, goalKey: 'lose', bodyweight: 100, protein: d.proteinTarget, kcal: 1500 });
  assert.match(x.calories.basis, /OnStandard's minimum/);
  assert.doesNotMatch(x.calories.basis, /per pound/);
});
