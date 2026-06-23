import {
  startingScore,
  gradeWithSuffix,
  scoreAfterFirstMeal,
  sleepHoursToSlider,
  FIRST_MEAL_BUMP,
  type BaselineAnswers,
} from './startingScore';

const PERFECT: BaselineAnswers = {
  nutritionConfidence: 10,
  mealsPerDay: 5,
  waterL: 3.8,
  sleepH: 9,
  proteinFreq: 3,
  consistency: 10,
};
const FLOOR: BaselineAnswers = {
  nutritionConfidence: 1,
  mealsPerDay: 2,
  waterL: 0,
  sleepH: 4,
  proteinFreq: 0,
  consistency: 1,
};

describe('startingScore', () => {
  it('maxes at 100 for the strongest answers', () => {
    expect(startingScore(PERFECT)).toBe(100);
  });

  it('floors low but stays >= 0 for the weakest answers', () => {
    const s = startingScore(FLOOR);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(20); // confidence(1/10*20=2)+cons(2) only
  });

  it('produces a believable mid score for average habits', () => {
    const s = startingScore({
      nutritionConfidence: 6,
      mealsPerDay: 3,
      waterL: 2,
      sleepH: 7,
      proteinFreq: 2,
      consistency: 6,
    });
    expect(s).toBeGreaterThan(55);
    expect(s).toBeLessThan(80);
  });

  it('rises monotonically with protein frequency (the heaviest weight)', () => {
    const base = { ...FLOOR };
    const a = startingScore({ ...base, proteinFreq: 0 });
    const b = startingScore({ ...base, proteinFreq: 3 });
    expect(b - a).toBe(25);
  });

  it('clamps out-of-range answers instead of overscoring', () => {
    expect(startingScore({ ...PERFECT, mealsPerDay: 99, sleepH: 24, waterL: 99 })).toBe(100);
  });
});

describe('gradeWithSuffix', () => {
  it('suffixes by position within the band', () => {
    expect(gradeWithSuffix(72)).toBe('C-'); // offset 2
    expect(gradeWithSuffix(75)).toBe('C'); // offset 5
    expect(gradeWithSuffix(78)).toBe('C+'); // offset 8
    expect(gradeWithSuffix(80)).toBe('B-');
    expect(gradeWithSuffix(90)).toBe('A-');
    expect(gradeWithSuffix(100)).toBe('A+');
  });

  it('never suffixes F', () => {
    expect(gradeWithSuffix(50)).toBe('F');
    expect(gradeWithSuffix(0)).toBe('F');
  });
});

describe('first-meal challenge', () => {
  it('bumps the score by the fixed reward, capped at 100', () => {
    expect(scoreAfterFirstMeal(72)).toBe(72 + FIRST_MEAL_BUMP);
    expect(scoreAfterFirstMeal(99)).toBe(100);
  });
});

describe('sleepHoursToSlider', () => {
  it('maps hours onto the 1-10 slider', () => {
    expect(sleepHoursToSlider(9)).toBe(10);
    expect(sleepHoursToSlider(0)).toBe(1);
    expect(sleepHoursToSlider(7)).toBe(8);
  });
});
