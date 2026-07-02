// OnStandard — Trust Pass math (pure TS, no RN imports).
//
// The Trust Pass is an EARNED, coach-granted camera-free reward: once an athlete has proven
// himself, his daily one-tap "yes" credits a real on-standard day WITHOUT a photo — worth
// exactly what his own camera already proved he does. This module owns the load-bearing
// number: his trailing EARNED nutrition baseline. See docs/council/2026-07-02-trust-pass.md.
import type { DayScore } from './types';
import type { CommitmentAnswer } from './commitment';
import { COMPLIANCE_THRESHOLD } from './history';

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

/**
 * Eligibility gate: a pass can only be granted once the athlete has enough REAL on-standard
 * (>= the compliance threshold) days on record — proof he built a baseline, so a pass can
 * never be earned from nothing. Counts overall on-standard days from scoreHistory. (At
 * go-live this count is authoritative on the server; the client mirror is advisory.)
 */
export function passEligibility(
  scoreHistory: DayScore[],
  minDays = 7,
  threshold: number = COMPLIANCE_THRESHOLD,
): { eligible: boolean; onStandardDays: number } {
  const onStandardDays = (scoreHistory ?? []).filter((d) => typeof d.score === 'number' && Number.isFinite(d.score) && d.score >= threshold).length;
  return { eligible: onStandardDays >= minDays, onStandardDays };
}

/** A coach-granted Trust Pass. Client state for the pilot; server-authoritative (RLS
 *  coach-write / athlete-read) at go-live so a pass can't be self-granted by a spoofed client. */
export interface TrustPass {
  /** ISO date (YYYY-MM-DD) the pass was granted. */
  grantedDate: string;
  /** Pass length in days (e.g. 7 / 14 / 30). */
  lengthDays: number;
}

export type PassPhase = 'active' | 'expired';

export interface PassStatus {
  phase: PassPhase;
  /** 0-based camera-free day index since the grant. */
  dayIndex: number;
  /** True when today is a spot-check: the camera comes back and the day scores by the normal
   *  photo path. Deterministic every-Nth here; seeded-random + server-owned at go-live. */
  isCheckDay: boolean;
  /** Forward-only staleness decay multiplier (0..1) applied to the credited baseline after a
   *  run of camera-free days, so nobody coasts a full window on one good week. */
  decayPct: number;
}

/** Whole calendar days from `fromIso` to `toIso` (>= 0). Pure; dates are YYYY-MM-DD. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

const CHECK_EVERY = 5; // spot-check cadence (deterministic pilot; seeded-random server-side at go-live)
const DECAY_START_DAY = 10; // camera-free days before the credit starts to decay
const DECAY_PER_DAY = 0.05; // ~4 pts/day off an ~80 baseline once decay begins

/** Derived status of a pass on a given day: active vs expired, the camera-free day index, whether
 *  today is a spot-check, and the staleness-decay multiplier. Null when there is no pass. */
export function passStatus(pass: TrustPass | null | undefined, todayIso: string): PassStatus | null {
  if (!pass) return null;
  const dayIndex = daysBetween(pass.grantedDate, todayIso);
  if (dayIndex >= pass.lengthDays) return { phase: 'expired', dayIndex, isCheckDay: false, decayPct: 1 };
  const isCheckDay = dayIndex > 0 && dayIndex % CHECK_EVERY === 0;
  const overStale = Math.max(0, dayIndex - DECAY_START_DAY);
  const decayPct = Math.max(0, 1 - overStale * DECAY_PER_DAY);
  return { phase: 'active', dayIndex, isCheckDay, decayPct };
}

/**
 * The nutrition credit for a camera-free pass day: the athlete's trailing earned-nutrition
 * median, scaled by his one-tap answer and the staleness decay. Returns `requiresPhoto: true`
 * on a spot-check day (the camera comes back; the normal photo path scores it) and null when
 * the pass is inactive/expired or there is no earned baseline to credit against.
 */
export function passDayCredit(
  pass: TrustPass | null | undefined,
  nutritionHistory: DayScore[],
  todayIso: string,
  answer: CommitmentAnswer | null | undefined,
): { nutrition: number; requiresPhoto: boolean } | null {
  const st = passStatus(pass, todayIso);
  if (!st || st.phase !== 'active') return null;
  if (st.isCheckDay) return { nutrition: 0, requiresPhoto: true };
  const base = trailingEarnedNutritionMedian(nutritionHistory);
  if (base == null) return null;
  return { nutrition: Math.round(passDayNutritionScore(base, answer) * st.decayPct), requiresPhoto: false };
}
