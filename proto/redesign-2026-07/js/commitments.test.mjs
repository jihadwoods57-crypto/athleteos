/* Verified Commitments engine — pure-module tests (node --test).
   Every case here encodes a founder rule, not an implementation detail:
     - the coach's words win over any product default
     - a missed wake-up NEVER cascades into the rest of the day
     - 'unverified' is not 'missed', and 'excused' leaves the denominator entirely
     - a coach-scheduled reminder survives quiet hours (a 4:45 AM roll call must actually fire)
   Timezone is always an explicit argument. The module holds no clock and reads no locale, so
   these assertions are identical on a CI box in UTC and a founder laptop in New York. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPE_LABEL, occursOn, opensMinFor, deriveCommitment, boardCounts, missingFrom,
  WEIGHTS, signalsAsked, accountability, morningReadiness, commitmentStreak,
  commitmentReminders,
} from './commitments.js';

/* America/New_York in July. Passed explicitly everywhere. */
const EDT = -240;

const rollCall = {
  type: 'morning_roll_call', title: 'Morning Roll Call',
  message: 'Everyone up? Ready to rise and conquer?', action_label: null,
  repeat_days: [1, 2, 3, 4, 5], starts_on: '2026-07-01', ends_on: null,
  starts_min: 285, respond_by_min: 315, opens_min: null,
  linked_title: 'Practice', linked_starts_min: 360, asks_arrival: false,
  occurs_on: '2026-07-22',
  starts_at: '2026-07-22T08:45:00Z', respond_by_at: '2026-07-22T09:15:00Z',
  status: 'pending', acknowledged_at: null, arrived_at: null, completed_at: null,
};

/* ---------------------------------------------------------------- recurrence */

test('occursOn honours repeat days and the date range', () => {
  assert.equal(occursOn(rollCall, '2026-07-22'), true);   // Wednesday
  assert.equal(occursOn(rollCall, '2026-07-25'), false);  // Saturday
  assert.equal(occursOn({ ...rollCall, starts_on: '2026-08-01' }, '2026-07-22'), false);
  assert.equal(occursOn({ ...rollCall, ends_on: '2026-07-01' }, '2026-07-22'), false);
  assert.equal(occursOn({ ...rollCall, repeat_days: [] }, '2026-07-22'), false);
});

test('opensMinFor falls back to respond-by minus an hour, floored at midnight', () => {
  assert.equal(opensMinFor(rollCall), 255);
  assert.equal(opensMinFor({ ...rollCall, opens_min: 240 }), 240);
  assert.equal(opensMinFor({ ...rollCall, respond_by_min: 30 }), 0);       // never wraps to yesterday
  assert.equal(opensMinFor({ ...rollCall, respond_by_min: null, starts_min: 600 }), 540);
});

/* ---------------------------------------------------------------- stages */

test('an untouched roll call inside its window is actionable', () => {
  const d = deriveCommitment(rollCall, '2026-07-22T08:50:00Z', EDT);
  assert.equal(d.stage, 'open');
  assert.equal(d.canAck, true);
  assert.equal(d.visible, true);
  assert.equal(d.collapsed, false);
  assert.equal(d.actionLabel, 'I’m Up');              // render-time default; never persisted
  assert.equal(d.title, 'Morning Roll Call');
  assert.equal(d.contextLine, 'Practice at 6:00 AM');
  assert.equal(d.deadlineLine, 'Respond by 5:15 AM');
});

test('the card stays hidden before it opens', () => {
  const d = deriveCommitment(rollCall, '2026-07-22T07:30:00Z', EDT); // 3:30 AM, opens 4:15
  assert.equal(d.stage, 'hidden');
  assert.equal(d.visible, false);
});

test('the coach action label and title win over the product defaults', () => {
  const d = deriveCommitment(
    { ...rollCall, action_label: 'Rise Up', title: '5 AM Club' }, '2026-07-22T08:50:00Z', EDT);
  assert.equal(d.actionLabel, 'Rise Up');
  assert.equal(d.title, '5 AM Club');
});

test('a commitment with no title falls back to its type label, never to an empty header', () => {
  const d = deriveCommitment({ ...rollCall, title: '' }, '2026-07-22T08:50:00Z', EDT);
  assert.equal(d.title, 'Morning Roll Call');
});

test('an acknowledged roll call collapses to a confirmation with the exact time', () => {
  const d = deriveCommitment(
    { ...rollCall, status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' },
    '2026-07-22T08:52:00Z', EDT);
  assert.equal(d.stage, 'acknowledged');
  assert.equal(d.collapsed, true);
  assert.equal(d.canAck, false);
  assert.equal(d.confirmLine, 'Checked in at 4:48 AM');
});

test('past the deadline with no response reads missed, and the card stops asking', () => {
  const d = deriveCommitment(rollCall, '2026-07-22T09:30:00Z', EDT);
  assert.equal(d.stage, 'missed');
  assert.equal(d.canAck, false);
});

test('an unverified response is never rendered as missed', () => {
  const d = deriveCommitment(
    { ...rollCall, status: 'unverified', unverified_reason: 'Location permission off' },
    '2026-07-22T09:30:00Z', EDT);
  assert.equal(d.stage, 'unverified');
  assert.equal(d.canDispute, true);
  assert.match(d.confirmLine, /Couldn’t verify/);
});

test('an excused response is never rendered as missed', () => {
  const d = deriveCommitment(
    { ...rollCall, status: 'excused', excused_reason: 'Family travel' },
    '2026-07-22T09:30:00Z', EDT);
  assert.equal(d.stage, 'excused');
  assert.equal(d.canAck, false);
});

test('a commitment with a location walks acknowledged → arrived → completed', () => {
  const base = { ...rollCall, type: 'strength', title: 'Lift', asks_arrival: true,
                 arrive_by_at: '2026-07-22T09:50:00Z', min_dwell_min: 45 };
  const ack = deriveCommitment(
    { ...base, status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' },
    '2026-07-22T09:20:00Z', EDT);
  assert.equal(ack.stage, 'awaiting_arrival');
  assert.equal(ack.canArrive, true);

  const arrived = deriveCommitment(
    { ...base, status: 'arrived', acknowledged_at: '2026-07-22T08:48:00Z',
      arrived_at: '2026-07-22T09:43:00Z', arrival_source: 'geofence' },
    '2026-07-22T10:00:00Z', EDT);
  assert.equal(arrived.stage, 'arrived');
  assert.equal(arrived.canComplete, true);
  assert.equal(arrived.confirmLine, 'Arrived at the facility at 5:43 AM');

  const done = deriveCommitment(
    { ...base, status: 'completed', acknowledged_at: '2026-07-22T08:48:00Z',
      arrived_at: '2026-07-22T09:43:00Z', completed_at: '2026-07-22T11:05:00Z' },
    '2026-07-22T11:30:00Z', EDT);
  assert.equal(done.stage, 'completed');
  assert.equal(done.canComplete, false);
  assert.equal(done.confirmLine, 'Completed at 7:05 AM');
});

test('the stage strip reports the three stages a commitment actually asks for', () => {
  const d = deriveCommitment({ ...rollCall, asks_arrival: true, type: 'practice' },
    '2026-07-22T08:50:00Z', EDT);
  assert.deepEqual(d.stages.map(s => s.key), ['acknowledged', 'arrived', 'completed']);
  const rc = deriveCommitment(rollCall, '2026-07-22T08:50:00Z', EDT);
  assert.deepEqual(rc.stages.map(s => s.key), ['acknowledged']);
});

test('a cancelled instance disappears rather than reading as missed', () => {
  const d = deriveCommitment({ ...rollCall, instance_status: 'cancelled' },
    '2026-07-22T09:30:00Z', EDT);
  assert.equal(d.visible, false);
  assert.equal(d.stage, 'hidden');
});

/* ---------------------------------------------------------------- board */

test('board counts split responded, awaiting, excused and unverified', () => {
  const rows = [
    { status: 'acknowledged' }, { status: 'arrived' }, { status: 'completed' },
    { status: 'pending' }, { status: 'pending' },
    { status: 'excused' }, { status: 'unverified' },
  ];
  assert.deepEqual(boardCounts(rows),
    { total: 7, responded: 3, awaiting: 2, excused: 1, unverified: 1 });
  assert.equal(missingFrom(rows).length, 2);
  assert.deepEqual(boardCounts([]), { total: 0, responded: 0, awaiting: 0, excused: 0, unverified: 0 });
});

test('every commitment type has a label', () => {
  for (const t of ['morning_roll_call', 'practice', 'strength', 'speed', 'team_meeting',
                   'study_hall', 'tutoring', 'class', 'rehab', 'nutrition']) {
    assert.equal(typeof TYPE_LABEL[t], 'string');
    assert.ok(TYPE_LABEL[t].length > 0);
  }
});

/* ---------------------------------------------------------------- scoring */

const inst = (o) => ({
  type: 'practice', respond_by_min: 315, asks_arrival: true,
  arrive_by_at: '2026-07-22T09:50:00Z', status: 'pending',
  acknowledged_at: null, arrived_at: null, completed_at: null, occurs_on: '2026-07-22', ...o,
});

test('weights are small / moderate / greatest', () => {
  assert.equal(WEIGHTS.ack, 10);
  assert.equal(WEIGHTS.arrival, 30);
  assert.equal(WEIGHTS.completion, 60);
});

test('a roll call asks for a response but never for completion', () => {
  assert.deepEqual(signalsAsked(inst({ type: 'morning_roll_call', asks_arrival: false })),
    { ack: true, arrival: false, completion: false });
});

test('a commitment with no location does not ask for arrival', () => {
  assert.deepEqual(signalsAsked(inst({ asks_arrival: false })),
    { ack: true, arrival: false, completion: true });
});

test('a commitment with no respond-by does not ask for a wake response', () => {
  assert.deepEqual(signalsAsked(inst({ respond_by_min: null, asks_arrival: false })),
    { ack: false, arrival: false, completion: true });
});

test('a perfect commitment scores 100 percent', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z', arrived_at: '2026-07-22T09:43:00Z',
    completed_at: '2026-07-22T11:05:00Z', status: 'completed' })]);
  assert.equal(r.earned, 100);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 100);
});

test('a missed wake-up does not cascade — arriving and finishing keeps 90', () => {
  const r = accountability([inst({
    acknowledged_at: null, arrived_at: '2026-07-22T09:43:00Z',
    completed_at: '2026-07-22T11:05:00Z', status: 'completed' })]);
  assert.equal(r.earned, 90);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 90);
});

test('arriving after the arrival deadline earns nothing for arrival', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z',
    arrived_at: '2026-07-22T10:30:00Z', status: 'arrived' })]);
  assert.equal(r.earned, 10);
  assert.equal(r.possible, 100);
});

test('excused leaves the denominator entirely', () => {
  const r = accountability([
    inst({ status: 'excused' }),
    inst({ acknowledged_at: '2026-07-22T08:48:00Z', arrived_at: '2026-07-22T09:43:00Z',
           completed_at: '2026-07-22T11:05:00Z', status: 'completed' }),
  ]);
  assert.equal(r.possible, 100);
  assert.equal(r.pct, 100);
});

test('unverified removes only the signals it could not verify', () => {
  const r = accountability([inst({
    acknowledged_at: '2026-07-22T08:48:00Z', status: 'unverified' })]);
  assert.equal(r.possible, 10);
  assert.equal(r.earned, 10);
  assert.equal(r.pct, 100);
});

test('an empty range reports null rather than a fake zero', () => {
  assert.equal(accountability([]).pct, null);
  assert.equal(accountability(null).pct, null);
});

test('morning readiness reports the three lines the coach reads', () => {
  const rows = [
    inst({ acknowledged_at: '2026-07-22T08:48:00Z', arrived_at: '2026-07-22T09:43:00Z',
           completed_at: '2026-07-22T11:05:00Z', status: 'completed' }),
    inst({ acknowledged_at: null, arrived_at: '2026-07-22T09:43:00Z',
           completed_at: '2026-07-22T11:05:00Z', status: 'completed' }),
  ];
  const m = morningReadiness(rows);
  assert.deepEqual(m.wake, { done: 1, total: 2 });
  assert.deepEqual(m.arrival, { done: 2, total: 2 });
  assert.deepEqual(m.completion, { done: 2, total: 2 });
  assert.equal(m.pct, 95); // 190 earned / 200 possible
});

test('the streak counts clean days, skips empty days, and breaks on a real miss', () => {
  const clean = (d) => inst({ occurs_on: d, asks_arrival: false, type: 'morning_roll_call',
                              acknowledged_at: d + 'T08:48:00Z', status: 'acknowledged' });
  const miss  = (d) => inst({ occurs_on: d, asks_arrival: false, type: 'morning_roll_call',
                              acknowledged_at: null, status: 'missed' });
  // 2026-07-19 is a Sunday with no commitments — an empty day must not break the streak.
  assert.equal(commitmentStreak(
    [clean('2026-07-22'), clean('2026-07-21'), clean('2026-07-20'), clean('2026-07-18')],
    '2026-07-22'), 4);
  assert.equal(commitmentStreak([clean('2026-07-22'), miss('2026-07-21')], '2026-07-22'), 1);
  assert.equal(commitmentStreak([miss('2026-07-22')], '2026-07-22'), 0);
  assert.equal(commitmentStreak([], '2026-07-22'), 0);
});

test('an excused day still counts as clean for the streak', () => {
  const rows = [inst({ occurs_on: '2026-07-22', status: 'excused', asks_arrival: false,
                       type: 'morning_roll_call' })];
  assert.equal(commitmentStreak(rows, '2026-07-22'), 1);
});

/* ---------------------------------------------------------------- reminders */

test('a coach-scheduled reminder survives quiet hours and ignores the daily cap', () => {
  const entries = commitmentReminders(
    [{ instance_id: 'i1', title: 'Morning Roll Call', respond_by_min: 315,
       reminder_offsets_min: [15, 5], status: 'pending', occurs_on: '2026-07-22' }],
    '2026-07-22');
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.stage === 'commitment' && e.exemptFromCap === true));
  assert.deepEqual(entries.map(e => e.at).sort((a, b) => a - b), [300, 310]);
  assert.equal(entries[0].title, 'Morning Roll Call');
});

test('an already-acknowledged commitment schedules nothing', () => {
  assert.equal(commitmentReminders(
    [{ instance_id: 'i1', respond_by_min: 315, reminder_offsets_min: [15],
       status: 'acknowledged', occurs_on: '2026-07-22' }], '2026-07-22').length, 0);
});

test('reminders anchor on the start time when there is no respond-by', () => {
  const e = commitmentReminders(
    [{ instance_id: 'i2', title: 'Study Hall', starts_min: 1080, respond_by_min: null,
       reminder_offsets_min: [30], status: 'pending', occurs_on: '2026-07-22' }], '2026-07-22');
  assert.equal(e.length, 1);
  assert.equal(e[0].at, 1050);
});

test('reminders are only planned for the day being planned', () => {
  assert.equal(commitmentReminders(
    [{ instance_id: 'i3', respond_by_min: 315, reminder_offsets_min: [15],
       status: 'pending', occurs_on: '2026-07-21' }], '2026-07-22').length, 0);
});
