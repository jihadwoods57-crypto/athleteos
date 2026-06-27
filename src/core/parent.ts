// AthleteOS — pure helpers for the Parent dashboard (pure TS, no RN imports).
// The parent persona (Sharon) flagged that the AI summary always reads
// "No action needed this week" regardless of the data, and that partial history
// is shown as if it were a full week. A parent's whole job is honest visibility,
// so the summary must (a) reflect the athlete's ACTUAL score band instead of a
// frozen reassurance, and (b) state how much of the week has actually been logged
// (a freshness/coverage signal) rather than implying seven complete days.
//
// These are derivations off the same real score + history the athlete's own Home
// screen draws from; nothing here fabricates a coach, a sync time, or a number.

const DAYS_IN_WEEK = 7;

/**
 * How much of this week the athlete has actually logged, as an honest coverage
 * line. `completedDays` is the count of completed score-history days this week
 * (today is still in progress, so it is not counted as complete). Below a full
 * week it reads "Building history: N of 7 days logged this week"; a full week
 * reads "7 of 7 days logged this week". Never claims more than the data supports.
 */
export function parentHistoryCoverage(completedDays: number): string {
  const n = Math.max(0, Math.min(DAYS_IN_WEEK, Math.floor(completedDays || 0)));
  if (n >= DAYS_IN_WEEK) return `${DAYS_IN_WEEK} of ${DAYS_IN_WEEK} days logged this week`;
  return `Building history: ${n} of ${DAYS_IN_WEEK} days logged this week`;
}

export interface ParentDigest {
  /** Freshness/coverage line — how much of the week is actually logged. */
  coverage: string;
  /** The honest one-line read, derived from the real score band (NOT a frozen
   *  "no action needed"). When the athlete has slipped it says so. */
  summary: string;
  /** Whether the summary is a reassurance (true) or a gentle flag (false), so the
   *  UI can tint it without re-deriving the band. */
  reassuring: boolean;
}

/**
 * The parent's honest weekly read. Derives the summary from the athlete's real
 * Accountability Score band rather than the previous always-on reassurance, and
 * carries the coverage line so a partial week is labelled as such.
 *
 * - score >= 80: meeting targets (reassuring)
 * - 70-79: mostly on track, a day or two to tighten (reassuring, qualified)
 * - < 70: slipped this week, a check-in could help (a flag, not an alarm)
 *
 * A non-finite/out-of-range score is clamped to the safe 0..100 band so the copy
 * never reads from a NaN.
 */
export function parentDigest(opts: { score: number; completedDays: number; first: string }): ParentDigest {
  const raw = Number(opts.score);
  const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const first = opts.first?.trim() || 'Your athlete';
  const coverage = parentHistoryCoverage(opts.completedDays);

  if (score >= 80) {
    return {
      coverage,
      summary: `${first} is meeting their protein and recovery targets and trending toward the weight goal. Nothing needs you this week. You'll see a flag here if that changes.`,
      reassuring: true,
    };
  }
  if (score >= 70) {
    return {
      coverage,
      summary: `${first} is mostly on track this week, with a day or two to tighten up. Worth a light check-in, not a worry.`,
      reassuring: true,
    };
  }
  return {
    coverage,
    summary: `${first} has been behind their targets this week. A calm check-in about meals and recovery could help them get back on plan.`,
    reassuring: false,
  };
}
