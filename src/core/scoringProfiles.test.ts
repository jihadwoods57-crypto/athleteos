// AthleteOS — scoring profiles. Proves the athlete profile reproduces the shipped formula,
// the general profile re-weights to calorie adherence, the calorie band is two-sided
// (penalizes under- AND over-eating), and computeDerived honors the profile while leaving
// the athlete default untouched.
import { calorieAdherence, profileNutritionScore, PROFILE_WEIGHTS, resolveProfile } from './scoringProfiles';
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';

describe('PROFILE_WEIGHTS', () => {
  it('every profile mix sums to 1', () => {
    for (const p of ['athlete', 'general'] as const) {
      const w = PROFILE_WEIGHTS[p];
      expect(w.nutrition + w.recovery + w.tasks + w.checkin).toBeCloseTo(1, 5);
    }
  });
  it('athlete keeps the shipped .5/.25/.15/.1 mix', () => {
    expect(PROFILE_WEIGHTS.athlete).toEqual({ nutrition: 0.5, recovery: 0.25, tasks: 0.15, checkin: 0.1 });
  });
});

describe('calorieAdherence — two-sided band', () => {
  it('is full credit within +/-10% of target', () => {
    expect(calorieAdherence(2000, 2000)).toBe(1);
    expect(calorieAdherence(2200, 2000)).toBe(1); // +10% boundary
    expect(calorieAdherence(1800, 2000)).toBe(1); // -10% boundary
  });
  it('penalizes under-eating just like over-eating (no reward for a crash deficit)', () => {
    expect(calorieAdherence(1200, 2000)).toBe(0); // -40%
    expect(calorieAdherence(2800, 2000)).toBe(0); // +40%
    expect(calorieAdherence(1600, 2000)).toBeCloseTo(0.667, 2); // -20%
    expect(calorieAdherence(2400, 2000)).toBeCloseTo(0.667, 2); // +20%
  });
  it('is 0 for a non-positive target', () => {
    expect(calorieAdherence(2000, 0)).toBe(0);
  });
});

describe('profileNutritionScore', () => {
  it('athlete reproduces protein 65 + meals 35', () => {
    expect(profileNutritionScore('athlete', { proteinToday: 180, proteinTarget: 180, kcalToday: 0, calTarget: 0, effectiveMeals: 4 })).toBe(100);
    expect(profileNutritionScore('athlete', { proteinToday: 90, proteinTarget: 180, kcalToday: 0, calTarget: 0, effectiveMeals: 2 })).toBe(50);
  });
  it('general = calorie 45 + protein 25 + consistency 30', () => {
    // perfect general day
    expect(profileNutritionScore('general', { proteinToday: 120, proteinTarget: 120, kcalToday: 2000, calTarget: 2000, effectiveMeals: 4 })).toBe(100);
    // 5% off calories (full 45), protein 75% (18.75), 3/4 meals (22.5) -> 86
    expect(profileNutritionScore('general', { proteinToday: 90, proteinTarget: 120, kcalToday: 1900, calTarget: 2000, effectiveMeals: 3 })).toBe(86);
  });
  it('general tanks when calories miss badly even if protein is hit', () => {
    const s = profileNutritionScore('general', { proteinToday: 120, proteinTarget: 120, kcalToday: 3500, calTarget: 2000, effectiveMeals: 4 });
    expect(s).toBeLessThan(60); // calorie adherence 0 -> only protein 25 + consistency 30
  });
});

describe('resolveProfile', () => {
  it('defaults an absent profile to athlete', () => {
    expect(resolveProfile(undefined)).toBe('athlete');
    expect(resolveProfile('general')).toBe('general');
  });
});

describe('computeDerived honors the profile', () => {
  const base = createInitialState();

  it('an absent profile scores identically to an explicit athlete profile', () => {
    expect(computeDerived(base).athleteScore).toBe(computeDerived({ ...base, scoringProfile: 'athlete' }).athleteScore);
  });

  it('the general profile changes the score (calorie miss tanks general nutrition)', () => {
    const athlete = computeDerived(base);
    const general = computeDerived({ ...base, scoringProfile: 'general', calTarget: 100 });
    expect(general.nutritionScore).toBeLessThan(athlete.nutritionScore);
    expect(general.athleteScore).not.toBe(athlete.athleteScore);
  });
});
