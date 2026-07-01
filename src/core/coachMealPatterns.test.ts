import { coachMealPatterns } from './nutritionMemory';
import type { StoredMeal } from './types';

const m = (over: Partial<StoredMeal>): StoredMeal => ({
  type: 'dinner', name: 'Meal', protein: 40, kcal: 600, quality: 85,
  photo_path: null, day_date: '2026-06-20', logged_at: '2026-06-20T18:00:00Z', ...over,
});

describe('coachMealPatterns — description bias (Slice 4)', () => {
  it('flags when notes consistently run lighter than the photo (>=60% of >=5 described)', () => {
    const meals = [
      m({ day_date: '2026-06-20', description_signal: 'photo_heavier' }),
      m({ day_date: '2026-06-19', description_signal: 'photo_heavier' }),
      m({ day_date: '2026-06-18', description_signal: 'photo_heavier' }),
      m({ day_date: '2026-06-17', description_signal: 'photo_heavier' }),
      m({ day_date: '2026-06-16', description_signal: 'match' }),
    ];
    expect(coachMealPatterns(meals).map((p) => p.kind)).toContain('description_bias');
  });

  it('does not flag when most notes match the photo', () => {
    const meals = Array.from({ length: 6 }, (_, i) =>
      m({ day_date: `2026-06-1${i}`, description_signal: i === 0 ? 'photo_heavier' : 'match' }),
    );
    expect(coachMealPatterns(meals).some((p) => p.kind === 'description_bias')).toBe(false);
  });

  it('does not flag below the 5-described-meal floor', () => {
    const meals = [
      m({ day_date: '2026-06-20', description_signal: 'photo_heavier' }),
      m({ day_date: '2026-06-19', description_signal: 'photo_heavier' }),
    ];
    expect(coachMealPatterns(meals).some((p) => p.kind === 'description_bias')).toBe(false);
  });
});

describe('coachMealPatterns — logging completeness (Slice 4)', () => {
  it('flags thin logging (few meals per day)', () => {
    const meals = [
      m({ day_date: '2026-06-20', type: 'dinner' }),
      m({ day_date: '2026-06-20', type: 'lunch' }),
      m({ day_date: '2026-06-19', type: 'dinner' }),
      m({ day_date: '2026-06-19', type: 'lunch' }),
      m({ day_date: '2026-06-18', type: 'dinner' }),
      m({ day_date: '2026-06-18', type: 'lunch' }),
    ];
    expect(coachMealPatterns(meals).map((p) => p.kind)).toContain('logging_completeness');
  });
});
