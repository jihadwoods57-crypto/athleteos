// AthleteOS — AI Nutrition Coach engine (pure TS, no RN imports).
// Turns a logged meal into coaching, not macros: goal-aligned insight, education,
// a concrete next step, daily/weekly context, and the honest score impact. This is
// the deterministic contract a real LLM swaps behind later. See
// docs/specs/2026-06-23-next-phase-product-spec.md.
import type { AppState, Derived, MealKey, MealLabel } from './types';
import { computeDerived } from './scoring';
import { mealResultFor } from './content';

export type GoalTheme = 'muscle' | 'lean' | 'engine';

/** Collapse the 12 onboarding goals into the three coaching themes that change
 *  how a meal is framed. Defaults to 'muscle' (the most common athlete intent). */
export function themeForGoal(goal: string | null): GoalTheme {
  switch (goal) {
    case 'lose_fat':
    case 'maintain':
      return 'lean';
    case 'get_faster':
    case 'improve_endurance':
    case 'improve_recovery':
      return 'engine';
    default:
      return 'muscle';
  }
}

const mealKeyOf = (m: MealLabel): MealKey => m.toLowerCase() as MealKey;

/** Projected change in today's Accountability Score from logging this meal (>= 0).
 *  Returns 0 if the slot is already logged. Honest: it recomputes the real engine
 *  with the meal added, so the "+N" the coach promises is exactly what happens. */
export function mealScoreImpact(state: AppState, mealType: MealLabel): number {
  const key = mealKeyOf(mealType);
  if (state.meals[key]) return 0;
  const before = computeDerived(state).athleteScore;
  const after = computeDerived({ ...state, meals: { ...state.meals, [key]: true } }).athleteScore;
  return Math.max(0, after - before);
}

export interface MealCoaching {
  /** Goal-aligned coaching sentence — the hero. Leads with meaning, not macros. */
  insight: string;
  /** A short "why this matters" teaching beat that builds trust. */
  education: string;
  /** One concrete, goal-aware action. */
  nextStep: string;
  /** Where this meal leaves the athlete today (pace framing, never raw totals). */
  dailyContext: string;
  /** Weekly framing once enough days exist, else null. */
  weeklyContext: string | null;
  /** Loop #2: the AI reinforcing the overseer's carried-forward directive, so the
   *  coach's voice is amplified inside the athlete's daily experience. Null if no note. */
  coachEcho: string | null;
  /** Scope disclaimer: this is general, optional education, not a prescription. Keeps
   *  the AI from reading as clinical advice a real nutritionist would be liable for
   *  (RD persona finding). Always present so the coaching never implies authority. */
  scope: string;
}

/** The standing scope note shown alongside any AI coaching: it is general, optional
 *  education, not a prescription, and a real nutritionist's or doctor's plan comes
 *  first. Addresses the RD persona's clinical-overreach/liability finding — the
 *  coaching should suggest and teach, never prescribe over a professional's plan. */
export function coachingScopeNote(): string {
  return 'General guidance to learn from, not a prescription. If a nutritionist or doctor set your plan, theirs comes first.';
}

/** The AI's reinforcement of the coach's standing directive — makes the coach feel
 *  heard (their words get repeated every relevant day, louder than a one-off text). */
export function coachReinforcement(coachNote: string | null | undefined): string | null {
  if (!coachNote || !coachNote.trim()) return null;
  return "I'm keeping this in front of you every day until it's automatic. This plate holds the line.";
}

function insightFor(theme: GoalTheme, mealType: MealLabel): string {
  const mr = mealResultFor(mealType);
  const food = mr.detected[0] ?? 'the protein here';
  const slot = mealType.toLowerCase();
  if (theme === 'lean') {
    return `Smart ${slot} for staying lean. ${food} brings ${mr.protein}g of protein that keeps you full and protects muscle while you're in a deficit, without overshooting calories.`;
  }
  if (theme === 'engine') {
    return `Great ${slot} fuel for your engine. The carbs here replenish glycogen so your next session has gas in the tank, and ${food} adds ${mr.protein}g of protein to drive recovery.`;
  }
  return `Strong ${slot} for building. ${food} delivers ${mr.protein}g of high-quality protein for muscle repair, and the carbs refuel you for tomorrow's work.`;
}

function educationFor(theme: GoalTheme): string {
  if (theme === 'lean') {
    return 'Higher protein on a cut preserves the muscle you have built, so the weight you lose comes off as fat, not hard-won mass.';
  }
  if (theme === 'engine') {
    return 'Replenishing glycogen now is what lets you train hard again sooner. Under-fueling is the hidden reason sessions go flat.';
  }
  return 'Protein within a few hours of training is when muscle protein synthesis peaks. This is the window that turns work into size and strength.';
}

/** Build the full coaching payload for a meal. */
export function mealCoaching(
  mealType: MealLabel,
  goal: string | null,
  derived: Derived,
  historyLen: number,
  coachNote?: string | null,
): MealCoaching {
  const theme = themeForGoal(goal);
  const gap = derived.proteinGap;
  // Educational/optional framing, not a directive: suggest foods as easy options
  // "if that fits your plan" rather than prescribing what to eat (RD finding).
  const nextStep =
    gap > 0
      ? `You're about ${gap}g under your protein target so far. Foods like Greek yogurt, eggs, or lean meat are easy ways to add protein if that fits your plan.`
      : 'Protein is handled for today. If you want, keeping carbs earlier tomorrow tends to set up a strong day.';
  const dailyContext =
    gap > 0
      ? `So far today: ${derived.proteinToday}g protein of ${derived.proteinTarget}g, ${derived.kcalToday} cal. About ${gap}g to go.`
      : `So far today: ${derived.proteinToday}g protein of ${derived.proteinTarget}g, ${derived.kcalToday} cal. Protein target cleared.`;
  const days = Math.min(historyLen, 7);
  const weeklyContext =
    historyLen >= 3 ? `${days} days logged this week. Consistency like this is what actually moves your score.` : null;
  return {
    insight: insightFor(theme, mealType),
    education: educationFor(theme),
    nextStep,
    dailyContext,
    weeklyContext,
    coachEcho: coachReinforcement(coachNote),
    scope: coachingScopeNote(),
  };
}
