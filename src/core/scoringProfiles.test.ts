// OnStandard — scoring profiles. Proves the athlete profile reproduces the shipped formula,
// the general profile re-weights to calorie adherence, the calorie band is two-sided
// (penalizes under- AND over-eating), and computeDerived honors the profile while leaving
// the athlete default untouched.
import { calorieAdherence, calorieFloorAdherence, profileForGoal, profileNutritionScore, PROFILE_WEIGHTS, resolveProfile } from './scoringProfiles';
import { computeDerived, SCORE_WEIGHTS } from './scoring';
import { createInitialState } from './defaultState';

describe('PROFILE_WEIGHTS', () => {
  it('every profile mix sums to 1', () => {
    for (const p of ['athlete', 'general', 'gain'] as const) {
      const w = PROFILE_WEIGHTS[p];
      expect(w.nutrition + w.recovery + w.commitment + w.checkin).toBeCloseTo(1, 5);
    }
  });
  it('athlete carries the score v2 mix', () => {
    expect(PROFILE_WEIGHTS.athlete).toEqual({ nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
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

describe('calorieFloorAdherence — one-sided floor (gain)', () => {
  it('gives full credit at or above the surplus target (overage is the point of a bulk)', () => {
    expect(calorieFloorAdherence(3000, 3000)).toBe(1);
    expect(calorieFloorAdherence(3600, 3000)).toBe(1); // ate over -> still full, never penalized
  });
  it('only undereating loses credit', () => {
    expect(calorieFloorAdherence(1800, 3000)).toBe(0); // 60% floor -> 0
    expect(calorieFloorAdherence(2400, 3000)).toBeCloseTo(0.5, 5); // 80% -> halfway
  });
  it('is 0 for a non-positive target', () => {
    expect(calorieFloorAdherence(3000, 0)).toBe(0);
  });
});

describe('profileNutritionScore — gain', () => {
  it('gain = calorie floor 40 + protein 35 + consistency 25', () => {
    // perfect bulk day: hit surplus, hit protein, 4 meals
    expect(profileNutritionScore('gain', { proteinToday: 200, proteinTarget: 200, kcalToday: 3200, calTarget: 3200, effectiveMeals: 4 })).toBe(100);
  });
  it('a green-protein day that never ate enough cannot top out (the board bug)', () => {
    // protein hit + 4 meals, but ate 75% of the surplus target -> calorie floor only partial
    // floor = (0.75-0.6)/0.4 = 0.375 -> 0.375*40 = 15; +35 protein +25 meals = 75
    const s = profileNutritionScore('gain', { proteinToday: 200, proteinTarget: 200, kcalToday: 2400, calTarget: 3200, effectiveMeals: 4 });
    expect(s).toBe(75); // undereating costs real points even on a green-protein day
  });
  it('never penalizes a surplus the way general would', () => {
    const inputs = { proteinToday: 200, proteinTarget: 200, kcalToday: 4200, calTarget: 3200, effectiveMeals: 4 } as const;
    expect(profileNutritionScore('gain', inputs)).toBe(100); // gain: full credit, overage is fine
    expect(profileNutritionScore('general', inputs)).toBeLessThan(75); // general: over-eating tanks it
  });
});

describe('profileForGoal', () => {
  it('maps each goal to its platform scoring profile', () => {
    expect(profileForGoal('performance')).toBe('athlete');
    expect(profileForGoal('lose')).toBe('general');
    expect(profileForGoal('maintain')).toBe('general');
    expect(profileForGoal('gain')).toBe('gain');
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

describe('score v2 weights', () => {
  it('matches the proto engine exactly', () => {
    expect(PROFILE_WEIGHTS.athlete).toEqual({ nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
    expect(PROFILE_WEIGHTS.general).toEqual({ nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 });
    expect(PROFILE_WEIGHTS.gain).toEqual({ nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
  });

  it('every profile sums to 1', () => {
    for (const [name, w] of Object.entries(PROFILE_WEIGHTS)) {
      const sum = w.nutrition + w.recovery + w.commitment + w.checkin;
      expect(`${name}:${sum.toFixed(6)}`).toBe(`${name}:${(1).toFixed(6)}`);
    }
  });

  it('SCORE_WEIGHTS is derived from PROFILE_WEIGHTS, never a second literal', () => {
    const byKey = Object.fromEntries(SCORE_WEIGHTS.map((s) => [s.key, s.pct]));
    expect(byKey.nutrition).toBe(Math.round(PROFILE_WEIGHTS.athlete.nutrition * 100));
    expect(byKey.recovery).toBe(Math.round(PROFILE_WEIGHTS.athlete.recovery * 100));
    expect(byKey.checkin).toBe(Math.round(PROFILE_WEIGHTS.athlete.checkin * 100));
  });

  it('drops zero-weight components from the display breakdown', () => {
    expect(SCORE_WEIGHTS.find((s) => s.key === 'commitment')).toBeUndefined();
  });
});
