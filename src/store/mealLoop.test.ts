// AthleteOS — store-level meal loop (Tier 1). Drives the real saveMeal action and
// asserts: a saved plate persists into day state, logs the slot, closes the detail
// overlay, and that the authoritative computeDerived score reflects the real macros.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { computeDerived } from '@/core';
import type { EditableFood } from '@/core';

const state = () => useStore.getState();

const plate = (protein: number): EditableFood[] => [
  { name: 'food', portion: '1 serving', servings: 1, per: { protein, kcal: 0, carbs: 0, fat: 0 } },
];

beforeEach(() => {
  state().resetDemo();
});

describe('saveMeal', () => {
  it('starts with no saved plates (seeded demo uses slot constants)', () => {
    expect(state().mealFoods).toEqual({});
  });

  it('persists the edited foods, logs the slot, and closes the detail overlay', () => {
    state().openMealDetail('dinner');
    expect(state().mealDetailOpen).toBe(true);
    state().saveMeal('dinner', plate(50));
    expect(state().mealFoods.dinner).toEqual(plate(50));
    expect(state().meals.dinner).toBe(true);
    expect(state().mealDetailOpen).toBe(false);
  });

  it('routes the saved macros into the authoritative daily score', () => {
    const before = computeDerived(state()).proteinToday; // 142 (dinner unlogged)
    state().saveMeal('dinner', plate(50));
    expect(computeDerived(state()).proteinToday).toBe(before + 50);
  });

  it('editing an already-logged slot moves the score off the slot constant', () => {
    const before = computeDerived(state());
    // breakfast constant is 42g; save a 90g plate -> +48g protein
    state().saveMeal('breakfast', plate(90));
    const after = computeDerived(state());
    expect(after.proteinToday).toBe(before.proteinToday + 48);
    expect(after.athleteScore).toBeGreaterThanOrEqual(before.athleteScore);
  });

  it('marks the "hit protein" task done once a saved plate clears the target', () => {
    // default protein target is 180g; 142 (seeded) + 80 (saved dinner) = 222 >= 180
    state().saveMeal('dinner', plate(80));
    const proteinTask = state().tasks.find((t) => t.id === 2);
    expect(proteinTask?.done).toBe(true);
  });

  // Keystone: the engines master switch is OFF in the test env (EXPO_PUBLIC_ENGINES_ENABLED
  // unset). The Accountability Engine's on-time punctuality signal (Feature 8) feeds the
  // Development Score, so with engines off it must NOT be recorded — a meal logged at any
  // hour stays full-credit and the score is byte-for-byte the pre-engines number.
  it('does NOT record a punctuality timestamp when the engines switch is off', () => {
    expect(state().mealLoggedAt).toEqual({});
    state().saveMeal('dinner', plate(50));
    expect(state().mealLoggedAt).toEqual({}); // no late-penalty signal collected
  });

  it('addMeal also records no punctuality timestamp with engines off', () => {
    useStore.setState({ mealType: 'Lunch' });
    state().addMeal();
    expect(state().meals.lunch).toBe(true); // the slot still logs
    expect(state().mealLoggedAt).toEqual({}); // but no on-time stamp with engines off
  });
});
