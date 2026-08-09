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
 * The date score v2 takes effect. Rows dated BEFORE this keep the v1 slots: they were earned
 * under a formula with a real 15-point commitment slot and a 35-point recovery+check-in slot a
 * weekly carry could unlock. Judging them under v2 would strip both and rewrite history the
 * product promised to freeze — and every UPDATE that so much as touches an old row would do it.
 * Must equal `v_cutover` in migration 0193.
 */
export const SCORING_V2_CUTOVER = '2026-08-16';

/** v1 ceiling slots, frozen. Deliberately NOT derived from PROFILE_WEIGHTS — they describe a
 *  formula that no longer exists and must not move when the live weights do. */
const V1_CEILING = { nutrition: 55, checkinAndRecovery: 35, commitment: 15 } as const;

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

/** v2 ceiling slots, in points, derived from the live weights. */
const V2_CEILING = {
  nutrition: Math.round(MAX_SUBSCORE_WEIGHT.nutrition * 100),
  checkinAndRecovery: Math.round((MAX_SUBSCORE_WEIGHT.recovery + MAX_SUBSCORE_WEIGHT.checkin) * 100),
  commitment: Math.round(MAX_SUBSCORE_WEIGHT.commitment * 100),
} as const;

/**
 * The ceiling applied to a row dated BEFORE the cutover: the UNION of both eras, slot by slot.
 *
 * Not the strict v1 numbers, and the difference is load-bearing. A ceiling is only ever safe in
 * the LOOSE direction — too loose clamps less and never touches an honest score, too tight
 * silently corrupts one. Two facts force the union here:
 *
 *  1. `mapStateToDayRow` (store/sync.ts) self-clamps with this very function, keyed on the row's
 *     own date. Once the v2 engine ships, a PRE-cutover-dated row can still be written by it: an
 *     offline backlog draining after the cutover, a 12:05am push whose dateStamp is still
 *     yesterday, a re-push of a recent day. That row carries a v2 score (nutrition up to 78). A
 *     strict 55 would cut it in the client and again in the trigger — "silently writes 55 where
 *     it computed 76", the exact corruption this ceiling exists to prevent.
 *  2. The union still grants everything v1 granted, so the guard does its real job: a historical
 *     row keeps its 15-point commitment slot and its 35-point carry-backed check-in slot.
 *
 * It also cannot move an existing row: the union is >= the v1 ceiling for every evidence
 * combination, so any row that did not move under v1 cannot move under it.
 */
const PRE_CUTOVER_CEILING = {
  nutrition: Math.max(V1_CEILING.nutrition, V2_CEILING.nutrition),
  checkinAndRecovery: Math.max(V1_CEILING.checkinAndRecovery, V2_CEILING.checkinAndRecovery),
  commitment: Math.max(V1_CEILING.commitment, V2_CEILING.commitment),
} as const;

/** The evidence gates a `days` row carries, each unlocking one weighted slot of the ceiling. */
export interface ScoreEvidence {
  /** Food evidence: a meal slot was logged, a real plate rode in on `checkin.slotMacros`, a
   *  quick-add was tapped, OR an active trust pass credits nutrition camera-free. Unlocks the
   *  nutrition slot (v2: 78, v1: 55). */
  nutritionPossible: boolean;
  /** A real check-in backs the row. v2: submitted THAT day — nothing carries. v1: submitted, or
   *  carried from a submission in the trailing 6 days. Unlocks the recovery + check-in slots
   *  (v2: 12 + 12 = 24, v1: 25 + 10 = 35). */
  checkinPossible: boolean;
  /** A plan-commitment answer is on the row. v2: unlocks NOTHING (weight 0). v1: 15. */
  commitmentPresent: boolean;
}

/**
 * The maximum Development Score the evidence can justify (integer 0..100), for a row on
 * `rowDate` (ISO `YYYY-MM-DD`). A real computeDerived() score is always <= this for the same
 * evidence — proven by the property test on BOTH sides of the cutover — so it is safe to clamp
 * a written score down to it.
 */
export function evidenceScoreCeiling(ev: ScoreEvidence, rowDate: string): number {
  const c = rowDate < SCORING_V2_CUTOVER ? PRE_CUTOVER_CEILING : V2_CEILING;
  return Math.min(100,
    (ev.nutritionPossible ? c.nutrition : 0) +
    (ev.checkinPossible ? c.checkinAndRecovery : 0) +
    (ev.commitmentPresent ? c.commitment : 0));
}

/** Clamp a (possibly client-reported) score down to what the evidence supports. Never raises. */
export function clampScoreToEvidence(score: number, ev: ScoreEvidence, rowDate: string): number {
  return Math.min(score, evidenceScoreCeiling(ev, rowDate));
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
  row: {
    date: string;
    meals?: Record<string, boolean> | null;
    quick_added?: boolean[] | null;
    checkin?: Record<string, unknown> | null;
  },
  ctx: { activeTrustPass?: boolean; priorSubmittedInWeek?: boolean } = {},
): ScoreEvidence {
  const meals = row.meals ?? {};
  const ci = row.checkin ?? {};
  // Scanned by VALUE, not against a hardcoded classic-four key list: a room on a 5-/6-meal coach
  // standard scores `meal-5`/`meal-6` (STD_SLOT_MAP), and those keys live in this same jsonb.
  const anyMealLogged = Object.values(meals).some((v) => v === true);
  const sm = ci.slotMacros;
  const hasSlotMacros = !!sm && typeof sm === 'object' && Object.keys(sm as Record<string, unknown>).length > 0;
  // A quick-add is real nutrition evidence — the gate the proto had and this mirror did not,
  // which erased whole quick-add-only days until it was fixed there. Shape-guarded: a malformed
  // value must read as "no evidence", never throw.
  const anyQuickAdd = Array.isArray(row.quick_added) && row.quick_added.some((v) => v === true);
  const submitted = ci.submitted === true;
  const ciLast = typeof ci.ciLast === 'string' ? ci.ciLast : null;
  const carryInWindow = ciLast != null && withinTrailingWeek(ciLast, row.date);
  const commitment = ci.commitment;
  // The carry is evidence for a PRE-cutover row only. v2's engine sets recovery and check-in to 0
  // unless the athlete checked in THAT day (score.ts: "checked in tonight"), so dropping the carry
  // for a v2 row can never clamp an honest score — and it closes the tamper path where a
  // fabricated `ciLast` bought 24 points with no check-in behind it.
  const carryCounts = row.date < SCORING_V2_CUTOVER;
  return {
    nutritionPossible: anyMealLogged || hasSlotMacros || anyQuickAdd || !!ctx.activeTrustPass,
    checkinPossible: submitted || (carryCounts && (carryInWindow || !!ctx.priorSubmittedInWeek)),
    commitmentPresent: commitment === 'yes' || commitment === 'partial' || commitment === 'no',
  };
}
