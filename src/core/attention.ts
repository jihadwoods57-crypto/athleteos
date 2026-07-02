// OnStandard — at-risk detection for the overseer dashboards (pure TS, no RN imports).
// The coach/trainer dashboard answers one question on open: "who needs my attention
// today?" This derives that list from the live roster/book instead of hand-picked
// rows, so the Needs-Attention surface, its count badge, and the alerts/follow-ups
// KPI can never disagree, the most-at-risk athlete sorts first, and the reason is a
// derived sentence (compliance + trend + recency) rather than a frozen string. The
// real-data contract a richer at-risk model swaps behind later.
// See docs/specs/2026-06-23-next-phase-product-spec.md section 3.
import { COACH_ALERT_THRESHOLD } from './leaderboard';

export type RiskTone = 'warning' | 'alert';

/** Minimal shape both RosterRow (coach) and ClientRow (trainer) satisfy. `last`
 *  is the trainer book's "last logged" label (e.g. "Today", "5 days ago").
 *  The optional signal fields let a row carry the SPECIFIC reasons the product
 *  spec names (protein missed N of 7, hydration down, weight stalled, no
 *  check-in) so the dashboard reads like a real coaching tool; a row that omits
 *  them still gets an honest reason from compliance + trend + recency. */
export interface AtRiskInput {
  name: string;
  /** The linked athlete's backend id (present when the roster came from real days rows);
   *  lets the coach's nudge target the right athlete for push. Absent on the seeded demo. */
  athleteId?: string;
  score: number;
  comp: number;
  dir: 'up' | 'down' | 'flat';
  last?: string;
  /** Days in the last 7 the athlete missed their protein target (0-7). */
  proteinMissed?: number;
  /** Hydration trending below target this week. */
  hydrationLow?: boolean;
  /** Weight goal stalled (no movement toward the target). */
  weightStalled?: boolean;
  /** Days since the athlete's last weekly check-in (undefined = unknown). */
  checkinDaysAgo?: number;
}

export interface AtRisk extends AtRiskInput {
  /** Derived, honest meta sentence (compliance + trend/recency). */
  reason: string;
  /** Deep alert vs borderline warning, for the row's score color. */
  tone: RiskTone;
}

/**
 * Lower = more at risk. Score carries most of the weight (it is the shared
 * currency), compliance is the nutrition-first secondary signal, and a downward
 * trend pushes an athlete up the list while an upward one eases them down. Used
 * only to RANK; membership is decided by the alert threshold below.
 */
export function riskValue(a: AtRiskInput): number {
  const trendAdj = a.dir === 'down' ? -5 : a.dir === 'up' ? 4 : 0;
  return a.score * 0.6 + a.comp * 0.4 + trendAdj;
}

/** Deep alert (low score or low compliance) vs a borderline warning. */
export function riskTone(a: AtRiskInput): RiskTone {
  return a.score < 70 || a.comp < 60 ? 'alert' : 'warning';
}

/** Parse a trainer "last logged" label into whole days since logging (or null). */
function daysQuiet(last: string | undefined): number | null {
  if (!last) return null;
  const m = last.match(/(\d+)\s*day/i);
  if (m) return Number(m[1]);
  if (/yesterday/i.test(last)) return 1;
  if (/today/i.test(last)) return 0;
  return null;
}

/**
 * A derived, honest reason for why this athlete needs attention. When the row
 * carries the SPECIFIC spec signals (protein missed N of 7, hydration down,
 * weight stalled, no check-in for N days) the reason names them, nutrition-first,
 * so a coach reads exactly what to act on. A row that carries none of those falls
 * back to a reason built only from compliance + trend + recency, so it never
 * invents a stat the data can't back. Capped at the three most-actionable clauses
 * so the line stays glanceable.
 */
export function atRiskReason(a: AtRiskInput): string {
  const signals: string[] = [];
  // Nutrition-first: the protein signal leads (>= 2 missed days is worth saying).
  if (typeof a.proteinMissed === 'number' && a.proteinMissed >= 2) {
    signals.push(`Protein missed ${a.proteinMissed} of 7 days`);
  }
  if (a.hydrationLow) signals.push('hydration down');
  if (a.weightStalled) signals.push('weight stalled');
  if (typeof a.checkinDaysAgo === 'number' && a.checkinDaysAgo >= 3) {
    signals.push(`no check-in ${a.checkinDaysAgo} days`);
  }
  if (signals.length > 0) return signals.slice(0, 3).join(' · ');

  // Fallback: no specific signal carried, so read compliance + trend + recency.
  const clauses: string[] = [];
  if (a.comp <= 0) clauses.push('No meals logged yet');
  else if (a.comp < 60) clauses.push(`${a.comp}% compliant, logging slipping`);
  else if (a.comp < 75) clauses.push(`${a.comp}% compliant, missing days`);
  else clauses.push(`${a.comp}% compliant`);

  const quiet = daysQuiet(a.last);
  if (quiet !== null && quiet >= 2) clauses.push(`${quiet} days quiet`);
  else if (a.dir === 'down') clauses.push('trending down');
  return clauses.join(' · ');
}

/**
 * The Needs-Attention list: everyone below the alert threshold, most-at-risk
 * first, each carrying a derived reason + tone. The SAME `score < threshold`
 * predicate the alerts/follow-ups KPI uses, so the list length always equals the
 * KPI count and the badge can be driven straight off `.length`.
 */
export function needsAttention(list: AtRiskInput[], threshold: number = COACH_ALERT_THRESHOLD): AtRisk[] {
  return list
    .filter((a) => a.score < threshold)
    .sort((a, b) => riskValue(a) - riskValue(b))
    .map((a) => ({ ...a, reason: atRiskReason(a), tone: riskTone(a) }));
}

/**
 * Sort a whole roster/book worst-first (most at-risk leading), using the same
 * `riskValue` ranking the Needs-Attention list uses. So the full table below the
 * alert card agrees with it: the athletes a coach should act on first lead the
 * list instead of sitting in arbitrary seed order. Pure + non-mutating.
 */
export function rankByRisk<T extends AtRiskInput>(list: T[]): T[] {
  return [...list].sort((a, b) => riskValue(a) - riskValue(b));
}

/**
 * The plain-language read of a score, so the words a coach sees always match the
 * number: "On standard" (dialed in), "On the bubble" (real but inconsistent),
 * "Needs intervention" (not accountable yet). Anchored to the spec's 95 / 75 / 60.
 */
export function scoreLanguage(score: number): string {
  if (score >= 85) return 'On standard';
  if (score >= 70) return 'On the bubble';
  return 'Needs intervention';
}
