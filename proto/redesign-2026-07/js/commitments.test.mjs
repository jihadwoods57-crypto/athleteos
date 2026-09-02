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
  commitmentReminders, zoneOffsetMin, presenceOf, PRESENCE,
  VERDICT, rollcallVerdict, lateMinutes, verdictLine, closesAtOf, opensAtOf, graceMinOf,
  boardVerdicts, groupByVerdict, verdictCounts, wakeupHistory, wakeupSummary, summarizeOccurrences,
  wakeupPhase, SOURCE, sourceOf, isUnderReview, ROLLCALL_CLOSE_AFTER_MIN,
} from './commitments.js';

/* A realistic wake-up: 6:00 AM America/New_York on a July weekday (EDT, UTC-4), 5-minute grace,
   default close 30 minutes after the wake-up. Used by every boundary test below. */
const wake = {
  type: 'morning_roll_call', title: 'Wake-Up Roll Call',
  message: 'Everyone up and ready to go?', action_label: null, coach_name: "Coach D'Onofrio",
  repeat_days: [1, 2, 3, 4, 5], starts_on: '2026-07-01', ends_on: null,
  starts_min: 360, respond_by_min: 365, opens_min: 360, ends_min: null, timezone: 'America/New_York',
  occurs_on: '2026-07-22',
  starts_at: '2026-07-22T10:00:00Z', respond_by_at: '2026-07-22T10:05:00Z',
  status: 'pending', acknowledged_at: null, arrived_at: null, completed_at: null,
};
const NY = (hms) => `2026-07-22T${hms}Z`; // wall clock 6:xx AM EDT == 10:xx Z

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

test('past the grace but before the close, the card still asks, relabelled as late (0212)', () => {
  const d = deriveCommitment(wake, NY('10:11:00'), EDT);
  assert.equal(d.stage, 'late_open');
  assert.equal(d.canAck, true);
  assert.equal(d.actionLabel, 'Check in now');
  assert.equal(d.verdict, 'pending');          // unanswered and still open: not yet a miss
  assert.equal(d.confirmLine, 'No response by 6:05 AM');
});

test('past the close with no response reads missed, and the card stops asking', () => {
  // Wake-up 6:00, no explicit close: closes 30 minutes after the wake-up, 6:30.
  const d = deriveCommitment(wake, NY('10:30:01'), EDT);
  assert.equal(d.stage, 'missed');
  assert.equal(d.canAck, false);
  assert.equal(d.closesAt, '2026-07-22T10:30:00.000Z');
  assert.equal(d.verdict, 'missed');
});

test('the last 15 minutes before the open show a button-less "Opens at" card', () => {
  const d = deriveCommitment(wake, NY('09:50:00'), EDT);
  assert.equal(d.stage, 'upcoming');
  assert.equal(d.visible, true);
  assert.equal(d.canAck, false);
  assert.equal(d.confirmLine, 'Opens at 6:00 AM');
  assert.equal(deriveCommitment(wake, NY('09:40:00'), EDT).visible, false);
});

test('a practice with a respond-by and no close goes straight to missed (pre-0211 behaviour kept)', () => {
  const d = deriveCommitment({ ...rollCall, type: 'practice', title: 'Practice' }, '2026-07-22T09:30:00Z', EDT);
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

/* ---------------------------------------------------------------- timezone */

test('zoneOffsetMin is DST-correct for a real zone', () => {
  assert.equal(zoneOffsetMin('America/New_York', '2026-07-22T12:00:00Z'), -240); // EDT
  assert.equal(zoneOffsetMin('America/New_York', '2026-01-22T12:00:00Z'), -300); // EST
  assert.equal(zoneOffsetMin('UTC', '2026-07-22T12:00:00Z'), 0);
  assert.equal(zoneOffsetMin('Not/AZone', '2026-07-22T12:00:00Z'), null);
  assert.equal(zoneOffsetMin(null, '2026-07-22T12:00:00Z'), null);
});

test('stamps render in the TEAM’s clock, not the phone’s', () => {
  // The coach set 5:15 AM meaning 5:15 in New York. An athlete whose phone is in Los Angeles must
  // still read "Checked in at 4:48 AM" — the same clock the deadline is quoted in — or the card
  // contradicts itself.
  const row = { ...rollCall, timezone: 'America/New_York',
    status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' };
  const d = deriveCommitment(row, '2026-07-22T08:52:00Z');   // no explicit offset
  assert.equal(d.confirmLine, 'Checked in at 4:48 AM');
  assert.equal(d.deadlineLine, 'Respond by 5:15 AM');
});

test('an explicit offset still wins, and a missing timezone falls back to the device', () => {
  const row = { ...rollCall, timezone: 'America/New_York',
    status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' };
  assert.equal(deriveCommitment(row, '2026-07-22T08:52:00Z', 0).confirmLine, 'Checked in at 8:48 AM');
  const noTz = { ...rollCall, status: 'acknowledged', acknowledged_at: '2026-07-22T08:48:00Z' };
  assert.equal(typeof deriveCommitment(noTz, '2026-07-22T08:52:00Z').confirmLine, 'string');
});

/* ---------------------------------------------------------------- board */

test('board counts split responded, awaiting, excused and unverified', () => {
  const rows = [
    { status: 'acknowledged' }, { status: 'arrived' }, { status: 'completed' },
    { status: 'pending' }, { status: 'pending' },
    { status: 'excused' }, { status: 'unverified' },
  ];
  assert.deepEqual(boardCounts(rows),
    { total: 7, responded: 3, awaiting: 2, excused: 1, unverified: 1, leftEarly: 0 });
  assert.equal(missingFrom(rows).length, 2);
  assert.equal(boardCounts([
    { status: 'arrived', arrived_at: '2026-07-22T09:43:00Z', presence: 'left_early' },
    { status: 'arrived', arrived_at: '2026-07-22T09:43:00Z' },
  ]).leftEarly, 1);
  assert.deepEqual(boardCounts([]), { total: 0, responded: 0, awaiting: 0, excused: 0, unverified: 0, leftEarly: 0 });
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

/* ---------------------------------------------------------------- presence (0208)

   Arrival is a boundary CROSSING; presence is whether they were actually there for the stay the
   coach asked for. Before 0208 min_dwell_min gated nothing at all, so a drive-by scored exactly
   like a two-hour session. Every case below encodes a founder rule from 2026-08-23. */

/* A located commitment with a real 45-minute stay requirement. */
const lift = {
  ...rollCall, type: 'strength', title: 'Lift', asks_arrival: true,
  arrive_by_at: '2026-07-22T09:50:00Z', min_dwell_min: 45,
  status: 'arrived', acknowledged_at: '2026-07-22T08:48:00Z',
  arrived_at: '2026-07-22T09:43:00Z', arrival_source: 'geofence', departed_at: null,
};

test('a payload with no presence field degrades to confirmed, never to a downgrade', () => {
  // A server older than 0208 sends no verdict. Reading absence as anything else would
  // retroactively demote every arrival already on the record.
  assert.equal(presenceOf(lift), PRESENCE.CONFIRMED);
  assert.equal(presenceOf({ ...lift, presence: 'nonsense' }), PRESENCE.CONFIRMED);
});

test('presence is none when there is no arrival to have presence at', () => {
  assert.equal(presenceOf({ ...lift, arrived_at: null }), PRESENCE.NONE);
  assert.equal(presenceOf(null), PRESENCE.NONE);
});

test('mid-session presence reads as in-progress, not as a settled green result', () => {
  const d = deriveCommitment({ ...lift, presence: 'provisional' }, '2026-07-22T10:00:00Z', EDT);
  assert.equal(d.stage, 'arrived');
  assert.equal(d.statusColor, 'b');           // NOT 'g' — a running session is not a result
  assert.equal(d.confirmLine, 'At the facility since 5:43 AM · 17 of 45 min');
  assert.equal(d.canDispute, false);          // nothing has been held against them yet
});

test('a sustained early departure is its own stage, and is disputable', () => {
  const d = deriveCommitment(
    { ...lift, presence: 'left_early', departed_at: '2026-07-22T09:52:00Z' },
    '2026-07-22T10:30:00Z', EDT);
  assert.equal(d.stage, 'left_early');
  assert.equal(d.statusColor, 'a');
  assert.equal(d.confirmLine, 'Left the facility at 5:52 AM');
  // It COUNTS against them (founder ruling), which is exactly why it must be contestable.
  assert.equal(d.canDispute, true);
});

test('leaving early is never converted into missed or unverified', () => {
  const d = deriveCommitment(
    { ...lift, presence: 'left_early', departed_at: '2026-07-22T09:52:00Z' },
    '2026-07-22T10:30:00Z', EDT);
  assert.notEqual(d.stage, 'missed');
  assert.notEqual(d.stage, 'unverified');
});

test('a sustained early departure forfeits the arrival weight', () => {
  const onTime = accountability([{ ...lift, presence: 'confirmed' }]);
  const left   = accountability([{ ...lift, presence: 'left_early',
                                   departed_at: '2026-07-22T09:52:00Z' }]);
  // Same denominator: they were asked for the same thing either way.
  assert.equal(onTime.possible, left.possible);
  assert.equal(onTime.earned - left.earned, WEIGHTS.arrival);
});

test('an unresolved stay still counts, so a score never runs backwards mid-session', () => {
  // The athlete is sitting in the room doing exactly what was asked. Docking them now and
  // silently restoring it later is the failure mode this rule exists to prevent.
  const mid  = accountability([{ ...lift, presence: 'provisional' }]);
  const done = accountability([{ ...lift, presence: 'confirmed' }]);
  assert.equal(mid.earned, done.earned);
  assert.equal(mid.pct, done.pct);
});

test('morning readiness counts an early departure as an arrival not made', () => {
  const m = morningReadiness([{ ...lift, presence: 'left_early',
                                departed_at: '2026-07-22T09:52:00Z' }]);
  assert.equal(m.arrival.total, 1);
  assert.equal(m.arrival.done, 0);
});

test('leaving early breaks a clean-day streak; staying does not', () => {
  const day = (presence, extra) => ({
    ...lift, occurs_on: '2026-07-22', completed_at: '2026-07-22T11:00:00Z',
    presence, ...extra,
  });
  assert.equal(commitmentStreak([day('confirmed')], '2026-07-22'), 1);
  assert.equal(
    commitmentStreak([day('left_early', { departed_at: '2026-07-22T09:52:00Z' })], '2026-07-22'),
    0);
});

test('completing after an early departure keeps the verdict on the receipt', () => {
  // "Mark complete" must not upgrade an amber card to a clean green one while the score still
  // withholds the arrival weight. The receipt carries both facts and stays disputable.
  const d = deriveCommitment(
    { ...lift, presence: 'left_early', departed_at: '2026-07-22T09:52:00Z',
      completed_at: '2026-07-22T11:05:00Z', status: 'completed' },
    '2026-07-22T11:30:00Z', EDT);
  assert.equal(d.stage, 'completed');
  assert.equal(d.statusColor, 'a');
  assert.equal(d.canDispute, true);
  assert.equal(d.confirmLine, 'Completed at 7:05 AM · left the facility at 5:52 AM');
});

test('a commitment with no stay requirement is untouched by presence', () => {
  // Blast radius: when the coach never asked for a minimum stay, arriving IS the requirement and
  // behaviour must be byte-identical to before 0208.
  const noDwell = { ...lift, min_dwell_min: null, presence: 'confirmed' };
  const d = deriveCommitment(noDwell, '2026-07-22T10:00:00Z', EDT);
  assert.equal(d.stage, 'arrived');
  assert.equal(d.statusColor, 'g');
  assert.equal(d.confirmLine, 'Arrived at the facility at 5:43 AM');
});

/* ---------------------------------------------------------------- wake-up verdict (0211)
   These mirror rollcall_verdict() in migration 0211. Same clock, same answer, on both sides. */

test('verdict: answered at or before the deadline is On Standard, after it is Late', () => {
  const dl = '2026-07-22T09:15:00Z';
  assert.equal(rollcallVerdict({ ...rollCall, acknowledged_at: '2026-07-22T09:15:00Z' }, '2026-07-22T10:00:00Z'), VERDICT.ON_STANDARD);
  assert.equal(rollcallVerdict({ ...rollCall, acknowledged_at: '2026-07-22T09:15:01Z' }, '2026-07-22T10:00:00Z'), VERDICT.LATE);
  assert.equal(lateMinutes({ ...rollCall, acknowledged_at: '2026-07-22T09:15:01Z' }), 1);
  assert.equal(lateMinutes({ ...rollCall, acknowledged_at: '2026-07-22T09:21:00Z' }), 6);
  assert.equal(lateMinutes({ ...rollCall, acknowledged_at: '2026-07-22T09:10:00Z' }), null);
  // A board row judged against its instance's deadline.
  assert.equal(rollcallVerdict({ status: 'acknowledged', acknowledged_at: '2026-07-22T09:20:00Z' }, '2026-07-22T10:00:00Z', dl), VERDICT.LATE);
});

test('verdict: unanswered is Pending until the close and Missed after it', () => {
  // rollCall closes 30 min after its 08:45Z start: 09:15Z, the same instant as its grace.
  assert.equal(rollcallVerdict(rollCall, '2026-07-22T09:14:59Z'), VERDICT.PENDING);
  assert.equal(rollcallVerdict(rollCall, '2026-07-22T09:15:00Z'), VERDICT.PENDING);
  assert.equal(rollcallVerdict(rollCall, '2026-07-22T09:15:01Z'), VERDICT.MISSED);
  assert.equal(rollcallVerdict(rollCall, '2026-07-23T09:15:00Z'), VERDICT.MISSED);
});

test('verdict: excused wins over everything, and a late answer stays late forever', () => {
  assert.equal(rollcallVerdict({ ...rollCall, status: 'excused', acknowledged_at: '2026-07-22T09:30:00Z' }, '2026-07-22T10:00:00Z'), VERDICT.EXCUSED);
  assert.equal(verdictLine({ ...rollCall, acknowledged_at: '2026-07-22T09:21:00Z' }, '2026-07-30T00:00:00Z'), 'Late · 6 min');
  assert.equal(verdictLine({ ...rollCall, acknowledged_at: '2026-07-22T09:01:00Z' }, '2026-07-30T00:00:00Z'), 'On Standard');
  assert.equal(verdictLine(rollCall, '2026-07-30T00:00:00Z'), 'Missed');
});

test('verdict: the status column never overrides the timestamps', () => {
  // The ladder marks a row 'missed' at the deadline; a late lock-screen tap then flips it to
  // 'acknowledged'. Either way the verdict reads the answer, not the label.
  assert.equal(rollcallVerdict({ ...rollCall, status: 'missed' }, '2026-07-22T09:20:00Z'), VERDICT.MISSED);
  assert.equal(rollcallVerdict({ ...rollCall, status: 'missed', acknowledged_at: '2026-07-22T09:20:00Z' }, '2026-07-22T09:25:00Z'), VERDICT.LATE);
  assert.equal(rollcallVerdict({ ...rollCall, status: 'pending', acknowledged_at: '2026-07-22T09:00:00Z' }, '2026-07-22T09:25:00Z'), VERDICT.ON_STANDARD);
});

test('windows: the server values win, then the same fallbacks the SQL applies', () => {
  assert.equal(closesAtOf({ ...rollCall, closes_at: '2026-07-22T10:00:00Z' }), '2026-07-22T10:00:00Z');
  assert.equal(closesAtOf({ ...rollCall, ends_at: '2026-07-22T10:30:00Z' }), '2026-07-22T10:30:00Z');
  assert.equal(closesAtOf(rollCall), '2026-07-22T09:15:00.000Z');  // starts 08:45Z + 30
  assert.equal(closesAtOf({ ...rollCall, type: 'practice' }), null);
  assert.equal(opensAtOf({ ...rollCall, opens_at: '2026-07-22T08:30:00Z' }), '2026-07-22T08:30:00Z');
  assert.equal(opensAtOf({ ...rollCall, opens_min: 275 }), '2026-07-22T08:35:00.000Z');
  assert.equal(opensAtOf(rollCall), '2026-07-22T08:45:00Z');       // a wake-up opens AT its time
  assert.equal(opensAtOf({ ...rollCall, type: 'practice' }), '2026-07-22T08:15:00.000Z');
  assert.equal(graceMinOf(rollCall), 30);
  assert.equal(graceMinOf({ ...rollCall, grace_min: 5 }), 5);
  assert.equal(graceMinOf({ ...rollCall, respond_by_min: null }), null);
});

test('a late answer collapses to an amber receipt that says how late', () => {
  const d = deriveCommitment(
    { ...rollCall, status: 'acknowledged', acknowledged_at: '2026-07-22T09:21:00Z' },
    '2026-07-22T09:30:00Z', EDT);
  assert.equal(d.stage, 'acknowledged');
  assert.equal(d.collapsed, true);
  assert.equal(d.verdict, 'late');
  assert.equal(d.lateMin, 6);
  assert.equal(d.statusColor, 'a');
  assert.equal(d.confirmLine, 'Late · 6 min · checked in at 5:21 AM');
});

test('the board groups rows by verdict against the INSTANCE deadline', () => {
  const inst = {
    starts_at: '2026-07-22T08:45:00Z', respond_by_at: '2026-07-22T09:15:00Z',
    rows: [
      { name: 'Marcus', status: 'acknowledged', acknowledged_at: '2026-07-22T09:01:00Z' },
      { name: 'Devin', status: 'acknowledged', acknowledged_at: '2026-07-22T09:21:00Z' },
      { name: 'Jordan', status: 'missed' },
      { name: 'Ava', status: 'pending' },
      { name: 'Sam', status: 'excused' },
    ],
  };
  const g = groupByVerdict(inst, '2026-07-22T09:30:00Z');
  assert.deepEqual(g.on_standard.map((r) => r.name), ['Marcus']);
  assert.deepEqual(g.late.map((r) => r.name), ['Devin']);
  // Past the grace, before the close (08:45 + 30 = 09:15): unanswered is "still out", not missed.
  assert.deepEqual(g.still_out.map((r) => r.name), ['Jordan', 'Ava']);
  assert.deepEqual(g.pending, []);
  assert.equal(g.late[0].lateMin, 6);
  const c = verdictCounts(inst, '2026-07-22T09:30:00Z');
  assert.equal(c.total, 5); assert.equal(c.onStandard, 1); assert.equal(c.late, 1);
  assert.equal(c.stillOut, 0); assert.equal(c.missed, 2); assert.equal(c.excused, 1);
  assert.equal(c.responded, 2); assert.equal(c.counted, 4);
  // Before the grace the same unanswered rows are pending, not missed.
  const early = verdictCounts(inst, '2026-07-22T09:00:00Z');
  assert.equal(early.pending, 2);
  assert.equal(early.missed, 0);
  assert.equal(boardVerdicts(inst, '2026-07-22T09:00:00Z').length, 5);
});

test('missingFrom keys on the answer, not the status, so the ladder marking everyone missed does not empty it', () => {
  const rows = [
    { status: 'missed', acknowledged_at: null },
    { status: 'pending', acknowledged_at: null },
    { status: 'missed', acknowledged_at: '2026-07-22T09:21:00Z' },   // answered late, then status caught up
    { status: 'acknowledged', acknowledged_at: '2026-07-22T09:01:00Z' },
    { status: 'excused' },
  ];
  assert.equal(missingFrom(rows).length, 2);
});

test('the athlete history lists wake-ups newest first with the verdict and the stamp in the team clock', () => {
  const rows = [
    { ...rollCall, occurs_on: '2026-07-20', starts_at: '2026-07-20T08:45:00Z', respond_by_at: '2026-07-20T09:15:00Z', acknowledged_at: '2026-07-20T08:58:00Z', status: 'acknowledged' },
    { ...rollCall, occurs_on: '2026-07-21', starts_at: '2026-07-21T08:45:00Z', respond_by_at: '2026-07-21T09:15:00Z', acknowledged_at: '2026-07-21T09:24:00Z', status: 'acknowledged' },
    { ...rollCall, occurs_on: '2026-07-22', status: 'pending' },
    { ...rollCall, type: 'practice', occurs_on: '2026-07-22', acknowledged_at: '2026-07-22T09:00:00Z' },
    { ...rollCall, occurs_on: '2026-07-19', instance_status: 'cancelled' },
  ];
  const h = wakeupHistory(rows, '2026-07-22T09:00:00Z', EDT);
  assert.deepEqual(h.map((x) => [x.occurs_on, x.verdict, x.at, x.lateMin]), [
    ['2026-07-22', 'pending', '', null],
    ['2026-07-21', 'late', '5:24 AM', 9],
    ['2026-07-20', 'on_standard', '4:58 AM', null],
  ]);
  assert.deepEqual(wakeupSummary(h), { total: 2, onStandard: 1, late: 1, missed: 0, overrides: 0, review: 0 });
});

test('the coach summary skips days still in progress and sums the rest', () => {
  const s = summarizeOccurrences([
    { occurs_on: '2026-07-22', total: 52, on_standard: 40, late: 0, missed: 0, pending: 12 },
    { occurs_on: '2026-07-21', total: 52, on_standard: 48, late: 2, missed: 2, pending: 0 },
    { occurs_on: '2026-07-20', total: 50, on_standard: 50, late: 0, missed: 0, pending: 0 },
    { occurs_on: '2026-07-19', instance_status: 'cancelled', total: 0, pending: 0 },
  ]);
  assert.deepEqual(s, { occurrences: 2, onStandard: 98, late: 2, missed: 2, total: 102, overrides: 0, review: 0 });
});

test('the roll call moves before, open, late, closed on its own clock', () => {
  // 6:00 open · 6:05 grace · 6:30 close
  assert.equal(wakeupPhase(wake, NY('09:59:59')), 'before');
  assert.equal(wakeupPhase(wake, NY('10:00:00')), 'open');
  assert.equal(wakeupPhase(wake, NY('10:05:00')), 'open');
  assert.equal(wakeupPhase(wake, NY('10:05:01')), 'late');
  assert.equal(wakeupPhase(wake, NY('10:30:00')), 'late');
  assert.equal(wakeupPhase(wake, NY('10:30:01')), 'closed');
  // The server's own windows win when present.
  assert.equal(wakeupPhase({ ...rollCall, opens_at: '2026-07-22T08:35:00Z' }, '2026-07-22T08:20:00Z'), 'before');
  assert.equal(wakeupPhase({ ...rollCall, closes_at: '2026-07-22T09:45:00Z' }, '2026-07-22T09:50:00Z'), 'closed');
});

/* ---------------------------------------------------------------- the 6 AM boundaries (0212)
   5:59:59 unavailable · 6:00 on standard · 6:04 · 6:05:00 on standard · 6:05:01 late (1 min) ·
   6:11 late (6 min) · 6:30:00 late (25 min, last accepted) · 6:30:01 missed. */

test('boundaries: on standard through the grace, late by the second after it', () => {
  const ack = (hms) => ({ ...wake, status: 'acknowledged', acknowledged_at: NY(hms), ack_source: 'lockscreen' });
  assert.equal(rollcallVerdict(ack('10:00:00'), NY('10:31:00')), 'on_standard');
  assert.equal(rollcallVerdict(ack('10:04:00'), NY('10:31:00')), 'on_standard');
  assert.equal(rollcallVerdict(ack('10:05:00'), NY('10:31:00')), 'on_standard');
  assert.equal(rollcallVerdict(ack('10:05:01'), NY('10:31:00')), 'late');
  assert.equal(lateMinutes(ack('10:05:01')), 1);
  assert.equal(rollcallVerdict(ack('10:11:00'), NY('10:31:00')), 'late');
  assert.equal(lateMinutes(ack('10:11:00')), 6);
  assert.equal(rollcallVerdict(ack('10:30:00'), NY('10:31:00')), 'late');
  assert.equal(lateMinutes(ack('10:30:00')), 25);
  assert.equal(verdictLine(ack('10:11:00'), NY('10:31:00')), 'Late · 6 min');
});

test('boundaries: unanswered is pending until the close and missed the second after it', () => {
  assert.equal(rollcallVerdict(wake, NY('09:59:59')), 'pending');
  assert.equal(rollcallVerdict(wake, NY('10:29:59')), 'pending');
  assert.equal(rollcallVerdict(wake, NY('10:30:00')), 'pending');
  assert.equal(rollcallVerdict(wake, NY('10:30:01')), 'missed');
  assert.equal(rollcallVerdict(wake, NY('23:00:00')), 'missed');
  // The card: not answerable before 6:00, answerable through 6:30, never after.
  assert.equal(deriveCommitment(wake, NY('09:59:59'), EDT).canAck, false);
  assert.equal(deriveCommitment(wake, NY('10:00:00'), EDT).canAck, true);
  assert.equal(deriveCommitment(wake, NY('10:30:00'), EDT).canAck, true);
  assert.equal(deriveCommitment(wake, NY('10:30:01'), EDT).canAck, false);
});

test('a coach override reads On Standard and is never an athlete tap', () => {
  const o = { ...wake, status: 'acknowledged', acknowledged_at: NY('10:40:00'), ack_source: 'override', correction_note: 'Phone died, was in the weight room' };
  assert.equal(rollcallVerdict(o, NY('11:00:00')), 'on_standard');
  assert.equal(sourceOf(o), SOURCE.OVERRIDE);
  assert.equal(sourceOf({ ack_source: 'staff' }), SOURCE.OVERRIDE);   // pre-0212 rows
  const d = deriveCommitment(o, NY('11:00:00'), EDT);
  assert.equal(d.stage, 'acknowledged');
  assert.equal(d.confirmLine, 'Coach override · marked at 6:40 AM');
  // The board never sums it as checked in.
  const inst = { starts_at: wake.starts_at, respond_by_at: wake.respond_by_at, type: 'morning_roll_call', rows: [
    { name: 'A', status: 'acknowledged', acknowledged_at: NY('10:01:00'), ack_source: 'lockscreen' },
    { name: 'B', status: 'acknowledged', acknowledged_at: NY('10:02:00'), ack_source: 'app' },
    { name: 'C', status: 'acknowledged', acknowledged_at: NY('10:40:00'), ack_source: 'override' },
    { name: 'D', status: 'acknowledged', acknowledged_at: NY('10:03:00'), ack_source: 'lockscreen' },
  ] };
  const c = verdictCounts(inst, NY('11:00:00'));
  assert.equal(c.onStandard, 4);
  assert.equal(c.checkedIn, 3);
  assert.equal(c.overrides, 1);
  assert.equal(c.accountedFor, 4);
  assert.notEqual(`${c.checkedIn} / ${c.total} checked in`, '4 / 4 checked in');
});

test('a delayed-sync review counts as nothing until a coach resolves it', () => {
  const rv = { ...wake, status: 'acknowledged', acknowledged_at: NY('10:12:00'), device_tapped_at: NY('10:04:00'), ack_source: 'lockscreen', sync_review: true, review_resolution: null };
  assert.equal(isUnderReview(rv), true);
  assert.equal(rollcallVerdict(rv, NY('10:20:00')), 'review');
  assert.deepEqual(accountability([rv]), { earned: 0, possible: 0, pct: null });
  assert.equal(deriveCommitment(rv, NY('10:20:00'), EDT).stage, 'review');
  // Resolved three ways.
  assert.equal(rollcallVerdict({ ...rv, review_resolution: 'accepted', ack_source: 'review_accepted' }, NY('10:20:00')), 'on_standard');
  assert.equal(rollcallVerdict({ ...rv, review_resolution: 'late' }, NY('10:20:00')), 'late');
  assert.equal(rollcallVerdict({ ...rv, review_resolution: 'missed' }, NY('10:20:00')), 'missed');
  assert.equal(accountability([{ ...rv, review_resolution: 'missed' }]).earned, 0);
  assert.equal(accountability([{ ...rv, review_resolution: 'accepted', ack_source: 'review_accepted' }]).earned, 10);
  // The board puts it in its own group.
  const inst = { ...wake, rows: [rv] };
  assert.equal(groupByVerdict(inst, NY('10:20:00')).review.length, 1);
  assert.equal(verdictCounts(inst, NY('10:20:00')).review, 1);
});

test('the close default is 30 minutes after the wake-up and the coach ends_at wins', () => {
  assert.equal(ROLLCALL_CLOSE_AFTER_MIN, 30);
  assert.equal(closesAtOf(wake), '2026-07-22T10:30:00.000Z');
  assert.equal(closesAtOf({ ...wake, ends_at: NY('10:15:00') }), NY('10:15:00'));
  assert.equal(rollcallVerdict(wake, NY('10:16:00'), null, NY('10:15:00')), 'missed');
});

/* ---------------------------------------------------------------- schedule ahead (0215) */
import { dayLabel, scheduleState, nextRollcall } from './commitments.js';

test('dayLabel: Today, Tomorrow, then a fixed weekday + date, no locale', () => {
  assert.equal(dayLabel('2026-09-02', '2026-09-02'), 'Today');
  assert.equal(dayLabel('2026-09-03', '2026-09-02'), 'Tomorrow');
  assert.equal(dayLabel('2026-09-09', '2026-09-02'), 'Wed, Sep 9');
  assert.equal(dayLabel('garbage', '2026-09-02'), '');
});

test('scheduleState reads the server flags, never guesses', () => {
  assert.equal(scheduleState({ skipped: true }).kind, 'skipped');
  assert.equal(scheduleState({ instance_status: 'cancelled' }).kind, 'skipped');
  const moved = scheduleState({ starts_override_min: 390, rule_starts_min: 360 });
  assert.equal(moved.kind, 'moved');
  assert.match(moved.line, /6:30 AM/);
  assert.match(moved.line, /Usually 6:00 AM/);
  // an override equal to the rule is not a move
  assert.equal(scheduleState({ starts_override_min: 360, rule_starts_min: 360 }).kind, 'standing');
  assert.equal(scheduleState({}).kind, 'standing');
});

test('nextRollcall is the first occurrence still ahead of now, skipped days included', () => {
  const up = [
    { occurs_on: '2026-09-03', starts_at: '2026-09-03T10:00:00Z', closes_at: '2026-09-03T10:30:00Z', skipped: true, instance_status: 'cancelled' },
    { occurs_on: '2026-09-02', starts_at: '2026-09-02T10:00:00Z', closes_at: '2026-09-02T10:30:00Z' },
    { occurs_on: '2026-09-04', starts_at: '2026-09-04T10:00:00Z', closes_at: '2026-09-04T10:30:00Z' },
  ];
  // 9:00 AM on the 2nd: today's is still ahead
  assert.equal(nextRollcall(up, '2026-09-02T09:00:00Z').occurs_on, '2026-09-02');
  // 11:00 AM on the 2nd: today's closed at 10:30, tomorrow (skipped) is next so the coach can put it back
  assert.equal(nextRollcall(up, '2026-09-02T11:00:00Z').occurs_on, '2026-09-03');
  assert.equal(nextRollcall([], '2026-09-02T11:00:00Z'), null);
});
