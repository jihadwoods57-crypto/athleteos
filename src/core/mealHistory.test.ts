import { dayLabel, groupMealsByDay, localTodayCards, storedMealToCard, type StoredMeal } from './mealHistory';
import { createInitialState } from './defaultState';
import type { AppState } from './types';

const meal = (over: Partial<StoredMeal> = {}): StoredMeal => ({
  type: 'dinner',
  name: 'Chicken & Rice',
  protein: 52,
  kcal: 680,
  quality: 94,
  photo_path: null,
  day_date: '2026-06-28',
  logged_at: '2026-06-28T19:00:00Z',
  ...over,
});

describe('dayLabel', () => {
  it('reads Today / Yesterday relative to the reference stamp', () => {
    expect(dayLabel('2026-06-28', '2026-06-28')).toBe('Today');
    expect(dayLabel('2026-06-27', '2026-06-28')).toBe('Yesterday');
  });
  it('formats older days as weekday, month day', () => {
    expect(dayLabel('2026-06-23', '2026-06-28')).toBe('Tue, Jun 23');
  });
  it('falls back to the raw stamp when unparseable', () => {
    expect(dayLabel('not-a-date', '2026-06-28')).toBe('not-a-date');
  });
});

describe('storedMealToCard', () => {
  it('maps a row to a card with rounded, floored macros', () => {
    const c = storedMealToCard(meal({ protein: 51.6, kcal: 679.4, quality: 94 }));
    expect(c).toMatchObject({ label: 'Dinner', name: 'Chicken & Rice', protein: 52, kcal: 679, quality: 94 });
    expect(c.id).toBe('2026-06-28-dinner');
  });
  it('survives a null/unknown slot type and missing macros (no crash, floored to 0)', () => {
    const c = storedMealToCard(meal({ type: null, name: null, protein: null, kcal: null, quality: null }));
    expect(c.protein).toBe(0);
    expect(c.kcal).toBe(0);
    expect(c.label).toBe('Dinner'); // unknown slot falls back to dinner color/label
  });
  it('carries the photo path through when present', () => {
    expect(storedMealToCard(meal({ photo_path: 'a/2026-06-28/dinner.jpg' })).photoPath).toBe('a/2026-06-28/dinner.jpg');
  });
});

describe('groupMealsByDay', () => {
  it('groups by day newest-first and orders meals within a day by logged_at', () => {
    const rows: StoredMeal[] = [
      meal({ day_date: '2026-06-27', type: 'dinner', logged_at: '2026-06-27T20:00:00Z' }),
      meal({ day_date: '2026-06-28', type: 'lunch', logged_at: '2026-06-28T12:00:00Z' }),
      meal({ day_date: '2026-06-28', type: 'breakfast', logged_at: '2026-06-28T08:00:00Z' }),
    ];
    const days = groupMealsByDay(rows, '2026-06-28');
    expect(days.map((d) => d.dayLabel)).toEqual(['Today', 'Yesterday']);
    expect(days[0].cards.map((c) => c.label)).toEqual(['Breakfast', 'Lunch']);
  });
  it('returns an empty list for no meals (honest empty state)', () => {
    expect(groupMealsByDay([], '2026-06-28')).toEqual([]);
  });
});

describe('localTodayCards', () => {
  it('renders only the logged slots from local state', () => {
    const s: AppState = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: false, dinner: false } };
    const cards = localTodayCards(s);
    expect(cards.map((c) => c.label)).toEqual(['Breakfast', 'Lunch']);
    expect(cards.every((c) => c.photoPath === null)).toBe(true);
  });
  it('is empty when nothing is logged', () => {
    const s: AppState = { ...createInitialState(), meals: { breakfast: false, lunch: false, snack: false, dinner: false } };
    expect(localTodayCards(s)).toEqual([]);
  });
});
