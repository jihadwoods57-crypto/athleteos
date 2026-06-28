// AthleteOS — scoring profiles (pure TS, no RN imports).
//
// The Development Score is ONE engine measured by a platform-owned formula; a profile only
// re-weights that engine for a different kind of client. The coach/trainer owns the TARGETS
// (protein, calories, meals) and picks the PROFILE; the platform owns these WEIGHTS so an
// "84" always means "84% of YOUR plan executed" and stays comparable across a book
// (Constitution Rule #13 — The Scoring Contract). Never a second formula bolted on.
//
// `athlete` reproduces the shipped formula BYTE-FOR-BYTE (default profile), so every existing
// user and test is unchanged. `general` is tuned for a trainer's general-fitness / weight-loss
// client: hitting the CALORIE TARGET is the lever, protein/consistency support it.
//
// NOTE: the `general` numbers are the v1 DEFAULT pending founder/RD sign-off (see
// docs/specs/2026-06-28-D9...). They are tunable constants — changing them is a one-line edit,
// not a rebuild — so the engine can ship while the exact weights are still being ratified.
import type { ScoringProfile } from './types';

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
};

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
 * Profile-aware nutrition sub-score (0..100).
 *  - athlete: protein 65 + on-time meals 35 (the shipped formula, unchanged).
 *  - general: calorie adherence 45 + protein 25 + meal consistency 30.
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
  // athlete (default) — identical to the shipped nutrition formula in scoring.ts
  return Math.min(100, Math.round(proteinFrac * 65 + mealsFrac * 35));
}

/** Resolve a possibly-absent profile to the default ('athlete'). */
export function resolveProfile(p: ScoringProfile | undefined): ScoringProfile {
  return p ?? 'athlete';
}
