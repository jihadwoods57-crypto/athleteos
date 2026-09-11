// OnStandard — scoring profiles (pure TS, no RN imports).
//
// The OnStandard Score is ONE engine measured by a platform-owned formula; a profile only
// re-weights that engine for a different kind of client. The coach/trainer owns the TARGETS
// (protein, calories, meals) and picks the PROFILE; the platform owns these WEIGHTS so an
// "84" always means "84% of YOUR plan executed" and stays comparable across a book
// (Constitution Rule #13 — The Scoring Contract). Never a second formula bolted on.
//
// Profiles map from the user's GOAL at signup (profileForGoal):
//  - `athlete`  (goal = performance) reproduces the shipped formula BYTE-FOR-BYTE (default).
//  - `general`  (goal = lose/maintain) is calorie-TARGET led: a two-sided window that credits
//               hitting the target and never rewards an unsafe deficit.
//  - `gain`     (goal = build muscle) is surplus + protein led: a ONE-SIDED calorie floor (hit
//               your surplus, no penalty for going over) so a diligent gainer can't green-score
//               a week where they never ate enough to grow.
//
// NOTE: the `general`/`gain` numbers are v1 defaults, both founder-ratified — see
// docs/council/2026-07-23-general-profile-weights.md and docs/council/2026-07-23-gain-profile-weights.md
// for the nutrition-science rationale. Both are tunable constants — changing them is a one-line edit,
// not a rebuild.
import type { BaseGoal, ScoringProfile } from './types';

export interface ProfileWeights {
  nutrition: number;
  /** Quality of TONIGHT's check-in answers. No weekly carry (v2). */
  recovery: number;
  /** v2: 0. The end-of-day reflection is captured and shown to the coach, but no longer scores. */
  commitment: number;
  /** v2: a check-in was submitted TONIGHT — binary, guaranteed. */
  checkin: number;
  /** The coach-assigned morning roll call. 0 in every profile row: it only carries weight on a
   *  day a wake-up was ASSIGNED, which is a per-day decision, not a per-profile one. */
  wakeup: number;
}

/** Headline mix per profile — score v2. MUST equal proto plan-style.js PROFILE_WEIGHTS;
 *  scoreParity.test.ts proves the two engines agree. */
export const PROFILE_WEIGHTS: Record<ScoringProfile, ProfileWeights> = {
  // v3 (2026-09-09): food 82, check-in submitted 9, check-in complete 9. Mirrors proto plan-style.js.
  athlete: { nutrition: 0.82, recovery: 0.09, commitment: 0, checkin: 0.09, wakeup: 0 },
  general: { nutrition: 0.82, recovery: 0.09, commitment: 0, checkin: 0.09, wakeup: 0 },
  gain: { nutrition: 0.82, recovery: 0.09, commitment: 0, checkin: 0.09, wakeup: 0 },
};

/**
 * How much of the nightly check-in's 18 points moves to the MORNING on a day the coach assigned
 * a wake-up roll call. MUST equal proto plan-style.js WAKEUP_SHIFT; scoreParity.test.ts pins it.
 *
 * It lives outside PROFILE_WEIGHTS on purpose: the morning is a PER-DAY weight, not a per-profile
 * one, so the rows above stay the mix for a day with no wake-up assigned, which is every day for
 * every athlete whose coach has not set one.
 */
export const WAKEUP_SHIFT = 0.08;

/** The mix for a day that HAS an assigned wake-up. Taken evenly from the two check-in slots, so
 *  the day still sums to 1 and nutrition's 82 never moves. Always a fresh object. */
export function weightsForWakeupDay(profile: ScoringProfile): ProfileWeights {
  const base = PROFILE_WEIGHTS[profile] ?? PROFILE_WEIGHTS.athlete;
  if (!WAKEUP_SHIFT) return { ...base };
  const half = WAKEUP_SHIFT / 2;
  return { ...base, recovery: base.recovery - half, checkin: base.checkin - half, wakeup: WAKEUP_SHIFT };
}

/** Map a user's GOAL to the platform-owned scoring profile. A solo client never gets a coach to
 *  pick this, so signup auto-assigns it (and the UI discloses it). Performance is the default so
 *  every existing athlete/test is unchanged. */
export function profileForGoal(goal: BaseGoal): ScoringProfile {
  switch (goal) {
    case 'gain':
      return 'gain';
    case 'lose':
    case 'maintain':
      return 'general';
    case 'performance':
    default:
      return 'athlete';
  }
}

export interface NutritionInputs {
  proteinToday: number;
  proteinTarget: number;
  kcalToday: number;
  calTarget: number;
  /** On-time-weighted meals logged today, 0..N (from effectiveMealsLogged). */
  effectiveMeals: number;
  /** The governing standard's meal count (0055 requirement_sets, rails 1–6).
      Absent = the shipped classic denominator of 4 — every existing caller unchanged. */
  mealsRequired?: number;
}

/**
 * Calorie-target adherence credit (0..1): full within ±10% of the target, linear falloff to
 * 0 at ±40%. Two-sided ON PURPOSE — over-eating AND crash-undereating both lose credit, so the
 * general score can never reward an unsafe deficit. The most RD-sensitive number; tunable.
 */
export function calorieAdherence(kcal: number, target: number): number {
  if (!(target > 0)) return 0;
  const dev = Math.abs(kcal - target) / target;
  if (dev <= 0.1) return 1;
  if (dev >= 0.4) return 0;
  return (0.4 - dev) / 0.3;
}

/**
 * One-sided calorie FLOOR credit (0..1) for a muscle-gain client: full at or above the (surplus)
 * target, linear falloff to 0 at 60% of it. Eating ABOVE target is the point of a bulk, so unlike
 * `calorieAdherence` it never penalizes overage — only undereating, which stalls growth. Tunable.
 */
export function calorieFloorAdherence(kcal: number, target: number): number {
  if (!(target > 0)) return 0;
  if (kcal >= target) return 1;
  const ratio = kcal / target;
  if (ratio <= 0.6) return 0;
  return (ratio - 0.6) / 0.4;
}

/**
 * Profile-aware nutrition sub-score (0..100).
 *  - athlete: protein 65 + on-time meals 35 (the shipped formula, unchanged).
 *  - general: calorie adherence 45 + protein 25 + meal consistency 30.
 *  - gain:    calorie floor 40 + protein 35 + meal consistency 25 (surplus + protein led).
 * Pure; clamped 0..100.
 */
export function profileNutritionScore(profile: ScoringProfile, n: NutritionInputs): number {
  const proteinFrac = n.proteinTarget > 0 ? Math.min(n.proteinToday, n.proteinTarget) / n.proteinTarget : 0;
  const denom = n.mealsRequired && n.mealsRequired > 0 ? Math.min(6, n.mealsRequired) : 4;
  const mealsFrac = Math.min(1, Math.max(0, n.effectiveMeals) / denom);
  if (profile === 'general') {
    return Math.min(
      100,
      Math.round(calorieAdherence(n.kcalToday, n.calTarget) * 45 + proteinFrac * 25 + mealsFrac * 30),
    );
  }
  if (profile === 'gain') {
    return Math.min(
      100,
      Math.round(calorieFloorAdherence(n.kcalToday, n.calTarget) * 40 + proteinFrac * 35 + mealsFrac * 25),
    );
  }
  // athlete (default), v3: protein 55 + on-time meals 30 + fueling floor 15. Mirrors proto
  // day.js legacyNutritionScore. No calorie target: nothing to judge, full floor.
  const fuel = n.calTarget > 0 ? fuelingFloor(n.kcalToday, n.calTarget) : 1;
  return Math.min(100, Math.round(proteinFrac * 55 + mealsFrac * 30 + fuel * 15));
}

/** Soft under-fueling floor: 0 at <= 35% of the calorie target, 1 at >= 65%, linear between.
 *  Soft on purpose — plate calories are photo estimates; this catches the shake-only day, it
 *  does not grade the estimate. Mirrors proto day.js fuelingFloor. */
export function fuelingFloor(kcal: number, target: number): number {
  if (!(target > 0)) return 1;
  const frac = Math.max(0, kcal) / target;
  return Math.max(0, Math.min(1, (frac - 0.35) / 0.30));
}

/** Resolve a possibly-absent profile to the default ('athlete'). */
export function resolveProfile(p: ScoringProfile | undefined): ScoringProfile {
  return p ?? 'athlete';
}

/** Plain-English disclosure of how an account is scored, for the Profile screen. Honesty: a solo
 *  client should never wonder why a green-protein day didn't top out. */
export function scoringProfileLabel(p: ScoringProfile | undefined): { title: string; how: string } {
  switch (resolveProfile(p)) {
    case 'general':
      return { title: 'Calorie-target scoring', how: 'Hitting your daily calorie target is the main lever, with protein and meal consistency supporting it.' };
    case 'gain':
      return { title: 'Muscle-gain scoring', how: 'Eating enough to grow (your calorie floor) and hitting protein lead your score; going over target is never penalized.' };
    case 'athlete':
    default:
      return { title: 'Performance scoring', how: 'Protein and on-time meals lead your nutrition score, the way a competitive athlete is graded.' };
  }
}
