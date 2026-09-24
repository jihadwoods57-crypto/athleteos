// Coach OS statuses — deterministic, precedence-ordered (spec §Roster statuses).
// @ts-ignore
import { athleteStatus, STATUS_META } from '../../proto/redesign-2026-07/js/status.js';
// @ts-ignore
import { groupPulse } from '../../proto/redesign-2026-07/js/team-count.js';

const req = (id: string, open: number, due: number) => ({ id, title: id, required: true, proof: 'photo', window: { open, due } });
const REQS = [req('breakfast', 420, 570), req('lunch', 720, 840), req('dinner', 1080, 1230)];
const row = (over: object = {}) => ({
  athleteId: 'a1', name: 'Devin', score: null, loggedToday: false,
  tasks: [], meals: {}, lastMealAt: null, scoreHistory: [], ...over,
});
  // `meals` is the slot map days.meals carries and buildRosterRow now puts on every roster row.
  // An empty map is the honest "logged something, no meal slots done" shape these window tests
  // want: status.js will not call an item overdue on a LOGGED day it has no way to judge, so a
  // row without this reads as unjudgeable rather than as a miss (see js/false-miss.test.mjs).

test('excused wins over everything', () => {
  const s = athleteStatus({ nowMin: 900, row: row(), reqs: REQS, excused: true });
  expect(s.key).toBe('excused');
});
test('overdue: a required item past due and not done', () => {
  const s = athleteStatus({ nowMin: 900, row: row({ loggedToday: true, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('overdue');
  expect(s.detail).toMatch(/lunch/i);
});
test('due soon: within 60 min of an open required item', () => {
  const s = athleteStatus({ nowMin: 800, row: row({ loggedToday: true, score: 85, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('due_soon');
});
test('under 80 with windows still open: in progress, no verdict and no number (the athlete rule)', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 55, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('in_progress');
  expect(s.detail).not.toMatch(/\d/);
});
test('below standard: every window settled, score < 80', () => {
  const all = [{ id: 'breakfast', done: true }, { id: 'lunch', done: true }, { id: 'dinner', done: true }];
  const s = athleteStatus({ nowMin: 1300, row: row({ loggedToday: true, score: 55, tasks: all }), reqs: REQS, excused: false });
  expect(s.key).toBe('below_standard');
  expect(s.detail).toBe('Scored 55 today');
});
// Overdue outranks no_activity by design — nowMin 500 keeps every item merely 'ready'.
test('no activity: nothing today and no meal inside 24h', () => {
  const s = athleteStatus({ nowMin: 500, row: row(), reqs: REQS, excused: false });
  expect(s.key).toBe('no_activity');
});
test('on standard', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 92, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('on_standard');
});
test('groupPulse: average, and a delta only once today is settled', () => {
  const e = (athleteId: string, score: number, yesterdayScore: number, meals: object, nowMin: number) => ({
    row: row({ athleteId, score, yesterdayScore, loggedToday: true, meals }), status: { key: 'on_standard' }, reqs: REQS, nowMin,
  });
  const all = { breakfast: true, lunch: true, dinner: true };
  // 9 PM: every window has closed, so today is finished and compares with yesterday.
  const late = groupPulse([e('a1', 90, 80, all, 1260), e('a2', 50, 70, { breakfast: true, lunch: true }, 1260)]);
  expect(late.avg).toBe(70);
  expect(late.delta).toBe(-5);   // (80+70)/2=75 yesterday → 70 today
  // 12:30 PM: dinner has not opened yet, so there is no delta, only yesterday's final.
  const noon = groupPulse([e('a1', 57, 85, { breakfast: true, lunch: true }, 750)]);
  expect(noon.avg).toBe(57);
  expect(noon.delta).toBeNull();
  expect(noon.yesterday).toBe(85);
});
test('every status key has display meta', () => {
  for (const k of ['excused', 'overdue', 'needs_review', 'below_standard', 'due_soon', 'no_activity', 'in_progress', 'on_standard']) {
    expect(STATUS_META[k].label).toBeTruthy();
  }
});
test('needs_review flag outranks below_standard but not overdue', () => {
  const below = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 55, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false, needsReview: true });
  expect(below.key).toBe('needs_review');
  const over = athleteStatus({ nowMin: 900, row: row({ loggedToday: true, tasks: [{ id: 'breakfast', done: true }, { id: 'lunch', done: false }] }), reqs: REQS, excused: false, needsReview: true });
  expect(over.key).toBe('overdue');
});
test('logged but unscored never claims on_standard', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: null, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('needs_review');
  expect(s.detail).toMatch(/pending/i);
});
test('no-activity staleness comes from nowMs, purely', () => {
  const base = { nowMin: 500, row: row({ lastMealAt: '2026-07-15T12:00:00Z' }), reqs: REQS, excused: false };
  const fresh = athleteStatus({ ...base, nowMs: new Date('2026-07-15T20:00:00Z').getTime() });
  expect(fresh.detail).toBe('Nothing logged yet today');   // 8h old — not the stale 'No activity in the last day'
  const stale = athleteStatus({ ...base, nowMs: new Date('2026-07-17T12:00:00Z').getTime() });
  expect(stale.key).toBe('no_activity');       // 48h old
  expect(stale.detail).toBe('No activity in the last day');
  const unknown = athleteStatus({ ...base });   // no nowMs → age unknown → never invented
  expect(unknown.detail).toBe('Nothing logged yet today');
});
test('openItems carries id/title/dueMin/state and nowMin===due is due_soon not overdue', () => {
  const s = athleteStatus({ nowMin: 570, row: row({ loggedToday: true, score: 90 }), reqs: REQS, excused: false });
  const b = s.openItems.find(i => i.id === 'breakfast')!;
  expect(b).toEqual({ id: 'breakfast', title: 'breakfast', dueMin: 570, state: 'due_soon' });
});
