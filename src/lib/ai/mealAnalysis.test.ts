import { analyzeMeal, isAiConfigured } from './index';
import { mealResultFor } from '@/core';

describe('analyzeMeal', () => {
  it('is inert without a configured backend (deterministic fallback)', () => {
    expect(isAiConfigured).toBe(false);
  });

  it('returns the deterministic MealResult for each slot when unconfigured', async () => {
    for (const m of ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const) {
      const got = await analyzeMeal({ mealType: m, goal: null });
      // Unconfigured never asks questions — it resolves the deterministic result directly.
      expect(got).toEqual({ kind: 'result', result: mealResultFor(m) });
    }
  });

  it('always resolves a usable result (logging never blocks on AI)', async () => {
    const got = await analyzeMeal({ mealType: 'Dinner', goal: 'get_stronger' });
    expect(got.kind).toBe('result');
    if (got.kind !== 'result') throw new Error('expected a result, not questions');
    expect(got.result.name).toBeTruthy();
    expect(got.result.protein).toBeGreaterThan(0);
    expect(Array.isArray(got.result.detected)).toBe(true);
  });
});
