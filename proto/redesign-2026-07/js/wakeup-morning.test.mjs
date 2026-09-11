/* The morning, reduced to the numbers every wake-up surface reads.
 *
 * This is the spine of the wake-up release: the coach summary, the squad list and the athlete's
 * streak all read it, so a bug here makes two screens disagree about the same morning in front of
 * a coach. Every rule it encodes is one the server or an existing module already applies, and the
 * tests exist to stop the client quietly inventing a second version of any of them.
 * Run: node --test proto/redesign-2026-07/js/wakeup-morning.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { morningSummary, morningStreak, wakeClock, WAKEUP_TYPE } from './wakeup-morning.js';

const row = (name, verdict, at, lateMin = 0) => ({
  response_id: `r-${name}`, athlete_id: `a-${name}`, name,
  status: verdict === 'missed' ? 'pending' : 'acknowledged',
  acknowledged_at: at, verdict, late_min: lateMin,
});
const inst = (rows) => ({
  instance_id: 'i1', type: WAKEUP_TYPE, title: 'Team wake-up', occurs_on: '2026-09-11',
  coach_name: 'Priya Nair', rows,
});

test('it counts every verdict and leaves excused out of the total', () => {
  const s = morningSummary(inst([
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
    row('Tyler', 'late', '2026-09-11T10:09:00Z', 24),
    row('Marcus', 'missed', null),
    row('Sam', 'excused', null),
  ]));
  assert.equal(s.onTime, 2);
  assert.equal(s.late, 1);
  assert.equal(s.missed, 1);
  // excused leaves the denominator entirely, the same rule commitments.js accountability() uses
  assert.equal(s.excused, 1);
  assert.equal(s.total, 4);
});

test('first up is the earliest answer, and only an on-time one counts', () => {
  const s = morningSummary(inst([
    row('Tyler', 'late', '2026-09-11T09:40:00Z', 20),
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
  ]));
  assert.equal(s.firstUp.name, 'Devon', 'a late answer is not first up however early it landed');
});

test('needs-you is missed before late, and never contains anyone who was up on time', () => {
  const s = morningSummary(inst([
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
    row('Tyler', 'late', '2026-09-11T10:09:00Z', 24),
    row('Marcus', 'missed', null),
    row('Jordan', 'late', '2026-09-11T09:58:00Z', 13),
  ]));
  assert.deepEqual(s.needsYou.map((r) => r.name), ['Marcus', 'Tyler', 'Jordan'],
    'missed first, then the latest answer down to the earliest');
  assert.ok(!s.needsYou.some((r) => r.name === 'Devon'));
});

test('up rows are in the order they answered', () => {
  const s = morningSummary(inst([
    row('Amare', 'on_standard', '2026-09-11T09:45:00Z'),
    row('Devon', 'on_standard', '2026-09-11T09:44:00Z'),
  ]));
  assert.deepEqual(s.upRows.map((r) => r.name), ['Devon', 'Amare']);
});

test('an empty or missing instance is zeroes, never a crash', () => {
  for (const bad of [null, undefined, {}, { rows: null }, { rows: 'nope' }]) {
    const s = morningSummary(bad);
    assert.equal(s.total, 0);
    assert.equal(s.firstUp, null);
    assert.deepEqual(s.needsYou, []);
    assert.deepEqual(s.upRows, []);
  }
});

test('a row with no verdict is pending, not silently counted as up', () => {
  const s = morningSummary(inst([{ athlete_id: 'a1', name: 'Nobody' }]));
  assert.equal(s.onTime, 0);
  assert.equal(s.pending, 1);
  assert.equal(s.total, 1);
});

test('the streak counts consecutive answered mornings back from the most recent', () => {
  // newest first, which is the order the loader builds and scoreHistory already uses
  assert.equal(morningStreak([true, true, true, false, true]), 3);
  assert.equal(morningStreak([false, true, true]), 0, 'a missed today ends it at zero');
  assert.equal(morningStreak([true, false, false]), 1);
  assert.equal(morningStreak([]), 0);
  assert.equal(morningStreak(null), 0);
});

test('the clock is one helper, so no two surfaces format a wake time differently', () => {
  assert.equal(wakeClock(346), '5:46');
  assert.equal(wakeClock(0), '12:00');
  assert.equal(wakeClock(720), '12:00');
  assert.equal(wakeClock(null), '');
});
