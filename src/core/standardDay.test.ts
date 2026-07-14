// WS3 slice 2 — the coach standard reshaping the SCORED day, both engines.
// Invariant #1: with NO standard, everything is byte-identical to the shipped formula
// (the existing parity/exec suites lock that too — these are explicit sentinels).
// Invariant #2: a standard's meal count is the nutrition denominator, and its slots
// (including meal-5/meal-6) are counted and deadline-checked.

import { profileNutritionScore } from './scoringProfiles';
// @ts-ignore — proto is plain ESM JS (allowJs), same pattern as exec.test.ts
import { DAY as DAY_, setDayStandard, dayStandard, slotDeadline, computeComponents } from '../../proto/redesign-2026-07/js/day.js';

const DAY: any = DAY_; // untyped proto runtime object — the tests drive it directly

const N = { proteinToday: 180, proteinTarget: 180, kcalToday: 0, calTarget: 0 };

describe('src/core profileNutritionScore — mealsRequired denominator', () => {
  test('absent mealsRequired keeps the classic /4 (shipped formula unchanged)', () => {
    expect(profileNutritionScore('athlete', { ...N, effectiveMeals: 4 })).toBe(100);
    expect(profileNutritionScore('athlete', { ...N, effectiveMeals: 3 }))
      .toBe(Math.round(65 + (3 / 4) * 35));
  });
  test('a 2-meal standard: both meals on time = full meal credit', () => {
    expect(profileNutritionScore('athlete', { ...N, effectiveMeals: 2, mealsRequired: 2 })).toBe(100);
  });
  test('a 6-meal standard: 3 meals is half the meal credit', () => {
    expect(profileNutritionScore('athlete', { ...N, effectiveMeals: 3, mealsRequired: 6 }))
      .toBe(Math.round(65 + 0.5 * 35));
  });
  test('mealsFrac never exceeds 1 (overeating slots cannot inflate)', () => {
    expect(profileNutritionScore('athlete', { ...N, effectiveMeals: 5, mealsRequired: 2 })).toBe(100);
  });
});

describe('proto day engine — setDayStandard governs slots, deadlines, denominator', () => {
  const freshDay = () => {
    DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
    DAY.mealLoggedAt = {}; DAY.slotMacros = {}; DAY.quickAdded = [false, false, false];
    DAY.proteinTarget = 180;
  };
  const logOnTime = (k: string, protein = 45) => {
    DAY.meals[k] = true; DAY.mealLoggedAt[k] = 60; // 1:00 AM — before any deadline
    DAY.slotMacros[k] = { protein };
  };
  afterEach(() => { setDayStandard(null); freshDay(); });

  test('no standard: classic 4-slot denominator (3 on-time meals = 3/4 credit)', () => {
    freshDay();
    logOnTime('breakfast', 60); logOnTime('lunch', 60); logOnTime('dinner', 60);
    expect(computeComponents(DAY).nutrition).toBe(Math.round(65 + (3 / 4) * 35));
    expect(dayStandard()).toBeNull();
  });

  test('2-meal standard: breakfast + dinner on time = 100 nutrition', () => {
    freshDay();
    setDayStandard({ mealsRequired: 2, slots: ['breakfast', 'dinner'], deadlines: {}, titles: {} });
    logOnTime('breakfast', 90); logOnTime('dinner', 90);
    expect(computeComponents(DAY).nutrition).toBe(100);
    // lunch logged anyway: does not change the capped credit
    logOnTime('lunch', 0);
    expect(computeComponents(DAY).nutrition).toBe(100);
  });

  test('6-meal standard: extra slots are seeded, counted, and deadline-checked', () => {
    freshDay();
    setDayStandard({
      mealsRequired: 6,
      slots: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'],
      deadlines: { 'meal-5': 1320, 'meal-6': 1350 }, titles: {},
    });
    expect(DAY.meals).toHaveProperty('meal-5', false); // seeded by the standard
    expect(slotDeadline('meal-5')).toBe(1320);
    ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'].forEach(k => logOnTime(k, 30));
    expect(computeComponents(DAY).nutrition).toBe(100);
  });

  test('late meal under a standard earns half against the standard deadline', () => {
    freshDay();
    setDayStandard({ mealsRequired: 1, slots: ['dinner'], deadlines: { dinner: 1230 }, titles: {} });
    DAY.meals.dinner = true; DAY.mealLoggedAt.dinner = 1300; // past 8:30 PM window
    DAY.slotMacros.dinner = { protein: 180 };
    expect(computeComponents(DAY).nutrition).toBe(Math.round(65 + 0.5 * 35));
  });
});
