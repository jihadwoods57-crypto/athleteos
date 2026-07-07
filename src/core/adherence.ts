// OnStandard — Accountability Engine (pure TS, no RN imports).
//
// "OnStandard doesn't reward eating. It rewards executing the plan." This evaluates the
// athlete's real execution against the CoachPlan: which meal windows are open/missed
// (Feature 2), the escalating accountability level (Feature 3), overall plan adherence
// (Feature 4/8), and a plan-RELATIVE, goal-aware coaching line (Feature 4/5). Supportive,
// never shaming. The score impact + coach intervention compose these signals.
import type { CoachPlan, MealWindow } from './coachPlan';
import { mealTarget, formatWindowTime } from './coachPlan';
import type { EngineGoal } from './restaurantCoach';
import type { MealKey } from './types';

export type WindowState = 'upcoming' | 'open' | 'logged' | 'missed';

export interface WindowStatus {
  window: MealWindow;
  state: WindowState;
  /** Minutes until the deadline (negative once passed). */
  minutesToDeadline: number;
}

/** Status of every coach-defined meal window given what's logged + the current time. */
export function mealWindowStatuses(
  plan: CoachPlan,
  meals: Record<MealKey, boolean>,
  now: Date = new Date(),
): WindowStatus[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return plan.windows.map((window) => {
    const logged = Boolean(meals[window.key]);
    const state: WindowState = logged
      ? 'logged'
      : nowMin < window.openMin
        ? 'upcoming'
        : nowMin <= window.deadlineMin
          ? 'open'
          : 'missed';
    return { window, state, minutesToDeadline: window.deadlineMin - nowMin };
  });
}

export type AccountabilityLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type AccountabilityTone = 'clear' | 'reminder' | 'support' | 'score' | 'coach' | 'report';

export interface Escalation {
  level: AccountabilityLevel;
  tone: AccountabilityTone;
  /** Athlete- or coach-facing line; supportive, never shaming (Feature 5). */
  message: string;
}

/**
 * The single highest-applicable accountability level (Feature 3), from today's misses, an
 * approaching open deadline, and the multi-day missed streak. Higher levels supersede
 * lower ones. Names are passed in so the same engine serves athlete + coach surfaces.
 */
export function escalation(opts: {
  /** Required meals already missed today. */
  missedToday: number;
  /** Label of an open-but-not-logged meal whose deadline is near (≤45m), or null. */
  approachingMeal: string | null;
  /** Consecutive days an expected meal was missed (for the coach-notify level). */
  consecutiveDaysMissed: number;
  /** Athlete first name for coach-facing copy. */
  athleteName?: string;
}): Escalation {
  const who = opts.athleteName?.trim() || 'This athlete';
  if (opts.consecutiveDaysMissed >= 3) {
    return {
      level: 4,
      tone: 'coach',
      message: `${who} has missed an expected meal ${opts.consecutiveDaysMissed} days in a row. A check-in could get them back on track.`,
    };
  }
  if (opts.missedToday >= 2) {
    return {
      level: 3,
      tone: 'score',
      message: `Your OnStandard Score reflects ${opts.missedToday} expected meals not logged today. Logging the next one starts the climb back.`,
    };
  }
  if (opts.missedToday >= 1) {
    return {
      level: 2,
      tone: 'support',
      message: 'You missed a meal check-in today. Staying consistent is what drives results, so let us lock in the next one.',
    };
  }
  if (opts.approachingMeal) {
    return {
      level: 1,
      tone: 'reminder',
      message: `Heads up: log ${opts.approachingMeal} before the window closes to keep your streak.`,
    };
  }
  return { level: 0, tone: 'clear', message: 'On plan today. Keep stacking days.' };
}

export interface PlanAdherence {
  proteinMet: boolean;
  /** Within 10% of the plan's calorie target (over for gain matters, under for cut). */
  calorieOnTarget: boolean;
  hydrationMet: boolean;
  requiredLogged: number;
  requiredTotal: number;
  missedRequired: number;
  /** Overall execution 0..100 — the honest, earned number that should feed the score. */
  adherencePct: number;
}

/** How fully the athlete executed the plan today (Feature 4/8). No floors, no participation
 *  credit — every point is logged-and-on-target work. */
export function planAdherence(
  plan: CoachPlan,
  facts: { proteinToday: number; kcalToday: number; hydrationL: number },
  statuses: WindowStatus[],
): PlanAdherence {
  const proteinMet = facts.proteinToday >= plan.proteinTarget;
  const calorieOnTarget = plan.calorieTarget > 0 && Math.abs(facts.kcalToday - plan.calorieTarget) <= plan.calorieTarget * 0.1;
  const hydrationMet = facts.hydrationL >= plan.hydrationL;
  const required = statuses.filter((s) => s.window.required);
  const requiredTotal = required.length;
  const requiredLogged = required.filter((s) => s.state === 'logged').length;
  const missedRequired = required.filter((s) => s.state === 'missed').length;

  // Execution weighting: required meals on time 50%, protein 30%, hydration 20%.
  const mealsPct = requiredTotal > 0 ? requiredLogged / requiredTotal : 1;
  const proteinPct = plan.proteinTarget > 0 ? Math.min(1, facts.proteinToday / plan.proteinTarget) : 1;
  const hydrationPctRaw = plan.hydrationL > 0 ? Math.min(1, facts.hydrationL / plan.hydrationL) : 1;
  const adherencePct = Math.round((mealsPct * 0.5 + proteinPct * 0.3 + hydrationPctRaw * 0.2) * 100);

  return { proteinMet, calorieOnTarget, hydrationMet, requiredLogged, requiredTotal, missedRequired, adherencePct };
}

/**
 * Plan-RELATIVE, goal-aware coaching for a single meal (Feature 4/5). The SAME plate gets
 * different feedback for a gainer vs a cutter, judged against what THIS plan expects of
 * this slot — not generic "healthy eating". Supportive and action-oriented.
 */
export function planMealNote(
  plan: CoachPlan,
  slot: MealKey,
  meal: { protein: number; calories: number },
  goal: EngineGoal,
): string {
  const target = mealTarget(plan, slot);
  const calGap = target.calories - meal.calories;
  const proteinGap = target.protein - meal.protein;

  if (goal === 'gain') {
    if (calGap >= 200) {
      return `Good choices, but this meal is about ${calGap} calories below your ${slot} target. Add rice, potatoes, or another protein source to fuel the gain.`;
    }
    if (proteinGap >= 10) {
      return `Solid, though about ${proteinGap}g short on protein for this slot. A little more protein keeps muscle growth on track.`;
    }
    return 'On target for your gain plan. This is the kind of meal that builds.';
  }
  if (goal === 'lose') {
    if (calGap < -150) {
      return `Watch the portion: this runs about ${Math.abs(calGap)} calories over your ${slot} target. Lean it out to stay in today's deficit.`;
    }
    if (meal.protein >= target.protein) {
      return 'Excellent choice. This aligns with today’s calorie deficit and hits your protein target.';
    }
    return 'On track for your cut. Keep protein high while the calories stay controlled.';
  }
  // maintain / performance
  if (proteinGap >= 10) {
    return `Good meal, about ${proteinGap}g short of this slot's protein target. Top it up to stay on plan.`;
  }
  return `On plan for ${formatWindowTime(plan.windows.find((w) => w.key === slot)?.deadlineMin ?? 0)}. Consistent and on target.`;
}
