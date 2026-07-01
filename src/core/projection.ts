// OnStandard — Projected Development Score (pure TS, no RN imports).
//
// Forward-looking framing of the daily score, the nugget extracted from the "Daily Game
// Plan" vision: "you're at X today; finish the actions you still control and you'll reach Y,
// here's the checklist." It reinforces the CORE loop (do the work -> the number moves) rather
// than adding a new feature area, so it fits the prove-the-loop beta.
//
// SINGLE SCORING AUTHORITY: the projection is computeDerived run over an idealized end-of-day
// state, never a parallel formula. It only lifts what the athlete can still DO today (log
// meals on time, hit protein, finish tasks, submit the check-in). Recovery is an ESTIMATE
// from their current check-in answers, not a fabricated max, and `projected` is floored at
// `current` so finishing the day can never read as a loss.
import { computeDerived } from './scoring';
import type { EditableFood } from './mealEdit';
import type { AppState, MealKey } from './types';

export interface ProjectedAction {
  /** Stable key (e.g. 'protein', 'meal:dinner', 'checkin', 'tasks'). */
  key: string;
  /** Athlete-facing instruction, no guilt, no em dash. */
  label: string;
}

export interface ScoreProjection {
  /** Today's live Development Score. */
  current: number;
  /** The score reached by completing today's controllable actions (>= current). */
  projected: number;
  /** projected - current (>= 0). */
  gain: number;
  /** The remaining controllable actions, in do-this order. Empty when the day is done. */
  actions: ProjectedAction[];
}

const MEAL_LABEL: Record<MealKey, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'a snack',
  dinner: 'dinner',
};

/**
 * An end-of-day state where the athlete completed every CONTROLLABLE accountability action:
 * all four meals logged on time, the protein target met, tasks done, check-in submitted. A
 * synthetic protein plate in one slot guarantees the target is met without disturbing the
 * other slots; absent mealLoggedAt means on-time. Recovery is whatever the current check-in
 * answers compute to (an estimate, not inflated).
 */
function idealizeDay(s: AppState): AppState {
  const proteinTarget = computeDerived(s).proteinTarget;
  const projectedPlate: EditableFood[] = [
    { name: 'projected', portion: '', servings: 1, per: { protein: proteinTarget, kcal: 0, carbs: 0, fat: 0 } },
  ];
  return {
    ...s,
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealLoggedAt: {},
    mealFoods: { ...s.mealFoods, breakfast: projectedPlate },
    tasks: s.tasks.map((t) => ({ ...t, done: true })),
    ciSubmitted: true,
  };
}

/**
 * Project today's Development Score: the current number, the number reachable by finishing
 * the day's controllable actions, and the checklist of what's left. `projected` equals
 * computeDerived over the idealized day and is never below `current`. Pure.
 */
export function projectedScore(s: AppState): ScoreProjection {
  const d = computeDerived(s);
  const current = d.athleteScore;
  const projected = Math.max(current, computeDerived(idealizeDay(s)).athleteScore);

  const actions: ProjectedAction[] = [];

  // Protein gap (the heaviest lever).
  if (d.proteinGap > 0) {
    actions.push({ key: 'protein', label: `Hit your protein target (${Math.round(d.proteinGap)}g to go)` });
  }
  // Each unlogged meal slot, in day order.
  (Object.keys(s.meals) as MealKey[]).forEach((k) => {
    if (!s.meals[k]) actions.push({ key: `meal:${k}`, label: `Log ${MEAL_LABEL[k]}` });
  });
  // Other daily tasks not already represented by the protein (id 2) and dinner (id 3) rows,
  // so the checklist never double-counts them.
  const coveredByAbove = (d.proteinGap > 0 ? 1 : 0) + (!s.meals.dinner ? 1 : 0);
  const otherTasksLeft = Math.max(0, d.tasksTotal - d.tasksDone - coveredByAbove);
  if (otherTasksLeft > 0) {
    actions.push({ key: 'tasks', label: `Finish ${otherTasksLeft} more daily ${otherTasksLeft === 1 ? 'task' : 'tasks'}` });
  }
  // Submit the weekly check-in if it is still open.
  if (!s.ciSubmitted) {
    actions.push({ key: 'checkin', label: "Submit today's check-in" });
  }

  return { current, projected, gain: Math.max(0, projected - current), actions };
}
