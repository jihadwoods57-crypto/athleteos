import { createInitialState } from './defaultState';
import { computeDerived } from './scoring';
import { themeForGoal, mealScoreImpact, mealCoaching, coachReinforcement } from './coaching';

describe('themeForGoal', () => {
  it('maps goals to the three coaching themes', () => {
    expect(themeForGoal('lose_fat')).toBe('lean');
    expect(themeForGoal('maintain')).toBe('lean');
    expect(themeForGoal('improve_endurance')).toBe('engine');
    expect(themeForGoal('get_faster')).toBe('engine');
    expect(themeForGoal('get_stronger')).toBe('muscle');
    expect(themeForGoal('scholarship')).toBe('muscle');
    expect(themeForGoal(null)).toBe('muscle');
  });
});

describe('mealScoreImpact', () => {
  it('is positive for an unlogged slot (logging real work moves the score)', () => {
    const s = createInitialState();
    s.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
    expect(mealScoreImpact(s, 'Dinner')).toBeGreaterThan(0);
  });

  it('is zero when the slot is already logged', () => {
    const s = createInitialState();
    s.meals = { breakfast: true, lunch: true, snack: true, dinner: true };
    expect(mealScoreImpact(s, 'Dinner')).toBe(0);
  });

  it('matches the real engine delta (honest, never invented)', () => {
    const s = createInitialState();
    s.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
    const before = computeDerived(s).athleteScore;
    const after = computeDerived({ ...s, meals: { ...s.meals, lunch: true } }).athleteScore;
    expect(mealScoreImpact(s, 'Lunch')).toBe(Math.max(0, after - before));
  });
});

describe('mealCoaching', () => {
  const s = createInitialState();
  const d = computeDerived(s);

  it('leads with goal-aligned coaching, not macros', () => {
    const c = mealCoaching('Dinner', 'get_stronger', d, 0, null);
    expect(c.insight.length).toBeGreaterThan(20);
    expect(c.insight.toLowerCase()).toContain('protein');
    expect(c.education.length).toBeGreaterThan(20);
    expect(c.nextStep.length).toBeGreaterThan(10);
    expect(c.dailyContext.length).toBeGreaterThan(10);
  });

  it('frames the next step around the protein gap when behind', () => {
    const behind = computeDerived({ ...s, meals: { breakfast: false, lunch: false, snack: false, dinner: false } });
    const c = mealCoaching('Snack', 'gain_muscle', behind, 0, null);
    expect(c.nextStep.toLowerCase()).toContain('protein');
  });

  it('adds weekly context only once enough days exist', () => {
    expect(mealCoaching('Lunch', null, d, 2, null).weeklyContext).toBeNull();
    expect(mealCoaching('Lunch', null, d, 4, null).weeklyContext).toContain('days');
  });

  it('carries the coach note forward (loop #2) only when a note exists', () => {
    expect(mealCoaching('Lunch', null, d, 0, null).coachEcho).toBeNull();
    expect(mealCoaching('Lunch', null, d, 0, 'Ease up on dinner carbs').coachEcho).toBeTruthy();
  });

  it('keeps coaching copy free of em dashes (design ban)', () => {
    const c = mealCoaching('Dinner', 'lose_fat', d, 5, 'note');
    for (const v of [c.insight, c.education, c.nextStep, c.dailyContext, c.weeklyContext, c.coachEcho]) {
      if (v) expect(v).not.toContain('—');
    }
  });
});

describe('coachReinforcement', () => {
  it('returns null for an empty note and a line for a real one', () => {
    expect(coachReinforcement(null)).toBeNull();
    expect(coachReinforcement('  ')).toBeNull();
    expect(coachReinforcement('keep carbs earlier')).toBeTruthy();
  });
});
