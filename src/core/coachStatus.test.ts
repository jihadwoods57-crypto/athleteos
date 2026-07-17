// Coach OS statuses — deterministic, precedence-ordered (spec §Roster statuses).
// @ts-ignore
import { athleteStatus, teamPulse, STATUS_META } from '../../proto/redesign-2026-07/js/status.js';

const req = (id: string, open: number, due: number) => ({ id, title: id, required: true, proof: 'photo', window: { open, due } });
const REQS = [req('breakfast', 420, 570), req('lunch', 720, 840), req('dinner', 1080, 1230)];
const row = (over: object = {}) => ({
  athleteId: 'a1', name: 'Devin', score: null, loggedToday: false,
  tasks: [], lastMealAt: null, scoreHistory: [], ...over,
});

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
test('below standard: everything logged on time but score < 80', () => {
  const s = athleteStatus({ nowMin: 700, row: row({ loggedToday: true, score: 55, tasks: [{ id: 'breakfast', done: true }] }), reqs: REQS, excused: false });
  expect(s.key).toBe('below_standard');
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
test('teamPulse: counts + completion + delta from history', () => {
  const rows = [
    row({ athleteId: 'a1', score: 90, loggedToday: true, scoreHistory: [{ date: '2026-07-15', score: 80 }, { date: '2026-07-16', score: 90 }], tasks: [{ id: 'breakfast', done: true }] }),
    row({ athleteId: 'a2', score: 50, loggedToday: true, scoreHistory: [{ date: '2026-07-15', score: 70 }, { date: '2026-07-16', score: 50 }], tasks: [{ id: 'breakfast', done: false }] }),
  ];
  const statuses = { a1: { key: 'on_standard' }, a2: { key: 'overdue' } };
  const p = teamPulse(rows, statuses, '2026-07-16');
  expect(p.avg).toBe(70);
  expect(p.deltaVsYesterday).toBe(-5);   // (80+70)/2=75 yesterday → 70 today
  expect(p.onStandard).toBe(1);
  expect(p.overdue).toBe(1);
  expect(p.completionPct).toBe(50);      // 1 of 2 tasks done
});
test('every status key has display meta', () => {
  for (const k of ['excused', 'overdue', 'needs_review', 'below_standard', 'due_soon', 'no_activity', 'on_standard']) {
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
