// AthleteOS — scoring profiles (pure TS, no RN imports).
//
// The Execution Score is ONE engine measured by a platform-owned formula; a profile only
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
// NOTE: the `general`/`gain` numbers are v1 DEFAULTS pending founder/RD sign-off. They are tunable
// constants — changing them is a one-line edit, not a rebuild.
import type { BaseGoal, ScoringProfile } from './types';

export interface ProfileWeights {
  nutrition: number;
  recovery: number;
  tasks: number;
  checkin: number;
}

/** Headline mix per profile. Athlete is the shipped .50/.25/.15/.10 (do not change). */
export const PROFILE_WEIGHTS: Record<ScoringProfile, ProfileWeights> = {
  athlete: { nutrition: 0.5, recovery: 0.25, tasks: 0.15, checkin: 0.1 },
  general: { nutrition: 0.55, recovery: 0.2, tasks: 0.15, checkin: 0.1 }, // v1 default, pending sign-off
  gain: { nutrition: 0.55, recovery: 0.25, tasks: 0.1, checkin: 0.1 }, // recovery matters more for hypertrophy
};

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
  /** On-time-weighted meals logged today, 0..4 (from effectiveMealsLogged). */
  effectiveMeals: number;
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
  const mealsFrac = Math.min(1, Math.max(0, n.effectiveMeals) / 4);
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
  // athlete (default) — identical to the shipped nutrition formula in scoring.ts
  return Math.min(100, Math.round(proteinFrac * 65 + mealsFrac * 35));
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
