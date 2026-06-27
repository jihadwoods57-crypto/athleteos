// AthleteOS — the Coach Plan (pure TS, no RN imports).
//
// THE KEYSTONE that ties the two engines together: the coach/trainer/nutritionist defines
// the plan ONCE here, and both engines read it —
//   • the Nutrition Intelligence Engine recommends meals that fit THIS plan ("what should
//     you eat?"), and
//   • the Accountability Engine evaluates execution against THIS plan ("did you do it?").
// Generic nutrition advice is never the yardstick; the coach's plan is.
import { CAL_TARGET, HYDRATION_TARGET, PROTEIN_TARGET } from './constants';
import type { MealKey } from './types';

/** A coach-defined expected meal window with a deadline (Feature 2). Times are local
 *  minutes-from-midnight so the logic is timezone-pure and testable. */
export interface MealWindow {
  key: MealKey;
  label: string;
  openMin: number;
  deadlineMin: number;
  required: boolean;
}

/** Everything a coach/trainer/nutritionist sets as the athlete's plan (Feature 1). */
export interface CoachPlan {
  calorieTarget: number;
  proteinTarget: number;
  mealsPerDay: number;
  hydrationL: number;
  /** Expected meal windows + deadlines. */
  windows: MealWindow[];
  /** Free-form standing instructions, e.g. "No sugary drinks", "Pre-bed protein shake". */
  instructions: string[];
  /** "Log every meal within N minutes" — null = no logging-latency rule. */
  logWithinMin: number | null;
  /** Coach-set weight goal (lb), null if not set. */
  weightGoalLb: number | null;
}

const hm = (h: number, m = 0): number => h * 60 + m;

/** A sensible default plan derived from the app's existing targets, so the engine works
 *  before a coach customizes anything. A coach overrides any field. */
export const DEFAULT_PLAN: CoachPlan = {
  calorieTarget: CAL_TARGET,
  proteinTarget: PROTEIN_TARGET,
  mealsPerDay: 4,
  hydrationL: HYDRATION_TARGET,
  windows: [
    { key: 'breakfast', label: 'Breakfast', openMin: hm(6), deadlineMin: hm(9, 30), required: true },
    { key: 'lunch', label: 'Lunch', openMin: hm(11, 30), deadlineMin: hm(14), required: true },
    { key: 'snack', label: 'Snack', openMin: hm(14), deadlineMin: hm(17), required: false },
    { key: 'dinner', label: 'Dinner', openMin: hm(17), deadlineMin: hm(20, 30), required: true },
  ],
  instructions: [],
  logWithinMin: null,
  weightGoalLb: null,
};

/** Per-meal calorie + protein share of the plan, split across the required meals so a
 *  single meal can be judged against what THIS plan expects of it (Feature 4). */
export function mealTarget(plan: CoachPlan, key: MealKey): { calories: number; protein: number } {
  const required = plan.windows.filter((w) => w.required);
  const slots = Math.max(1, required.length || plan.mealsPerDay);
  const isRequired = required.some((w) => w.key === key);
  // Snacks (non-required) carry a lighter ~half share; required meals split the rest evenly.
  const weight = isRequired ? 1 : 0.5;
  return {
    calories: Math.round((plan.calorieTarget / slots) * weight),
    protein: Math.round((plan.proteinTarget / slots) * weight),
  };
}

/** Format minutes-from-midnight as a local 12-hour label (e.g. 570 -> "9:30 AM"). */
export function formatWindowTime(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
