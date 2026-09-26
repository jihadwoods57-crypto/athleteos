/* The athlete's own weight reaches athlete_profiles.base_weight (goals and eating plan, D review).
 *
 * Measured on prod 2026-09-26: 30 of 30 athletes with a goal had NO base_weight, because the
 * current onboarding (ob2) never asks for one, so the server's challenge targets fell back to the
 * 171 lb stand-in. The device now saves the weight it holds (the onboarding answer or the latest
 * weigh-in) ONCE, through the 0181 set_my_base_weight door, only when the server confirms none is
 * stored, only for the athlete's own account, never for a minor still waiting on consent.
 * Run: node --test proto/redesign-2026-07/js/weight-backfill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const { RT } = await import('./state.js');
const { DAY } = await import('./day.js');
const WB = await import('./weight-backfill.js');

function stub(meta) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'athlete_plan_meta') return typeof meta === 'function' ? meta() : meta;
      if (name === 'set_my_base_weight') return { data: null, error: null };
      return { data: null, error: { message: 'no stub' } };
    },
  };
}
function athlete(id) {
  mem.clear();
  RT.userId = id; RT.authRole = 'athlete';
  RT.profile = { baseGoal: 'gain' }; RT.ob = null; RT.consent = null;
  DAY.currentWeight = null; DAY.lastWeight = null;
}

test('the device weight the athlete holds, in order: onboarding, today, the latest weigh-in', () => {
  athlete('wb-0');
  assert.equal(WB.deviceWeight(), null);
  DAY.lastWeight = { date: '2026-09-20', weight: 203.6 };
  assert.equal(WB.deviceWeight(), 203.6);
  DAY.currentWeight = 204;
  assert.equal(WB.deviceWeight(), 204);
  RT.ob = { currentWeight: 199 };
  assert.equal(WB.deviceWeight(), 199);
});

test('no stored weight on the server and one on the device: saved once through set_my_base_weight', async () => {
  athlete('wb-1');
  DAY.lastWeight = { date: '2026-09-20', weight: 203.6 };
  const sb = stub({ data: [{ base_weight: null, targets: null }], error: null });
  assert.equal(await WB.backfillBaseWeight(sb), true);
  assert.deepEqual(sb.calls.map((c) => c.name), ['athlete_plan_meta', 'set_my_base_weight']);
  assert.deepEqual(sb.calls[0].args, { athlete: 'wb-1' }, 'only ever the athlete\'s own row');
  assert.deepEqual(sb.calls[1].args, { w: 204 });
  assert.equal(RT.profile.baseWeight, 204, 'the device grades with it straight away');
  assert.equal(await WB.backfillBaseWeight(sb), false, 'once');
  assert.equal(sb.calls.length, 2);
});

test('a stored weight is never overwritten, and a failed read writes nothing', async () => {
  athlete('wb-2');
  DAY.lastWeight = { date: '2026-09-20', weight: 190 };
  const has = stub({ data: [{ base_weight: 185, targets: null }], error: null });
  assert.equal(await WB.backfillBaseWeight(has), false);
  assert.deepEqual(has.calls.map((c) => c.name), ['athlete_plan_meta']);
  athlete('wb-3');
  DAY.lastWeight = { date: '2026-09-20', weight: 190 };
  const failed = stub({ data: null, error: { message: 'offline' } });
  assert.equal(await WB.backfillBaseWeight(failed), false);
  assert.deepEqual(failed.calls.map((c) => c.name), ['athlete_plan_meta']);
});

test('nothing to save, a staff account, or a minor waiting on consent: no write at all', async () => {
  athlete('wb-4');
  const none = stub({ data: [{ base_weight: null }], error: null });
  assert.equal(await WB.backfillBaseWeight(none), false);
  assert.equal(none.calls.length, 0, 'no device weight, no read either');
  athlete('wb-5');
  RT.authRole = 'coach';
  DAY.lastWeight = { date: '2026-09-20', weight: 190 };
  const coach = stub({ data: [{ base_weight: null }], error: null });
  assert.equal(await WB.backfillBaseWeight(coach), false);
  assert.equal(coach.calls.length, 0);
  athlete('wb-6');
  RT.consent = { status: 'pending' };
  RT.profile = { baseGoal: 'gain', dob: '2011-03-02' };
  DAY.lastWeight = { date: '2026-09-20', weight: 150 };
  const minor = stub({ data: [{ base_weight: null }], error: null });
  assert.equal(await WB.backfillBaseWeight(minor), false);
  assert.equal(minor.calls.length, 0, 'the same rule that blocks their day sync');
});

test('the athlete\'s day load runs it, lazily, and the device reads the latest weigh-in for its target', () => {
  const state = readFileSync(new URL('./state.js', import.meta.url), 'utf8');
  assert.match(state, /import\('\.\/weight-backfill\.js'\)\.then\(\(m\) => m\.backfillBaseWeight\(\)\)/);
  assert.match(state, /DAY\.lastWeight && DAY\.lastWeight\.weight/);
  const day = readFileSync(new URL('./day.js', import.meta.url), 'utf8');
  assert.match(day, /fetchWeightSeries\(sb, userId, WEIGHT_DAYS\)/, 'the weigh-ins are read over the same 90 days the server uses');
});
