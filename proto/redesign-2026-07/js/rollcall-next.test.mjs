/* The athlete's next roll call. Run: node --test proto/redesign-2026-07/js/rollcall-next.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingWakeups, nextWakeup, alarmLine, whenLabel, daysLabel, assignedModel, nextCardHtml } from './rollcall-next.js';

const NOW = new Date(2026, 8, 24, 20, 0).getTime();          // Thu 24 Sep 2026, 8:00 PM, phone clock
const at = (d, h, m) => new Date(2026, 8, d, h, m).toISOString();
const row = (o = {}) => ({ type: 'morning_roll_call', instance_id: 'aaaaaaaa-0000-0000-0000-000000000001', commitment_id: 'c1',
  title: 'Morning Roll Call', coach_name: 'Coach Brooks', message: 'Up and at it.', starts_at: at(25, 4, 45),
  status: 'pending', instance_status: 'scheduled', alarm: true, ...o });

test('upcoming wake-ups: ahead, on, not excused, not answered, deduped, soonest first', () => {
  const rows = [row({ instance_id: 'b', starts_at: at(28, 4, 45) }), row(), row(),
    row({ instance_id: 'c', instance_status: 'cancelled' }), row({ instance_id: 'd', status: 'excused' }),
    row({ instance_id: 'e', starts_at: at(24, 4, 45) }), row({ instance_id: 'f', type: 'practice' })];
  assert.deepEqual(upcomingWakeups(rows, NOW).map((r) => r.instance_id), ['aaaaaaaa-0000-0000-0000-000000000001', 'b']);
  assert.equal(nextWakeup([], NOW), null);
});

test('alarmLine: the truth about THIS phone and THIS morning', () => {
  const r = row();
  assert.equal(alarmLine(null, r), null, 'no bridge (web preview): say nothing');
  assert.deepEqual(alarmLine({ supported: true, authorization: 'authorized', armed: 1, ids: ['AAAAAAAA-0000-0000-0000-000000000001'.toLowerCase()] }, r),
    { kind: 'set', text: 'Alarm set ✓', fix: null });
  assert.deepEqual(alarmLine({ supported: true, authorization: 'authorized', armed: 1, ids: ['other'] }, r),
    { kind: 'sync', text: 'Alarm not set · Tap to fix', fix: 'sync' });
  assert.equal(alarmLine({ supported: true, authorization: 'notDetermined', armed: 0, ids: [] }, r).fix, 'ask');
  assert.equal(alarmLine({ supported: true, authorization: 'denied', armed: 0, ids: [] }, r).fix, 'settings');
  assert.equal(alarmLine({ supported: false }, r).kind, 'unsupported');
  assert.equal(alarmLine({ supported: true, authorization: 'authorized', ids: [] }, row({ alarm: false })).kind, 'coach_off');
  assert.equal(alarmLine({ supported: true, authorization: 'authorized', armed: 1 }, r).kind, 'set', 'an older shell without ids falls back to the count');
});

test('whenLabel reads Tomorrow, then weekday names', () => {
  assert.equal(whenLabel(row(), NOW), 'Tomorrow · 4:45 AM');
  assert.equal(whenLabel(row({ starts_at: at(28, 4, 45) }), NOW), 'Mon · 4:45 AM');
});

test('daysLabel says the week the way a coach does', () => {
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(daysLabel([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(daysLabel([]), '');
});

test('assignedModel: one roll call, its next mornings, its words', () => {
  const rows = [row(), row({ instance_id: 'b', starts_at: at(28, 4, 45) }), row({ instance_id: 'z', commitment_id: 'c2' })];
  const m = assignedModel(rows, 'c1', NOW);
  assert.equal(m.title, 'Morning Roll Call');
  assert.equal(m.coach, 'Coach Brooks');
  assert.equal(m.upcoming.length, 2);
  assert.equal(m.days, 'Mon, Fri');
  assert.equal(assignedModel(rows, 'nope', NOW), null);
});

test('the Home card: route, message, the alarm pill, no em dash', () => {
  const set = nextCardHtml(row(), { kind: 'set', text: 'Alarm set ✓', fix: null }, NOW);
  assert.match(set, /data-go="rollcall-assigned\/c1"/);
  assert.match(set, /Tomorrow · 4:45 AM/);
  assert.match(set, /Up and at it\./);
  assert.match(set, /status-pill g">Alarm set ✓/);
  assert.doesNotMatch(set, /data-rn-fix/);
  const fix = nextCardHtml(row(), { kind: 'ask', text: 'Alarm not set · Tap to fix', fix: 'ask' }, NOW);
  assert.match(fix, /<button[^>]*data-rn-fix="ask"[^>]*>Alarm not set · Tap to fix</);
  assert.doesNotMatch(set + fix, /—/);
  assert.equal(nextCardHtml(null, null, NOW), '');
});
