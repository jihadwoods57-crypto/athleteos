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
import { DEFAULT_PLAN } from './coachPlan';
import type { EditableFood } from './mealEdit';
import type { AppState, MealKey } from './types';

/** The plan window deadline (minute-of-day) for a slot; 1440 (never late) if unlisted. */
function deadlineFor(k: MealKey): number {
  return DEFAULT_PLAN.windows.find((w) => w.key === k)?.deadlineMin ?? 1440;
}

export interface ProjectedAction {
  /** Stable key (e.g. 'protein', 'meal:dinner', 'checkin'). */
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
 * the remaining meals logged, the protein target met, tasks done, check-in submitted.
 *
 * Reachability rules (the projection is a promise — it must be earnable by ACTIONS):
 * - Logged plates are kept, never replaced: swapping a logged breakfast for a synthetic
 *   0-kcal plate could RAISE an over-eaten day's two-sided calorie adherence, promising
 *   points only attainable by un-eating food.
 * - Only the remaining protein GAP is added, into a slot the athlete has NOT logged yet
 *   (or appended to snack when all four are). Exported for the reachability tests.
 * - Punctuality stamps are kept: credit already lost to a late log stays lost.
 * Recovery is whatever the current check-in answers compute to (an estimate, not a max).
 *
 * HONEST DECAY (clock-aware, optional `nowMin`): a meal the athlete has NOT logged whose
 * window deadline has ALREADY passed can now only be logged LATE — so it is idealized with a
 * late `mealLoggedAt = nowMin`, projecting at the half `LATE_MEAL_WEIGHT` rather than promising
 * unearnable on-time credit. This makes the projected score genuinely slip as the day burns
 * down. Backward compatible: omit `nowMin`, or run engines-off where no timestamps are
 * collected, and every idealized meal stays on-time exactly as before. Already-logged meals
 * are never re-stamped (their real punctuality is authoritative).
 */
export function idealizeDay(s: AppState, nowMin?: number): AppState {
  const d = computeDerived(s);
  const gap = Math.max(0, Math.round(d.proteinGap));
  const gapPlate: EditableFood[] = gap > 0 ? [{ name: 'projected', portion: '', servings: 1, per: { protein: gap, kcal: 0, carbs: 0, fat: 0 } }] : [];
  const slots: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
  const openSlot = slots.find((k) => !s.meals[k]);
  const mealFoods = { ...s.mealFoods };
  if (gapPlate.length > 0) {
    if (openSlot) mealFoods[openSlot] = gapPlate;
    else mealFoods.snack = [...(mealFoods.snack ?? []), ...gapPlate];
  }
  // Late-stamp only meals the athlete has NOT logged whose window already closed, and only
  // when a clock is supplied. Existing stamps are preserved; on-time slots stay unstamped.
  const mealLoggedAt = { ...s.mealLoggedAt };
  if (nowMin != null) {
    slots.forEach((k) => {
      if (!s.meals[k] && mealLoggedAt[k] == null && nowMin > deadlineFor(k)) {
        mealLoggedAt[k] = nowMin;
      }
    });
  }
  return {
    ...s,
    meals: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealFoods,
    mealLoggedAt,
    tasks: s.tasks.map((t) => ({ ...t, done: true })),
    ciSubmitted: true,
    dailyCommitment: 'yes',
  };
}

/**
 * Project today's Development Score: the current number, the number reachable by finishing
 * the day's controllable actions, and the checklist of what's left. `projected` equals
 * computeDerived over the idealized day and is never below `current`. Optional `nowMin`
 * enables honest decay (see idealizeDay). Pure.
 */
export function projectedScore(s: AppState, nowMin?: number): ScoreProjection {
  const d = computeDerived(s);
  const current = d.athleteScore;
  const projected = Math.max(current, computeDerived(idealizeDay(s, nowMin)).athleteScore);

  const actions: ProjectedAction[] = [];

  // Protein gap (the heaviest lever).
  if (d.proteinGap > 0) {
    actions.push({ key: 'protein', label: `Hit your protein target (${Math.round(d.proteinGap)}g to go)` });
  }
  // Each unlogged meal slot, in day order.
  (Object.keys(s.meals) as MealKey[]).forEach((k) => {
    if (!s.meals[k]) actions.push({ key: `meal:${k}`, label: `Log ${MEAL_LABEL[k]}` });
  });
  // The daily plan-commitment is captured and shown to the coach, but v2 weights it at 0 — it
  // no longer moves the score at all (PROFILE_WEIGHTS.*.commitment; see the score-v2 spec).
  // idealizeDay still marks it 'yes' for the idealized-day shape, but this module only lists
  // ACTIONS THAT MOVE THE PROJECTED NUMBER (its own file-header principle), so confirming the
  // plan is deliberately not offered here — it would be a promise the score can't keep.
  // Submit tonight's check-in if it is still open. (v2: nightly, not weekly — the Weekly
  // Check-In ritual was deleted; see the score-v2 spec.)
  if (!s.ciSubmitted) {
    actions.push({ key: 'checkin', label: "Submit today's check-in" });
  }

  return { current, projected, gain: Math.max(0, projected - current), actions };
}
