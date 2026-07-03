// OnStandard — server-mirrored score-integrity ceiling (pure TS, no RN imports).
//
// The Development Score is computed by computeDerived() from inputs the `days` table does
// NOT fully persist (per-athlete protein/cal targets, ciConfig, mealFoods, scoringProfile,
// scoreHistory). A faithful server RECOMPUTE is therefore infeasible, and a partial one
// would drift from the canonical TS formula and mis-score every athlete — strictly worse
// than the gap it chases (see supabase/migrations/0029 note).
//
// This is the alternative that closes the "flat 100 with no logging" gap WITHOUT that risk:
// a monotone UPPER BOUND on the score, derived only from evidence gates. It never recomputes
// the score — it only caps a value that EXCEEDS what the evidence can justify. Because a real
// day's score is ALWAYS <= its own evidence ceiling (proven by the property test in
// scoreIntegrity.test.ts), clamping DOWN to the ceiling can never lower an honest score; it
// can only cut a fabricated over-report. The 0041 Postgres trigger enforces this server-side
// (a tampered client bypasses everything in this file); this TS copy is the tested spec that
// mirror and the honest client self-limit both share.
import type { Derived } from './types';
import { PROFILE_WEIGHTS } from './scoringProfiles';
import { withinTrailingWeek } from './clock';

/**
 * The MAXIMUM weight each subscore carries across ALL scoring profiles (athlete/general/gain).
 * Using the per-component max makes the ceiling a valid upper bound whatever profile the
 * athlete is on, so neither the trigger nor the row has to know the profile. Derived from
 * PROFILE_WEIGHTS so it can never silently drift from the engine.
 */
export const MAX_SUBSCORE_WEIGHT = ((): { nutrition: number; recovery: number; commitment: number; checkin: number } => {
  const ws = Object.values(PROFILE_WEIGHTS);
  const maxOf = (k: 'nutrition' | 'recovery' | 'commitment' | 'checkin') => Math.max(...ws.map((w) => w[k]));
  return { nutrition: maxOf('nutrition'), recovery: maxOf('recovery'), commitment: maxOf('commitment'), checkin: maxOf('checkin') };
})();

/** The evidence gates a `days` row carries, each unlocking one weighted slot of the ceiling. */
export interface ScoreEvidence {
  /** A meal slot was logged (meal-count credit alone makes nutrition > 0), OR an active
   *  trust pass credits nutrition camera-free. Unlocks the nutrition slot (<= 55). */
  nutritionPossible: boolean;
  /** A real check-in backs the week (submitted today, or carried from a submission in the
   *  trailing 6 days). Unlocks BOTH the recovery (<= 25) and check-in (<= 10) slots. */
  checkinPossible: boolean;
  /** A plan-commitment answer is on the row. Unlocks the commitment slot (<= 15). */
  commitmentPresent: boolean;
}

/**
 * The maximum Development Score the evidence can justify (integer 0..100). A real
 * computeDerived() score is always <= this for the same evidence, so it is safe to clamp a
 * written score down to it.
 */
export function evidenceScoreCeiling(ev: ScoreEvidence): number {
  const w = MAX_SUBSCORE_WEIGHT;
  const ceil =
    (ev.nutritionPossible ? w.nutrition : 0) * 100 +
    (ev.checkinPossible ? w.recovery + w.checkin : 0) * 100 +
    (ev.commitmentPresent ? w.commitment : 0) * 100;
  return Math.min(100, Math.round(ceil));
}

/** Clamp a (possibly client-reported) score down to what the evidence supports. Never raises. */
export function clampScoreToEvidence(score: number, ev: ScoreEvidence): number {
  return Math.min(score, evidenceScoreCeiling(ev));
}

/**
 * Derive the evidence gates from an already-computed Derived (the honest client's own
 * output). Each gate is true exactly when its subscore is non-zero, which makes the clamp a
 * provable no-op for a correct client (the score can't exceed a ceiling built from the very
 * subscores that produced it) while still catching a regression that ever over-scores.
 */
export function evidenceFromDerived(d: Derived): ScoreEvidence {
  return {
    nutritionPossible: d.nutritionScore > 0,
    checkinPossible: d.recoveryScoreIsReal || d.checkinScore > 0,
    commitmentPresent: d.commitmentScore > 0,
  };
}

/**
 * Derive the evidence gates the SERVER trigger (0041) uses, from the row's OWN jsonb — not
 * from a Derived object. This mirrors the SQL exactly, so the property test can prove the
 * *server-side* ceiling (the authoritative control) never clamps an honest score — including
 * the weekly recovery CARRY, which the row self-describes via `checkin.ciLast` so the server
 * never has to reconstruct cross-day history it can't reliably see. Facts that genuinely live
 * outside the row (an active trust pass; a prior submitted row still visible server-side) are
 * passed via `ctx`; both only ever GRANT more ceiling, so omitting them stays a safe (never
 * false-positive) lower bound on what the SQL would allow.
 */
export function evidenceFromDayRow(
  row: { date: string; meals?: Record<string, boolean> | null; checkin?: Record<string, unknown> | null },
  ctx: { activeTrustPass?: boolean; priorSubmittedInWeek?: boolean } = {},
): ScoreEvidence {
  const meals = row.meals ?? {};
  const ci = row.checkin ?? {};
  const anyMealLogged = Object.values(meals).some((v) => v === true);
  const sm = ci.slotMacros;
  const hasSlotMacros = !!sm && typeof sm === 'object' && Object.keys(sm as Record<string, unknown>).length > 0;
  const submitted = ci.submitted === true;
  const ciLast = typeof ci.ciLast === 'string' ? ci.ciLast : null;
  const carryInWindow = ciLast != null && withinTrailingWeek(ciLast, row.date);
  const commitment = ci.commitment;
  return {
    nutritionPossible: anyMealLogged || hasSlotMacros || !!ctx.activeTrustPass,
    checkinPossible: submitted || carryInWindow || !!ctx.priorSubmittedInWeek,
    commitmentPresent: commitment === 'yes' || commitment === 'partial' || commitment === 'no',
  };
}
