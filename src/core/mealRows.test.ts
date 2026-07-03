// OnStandard — pure-core unit test for the Nutrition row-builder helper.
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

  it('a saved plate names the row after the real foods and scores quality from its macros', () => {
    const s = {
      ...createInitialState(),
      meals: { breakfast: true, lunch: false, snack: false, dinner: false },
      mealFoods: { breakfast: [{ name: 'Protein shake', portion: '1 scoop', servings: 1, per: { protein: 30, kcal: 180, carbs: 6, fat: 3 } }] },
    };
    const byKey = Object.fromEntries(mealRowsFor(s).map((r) => [r.key, r]));
    expect(byKey.breakfast.name).toBe('Protein shake');
    expect(byKey.breakfast.name).not.toBe(mealResultFor('Breakfast').name);
    expect(byKey.breakfast.protein).toBe(30); // real plate macros, not the slot constant
  });

  it('a multi-food plate leads with the first food and counts the rest', () => {
    const plate = [
      { name: 'Grilled chicken', portion: '7 oz', servings: 1, per: { protein: 52, kcal: 330, carbs: 0, fat: 7 } },
      { name: 'Brown rice', portion: '1 cup', servings: 1, per: { protein: 5, kcal: 220, carbs: 45, fat: 2 } },
      { name: 'Broccoli', portion: '1 cup', servings: 1, per: { protein: 3, kcal: 55, carbs: 11, fat: 0 } },
    ];
    const s = { ...createInitialState(), meals: { breakfast: false, lunch: true, snack: false, dinner: false }, mealFoods: { lunch: plate } };
    const byKey = Object.fromEntries(mealRowsFor(s).map((r) => [r.key, r]));
    expect(byKey.lunch.name).toBe('Grilled chicken + 2 more');
  });

  it("a REAL user's plate-less logged slot keeps the slot label, never the showcase dish", () => {
    const s = {
      ...createInitialState(),
      athleteName: 'Marcus Cole',
      meals: { breakfast: true, lunch: false, snack: false, dinner: false },
      mealFoods: {},
    };
    const byKey = Object.fromEntries(mealRowsFor(s).map((r) => [r.key, r]));
    expect(byKey.breakfast.name).toBe('Breakfast');
    expect(byKey.breakfast.name).not.toBe(mealResultFor('Breakfast').name);
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
