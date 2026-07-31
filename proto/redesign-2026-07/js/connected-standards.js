/* OnStandard — Connected Standards engine.
   PURE: no DOM, no Supabase, no clock, no locale. Every function takes what it needs as an
   argument — the same contract requirements.js, commitments.js and notify-plan.js hold — so
   node --test can exercise it directly and a CI box in UTC agrees with a laptop in New York.

   ⚠ Nothing here feeds the daily 0–100 score. Connected Standards ships tracked-not-scored
   (founder decision 2026-07-28), exactly as multi-domain completions and training logs did.
   day.js is not imported and must not be.

   CANONICAL UNITS. Everything crossing the wire is in the metric's base unit, matching the
   0155 column comment: steps = count, distance = METRES, workouts = count, minutes = minutes.
   Miles and kilometres exist only at the moment of rendering, which is why every comparison in
   this file is a plain numeric >= and never a unit-aware one. */

// Time formatting is shared with the commitments engine rather than re-derived here: two copies
// of "minute-of-day in a target zone" is two chances to disagree about DST.
import { fmtAt, localOffsetMin } from './commitments.js';

export { fmtAt, localOffsetMin };

const METRES_PER_MILE = 1609.344;
const METRES_PER_KM = 1000;

/* ---------------------------------------------------------------- the nine verdicts
   `counts` is the load-bearing field, and it encodes the doctrine this whole feature rests on:

     complete   the work was done (however it was proven)   → numerator + denominator
     missed     fresh data affirmatively showed a shortfall → denominator only
     open       still live, nothing decided yet             → neither
     excluded   the DEVICE failed, not the athlete          → NEITHER. Out of the denominator.
     dropped    staff removed the requirement               → row leaves entirely

   'excluded' is the one that matters. A dead battery, a revoked permission or a phone left on
   the charger produces no evidence either way, and the honest thing to do with no evidence is
   to not count the period at all. Converting it into a miss would make the number a measure of
   phone reliability wearing the costume of a measure of discipline. */
export const STATUS = {
  in_progress:        { label: 'In progress',       tone: 'blue',   counts: 'open' },
  verified_complete:  { label: 'Verified',          tone: 'green',  counts: 'complete' },
  completed_manually: { label: 'Reported',          tone: 'cyan',   counts: 'complete' },
  awaiting_review:    { label: 'Needs review',      tone: 'purple', counts: 'open' },
  awaiting_sync:      { label: 'Awaiting sync',     tone: 'amber',  counts: 'excluded' },
  disconnected:       { label: 'Disconnected',      tone: 'red',    counts: 'excluded' },
  insufficient_data:  { label: 'Insufficient data', tone: 'slate',  counts: 'excluded' },
  excused:            { label: 'Excused',           tone: 'slate',  counts: 'dropped' },
  missed:             { label: 'Missed',            tone: 'red',    counts: 'missed' },
};

const UNKNOWN = { label: 'Unknown', tone: 'slate', counts: 'open' };

export function csStatus(status) { return STATUS[status] || UNKNOWN; }
export function csStatusLabel(status) { return csStatus(status).label; }
export function isComplete(status) { return csStatus(status).counts === 'complete'; }
/** True when the reason this is not done is the device, not the athlete. */
export function isDeviceGap(status) { return csStatus(status).counts === 'excluded'; }

/* ---------------------------------------------------------------- numbers */

/** Thousands separators without Intl: the engine must render identically everywhere. */
export function groupThousands(n) {
  const neg = n < 0;
  const [whole, frac] = Math.abs(n).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** Canonical value → the number a human reads in the chosen display unit. */
export function toDisplay(value, metric, unit) {
  const v = Number(value) || 0;
  if (metric !== 'distance') return v;
  return unit === 'km' ? v / METRES_PER_KM : v / METRES_PER_MILE;
}

/** The reverse, for a builder that collects "12 miles" and must store metres. */
export function toCanonical(display, metric, unit) {
  const v = Number(display) || 0;
  if (metric !== 'distance') return v;
  return unit === 'km' ? v * METRES_PER_KM : v * METRES_PER_MILE;
}

/** Distance keeps two decimals (2.73 mi is a real run); counts and minutes are whole. */
export function fmtValue(value, metric, unit) {
  const d = toDisplay(value, metric, unit);
  if (metric === 'distance') {
    const rounded = Math.round(d * 100) / 100;
    return groupThousands(Number(rounded.toFixed(2).replace(/\.?0+$/, '')));
  }
  return groupThousands(Math.round(d));
}

/** The noun that follows the number. Singular where a human would say it. */
export function unitNoun(metric, unit, value) {
  const one = Math.abs(Math.round(toDisplay(value, metric, unit))) === 1;
  if (metric === 'steps') return one ? 'step' : 'steps';
  if (metric === 'distance') return unit === 'km' ? 'km' : 'mi';
  if (metric === 'workouts') return one ? 'workout' : 'workouts';
  return 'min';
}

/* ---------------------------------------------------------------- the athlete's lines */

/** "7,842 of 10,000 steps" — the line the whole feature is named after. */
export function csProgressLine(row) {
  const { metric, display_unit: unit, progress = 0, target = 0 } = row || {};
  return `${fmtValue(progress, metric, unit)} of ${fmtValue(target, metric, unit)} ${unitNoun(metric, unit, target)}`;
}

/** "2,158 to go", or null once the target is met — nobody needs to be told they have 0 left. */
export function remainingLabel(row) {
  const { metric, display_unit: unit, progress = 0, target = 0 } = row || {};
  const left = Number(target) - Number(progress);
  if (!(left > 0)) return null;
  return `${fmtValue(left, metric, unit)} to go`;
}

/** 0–100, capped. Capped because "112% of your coach's target" invites the wrong contest. */
export function progressPct(row) {
  const t = Number(row?.target) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(row?.progress) || 0) / t * 100)));
}

/** The local calendar date of an ISO instant in the viewer's zone. */
export function localDateISO(iso, offMin = localOffsetMin()) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return null;
  return new Date(t + (offMin || 0) * 60000).toISOString().slice(0, 10);
}

/**
 * "Synced 6:42 PM", or the honest absence of one.
 *
 * ⚠ A BARE TIME IS A LIE WHEN THE SYNC WASN'T TODAY. "Synced 2:04 PM" on a row that last heard
 * from the watch YESTERDAY reads as this afternoon, which is exactly backwards on the one state
 * this feature exists to get right — the athlete needs to know the device has gone quiet, not be
 * reassured it just reported. Pass todayISO to get the day back.
 */
export function syncedLabel(row, offMin = localOffsetMin(), todayISO = null) {
  if (!row?.last_synced_at) return 'Not synced yet';
  const at = fmtAt(row.last_synced_at, offMin);
  if (!at) return 'Not synced yet';
  const on = localDateISO(row.last_synced_at, offMin);
  if (!todayISO || !on || on === todayISO) return `Synced ${at}`;
  const ago = daysBetween(on, todayISO);
  if (ago === 1) return `Last synced yesterday, ${at}`;
  if (ago > 1) return `Last synced ${ago} days ago`;
  return `Synced ${at}`;
}

/** "Completed 8:17 PM" — the receipt, which is a different fact from the last sync. */
export function completedLabel(row, offMin = localOffsetMin()) {
  const at = row?.completed_at ? fmtAt(row.completed_at, offMin) : '';
  return at ? `Completed ${at}` : 'Complete';
}

/* ---------------------------------------------------------------- what counts as this metric
   The spec's walk-three-miles / run-three-miles distinction. A requirement that silently accepts
   ambient walking for a prescribed run is not a conditioning standard, and one that silently
   rejects it for a movement standard punishes an honest day. The rule is the coach's to set, and
   it is stated on the athlete's card so it is never a surprise after the fact. */
export function metricLabel(metric, deliberateWorkout) {
  if (metric === 'steps') return 'Daily steps';
  if (metric === 'distance') return deliberateWorkout ? 'Workout distance' : 'Walking + running';
  if (metric === 'workouts') return 'Recorded workouts';
  if (metric === 'workout_minutes') return 'Workout minutes';
  if (metric === 'active_minutes') return 'Active minutes';
  return 'Activity';
}

export function sourceRule(metric, deliberateWorkout, minDurationMin) {
  if (metric === 'distance') {
    return deliberateWorkout
      ? 'Counts distance from a recorded workout — daily walking does not apply.'
      : 'Counts all walking and running distance for the period.';
  }
  if (metric === 'steps') return 'Counts every step your phone or watch records.';
  if (metric === 'workouts' || metric === 'workout_minutes') {
    return minDurationMin
      ? `Counts recorded workouts of at least ${minDurationMin} minutes.`
      : 'Counts any recorded workout session.';
  }
  if (metric === 'active_minutes') return 'Counts active minutes your device records.';
  return '';
}

/* ---------------------------------------------------------------- weekly pace
   Computed, never stored: a stored "behind pace" is stale the moment the athlete takes a walk. */

const dayNum = (iso) => Math.floor(Date.parse(String(iso) + 'T12:00:00Z') / 86400000);
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

/**
 * Where a weekly standard actually stands. Null for a daily standard — a one-day period has no
 * pace, only a progress line, and inventing one would be noise.
 *
 * daysLeft INCLUDES today, because today is still a day you can go walk.
 */
export function paceToGoal(row, todayISO) {
  if (!row || row.period !== 'week') return null;
  const start = row.period_start, end = row.period_end;
  if (!start || !end || !todayISO) return null;

  const total = daysBetween(start, end) + 1;
  if (total <= 0) return null;

  const target = Number(row.target) || 0;
  const progress = Number(row.progress) || 0;
  const remaining = Math.max(0, target - progress);
  const daysLeft = Math.max(0, daysBetween(todayISO, end) + 1);
  const elapsed = Math.max(0, Math.min(total, daysBetween(start, todayISO) + 1));
  const expected = total ? target * (elapsed / total) : 0;

  let state;
  if (progress >= target) state = 'done';
  else if (daysLeft === 0) state = 'behind';
  // A 5% band around the ideal line, so a rounding-sized delta doesn't flip the chip
  // back and forth between "ahead" and "behind" on consecutive renders.
  else if (progress > expected * 1.05) state = 'ahead';
  else if (progress < expected * 0.95) state = 'behind';
  else state = 'on_pace';

  const neededPerDay = daysLeft > 0 ? remaining / daysLeft : remaining;

  return {
    state, daysLeft, daysTotal: total, remaining, neededPerDay,
    // Where the ideal line stands right now, as a percentage of the target. The column draws its
    // pace notch here, so the notch and the `state` above can never disagree — both read `elapsed`.
    expectedPct: Math.max(0, Math.min(100, Math.round((elapsed / total) * 100))),
    label: state === 'done' ? 'Complete'
         : state === 'ahead' ? 'Ahead of pace'
         : state === 'on_pace' ? 'On pace' : 'Behind pace',
    needLabel: state === 'done' || remaining <= 0 ? null
      : `Need ${fmtValue(neededPerDay, row.metric, row.display_unit)} ${unitNoun(row.metric, row.display_unit, neededPerDay)}/day`,
  };
}

/* ---------------------------------------------------------------- the column
   The athlete's hero mark. Deliberately NOT the score ring: the ring is the daily 0-100's
   letterform, and drawing it on the one surface whose job is to say "tracked, not scored" would
   undo the honesty this feature was built around. A column that fills from the bottom says
   "accumulating" instead of "graded", and it belongs to nothing else in the app.

   `state` is the whole vocabulary, and it exists so a sync gap cannot be drawn as a shortfall:

     live      still going, some of it verified          → sweep fill
     partial   the device owes us the rest of the truth  → sweep fill + hatched unknown above it
     unknown   no access at all; we know NOTHING         → dashed outline, no fill, no number
     done      target met                                → topped out, green lip
     missed    the period closed short                   → fill stays, lip goes red
     excused   staff removed it                          → flat and dim; there is nothing to show

   'partial' and 'unknown' are the two that matter. An empty column reads as "you did nothing",
   which is a claim about the ATHLETE. Neither state has earned that claim — one is a watch that
   hasn't reported and the other is a permission that was never granted. */
export function columnGeometry(row, pace) {
  const status = row?.status;
  const state = status === 'disconnected' ? 'unknown'
    : csStatus(status).counts === 'dropped' ? 'excused'
    : isComplete(status) ? 'done'
    : status === 'missed' ? 'missed'
    : isDeviceGap(status) ? 'partial'
    : 'live';

  // 'unknown' and 'excused' have no honest height. Everything else draws what was actually seen —
  // including 'missed', because the work the athlete did do is still true after the day closes.
  const fillPct = (state === 'unknown' || state === 'excused') ? 0 : progressPct(row);

  /* The notch is PACE, not the target — the top of the column is already the target, which frees
     the line to carry the more useful fact. It renders only where pace is real: a weekly window.
     paceToGoal returns null for a daily standard on purpose ("a one-day period has no pace, only
     a progress line, and inventing one would be noise"), and a notch drawn from a made-up model
     of when a day is supposed to be half over would be exactly that noise, dressed as precision. */
  const notchPct = (pace && pace.expectedPct != null
    && state !== 'done' && state !== 'excused' && state !== 'unknown')
    ? pace.expectedPct : null;

  return {
    state, fillPct, notchPct,
    // Behind is a fact about the clock, so it colours the NOTCH and the pace line — never the
    // fill. Recolouring the work the athlete actually did as a warning is a verdict, not a fact.
    behind: notchPct != null && fillPct < notchPct,
  };
}

/** The rows for one standard, oldest first. Shared by the streak and the momentum chart so the
 *  two can never disagree about which periods exist. */
function periodsOf(rows, standardId) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.standard_id === standardId)
    .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
}

/**
 * Consecutive completed periods, counting back from the most recent.
 *
 * A DEVICE GAP DOES NOT BREAK A RUN. This is the same doctrine `compliance()` holds one screen
 * down — 'excluded' leaves the denominator because no evidence is not evidence of failure — and
 * a streak that a dead battery could end would be measuring the watch, not the athlete. An open
 * period (today, still live) is likewise not yet a failure. Only an affirmative 'missed' ends it.
 */
export function streakOf(rows, standardId) {
  const mine = periodsOf(rows, standardId);
  let n = 0;
  for (let i = mine.length - 1; i >= 0; i--) {
    const counts = csStatus(mine[i].status).counts;
    if (counts === 'complete') { n++; continue; }
    if (counts === 'missed') break;
    // 'open', 'excluded', 'dropped' — neither extend the run nor end it.
  }
  return n;
}

/** The last `n` periods as bars. `pct` drives the height, `cls` the treatment. */
export function momentumOf(rows, standardId, n = 7) {
  return periodsOf(rows, standardId).slice(-n).map((r) => ({
    iso: r.period_start,
    status: r.status,
    pct: progressPct(r),
    cls: isComplete(r.status) ? 'ok'
      : r.status === 'missed' ? 'miss'
      : csStatus(r.status).counts === 'dropped' ? 'exc'
      : isDeviceGap(r.status) ? 'gap' : 'now',
  }));
}

/* ---------------------------------------------------------------- rollups
   Mirrors accountability_raw's arithmetic in 0155's sibling migration, and holds the same two
   rules: 'excused' leaves the row entirely, and a device gap leaves the denominator. */

export function compliance(rows) {
  let complete = 0, missed = 0, open = 0, excluded = 0, dropped = 0;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    switch (csStatus(r?.status).counts) {
      case 'complete': complete++; break;
      case 'missed':   missed++;   break;
      case 'excluded': excluded++; break;
      case 'dropped':  dropped++;  break;
      default:         open++;
    }
  }
  const denominator = complete + missed;
  return {
    complete, missed, open, excluded, dropped, denominator,
    // No data reports null, never a fake zero — an athlete whose watch broke has not failed.
    pct: denominator ? Math.round((complete / denominator) * 100) : null,
  };
}

/** The coach's headline: "46 of 55 complete · 2 awaiting sync · 1 disconnected". */
export function boardCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by = (s) => list.filter(r => r?.status === s).length;
  return {
    total: list.length,
    complete: list.filter(r => isComplete(r?.status)).length,
    verified: by('verified_complete'),
    reported: by('completed_manually'),
    inProgress: by('in_progress'),
    awaitingReview: by('awaiting_review'),
    awaitingSync: by('awaiting_sync'),
    disconnected: by('disconnected'),
    insufficient: by('insufficient_data'),
    excused: by('excused'),
    missed: by('missed'),
    ...compliance(list),
  };
}

/** The rows a coach actually has to act on, in the order they should act on them. */
export function needsAttention(rows) {
  const rank = { awaiting_review: 0, disconnected: 1, insufficient_data: 2, awaiting_sync: 3 };
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && (r.status in rank || r.disputed_at))
    .sort((a, b) => (a.disputed_at ? -1 : 0) - (b.disputed_at ? -1 : 0)
                 || (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

/* ---------------------------------------------------------------- grouping for the athlete */

/** "From your coach" above "Personal", because an obligation outranks an intention. */
export function groupForAthlete(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    assigned: list.filter(r => r?.source_kind !== 'personal'),
    personal: list.filter(r => r?.source_kind === 'personal'),
  };
}

/** Today's rows: a daily standard for today, plus every weekly window containing today. */
export function activeOn(rows, todayISO) {
  return (Array.isArray(rows) ? rows : []).filter(r =>
    r && r.instance_status !== 'cancelled' &&
    daysBetween(r.period_start, todayISO) >= 0 &&
    daysBetween(todayISO, r.period_end) >= 0);
}
