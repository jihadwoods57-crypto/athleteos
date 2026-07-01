// OnStandard — Accountability Engine. Proves the meal-window state machine, the 5-level
// escalation, plan adherence with no floors, and plan-RELATIVE goal-aware meal coaching
// (same plate, different feedback for a gainer vs a cutter).
import { mealWindowStatuses, escalation, planAdherence, planMealNote } from './adherence';
import { DEFAULT_PLAN, mealTarget } from './coachPlan';
import type { MealKey } from './types';

const at = (h: number, m = 0) => new Date(2026, 5, 27, h, m);
const noMeals: Record<MealKey, boolean> = { breakfast: false, lunch: false, snack: false, dinner: false };

describe('mealWindowStatuses', () => {
  it('classifies upcoming / open / logged / missed by the clock', () => {
    // 12:30pm: breakfast deadline (9:30) passed + unlogged = missed; lunch window open;
    // dinner still upcoming.
    const s = mealWindowStatuses(DEFAULT_PLAN, { ...noMeals, snack: false }, at(12, 30));
    const byKey = Object.fromEntries(s.map((x) => [x.window.key, x.state]));
    expect(byKey.breakfast).toBe('missed');
    expect(byKey.lunch).toBe('open');
    expect(byKey.dinner).toBe('upcoming');
  });
  it('a logged meal is logged regardless of time', () => {
    const s = mealWindowStatuses(DEFAULT_PLAN, { ...noMeals, breakfast: true }, at(23, 0));
    expect(s.find((x) => x.window.key === 'breakfast')?.state).toBe('logged');
  });
});

describe('escalation — 5 supportive levels, highest applicable wins', () => {
  it('level 1: approaching window', () => {
    const e = escalation({ missedToday: 0, approachingMeal: 'lunch', consecutiveDaysMissed: 0 });
    expect(e.level).toBe(1);
    expect(e.tone).toBe('reminder');
  });
  it('level 2: one missed meal today (supportive, not shaming)', () => {
    const e = escalation({ missedToday: 1, approachingMeal: null, consecutiveDaysMissed: 0 });
    expect(e.level).toBe(2);
    expect(e.message).not.toMatch(/lazy|failed|bad/i);
  });
  it('level 3: two missed -> score impact explained', () => {
    expect(escalation({ missedToday: 2, approachingMeal: null, consecutiveDaysMissed: 0 }).level).toBe(3);
  });
  it('level 4: multi-day streak -> coach notified', () => {
    const e = escalation({ missedToday: 0, approachingMeal: null, consecutiveDaysMissed: 3, athleteName: 'Marcus' });
    expect(e.level).toBe(4);
    expect(e.message).toContain('Marcus');
  });
  it('level 0 when nothing is wrong', () => {
    expect(escalation({ missedToday: 0, approachingMeal: null, consecutiveDaysMissed: 0 }).level).toBe(0);
  });
});

describe('planAdherence — earned, no floors', () => {
  it('a zero-execution day scores near 0 (no participation credit)', () => {
    const statuses = mealWindowStatuses(DEFAULT_PLAN, noMeals, at(23, 0));
    const a = planAdherence(DEFAULT_PLAN, { proteinToday: 0, kcalToday: 0, hydrationL: 0 }, statuses);
    expect(a.adherencePct).toBe(0);
    expect(a.missedRequired).toBe(3); // breakfast, lunch, dinner
  });
  it('a fully-executed day scores 100', () => {
    const allMeals = { breakfast: true, lunch: true, snack: true, dinner: true };
    const statuses = mealWindowStatuses(DEFAULT_PLAN, allMeals, at(21, 0));
    const a = planAdherence(
      DEFAULT_PLAN,
      { proteinToday: DEFAULT_PLAN.proteinTarget, kcalToday: DEFAULT_PLAN.calorieTarget, hydrationL: DEFAULT_PLAN.hydrationL },
      statuses,
    );
    expect(a.adherencePct).toBe(100);
    expect(a.proteinMet).toBe(true);
  });
});

describe('planMealNote — plan-relative + goal-aware (same plate, different athlete)', () => {
  // A ~500 cal, 30g protein lunch vs a 3200/180 plan -> lunch target ~ 800cal/45g.
  const meal = { protein: 30, calories: 500 };
  it('flags the gainer that the meal is below the lunch target', () => {
    const note = planMealNote(DEFAULT_PLAN, 'lunch', meal, 'gain');
    expect(note).toMatch(/below your lunch target|short on protein/i);
  });
  it('reads the same meal as on-track for a cutter', () => {
    const note = planMealNote(DEFAULT_PLAN, 'lunch', meal, 'lose');
    expect(note).toMatch(/deficit|on track|excellent/i);
  });
  it('mealTarget splits the plan across required meals', () => {
    const t = mealTarget(DEFAULT_PLAN, 'lunch');
    expect(t.calories).toBeGreaterThan(0);
    expect(t.protein).toBeGreaterThan(0);
  });
});
