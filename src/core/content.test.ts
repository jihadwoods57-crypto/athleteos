// AthleteOS — content/display-helper tests: meal-analysis lookup, reactive Home
// insight, weekly-goal pace projection, and the profile subtitle.
import {
  aiInsight,
  athleteSubtitle,
  mealResultFor,
  MEAL_RESULTS,
  paceProjection,
} from './content';
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState, MealLabel } from './types';

describe('mealResultFor', () => {
  it('returns the matching analysis for each meal type', () => {
    (['Breakfast', 'Lunch', 'Snack', 'Dinner'] as MealLabel[]).forEach((m) => {
      expect(mealResultFor(m)).toBe(MEAL_RESULTS[m]);
    });
  });

  it('falls back to Dinner for an unknown label', () => {
    expect(mealResultFor('Brunch' as MealLabel)).toBe(MEAL_RESULTS.Dinner);
  });
});

describe('aiInsight', () => {
  it('nudges to log dinner with the live protein gap before dinner is logged', () => {
    const s = createInitialState();
    const d = computeDerived(s);
    const msg = aiInsight(s, d);
    expect(msg).toContain(`${d.proteinGap}g`);
    expect(msg).toContain('log dinner');
  });

  it('flips to the day-complete message once dinner is logged', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true } } as AppState;
    const d = computeDerived(s);
    expect(aiInsight(s, d)).toContain('Day complete');
  });
});

describe('paceProjection', () => {
  it('projects +1.1 lb at the default 1.0 lb/week goal (on pace)', () => {
    // progressLb 0.6 over 4 days -> (0.6/4)*7 = 1.05, .toFixed(1) -> 1.1
    const p = paceProjection(1.0);
    expect(p.projected).toBe(1.1);
    expect(p.onPace).toBe(true); // 1.1 >= 1.0 - eps
    expect(p.paceLabel).toBe('↑ On pace');
  });

  it('reports behind pace for an aggressive goal', () => {
    const p = paceProjection(2.0);
    expect(p.projected).toBe(1.1);
    expect(p.onPace).toBe(false);
    expect(p.paceLabel).toBe('↓ Behind pace');
    expect(p.paceAi).toContain('Add');
  });

  it('caps the goal-progress percentage at 100', () => {
    const p = paceProjection(0.5); // 0.6/0.5 = 120% -> clamp 100
    expect(p.goalPct).toBe(100);
  });

  it('computes the daily surplus from the weekly goal', () => {
    // round(goal * 3500 / 7)
    expect(paceProjection(1.0).surplus).toBe(500);
    expect(paceProjection(2.0).surplus).toBe(1000);
  });

  it('always leaves 3 days remaining (prototype constant)', () => {
    expect(paceProjection(1.0).daysLeft).toBe(3);
  });
});

describe('athleteSubtitle', () => {
  it('expands a known position abbreviation', () => {
    expect(athleteSubtitle('QB')).toBe('Quarterback · Eastside HS');
    expect(athleteSubtitle('LB')).toBe('Linebacker · Eastside HS');
  });

  it('passes through an unknown abbreviation verbatim', () => {
    expect(athleteSubtitle('XYZ')).toBe('XYZ · Eastside HS');
  });

  it('defaults to Linebacker when no position is set', () => {
    expect(athleteSubtitle(null)).toBe('Linebacker · Eastside HS');
  });
});
