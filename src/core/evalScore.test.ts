import { expectedMacros, scoreDetection, scoreMacroError, scoreVerifyTrigger } from './evalScore';

describe('expectedMacros', () => {
  test('sums food-db macros times servings', () => {
    // chicken-breast per = protein35/kcal187/carbs0/fat4; 2 servings
    const m = expectedMacros([{ foodDbId: 'chicken-breast', servings: 2 }]);
    expect(m).toEqual({ protein: 70, kcal: 374, carbs: 0, fat: 8 });
  });
  test('unknown ids are skipped, not crashed', () => {
    expect(expectedMacros([{ foodDbId: 'nope', servings: 1 }])).toEqual({ protein: 0, kcal: 0, carbs: 0, fat: 0 });
  });
});

describe('scoreDetection', () => {
  test('precision/recall against expected foods', () => {
    const d = scoreDetection([{ name: 'grilled chicken' }, { name: 'white rice' }], [{ foodDbId: 'chicken-breast', servings: 1 }]);
    expect(d.recall).toBe(1);       // chicken found
    expect(d.expectedCount).toBe(1);
    expect(d.detectedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('scoreMacroError', () => {
  test('absolute + pct error per macro', () => {
    const e = scoreMacroError({ protein: 40, kcal: 600, carbs: 50, fat: 20 }, { protein: 50, kcal: 500, carbs: 50, fat: 20 });
    expect(e.protein.abs).toBe(10);
    expect(e.protein.pct).toBeCloseTo(0.2);
    expect(e.kcal.abs).toBe(100);
  });
});

describe('scoreVerifyTrigger', () => {
  test('accuracy trigger expected + fires', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40 },
      { id: 'x', photo: 'x', caseType: 'known-failure', expectedFoods: [], expectVerify: 'accuracy' });
    expect(r).toEqual({ expected: 'accuracy', fired: 'accuracy', correct: true });
  });
  test('clear case expects none, stays quiet', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'chicken', kcal: 500, confidence: 'high' }], quality: 85 },
      { id: 'y', photo: 'y', caseType: 'clear', expectedFoods: [], expectVerify: 'none' });
    expect(r.correct).toBe(true);
  });
});
