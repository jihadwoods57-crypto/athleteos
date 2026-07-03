// OnStandard — daily fuel target + "win the day" (pure TS).
//
// The real coach frames everything around a scale number ("need a 223 on Monday", "win the
// weekend"). This connects meals to the weight goal: a daily calorie + protein target derived
// from bodyweight + the weekly weight goal, and a read of whether today's logged macros hit it.
// Rough but honest; the coach can still override targets via coach_set_goals.
import type { MacroSet } from './mealEdit';

export type FuelDirection = 'gain' | 'lose' | 'maintain';

export interface FuelTarget {
  kcal: number;
  protein: number;
}

/** Daily calorie + protein target to move toward the weight goal. Maintenance ~= 16 kcal/lb for
 *  an active athlete; a weekly weight goal adds/subtracts ~500 kcal/day per lb/week (3500 kcal per
 *  lb); protein ~= 1 g/lb bodyweight. Pure. */
export function fuelTarget(bodyWeightLb: number, weeklyGoalLb: number, direction: FuelDirection): FuelTarget {
  const bw = Math.max(80, Math.min(400, Math.round(bodyWeightLb) || 170));
  const maintenance = bw * 16;
  const swing = Math.round(Math.max(0, weeklyGoalLb || 0) * 500);
  const kcal =
    direction === 'gain' ? maintenance + swing
    : direction === 'lose' ? Math.max(1400, maintenance - swing)
    : maintenance;
  return { kcal: Math.round(kcal), protein: bw };
}

export interface MacroTargets {
  carbs: number;
  fat: number;
}

/**
 * Carb/fat gram targets derived from the PLAN (calorie + protein targets) instead of
 * fixed constants, so the rings can never contradict the plan shown on the same
 * screen. Deterministic split: fat = 30% of calories on a cut (satiety), 25%
 * otherwise; carbs = whatever calories remain after protein + fat. Floored at 0 so an
 * aggressive protein target can't produce a negative carb goal. Pure.
 */
export function derivedMacroTargets(calTarget: number, proteinTargetG: number, direction: FuelDirection | 'performance'): MacroTargets {
  const cal = Math.max(0, Math.round(calTarget) || 0);
  const proteinKcal = Math.max(0, Math.round(proteinTargetG) || 0) * 4;
  const fatPct = direction === 'lose' ? 0.3 : 0.25;
  const fat = Math.round((cal * fatPct) / 9);
  const carbs = Math.max(0, Math.round((cal - proteinKcal - fat * 9) / 4));
  return { carbs, fat };
}

export interface DayWin {
  proteinHit: boolean;
  fuelHit: boolean;
  /** Both protein and fuel targets met (within 10%) — the day is "won". */
  won: boolean;
}

/** Did today's logged macros hit the fuel target (within 10%)? Pure. */
export function winTheDay(logged: MacroSet, target: FuelTarget): DayWin {
  const proteinHit = target.protein > 0 && logged.protein >= target.protein * 0.9;
  const fuelHit = target.kcal > 0 && logged.kcal >= target.kcal * 0.9;
  return { proteinHit, fuelHit, won: proteinHit && fuelHit };
}
