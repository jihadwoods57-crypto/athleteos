// AthleteOS — reactive scoring engine (pure functions).
// Ported verbatim from AthleteOS.dc.html renderVals() / gradeFor().
import {
  CAL_TARGET,
  MEAL_MACROS,
  PROTEIN_TARGET,
  QUICK_FOODS,
  HYDRATION_TARGET,
} from './constants';
import type { AppState, Derived, Grade, MealKey } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pure season-goal progress against fixed start/target weights.
 * remaining = target - current ("+N to go"; <=0 once at/over target).
 * pctThere = clamped 0..100 of how far current sits between start and target.
 */
export function seasonGoalProgress(
  currentWeight: number,
  start: number,
  target: number,
): { remaining: number; pctThere: number } {
  const remaining = Math.round((target - currentWeight) * 10) / 10;
  const pctThere = Math.round(clamp(((currentWeight - start) / (target - start)) * 100, 0, 100));
  return { remaining, pctThere };
}

/** Letter grade + colors for a 0–100 score. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return { g: 'A', bg: '#DCFCE7', c: '#16A34A' };
  if (score >= 80) return { g: 'B', bg: '#EFF6FF', c: '#2563EB' };
  if (score >= 70) return { g: 'C', bg: '#FEF3C7', c: '#D97706' };
  if (score >= 60) return { g: 'D', bg: '#FFEDD5', c: '#EA580C' };
  return { g: 'F', bg: '#FEE2E2', c: '#DC2626' };
}

/**
 * Compute every value the UI derives from day state. One selector, called
 * everywhere, so Home / Nutrition / Squad / role views stay in sync.
 */
export function computeDerived(s: AppState): Derived {
  const mealKeys = Object.keys(s.meals) as MealKey[];
  const mealsLoggedCount = mealKeys.filter((k) => s.meals[k]).length;

  const quickGrams = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.g : 0), 0);
  const quickKcal = QUICK_FOODS.reduce((a, f, i) => a + (s.quickAdded[i] ? f.k : 0), 0);

  let proteinBase = 0;
  let kcalBase = 0;
  mealKeys.forEach((k) => {
    if (s.meals[k]) {
      proteinBase += MEAL_MACROS[k].p;
      kcalBase += MEAL_MACROS[k].k;
    }
  });

  const proteinToday = proteinBase + quickGrams;
  const kcalToday = kcalBase + quickKcal;
  const proteinGap = Math.max(0, PROTEIN_TARGET - proteinToday);
  const proteinPct = Math.min(100, Math.round((proteinToday / PROTEIN_TARGET) * 100));
  const hydrationPct = Math.round((s.hydrationL / HYDRATION_TARGET) * 100);

  const tasksDone = s.tasks.filter((t) => t.done).length;
  const tasksTotal = s.tasks.length;

  const nutritionScore = Math.min(
    100,
    Math.round(57 + (Math.min(proteinToday, PROTEIN_TARGET) / PROTEIN_TARGET) * 30 + (mealsLoggedCount / 4) * 15),
  );
  const recoveryScore = s.ciSubmitted
    ? Math.min(100, Math.round(((s.ciEnergy + s.ciRecovery + s.ciSleep) / 30) * 100))
    : 86;
  const weightScore = 95;
  const tasksScore = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const checkinScore = 100;

  const athleteScore = clamp(
    Math.round(0.4 * nutritionScore + 0.2 * recoveryScore + 0.2 * weightScore + 0.1 * tasksScore + 0.1 * checkinScore),
    0,
    100,
  );

  const ringOffset = Math.round(540 * (1 - athleteScore / 100));
  const proteinRingOffset = Math.round(251 * (1 - proteinPct / 100));
  const scoreDelta = athleteScore - 86;
  const deltaStr = (scoreDelta >= 0 ? '↑ +' : '↓ ') + Math.abs(scoreDelta);
  const deltaColor = scoreDelta >= 0 ? '#22C55E' : '#EF4444';

  return {
    athleteScore,
    grade: gradeFor(athleteScore),
    ringOffset,
    scoreDelta,
    deltaStr,
    deltaColor,
    nutritionScore,
    recoveryScore,
    weightScore,
    tasksScore,
    checkinScore,
    proteinToday,
    proteinTarget: PROTEIN_TARGET,
    proteinGap,
    proteinPct,
    proteinRingOffset,
    kcalToday,
    calTarget: CAL_TARGET,
    mealsLoggedCount,
    hydrationPct,
    tasksDone,
    tasksTotal,
  };
}
