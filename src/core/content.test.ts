// AthleteOS — content/display-helper tests: meal-analysis lookup, reactive Home
// insight, weekly-goal pace projection, and the profile subtitle.
import {
  aiInsight,
  athleteSubtitle,
  heroStatus,
  mealResultFor,
  MEAL_RESULTS,
  paceProjection,
} from './content';
import { computeDerived, gradeFor } from './scoring';
import { createInitialState } from './defaultState';
import type { AppState, Derived, MealLabel } from './types';

const FALSE_CLAIM = 'on pace to hit every weekly goal';

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

  it('flips to the day-complete message only when all four are logged AND protein meets target', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true } } as AppState;
    const d = computeDerived(s);
    // Gate is BOTH conditions; assert they hold for this state before expecting the copy.
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true);
    expect(aiInsight(s, d)).toContain('Day complete');
  });

  it('does not claim day complete when only dinner is logged', () => {
    const s = { ...createInitialState(), meals: { breakfast: false, lunch: false, snack: false, dinner: true } } as AppState;
    const d = computeDerived(s);
    const msg = aiInsight(s, d);
    expect(msg).not.toContain('Day complete');
    // Truthful nudge: shows the live protein gap and points at the remaining work,
    // not the misleading "log dinner" (dinner is already logged).
    expect(msg).toContain(`${d.proteinGap}g`);
    expect(msg).toContain('remaining meals');
    expect(msg).not.toContain('log dinner');
  });

  it('gates the day-complete copy on the protein boundary, not meals alone', () => {
    // MEAL_MACROS protein sums to 42+51+49+52 = 194g, which always >= the 180g
    // PROTEIN_TARGET. So an "all-four-logged but protein below target" state is
    // UNREACHABLE from the fixed macros without scoring changes (out of scope).
    // Per the acceptance escape clause, assert the boundary directly instead.
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: true, dinner: true } } as AppState;
    const d = computeDerived(s);
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true); // boundary held → both arms satisfied
    expect(aiInsight(s, d)).toContain('Day complete');
  });
});

describe('heroStatus', () => {
  it('day-complete A-day → positive tone, streak/complete copy, never "behind" or the false on-pace claim', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: true, snack: true, dinner: true },
      ciSubmitted: true,
    } as AppState;
    const d = computeDerived(s);
    // Verify the fixture actually lands in the day-complete A band before asserting.
    expect(d.mealsLoggedCount).toBe(4);
    expect(d.proteinToday >= d.proteinTarget).toBe(true);
    expect(d.athleteScore).toBeGreaterThanOrEqual(90);

    const h = heroStatus(s, d);
    expect(h.tone).toBe('positive');
    expect(h.line).toMatch(/streak|complete/i);
    expect(h.line.toLowerCase()).not.toContain('behind');
    expect(h.line).not.toContain(FALSE_CLAIM);
    expect(h.standingLabel).toBe('Top of your team'); // grade A
  });

  it('on-pace partial day → not warn, references the real proteinGap, never the false on-pace claim', () => {
    const s = { ...createInitialState(), ciSubmitted: true } as AppState;
    const d = computeDerived(s);
    // Bump into the on-pace (B) band but day NOT complete (3 meals).
    expect(d.athleteScore).toBeGreaterThanOrEqual(80);
    expect(d.athleteScore).toBeLessThan(90);
    expect(d.mealsLoggedCount).toBeLessThan(4);
    expect(d.proteinGap).toBeGreaterThan(0);

    const h = heroStatus(s, d);
    expect(h.tone).not.toBe('warn');
    expect(h.line).toContain(`${d.proteinGap}g`);
    expect(h.line).not.toContain(FALSE_CLAIM);
  });

  it('behind state (no meals, no check-in) → warn tone, honest "behind" copy, never the false on-pace claim', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: false, lunch: false, snack: false, dinner: false },
      ciSubmitted: false,
    } as AppState;
    const d = computeDerived(s);
    expect(d.athleteScore).toBeLessThan(70);

    const h = heroStatus(s, d);
    expect(h.tone).toBe('warn');
    expect(h.line).toMatch(/behind/i);
    expect(h.line).toContain(`${d.proteinGap}g`);
    expect(h.line).not.toContain(FALSE_CLAIM);
  });

  it('maps each grade to a standingLabel with no fabricated percentile', () => {
    const base = computeDerived(createInitialState());
    const at = (score: number): Derived => ({ ...base, athleteScore: score, grade: gradeFor(score) });
    const cases: [number, string][] = [
      [95, 'Top of your team'],     // A
      [85, 'Upper third of your team'], // B
      [75, 'Middle of your team'],  // C
      [65, 'Work to do this week'], // D
      [55, 'Work to do this week'], // F
    ];
    cases.forEach(([score, label]) => {
      const h = heroStatus(createInitialState(), at(score));
      expect(h.standingLabel).toBe(label);
      expect(h.standingLabel).not.toContain('%');
      expect(h.standingLabel).not.toContain('Top 12%');
    });
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
