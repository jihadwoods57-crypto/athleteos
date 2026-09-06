/* The per-render-tick derived-getter memo in state.js (2026-09-05).
 *
 * Pure getters (score, tier, weight, ...) are served from a memo while a memoTick() runs, which
 * is what the router wraps around a screen's render() and the tab bar. The contract: inside one
 * tick the second read is free and identical; a save(), a day.js mutation, or a new tick
 * invalidates; OUTSIDE a tick every getter is live, because RT is written directly all over the
 * app (RT.profile = ..., then S.audience on the next line) and none of those writes go through
 * save(). A memo that outlived a mutation would paint yesterday's score over today's meal, so
 * invalidation is what is tested. Run: node --test proto/redesign-2026-07/js/state-memo.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
let renders = 0;
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render: () => { renders++; },
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { S, RT, act, memoTick, bumpRev } = await import('./state.js');
const day = await import('./day.js');
RT.userId = 'u-memo';

/* The getters that are wrapped, and the ones deliberately left live. Both lists are pinned so a
   getter cannot quietly join the memo without someone reading this file. */
const MEMOIZED = [
  'athlete', 'planStyle', 'nutritionWeightPct', 'nutritionFormula', 'styleBands', 'trackedSignalLabels',
  'coach', 'coachIdentity', 'trainerIdentity', 'operatorIdentity', 'score', 'tier',
  'activation', 'consent', 'planTargets', 'planTargetsState', 'planGoalLabel', 'planGoal',
  'governingStandard', 'experience', 'audience', 'mealsRequiredCount', 'remainingCount', 'mealDayProgress',
  'dayConsumed', 'reachPlan', 'metCount', 'reqTotal', 'activity', 'passEligibleDays', 'weight', 'recovery',
  'categoryTrends',
];
// Read the clock (Date / minutesNow / this.now, directly or through a helper: components goes
// through projectedDay(minutesNow()), currentSlot through nextOpenSlot()), the DOM, another store
// (SYNC, CD) or a dependant of one of those. They recompute on every read, exactly as before.
const LIVE = [
  'now', 'greeting', 'components', 'currentSlot', 'scoreYesterday', 'streakDays', 'notYetScored', 'dayDecided', 'syncIssue', 'streak',
  'scheduleCatalog', 'breakdown', '_explainOpts', 'explain', 'reach', 'maxPossible', 'possible', 'weightLine',
  'requirements', 'nextMove', 'finish', 'pass', 'exec', 'unreadNotifs', 'logging', 'history', 'streakCalendar',
  'streakWeek', 'progress', 'progressInsight', 'notifications',
];

test('the wrapped and live lists together cover every getter on S', () => {
  const whole = readFileSync(join(HERE, 'state.js'), 'utf8');
  const src = whole.slice(whole.indexOf('export const S = {'));
  const all = Array.from(src.matchAll(/^  get ([A-Za-z_]+)\(\)/gm)).map((m) => m[1]);
  const wrapped = Array.from(src.matchAll(/^  get ([A-Za-z_]+)\(\) \{ return memo\('([A-Za-z_]+)'/gm)).map((m) => m[1]);
  assert.deepEqual(wrapped.sort(), [...MEMOIZED].sort(), 'the memoised set changed; update this test on purpose');
  assert.deepEqual(all.sort(), [...MEMOIZED, ...LIVE].sort(), 'a getter is in neither list');
  for (const m of src.matchAll(/^  get ([A-Za-z_]+)\(\) \{ return memo\('([A-Za-z_]+)'/gm)) assert.equal(m[1], m[2], 'memo key must be the getter name');
});

test('inside a tick a memoised getter is computed once (same object back)', () => {
  memoTick(() => {
    assert.equal(S.weight, S.weight, 'second read in the same tick must be the memoised object');
    assert.equal(S.activity, S.activity);
    assert.equal(S.athlete, S.athlete);
    assert.equal(S.tier, S.tier);
  });
});

test('outside a tick every getter is live, so a direct RT write is seen on the next read', () => {
  assert.notEqual(S.weight, S.weight);
  RT.myCoach = null; RT.myTrainer = null; RT.profile = { name: 'X', baseGoal: 'lose' };
  assert.equal(S.audience, 'client');
  RT.profile = { name: 'X', baseGoal: 'gain' };
  assert.equal(S.audience, 'athlete');
});

test('a live getter is never memoised, even inside a tick', () => {
  memoTick(() => {
    assert.notEqual(S.exec, S.exec, 'exec reads the clock and must recompute on every read');
    assert.notEqual(S.streakWeek, S.streakWeek);
    assert.notEqual(S.components, S.components);
  });
});

test('a day.js mutation inside a tick invalidates: the score moves the moment a meal is logged', () => {
  day.dayResetLocal();
  memoTick(() => {
    const s0 = S.score;
    const w0 = S.weight;
    day.dayLogMeal(RT.userId, 'breakfast', { protein: 40, kcal: 500, carbs: 40, fat: 20 }, null);
    assert.ok(S.score > s0, `score must rise after a logged meal (was ${s0}, now ${S.score})`);
    assert.notEqual(S.weight, w0, 'every memoised entry is dropped, not just the one that changed');
    day.dayLogWeight(RT.userId, 181);
    assert.equal(Number(S.weight.current), 181, 'the weight getter reads the new log');
  });
});

test('a save() inside a tick invalidates: RT changes reach the getters that read them', () => {
  memoTick(() => {
    const c0 = S.coach;
    assert.equal(S.coach, c0);
    act.setHaptics(true);        // save() -> bumpRev()
    assert.notEqual(S.coach, c0);
    const c1 = S.coach;
    bumpRev();
    assert.notEqual(S.coach, c1);
  });
});

test('a new tick never serves the previous tick, and a nested tick shares the outer one', () => {
  const a = memoTick(() => S.weight);
  const b = memoTick(() => S.weight);
  assert.notEqual(a, b);
  memoTick(() => {
    const outer = S.weight;
    memoTick(() => assert.equal(S.weight, outer));
    assert.equal(S.weight, outer, 'the inner tick must not drop the outer memo on exit');
  });
});

test('a throw inside a tick still disarms the memo', () => {
  assert.throws(() => memoTick(() => { S.weight; throw new Error('boom'); }), /boom/);
  assert.notEqual(S.weight, S.weight, 'the memo must be off again after the throw');
});

test('setTheme schedules the coalesced repaint so theme-at-draw-time surfaces redraw', () => {
  const before = renders;
  act.setTheme('light');
  assert.equal(renders, before + 1);
  assert.equal(RT.theme, 'light');
  act.setTheme('dark');
});

test('date words come from fmt-date.js and read exactly as before', () => {
  day.dayResetLocal();
  day.DAY.date = '2026-09-05';
  day.DAY.scoreHistory = [{ date: '2026-09-03', score: 80 }, { date: '2026-09-04', score: 90 }];
  const h = S.history;
  assert.equal(h[0].day, 'Friday');
  assert.equal(h[0].date, 'Sep 4');
  assert.equal(h[1].day, 'Thursday');
  const w = S.streakWeek;
  assert.deepEqual(w.map((d) => d.d), ['Thu', 'Fri', 'Sat']);
});
