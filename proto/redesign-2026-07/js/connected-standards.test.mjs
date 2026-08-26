/* Connected Standards engine — pure-module tests (node --test).
   Every case here encodes a founder rule, not an implementation detail:
     - a device gap ('awaiting_sync' / 'disconnected' / 'insufficient_data') leaves the
       DENOMINATOR. It is never counted as a miss, and no data reports null rather than 0%.
     - 'excused' leaves the row entirely.
     - walking three miles and running three miles are different requirements, and the card
       says which one it is BEFORE the deadline, not after.
     - weekly pace is computed from the period, so it is right on a Monday and on a Sunday.
   Timezone is always an explicit argument. The module holds no clock and reads no locale, so
   these assertions are identical on a CI box in UTC and a founder laptop in New York. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, csStatusLabel, isComplete, isDeviceGap,
  groupThousands, toDisplay, toCanonical, fmtValue, unitNoun,
  csProgressLine, remainingLabel, progressPct, syncedLabel, completedLabel, localDateISO,
  metricLabel, sourceRule, paceToGoal, daysBetween,
  compliance, boardCounts, needsAttention, groupForAthlete, activeOn,
  columnGeometry, streakOf, momentumOf,
} from './connected-standards.js';

/* America/New_York in July. Passed explicitly everywhere. */
const EDT = -240;

const steps = {
  title: 'Daily Movement', metric: 'steps', display_unit: 'steps',
  target: 10000, progress: 7842, period: 'day',
  period_start: '2026-07-28', period_end: '2026-07-28',
  status: 'in_progress', last_synced_at: '2026-07-28T22:42:00Z',
  instance_status: 'scheduled', source_kind: 'assigned',
};

const weekly = {
  title: 'Weekly Miles', metric: 'distance', display_unit: 'mi',
  target: 12 * 1609.344, progress: 6.8 * 1609.344, period: 'week',
  period_start: '2026-07-27', period_end: '2026-08-02',   // Mon → Sun
  status: 'in_progress', instance_status: 'scheduled', source_kind: 'personal',
};

/* ---------------------------------------------------------------- the nine verdicts */

test('every status carries a counts bucket, and only the right ones are complete', () => {
  assert.equal(Object.keys(STATUS).length, 9);
  assert.equal(isComplete('verified_complete'), true);
  assert.equal(isComplete('completed_manually'), true, 'a manual entry still means the work was done');
  assert.equal(isComplete('missed'), false);
  assert.equal(isComplete('awaiting_sync'), false);
});

test('a device gap is a device gap, not a failure of the athlete', () => {
  for (const s of ['awaiting_sync', 'disconnected', 'insufficient_data']) {
    assert.equal(isDeviceGap(s), true, `${s} must be a device gap`);
    assert.equal(STATUS[s].counts, 'excluded', `${s} must leave the denominator`);
  }
  assert.equal(isDeviceGap('missed'), false);
  assert.equal(STATUS.missed.counts, 'missed');
  assert.equal(STATUS.excused.counts, 'dropped');
});

test('an unknown status degrades to open rather than throwing', () => {
  assert.equal(csStatusLabel('some_future_status'), 'Unknown');
  assert.equal(isComplete('some_future_status'), false);
});

/* ---------------------------------------------------------------- numbers and units */

test('thousands are grouped without Intl so every device agrees', () => {
  assert.equal(groupThousands(7842), '7,842');
  assert.equal(groupThousands(999), '999');
  assert.equal(groupThousands(1000000), '1,000,000');
  assert.equal(groupThousands(12.5), '12.5');
});

test('distance round-trips through metres, the only unit ever stored', () => {
  assert.equal(Math.round(toCanonical(3, 'distance', 'mi')), 4828);
  assert.equal(toCanonical(5, 'distance', 'km'), 5000);
  assert.equal(Math.round(toDisplay(4828.032, 'distance', 'mi') * 100) / 100, 3);
  assert.equal(toDisplay(5000, 'distance', 'km'), 5);
  // a non-distance metric is already canonical and must pass through untouched
  assert.equal(toDisplay(10000, 'steps', 'steps'), 10000);
});

test('distance keeps the decimals a real run has; counts and minutes do not', () => {
  assert.equal(fmtValue(2.73 * 1609.344, 'distance', 'mi'), '2.73');
  assert.equal(fmtValue(12 * 1609.344, 'distance', 'mi'), '12', 'a whole number loses the .00');
  assert.equal(fmtValue(6.8 * 1609.344, 'distance', 'mi'), '6.8');
  assert.equal(fmtValue(10000, 'steps', 'steps'), '10,000');
  assert.equal(fmtValue(45.4, 'active_minutes', 'min'), '45');
});

test('the noun goes singular where a human would say it', () => {
  assert.equal(unitNoun('steps', 'steps', 10000), 'steps');
  assert.equal(unitNoun('steps', 'steps', 1), 'step');
  assert.equal(unitNoun('workouts', 'workouts', 1), 'workout');
  assert.equal(unitNoun('workouts', 'workouts', 3), 'workouts');
  assert.equal(unitNoun('distance', 'km', 5000), 'km');
  assert.equal(unitNoun('workout_minutes', 'min', 30), 'min');
});

/* ---------------------------------------------------------------- the athlete's lines */

test('the progress line is the sentence the feature is named after', () => {
  assert.equal(csProgressLine(steps), '7,842 of 10,000 steps');
  assert.equal(remainingLabel(steps), '2,158 to go');
  assert.equal(progressPct(steps), 78);
});

test('nobody is told they have 0 left, and nobody is shown 112%', () => {
  const done = { ...steps, progress: 10326, status: 'verified_complete' };
  assert.equal(remainingLabel(done), null);
  assert.equal(progressPct(done), 100, 'capped: this is a standard, not a contest');
  assert.equal(csProgressLine(done), '10,326 of 10,000 steps');
});

test('a target of zero cannot divide by zero', () => {
  assert.equal(progressPct({ target: 0, progress: 500 }), 0);
});

test('the sync line is honest about never having synced', () => {
  assert.equal(syncedLabel(steps, EDT), 'Synced 6:42 PM');
  assert.equal(syncedLabel({ ...steps, last_synced_at: null }, EDT), 'Not synced yet');
});

test('a bare time is never shown for a sync that was not today', () => {
  // The state this feature exists to get right. "Synced 2:04 PM" on a row whose watch last
  // reported YESTERDAY reads as this afternoon — the exact opposite of the truth the athlete
  // needs, which is that the device has gone quiet.
  const stale = { ...steps, last_synced_at: '2026-07-27T18:04:00Z' };
  assert.equal(syncedLabel(stale, EDT, '2026-07-28'), 'Last synced yesterday, 2:04 PM');

  const older = { ...steps, last_synced_at: '2026-07-25T18:04:00Z' };
  assert.equal(syncedLabel(older, EDT, '2026-07-28'), 'Last synced 3 days ago');

  // same day → the bare time is the honest, least noisy form
  assert.equal(syncedLabel(steps, EDT, '2026-07-28'), 'Synced 6:42 PM');
});

test('completion time is reported as completion, not as a sync', () => {
  const done = { ...steps, status: 'verified_complete', completed_at: '2026-07-29T00:17:00Z' };
  assert.equal(completedLabel(done, EDT), 'Completed 8:17 PM');
  // a complete row with no stamp still reads cleanly rather than "Completed "
  assert.equal(completedLabel({ ...done, completed_at: null }, EDT), 'Complete');
});

test('the local date of an instant follows the viewer, not UTC', () => {
  // 00:17 UTC on the 29th is still the evening of the 28th in New York.
  assert.equal(localDateISO('2026-07-29T00:17:00Z', EDT), '2026-07-28');
});

/* ---------------------------------------------------------------- what counts as this metric */

test('walking three miles and running three miles are different requirements', () => {
  assert.equal(metricLabel('distance', false), 'Walking + running');
  assert.equal(metricLabel('distance', true), 'Workout distance');
  assert.match(sourceRule('distance', true), /recorded workout/);
  assert.match(sourceRule('distance', true), /Daily walking does not apply/);
  assert.match(sourceRule('distance', false), /all walking and running/);
});

test('a minimum session length is stated in the rule, not buried in the schema', () => {
  assert.match(sourceRule('workouts', false, 30), /at least 30 minutes/);
  assert.match(sourceRule('workouts', false, null), /any recorded workout/);
});

/* ---------------------------------------------------------------- weekly pace */

test('a daily standard has no pace to report', () => {
  assert.equal(paceToGoal(steps, '2026-07-28'), null);
});

test('behind pace: the athlete is told what it takes to catch up', () => {
  // Thursday of a Mon-Sun week: 4 of 7 days elapsed, so 6.86 of 12 mi would be exactly on pace.
  const p = paceToGoal({ ...weekly, progress: 4 * 1609.344 }, '2026-07-30');
  assert.equal(p.state, 'behind');
  assert.equal(p.label, 'Behind pace');
  assert.equal(p.daysLeft, 4, 'today still counts as a day you can go walk');
  assert.equal(p.daysTotal, 7);
  assert.equal(p.needLabel, 'Need 2 mi/day');
});

test('the 5% band absorbs a rounding-sized delta instead of flickering', () => {
  // 6.8 of 12 on Thursday is a hair under the ideal 6.86 — a chip that flipped to "Behind" for
  // 0.06 of a mile would be noise, and would nag an athlete who is doing fine.
  const hair = paceToGoal({ ...weekly, progress: 6.8 * 1609.344 }, '2026-07-30');
  assert.equal(hair.state, 'on_pace');
  // …but a real shortfall still reads as one.
  const real = paceToGoal({ ...weekly, progress: 6.4 * 1609.344 }, '2026-07-30');
  assert.equal(real.state, 'behind');
});

test('ahead, on pace and done each read differently', () => {
  const on = paceToGoal({ ...weekly, progress: 12 * 1609.344 * (4 / 7) }, '2026-07-30');
  assert.equal(on.state, 'on_pace');

  const ahead = paceToGoal({ ...weekly, progress: 11 * 1609.344 }, '2026-07-30');
  assert.equal(ahead.state, 'ahead');

  const done = paceToGoal({ ...weekly, progress: 12.4 * 1609.344 }, '2026-07-30');
  assert.equal(done.state, 'done');
  assert.equal(done.needLabel, null, 'a finished week asks for nothing more');
});

test('the last day of a short week is behind, not divided by zero', () => {
  const p = paceToGoal(weekly, '2026-08-02');           // Sunday, the final day
  assert.equal(p.daysLeft, 1);
  assert.equal(p.state, 'behind');
  assert.ok(Number.isFinite(p.neededPerDay));

  const over = paceToGoal(weekly, '2026-08-05');        // asked about after the week closed
  assert.equal(over.daysLeft, 0);
  assert.equal(over.state, 'behind');
  assert.ok(Number.isFinite(over.neededPerDay));
});

test('pace is measured in whole days regardless of the reader\'s clock', () => {
  assert.equal(daysBetween('2026-07-27', '2026-08-02'), 6);
  assert.equal(daysBetween('2026-07-28', '2026-07-28'), 0);
  // across a US DST boundary, where a naive hour-based diff drifts by one
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
});

/* ---------------------------------------------------------------- rollups */

test('a device gap leaves the denominator instead of counting as a miss', () => {
  const rows = [
    { status: 'verified_complete' }, { status: 'verified_complete' },
    { status: 'completed_manually' },
    { status: 'missed' },
    { status: 'awaiting_sync' }, { status: 'disconnected' }, { status: 'insufficient_data' },
    { status: 'excused' },
    { status: 'in_progress' },
  ];
  const c = compliance(rows);
  assert.equal(c.complete, 3);
  assert.equal(c.missed, 1);
  assert.equal(c.excluded, 3);
  assert.equal(c.dropped, 1);
  assert.equal(c.open, 1);
  assert.equal(c.denominator, 4, 'only complete + missed are judged');
  assert.equal(c.pct, 75);
});

test('three broken watches do not manufacture a 25%', () => {
  const gapsOnly = compliance([
    { status: 'awaiting_sync' }, { status: 'disconnected' }, { status: 'insufficient_data' },
    { status: 'verified_complete' },
  ]);
  assert.equal(gapsOnly.pct, 100, 'the one period with evidence was met');
});

test('no data reports null, never a fake zero', () => {
  assert.equal(compliance([]).pct, null);
  assert.equal(compliance([{ status: 'excused' }]).pct, null);
  assert.equal(compliance([{ status: 'in_progress' }]).pct, null);
});

test('the coach headline counts what the coach actually asks about', () => {
  const rows = [
    ...Array(44).fill({ status: 'verified_complete' }),
    ...Array(2).fill({ status: 'completed_manually' }),
    ...Array(5).fill({ status: 'in_progress' }),
    ...Array(2).fill({ status: 'awaiting_sync' }),
    { status: 'excused' },
    { status: 'disconnected' },
  ];
  const b = boardCounts(rows);
  assert.equal(b.total, 55);
  assert.equal(b.complete, 46);
  assert.equal(b.verified, 44);
  assert.equal(b.reported, 2);
  assert.equal(b.inProgress, 5);
  assert.equal(b.awaitingSync, 2);
  assert.equal(b.excused, 1);
  assert.equal(b.disconnected, 1);
  assert.equal(b.missed, 0);
  assert.equal(b.pct, 100, 'nothing has been judged a miss, so every judged period passed');
});

test('boardCounts survives a malformed payload rather than throwing at the coach', () => {
  const b = boardCounts(null);
  assert.equal(b.total, 0);
  assert.equal(b.pct, null);
});

/* ---------------------------------------------------------------- coach triage */

test('the review queue puts disputes first, then the rows a coach can resolve', () => {
  const rows = [
    { id: 'sync', status: 'awaiting_sync' },
    { id: 'review', status: 'awaiting_review' },
    { id: 'disputed', status: 'missed', disputed_at: '2026-07-28T12:00:00Z' },
    { id: 'fine', status: 'verified_complete' },
    { id: 'gone', status: 'disconnected' },
  ];
  const order = needsAttention(rows).map(r => r.id);
  assert.equal(order[0], 'disputed', 'an athlete who objected is answered first');
  assert.deepEqual(order.slice(1), ['review', 'gone', 'sync']);
  assert.equal(order.includes('fine'), false, 'a verified row is not a task');
});

/* ---------------------------------------------------------------- the athlete's grouping */

test('an obligation is listed above an intention', () => {
  const g = groupForAthlete([steps, weekly]);
  assert.equal(g.assigned.length, 1);
  assert.equal(g.assigned[0].title, 'Daily Movement');
  assert.equal(g.personal.length, 1);
  assert.equal(g.personal[0].title, 'Weekly Miles');
});

test('today shows the day that is today and the week that contains it', () => {
  const rows = [steps, weekly, { ...steps, period_start: '2026-07-27', period_end: '2026-07-27' }];
  const on = activeOn(rows, '2026-07-28');
  assert.equal(on.length, 2, 'yesterday\'s daily standard is not today\'s problem');
  assert.equal(on.includes(weekly), true, 'the weekly window contains today');
});

test('a cancelled period disappears from the athlete\'s day', () => {
  const cancelled = { ...steps, instance_status: 'cancelled' };
  assert.equal(activeOn([cancelled], '2026-07-28').length, 0);
});

/* ---------------------------------------------------------------- the column
   The mark the athlete actually reads. Every case below is a claim the drawing must not make:
   an empty column claims the athlete did nothing, and only one of these states has earned it. */

test('a column draws what was seen — and a device gap is never drawn as a shortfall', () => {
  const live = columnGeometry({ ...steps, progress: 7412 }, null);
  assert.equal(live.state, 'live');
  assert.equal(live.fillPct, 74);

  const partial = columnGeometry({ ...steps, progress: 4300, status: 'awaiting_sync' }, null);
  assert.equal(partial.state, 'partial', 'the watch owes us the rest of the truth');
  assert.equal(partial.fillPct, 43, 'what HAS synced is still true and still drawn');

  const off = columnGeometry({ ...steps, progress: 0, status: 'disconnected' }, null);
  assert.equal(off.state, 'unknown');
  assert.equal(off.fillPct, 0, 'no access means no claim — the screen must not print a number');
});

test('a closed period keeps the work that was done', () => {
  const miss = columnGeometry({ ...steps, progress: 6140, status: 'missed' }, null);
  assert.equal(miss.state, 'missed');
  assert.equal(miss.fillPct, 61, 'midnight does not undo the steps');
});

test('an excused period shows nothing rather than showing zero', () => {
  const exc = columnGeometry({ ...steps, progress: 900, status: 'excused' }, null);
  assert.equal(exc.state, 'excused');
  assert.equal(exc.fillPct, 0);
});

test('a daily standard gets no pace notch, because it has no pace', () => {
  const geo = columnGeometry(steps, paceToGoal(steps, '2026-07-28'));
  assert.equal(geo.notchPct, null, 'inventing an intra-day pace model would be noise dressed as precision');
  assert.equal(geo.behind, false);
});

test('the pace notch and the pace verdict read the same elapsed days', () => {
  // Thursday of a Mon→Sun week: 4 of 7 days elapsed.
  const pace = paceToGoal(weekly, '2026-07-30');
  assert.equal(pace.expectedPct, 57);
  const geo = columnGeometry(weekly, pace);
  assert.equal(geo.notchPct, 57);
  assert.equal(geo.behind, pace.state === 'behind',
    'the notch can never say ahead while the sentence says behind');
});

test('a met target has no notch left to draw', () => {
  const done = { ...weekly, progress: weekly.target, status: 'verified_complete' };
  const geo = columnGeometry(done, paceToGoal(done, '2026-07-30'));
  assert.equal(geo.state, 'done');
  assert.equal(geo.fillPct, 100);
  assert.equal(geo.notchPct, null);
});

/* ---------------------------------------------------------------- streak + momentum */

const period = (start, status) => ({ ...steps, standard_id: 'S1', period_start: start, period_end: start, status });

test('a dead battery does not end a run', () => {
  const rows = [
    period('2026-07-24', 'verified_complete'),
    period('2026-07-25', 'awaiting_sync'),      // the watch failed, not the athlete
    period('2026-07-26', 'verified_complete'),
    period('2026-07-27', 'verified_complete'),
  ];
  assert.equal(streakOf(rows, 'S1'), 3, 'an excluded period is skipped, never counted and never fatal');
});

test('only an affirmative miss ends a run', () => {
  const rows = [
    period('2026-07-24', 'verified_complete'),
    period('2026-07-25', 'missed'),
    period('2026-07-26', 'verified_complete'),
  ];
  assert.equal(streakOf(rows, 'S1'), 1);
});

test('today still being live neither extends nor ends a run', () => {
  const rows = [
    period('2026-07-26', 'verified_complete'),
    period('2026-07-27', 'verified_complete'),
    period('2026-07-28', 'in_progress'),
  ];
  assert.equal(streakOf(rows, 'S1'), 2);
});

test('a streak counts only its own standard', () => {
  const rows = [period('2026-07-26', 'verified_complete'), { ...period('2026-07-27', 'verified_complete'), standard_id: 'S2' }];
  assert.equal(streakOf(rows, 'S1'), 1);
});

test('the momentum chart keeps the seven most recent periods, oldest first', () => {
  const rows = ['07-21', '07-22', '07-23', '07-24', '07-25', '07-26', '07-27', '07-28']
    .map((d) => period(`2026-${d}`, 'verified_complete'));
  const bars = momentumOf(rows, 'S1', 7);
  assert.equal(bars.length, 7);
  assert.equal(bars[0].iso, '2026-07-22', 'the oldest of the eight falls off the front');
  assert.equal(bars[6].iso, '2026-07-28');
});

test('every bar carries the verdict its column would have carried', () => {
  const bars = momentumOf([
    period('2026-07-25', 'verified_complete'),
    period('2026-07-26', 'missed'),
    period('2026-07-27', 'awaiting_sync'),
    period('2026-07-28', 'in_progress'),
  ], 'S1');
  assert.deepEqual(bars.map((b) => b.cls), ['ok', 'miss', 'gap', 'now']);
});
