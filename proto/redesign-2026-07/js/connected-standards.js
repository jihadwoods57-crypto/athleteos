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

/** "Synced 6:42 PM", or the honest absence of one. */
export function syncedLabel(row, offMin = localOffsetMin()) {
  if (!row?.last_synced_at) return 'Not synced yet';
  const at = fmtAt(row.last_synced_at, offMin);
  return at ? `Synced ${at}` : 'Not synced yet';
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
    label: state === 'done' ? 'Complete'
         : state === 'ahead' ? 'Ahead of pace'
         : state === 'on_pace' ? 'On pace' : 'Behind pace',
    needLabel: state === 'done' || remaining <= 0 ? null
      : `Need ${fmtValue(neededPerDay, row.metric, row.display_unit)} ${unitNoun(row.metric, row.display_unit, neededPerDay)}/day`,
  };
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
