// AthleteOS — pure-core unit test for the Nutrition row-builder helper.
import { mealRowsFor, mealResultFor } from './content';
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import { MEAL_MACROS } from './constants';

describe('mealRowsFor', () => {
  it('returns all four slots in fixed order', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: false, dinner: false } };
    const rows = mealRowsFor(s);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.key)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
  });

  it('logged slots carry name/quality from mealResultFor and macros from MEAL_MACROS', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: false, dinner: false } };
    const rows = mealRowsFor(s);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(byKey.breakfast.logged).toBe(true);
    expect(byKey.breakfast.name).toBe(mealResultFor('Breakfast').name);
    expect(byKey.breakfast.quality).toBe(mealResultFor('Breakfast').quality);
    expect(byKey.breakfast.protein).toBe(MEAL_MACROS.breakfast.p); // 42
    expect(byKey.breakfast.kcal).toBe(MEAL_MACROS.breakfast.k); // 520

    expect(byKey.lunch.logged).toBe(true);
    expect(byKey.lunch.name).toBe(mealResultFor('Lunch').name);
    expect(byKey.lunch.quality).toBe(mealResultFor('Lunch').quality);
    expect(byKey.lunch.protein).toBe(MEAL_MACROS.lunch.p); // 51
    expect(byKey.lunch.kcal).toBe(MEAL_MACROS.lunch.k); // 680
  });

  it('unlogged slots are marked logged===false', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: false, dinner: false } };
    const byKey = Object.fromEntries(mealRowsFor(s).map((r) => [r.key, r]));
    expect(byKey.snack.logged).toBe(false);
    expect(byKey.dinner.logged).toBe(false);
  });

  it('logged-row count equals computeDerived().mealsLoggedCount', () => {
    const s = { ...createInitialState(), meals: { breakfast: true, lunch: true, snack: false, dinner: false } };
    const loggedRows = mealRowsFor(s).filter((r) => r.logged).length;
    expect(loggedRows).toBe(2);
    expect(loggedRows).toBe(computeDerived(s).mealsLoggedCount);
  });

  it('exposes the MealDetail detailId contract (b/l/s/dinner)', () => {
    const byKey = Object.fromEntries(mealRowsFor(createInitialState()).map((r) => [r.key, r]));
    expect(byKey.breakfast.detailId).toBe('b');
    expect(byKey.lunch.detailId).toBe('l');
    expect(byKey.snack.detailId).toBe('s');
    expect(byKey.dinner.detailId).toBe('dinner');
  });

  it('default state: 3 logged, dinner unlogged, agrees with computeDerived', () => {
    const s = createInitialState();
    const rows = mealRowsFor(s);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.filter((r) => r.logged).length).toBe(3);
    expect(rows.filter((r) => r.logged).length).toBe(computeDerived(s).mealsLoggedCount);
    expect(byKey.dinner.logged).toBe(false);
  });
});
