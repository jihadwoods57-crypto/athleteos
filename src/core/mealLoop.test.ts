// AthleteOS — the real meal loop (Tier 1). Proves the daily score reads a saved
// edited plate's REAL macros for a slot, falls back to the slot constant when no
// plate is saved (so the seeded demo is unchanged), and that an edit MOVES the
// nutrition sub-score + headline. Pure: drives computeDerived against crafted state.
import { computeDerived, mealSlotMacros, loggedDayMacros } from './scoring';
import { createInitialState } from './defaultState';
import { MEAL_MACROS } from './constants';
import type { AppState } from './types';
import type { EditableFood } from './mealEdit';

/** A one-line editable plate at 1 serving carrying explicit per-serving macros. */
const plate = (protein: number, kcal = 0, carbs = 0, fat = 0): EditableFood[] => [
  { name: 'food', portion: '1 serving', servings: 1, per: { protein, kcal, carbs, fat } },
];

describe('mealSlotMacros — saved plate overrides the slot constant', () => {
  it('falls back to MEAL_MACROS when no plate is saved', () => {
    const m = mealSlotMacros({ mealFoods: {} }, 'breakfast');
    expect(m).toEqual({ protein: MEAL_MACROS.breakfast.p, kcal: MEAL_MACROS.breakfast.k, carbs: MEAL_MACROS.breakfast.c, fat: MEAL_MACROS.breakfast.f });
  });

  it('uses the saved plate macros when present', () => {
    const m = mealSlotMacros({ mealFoods: { breakfast: plate(60, 500, 40, 12) } }, 'breakfast');
    expect(m).toEqual({ protein: 60, kcal: 500, carbs: 40, fat: 12 });
  });

  it('sums servings × per across foods', () => {
    const foods: EditableFood[] = [
      { name: 'a', portion: '1', servings: 2, per: { protein: 20, kcal: 100, carbs: 5, fat: 2 } },
      { name: 'b', portion: '1', servings: 1, per: { protein: 10, kcal: 50, carbs: 3, fat: 1 } },
    ];
    expect(mealSlotMacros({ mealFoods: { lunch: foods } }, 'lunch')).toEqual({ protein: 50, kcal: 250, carbs: 13, fat: 5 });
  });
});

describe('loggedDayMacros — only logged slots, real plates when present', () => {
  it('the seeded default day is byte-for-byte the constant sum (no mealFoods)', () => {
    const s = createInitialState();
    // breakfast 42 + lunch 51 + snack 49 (dinner not logged) = 142
    expect(loggedDayMacros(s).protein).toBe(142);
  });

  it('an unlogged slot contributes nothing even if a plate exists', () => {
    const s: AppState = { ...createInitialState(), meals: { breakfast: false, lunch: false, snack: false, dinner: false }, mealFoods: { breakfast: plate(99) } };
    expect(loggedDayMacros(s).protein).toBe(0);
  });
});

describe('computeDerived — an edited plate moves the score', () => {
  it('replacing breakfast with a higher-protein plate raises proteinToday + nutritionScore', () => {
    const base = computeDerived(createInitialState());
    const edited = computeDerived({ ...createInitialState(), mealFoods: { breakfast: plate(90) } });
    // breakfast 42 -> 90 lifts protein by 48: 142 -> 190
    expect(edited.proteinToday).toBe(base.proteinToday + 48);
    expect(edited.nutritionScore).toBeGreaterThan(base.nutritionScore);
    expect(edited.athleteScore).toBeGreaterThanOrEqual(base.athleteScore);
  });

  it('saving an EMPTY plate for a logged slot honestly drops its macros to zero', () => {
    const s: AppState = { ...createInitialState(), mealFoods: { snack: [] } };
    const d = computeDerived(s);
    // snack 49 removed: 142 -> 93
    expect(d.proteinToday).toBe(93);
  });

  it('an enormous plate cannot push the nutrition sub-score or headline past 100', () => {
    const d = computeDerived({ ...createInitialState(), mealFoods: { breakfast: plate(5000) } });
    expect(d.nutritionScore).toBeLessThanOrEqual(100);
    expect(d.athleteScore).toBeLessThanOrEqual(100);
    expect(Number.isFinite(d.proteinToday)).toBe(true);
  });
});
