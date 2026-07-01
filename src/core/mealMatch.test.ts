import { matchUsuals, usualToResult } from './mealMatch';
import type { StoredMeal } from './types';

const meal = (over: Partial<StoredMeal>): StoredMeal => ({
  type: 'dinner', name: 'Chicken & Rice', protein: 50, kcal: 700, carbs: 60, fat: 18, quality: 90,
  photo_path: null, day_date: '2026-06-20', logged_at: '2026-06-20T18:00:00Z', ...over,
});

describe('matchUsuals', () => {
  it('groups repeats (name-normalized) and excludes meals seen only once', () => {
    const recent = [
      meal({ name: 'Chicken & Rice', day_date: '2026-06-20' }),
      meal({ name: 'chicken & rice', day_date: '2026-06-21' }), // same meal, different casing
      meal({ name: 'One-off Sushi', day_date: '2026-06-19' }),
    ];
    const usuals = matchUsuals(recent, 'Dinner');
    expect(usuals).toHaveLength(1); // the singleton is not a "usual"
    expect(usuals[0].count).toBe(2);
    expect(usuals[0].name).toBe('chicken & rice'); // most-recent representative name
  });

  it('ranks the current slot first, then frequency', () => {
    const recent = [
      meal({ name: 'Shake', type: 'snack', day_date: '2026-06-18' }),
      meal({ name: 'Shake', type: 'snack', day_date: '2026-06-19' }),
      meal({ name: 'Shake', type: 'snack', day_date: '2026-06-20' }),
      meal({ name: 'Steak Plate', type: 'dinner', day_date: '2026-06-18' }),
      meal({ name: 'Steak Plate', type: 'dinner', day_date: '2026-06-19' }),
    ];
    const usuals = matchUsuals(recent, 'Dinner');
    expect(usuals[0].name).toBe('Steak Plate'); // dinner slot wins despite Shake's higher count
  });

  it('reuses the confirmed macros from the most recent logging', () => {
    const recent = [
      meal({ name: 'Bowl', protein: 40, day_date: '2026-06-18' }),
      meal({ name: 'Bowl', protein: 60, day_date: '2026-06-22' }),
    ];
    const [u] = matchUsuals(recent, 'Dinner');
    expect(u.protein).toBe(60);
  });

  it('honors the limit', () => {
    const recent = ['A', 'B', 'C', 'D'].flatMap((n) => [
      meal({ name: n, day_date: '2026-06-18' }),
      meal({ name: n, day_date: '2026-06-19' }),
    ]);
    expect(matchUsuals(recent, 'Dinner', 2)).toHaveLength(2);
  });
});

describe('usualToResult', () => {
  it('builds a high-confidence, match-signal MealResult from a usual', () => {
    const recent = [meal({ name: 'X', day_date: '2026-06-20' }), meal({ name: 'X', day_date: '2026-06-21' })];
    const r = usualToResult(matchUsuals(recent, 'Dinner')[0]);
    expect(r.confidence).toBe('high');
    expect(r.descriptionSignal).toBe('match');
    expect(r.protein).toBe(50);
    expect(r.detected).toEqual(['X']);
  });
});
