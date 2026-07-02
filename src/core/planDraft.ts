// OnStandard — deterministic meal-plan draft. Splits the CoachPlan's macro targets across its
// windows (via mealTarget) into open slots, each seeded with one generic option. Pure + offline:
// it is the fallback the client uses whenever the plan-generate model call is unavailable, so a
// coach always gets an editable starting plan.
import type { CoachPlan, PlanSlot, PlanMeal } from './coachPlan';
import { emptySlot, mealTarget } from './coachPlan';
import type { EngineGoal } from './restaurantCoach';
import type { MealKey } from './types';

const SLOT_LABEL: Record<MealKey, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

function seedMeal(key: MealKey, goal: EngineGoal, kcal: number, protein: number): PlanMeal {
  const carbs = Math.round((kcal * 0.45) / 4);
  const fat = Math.round((kcal * 0.25) / 9);
  const lead = goal === 'gain' ? 'High-calorie' : goal === 'lose' ? 'Lean' : 'Balanced';
  return { name: `${lead} ${SLOT_LABEL[key]}`, items: [], macros: { kcal, protein, carbs, fat }, source: 'ai' };
}

export function buildPlanDraft(plan: CoachPlan, goal: EngineGoal): PlanSlot[] {
  return plan.windows.map((w) => {
    const t = mealTarget(plan, w.key);
    const slot = emptySlot(w.key);
    slot.macros = { kcal: t.calories, protein: t.protein };
    slot.options = [seedMeal(w.key, goal, t.calories, t.protein)];
    slot.photoRequired = w.required;
    return slot;
  });
}
