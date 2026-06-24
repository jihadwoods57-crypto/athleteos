import { analyzeMeal, isAiConfigured } from './index';
import { mealResultFor } from '@/core';

describe('analyzeMeal', () => {
  it('is inert without a configured backend (deterministic fallback)', () => {
    expect(isAiConfigured).toBe(false);
  });

  it('returns the deterministic MealResult for each slot when unconfigured', async () => {
    for (const m of ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const) {
      const got = await analyzeMeal({ mealType: m, goal: null });
      expect(got).toEqual(mealResultFor(m));
    }
  });

  it('always resolves a usable result (logging never blocks on AI)', async () => {
    const got = await analyzeMeal({ mealType: 'Dinner', goal: 'get_stronger' });
    expect(got.name).toBeTruthy();
    expect(got.protein).toBeGreaterThan(0);
    expect(Array.isArray(got.detected)).toBe(true);
  });
});
