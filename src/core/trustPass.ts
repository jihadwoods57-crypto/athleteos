// OnStandard — Trust Pass math (pure TS, no RN imports).
//
// The Trust Pass is an EARNED, coach-granted camera-free reward: once an athlete has proven
// himself, his daily one-tap "yes" credits a real on-standard day WITHOUT a photo — worth
// exactly what his own camera already proved he does. This module owns the load-bearing
// number: his trailing EARNED nutrition baseline. See docs/council/2026-07-02-trust-pass.md.
import type { DayScore } from './types';
import type { CommitmentAnswer } from './commitment';

/**
 * The athlete's trailing earned-nutrition baseline: the MEDIAN of his last `n` real
 * photo-earned daily nutrition sub-scores (from `nutritionHistory`, which already persists
 * the per-day earned nutritionScore). This is the value a pass-day "yes" credits — "worth
 * what you actually do on a normal day," not your best day. Median (not mean) so one
 * hero-plate can't inflate a coaster's credit. Returns null when there is no earned history
 * to form an honest baseline (and so no pass can be credited from nothing).
 */
export function trailingEarnedNutritionMedian(nutritionHistory: DayScore[], n = 10): number | null {
  if (!nutritionHistory || nutritionHistory.length === 0) return null;
  const recent = nutritionHistory
    .slice(-n)
    .map((h) => h.score)
    .filter((s) => typeof s === 'number' && Number.isFinite(s));
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/**
 * The nutrition sub-score a pass-day one-tap credits: `f(answer) * base`, where the base is
 * the athlete's trailing earned-nutrition median and f(yes)=1.0 / f(partial)=0.6 / f(no)=0.0
 * (an unanswered day = 0). Honesty invariant (council-locked): no <= partial <= yes, and a
 * "yes" is worth EXACTLY the proven baseline — it never manufactures a number above what his
 * own camera measured. The daily-score honesty firewall (nutrition = 0 without a photo for a
 * NON-pass athlete) is preserved because this substitute is only ever applied inside an
 * active, coach-granted pass. See docs/council/2026-07-02-trust-pass.md.
 */
export function passDayNutritionScore(base: number, answer: CommitmentAnswer | null | undefined): number {
  const f = answer === 'yes' ? 1.0 : answer === 'partial' ? 0.6 : 0.0;
  return Math.round(f * base);
}
