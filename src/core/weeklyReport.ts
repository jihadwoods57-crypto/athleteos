// OnStandard — weekly auto-report (P4, pure TS, no RN imports).
//
// The coach/parent leverage feature: a per-athlete weekly digest the app can show
// in-app or export (to paste into a message), so an overseer gets the week at a
// glance without nagging. This is the PURE generator — score, compliance, what
// moved week-over-week, and the single most important flag. Delivery to a real
// person (push/email) is the backend/founder step; this only builds the content.
// Copy follows the shipped guardrails: factual, no guilt, no em dash.
import { riskValue, scoreLanguage } from './attention';
import { weeklyCompliance } from './history';
import type { DayScore } from './types';

export interface WeeklyReportInput {
  name: string;
  /** This week's completed-day accountability scores, oldest -> newest (0..100). */
  scores: number[];
  /** Last week's average score, if known, for the week-over-week read. null/undefined = unknown. */
  priorAvg?: number | null;
  /** Weekly nutrition compliance: share of days on plan, 0..100. */
  compliance: number;
  /** Days in the last 7 the athlete missed their protein target (0-7). */
  proteinMissed?: number;
  /** Hydration trending below target this week. */
  hydrationLow?: boolean;
  /** Weight goal stalled (no movement toward the target). */
  weightStalled?: boolean;
  /** Days since the athlete's last weekly check-in (undefined = unknown). */
  checkinDaysAgo?: number;
}

export interface WeeklyReport {
  name: string;
  /** Mean of this week's completed scores, rounded (0 if no days logged). */
  avgScore: number;
  /** Completed days logged this week. */
  daysLogged: number;
  /** Plain band word for avgScore ("On standard" / "On the bubble" / ...). */
  status: string;
  /** "Strong week" / "Mixed week" / "Tough week" / "No data yet". */
  headline: string;
  /** One-line score summary. */
  scoreLine: string;
  /** One-line compliance summary. */
  complianceLine: string;
  /** What moved week-over-week. */
  movedLine: string;
  /** The single most important thing to act on this week, or null if none. */
  flag: string | null;
}

/** Threshold (in score points) for a week-over-week move to count as real movement. */
export const MOVE_THRESHOLD = 3;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * The single most important flag for the week, nutrition-first, or null when the
 * week is clean. Only ONE line so the digest stays glanceable; ordered by how
 * much it should pull the overseer's attention.
 */
function weeklyFlag(input: WeeklyReportInput, daysLogged: number, compliance: number): string | null {
  if (daysLogged === 0) return 'No days logged this week, accountability has stalled.';
  if (typeof input.proteinMissed === 'number' && input.proteinMissed >= 2) {
    return `Protein behind on ${input.proteinMissed} of 7 days.`;
  }
  if (compliance < 60) return `Logging is slipping at ${compliance}% of days on plan.`;
  if (typeof input.checkinDaysAgo === 'number' && input.checkinDaysAgo >= 3) {
    return `No check-in in ${input.checkinDaysAgo} days.`;
  }
  if (input.hydrationLow) return 'Hydration trended low this week.';
  if (input.weightStalled) return 'Weight goal has stalled.';
  return null;
}

/** Build the per-athlete weekly digest from this week's scores + signals. Pure. */
export function weeklyReport(input: WeeklyReportInput): WeeklyReport {
  const scores = input.scores.filter((s) => Number.isFinite(s));
  const daysLogged = scores.length;
  const avgScore = mean(scores);
  const compliance = clampPct(input.compliance);
  const status = scoreLanguage(avgScore);

  const headline =
    daysLogged === 0 ? 'No data yet' : avgScore >= 85 ? 'Strong week' : avgScore >= 70 ? 'Mixed week' : 'Tough week';

  const scoreLine =
    daysLogged === 0
      ? 'No days logged this week yet.'
      : `Averaged ${avgScore} across ${daysLogged} ${daysLogged === 1 ? 'day' : 'days'} (${status}).`;

  const complianceLine =
    daysLogged === 0 ? 'No meals on plan logged yet.' : `${compliance}% of days on plan.`;

  let movedLine: string;
  if (daysLogged === 0) {
    movedLine = 'Nothing logged yet, so there is nothing to compare.';
  } else if (input.priorAvg == null || !Number.isFinite(input.priorAvg)) {
    movedLine = 'First week tracked, this sets the baseline.';
  } else {
    const delta = avgScore - Math.round(input.priorAvg);
    if (delta >= MOVE_THRESHOLD) movedLine = `Up ${delta} points from last week.`;
    else if (delta <= -MOVE_THRESHOLD) movedLine = `Down ${Math.abs(delta)} points from last week.`;
    else movedLine = 'Holding steady from last week.';
  }

  return {
    name: input.name,
    avgScore,
    daysLogged,
    status,
    headline,
    scoreLine,
    complianceLine,
    movedLine,
    flag: weeklyFlag(input, daysLogged, compliance),
  };
}

/**
 * Build the weekly digest straight from persisted store state, so a screen can show
 * it with no plumbing. `scoreHistory` is the recorded completed-day scores; the last
 * 7 are this week, the 7 before set `priorAvg`. Compliance reuses `weeklyCompliance`
 * (share of completed days on plan). A brand-new athlete with no history yields the
 * honest "No data yet" report. Pure.
 */
export function weeklyReportFromState(opts: {
  name: string;
  scoreHistory: DayScore[];
  liveScore: number;
  now?: Date;
}): WeeklyReport {
  const history = opts.scoreHistory ?? [];
  const recent = history.slice(-7);
  const prior = history.slice(-14, -7);
  const priorAvg = prior.length
    ? Math.round(prior.reduce((a, d) => a + d.score, 0) / prior.length)
    : null;
  const comp = weeklyCompliance(history, opts.liveScore, undefined, undefined, opts.now);
  const compliance = comp.total ? Math.round((comp.onPlan / comp.total) * 100) : 0;
  return weeklyReport({ name: opts.name, scores: recent.map((d) => d.score), priorAvg, compliance });
}

// ---------------------------------------------------------------- team-level (coach)

/** Minimal per-athlete shape the team digest needs (RosterRow satisfies it). */
export interface TeamMember {
  name: string;
  score: number;
  comp: number;
  dir: 'up' | 'down' | 'flat';
}

export interface TeamWeeklyReport {
  athletes: number;
  /** Mean roster score, rounded (0 for an empty roster). */
  avgScore: number;
  /** Mean roster compliance %, rounded. */
  compliance: number;
  /** Plain band word for avgScore. */
  status: string;
  /** "Strong week" / "Mixed week" / "Tough week" / "No athletes yet". */
  headline: string;
  /** Counts across the score bands (mirrors scoreLanguage). */
  onStandard: number;
  onBubble: number;
  needsIntervention: number;
  /** Trend-direction counts across the roster. */
  trendingUp: number;
  trendingDown: number;
  /** Honest week-direction read from the trend distribution (no fabricated prior week). */
  movedLine: string;
  /** Best mover (trending up, highest score) and most-at-risk (lowest risk rank), or null. */
  mostImproved: { name: string; score: number } | null;
  mostAtRisk: { name: string; score: number } | null;
}

/**
 * Aggregate a roster into a team weekly digest a coach can glance at or share: average
 * score + compliance, the band distribution, how many are trending which way, the best
 * mover, and the athlete most at risk. Honest by construction: it reports only what the
 * roster carries (no invented week-over-week when prior data is absent). Pure.
 */
export function teamWeeklyReport(roster: TeamMember[]): TeamWeeklyReport {
  const n = roster.length;
  if (n === 0) {
    return {
      athletes: 0, avgScore: 0, compliance: 0, status: scoreLanguage(0),
      headline: 'No athletes yet', onStandard: 0, onBubble: 0, needsIntervention: 0,
      trendingUp: 0, trendingDown: 0, movedLine: 'No athletes on the roster yet.',
      mostImproved: null, mostAtRisk: null,
    };
  }
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const avgScore = avg(roster.map((r) => r.score));
  const compliance = clampPct(avg(roster.map((r) => r.comp)));

  let onStandard = 0, onBubble = 0, needsIntervention = 0;
  for (const r of roster) {
    const band = scoreLanguage(r.score);
    if (band === 'On standard') onStandard++;
    else if (band === 'On the bubble') onBubble++;
    else needsIntervention++;
  }
  const trendingUp = roster.filter((r) => r.dir === 'up').length;
  const trendingDown = roster.filter((r) => r.dir === 'down').length;

  const headline = avgScore >= 85 ? 'Strong week' : avgScore >= 70 ? 'Mixed week' : 'Tough week';
  const movedLine =
    trendingUp === 0 && trendingDown === 0
      ? 'The room is holding steady this week.'
      : `${trendingUp} trending up, ${trendingDown} trending down.`;

  // Best mover: an athlete trending up, highest score among them.
  const risers = roster.filter((r) => r.dir === 'up').sort((a, b) => b.score - a.score);
  const mostImproved = risers.length ? { name: risers[0].name, score: risers[0].score } : null;
  // Most at risk: lowest risk rank (same ordering the Needs-Attention list uses).
  const ranked = [...roster].sort((a, b) => riskValue(a) - riskValue(b));
  const worst = ranked[0];
  const mostAtRisk = worst ? { name: worst.name, score: worst.score } : null;

  return {
    athletes: n, avgScore, compliance, status: scoreLanguage(avgScore), headline,
    onStandard, onBubble, needsIntervention, trendingUp, trendingDown, movedLine,
    mostImproved, mostAtRisk,
  };
}

/** Plain-text team digest for the share/paste path. ASCII only, no em dash. */
export function teamWeeklyReportText(report: TeamWeeklyReport, teamName: string): string {
  const lines = [
    `Team weekly report: ${teamName}`,
    report.headline,
    '',
    `Team average: ${report.avgScore} (${report.status}) across ${report.athletes} athletes.`,
    `Compliance: ${report.compliance}% of days on plan.`,
    `Standing: ${report.onStandard} on standard, ${report.onBubble} on the bubble, ${report.needsIntervention} needs intervention.`,
    report.movedLine,
    report.mostImproved ? `Best mover: ${report.mostImproved.name} (${report.mostImproved.score}).` : 'Best mover: none trending up yet.',
    report.mostAtRisk ? `Most at risk: ${report.mostAtRisk.name} (${report.mostAtRisk.score}).` : 'Most at risk: none.',
  ];
  return lines.join('\n');
}

/**
 * Plain-text rendering of the digest, for the exportable / paste-into-a-message
 * path. No em dash (design ban); ASCII only so it survives any channel.
 */
export function weeklyReportText(report: WeeklyReport): string {
  const lines = [
    `Weekly report: ${report.name}`,
    report.headline,
    '',
    report.scoreLine,
    report.complianceLine,
    report.movedLine,
    report.flag ? `Flag: ${report.flag}` : 'No flags this week.',
  ];
  return lines.join('\n');
}
