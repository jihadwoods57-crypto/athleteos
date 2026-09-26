/* Team challenges: the SQL and the app judge a day the same way (goals and eating plan, D).
 *
 * The fixtures live ONCE, in supabase/tests/lessons_challenges_test.sql between the PARITY
 * FIXTURES markers. That suite asserts every `expect` from 0256's SQL (focus_day_hit, std_day_ctx,
 * protein_target_from); this file asserts the same `expect` from the app's own code (the weekly
 * focus's dayFacts + dayHit, requirements.js stdFromItems, plan-today-model slotOrder, day.js
 * slotDeadline + slotGrace, state.js nutritionConfigForGoal). Same fixtures, same answers, both
 * sides: that is the parity the spec asks for.
 * Run: node --test proto/redesign-2026-07/js/challenge-parity.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

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

const { nutritionConfigForGoal } = await import('./state.js');
const { slotDeadline, slotGrace } = await import('./day.js');
const { stdFromItems, filterItemsByDayType } = await import('./requirements.js');
const { slotOrder } = await import('./plan-today-model.js');
const CM = await import('./challenge-model.js');

const SQL = readFileSync(join(ROOT, 'supabase', 'tests', 'lessons_challenges_test.sql'), 'utf8');
const MIG = readFileSync(join(ROOT, 'supabase', 'migrations', '0256_lessons_challenges.sql'), 'utf8');
const block = SQL.split('-- PARITY FIXTURES BEGIN')[1].split('-- PARITY FIXTURES END')[0];
const FX = JSON.parse(block.split('$fx$')[1]);

/** The weekly focus's context for a fixture's required slots. */
const ctxFor = (required, due, target) => ({
  order: { all: [...required.filter((k) => k !== 'snack'), 'snack'], required },   // slotOrder: snack last
  target,
  deadline: (k) => (due && due[k] != null ? due[k] : 1440),
});

test('the fixtures are there and substantial', () => {
  assert.ok(FX.hits.length >= 30, 'hit fixtures');
  assert.ok(FX.ctx.length >= 8, 'standard fixtures');
  assert.ok(FX.targets.length >= 15, 'target fixtures');
});

test('parity: every day judged exactly as the SQL judges it', () => {
  for (const f of FX.hits) {
    const row = f.meals === null ? null : { date: '2026-09-21', meals: f.meals, checkin: f.checkin };
    const got = CM.challengeDayHit(f.habit, row, ctxFor(f.required, f.due, f.target));
    assert.equal(got, f.expect, f.name);
  }
});

test('parity: the stored standard resolves to the same slots and deadlines', () => {
  for (const f of FX.ctx) {
    const std = stdFromItems(filterItemsByDayType(f.items, f.dayType));
    const order = slotOrder(std);
    const due = Object.fromEntries(order.required.map((k) => [k, slotDeadline(k, std) + slotGrace(k, std)]));
    assert.deepEqual({ required: order.required, due }, f.expect, f.name);
  }
});

test('parity: the protein target is the one the device grades', () => {
  for (const f of FX.targets) {
    // applyGoalToDay: no goal keeps the shipped 180; otherwise the one derivation, then Math.round.
    const t = f.goal ? nutritionConfigForGoal(f.goal, f.bw > 0 ? f.bw : 171, f.targets, null).proteinTarget : 180;
    assert.equal(Math.round(t), f.expect, `${f.goal} ${f.bw} ${JSON.stringify(f.targets)}`);
  }
});

test('the habit titles are the database\'s (the start push quotes them)', () => {
  const body = MIG.split('create or replace function challenge_habit_title')[1].split('$$;')[0];
  const sql = Object.fromEntries([...body.matchAll(/when '([^']+)' then '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(sql, Object.fromEntries(CM.HABITS.map((h) => [h.key, h.title])));
});

test('a habit a day does not have is never a miss', () => {
  const ctx = ctxFor(['breakfast', 'dinner'], {}, 180);
  assert.equal(CM.challengeDayHit('protein:lunch', null, ctx), null);
  assert.equal(CM.challengeDayHit('snack', null, ctx), null);
  assert.equal(CM.challengeDayHit('missed', null, ctx), false);
});

test('on track: the goal, or pace while it runs; only the goal once it is over', () => {
  assert.equal(CM.onTrack({ hits: 5, goal: 5, elapsed: 3, total: 7, over: false }), true);
  assert.equal(CM.onTrack({ hits: 2, goal: 5, elapsed: 2, total: 7, over: false }), true);   // floor(10/7) = 1
  assert.equal(CM.onTrack({ hits: 0, goal: 5, elapsed: 2, total: 7, over: false }), false);
  assert.equal(CM.onTrack({ hits: 0, goal: 5, elapsed: 1, total: 7, over: false }), true);   // floor(5/7) = 0
  assert.equal(CM.onTrack({ hits: 4, goal: 5, elapsed: 7, total: 7, over: true }), false);
  // The SQL holds the same rule.
  assert.match(MIG, /v_hits >= c\.goal_days or \(not v_over and v_hits >= \(c\.goal_days \* v_elapsed\) \/ greatest\(1, v_total\)\)/);
});

test('ranges: this Monday to Sunday by default, 14 days at most, a goal inside the range', () => {
  assert.deepEqual(CM.defaultRange('2026-09-26'), { starts: '2026-09-21', ends: '2026-09-27' });
  assert.equal(CM.rangeError('2026-09-21', '2026-09-27', '2026-09-26'), '');
  assert.match(CM.rangeError('2026-09-21', '2026-10-05', '2026-09-26'), /14 days/);
  assert.match(CM.rangeError('2026-09-27', '2026-09-21', '2026-09-26'), /before the start/);
  assert.match(CM.rangeError('2026-09-01', '2026-09-07', '2026-09-26'), /this week or later/);
  assert.deepEqual(CM.goalBounds('2026-09-21', '2026-09-27'), { min: 1, max: 7, def: 5 });
  assert.deepEqual(CM.goalBounds('2026-09-21', '2026-09-23'), { min: 1, max: 3, def: 3 });
});

test('the athlete side names nobody and draws the server\'s days', () => {
  assert.equal(CM.teamLine({ onTrack: 14, total: 22 }), '14 of 22 on track');
  assert.equal(CM.teamLine({ onTrack: 9, total: 22, over: true }), '9 of 22 made it');
  const states = CM.trackerStates([
    { date: '2026-09-21', hit: true }, { date: '2026-09-22', hit: false }, { date: '2026-09-23', hit: null },
    { date: '2026-09-24', hit: null, na: true }, { date: '2026-09-25', hit: false }, { date: '2026-09-26', hit: null },
  ], '2026-09-25');
  assert.deepEqual(states.map((s) => s.state), ['hit', 'miss', 'unknown', 'na', 'open', 'future']);
  assert.deepEqual(states.map((s) => s.label), ['M', 'T', 'W', 'T', 'F', 'S']);
});

test('Intuitive athletes read the habit without grams', () => {
  for (const h of CM.HABITS) {
    assert.doesNotMatch(CM.habitTitle(h.key, false), /\d|gram|calorie/i, h.key);
    assert.doesNotMatch(CM.habitRule(h.key, false), /\d|gram|calorie/i, h.key);
  }
  assert.equal(CM.habitTitle('protein:breakfast', false), 'A palm of protein at breakfast');
});
