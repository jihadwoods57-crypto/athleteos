import { toEditableFoods, mealMacros, macroComposition, mealQuality, stepServings, type EditableFood } from './mealEdit';

const dinner = {
  protein: 52,
  kcal: 680,
  carbs: 64,
  fat: 18,
  foods: [
    { n: 'Grilled chicken', p: '7 oz' },
    { n: 'Brown rice', p: '1 cup' },
    { n: 'Broccoli', p: '1.5 cups' },
    { n: 'Olive oil', p: '1 tbsp' },
  ],
};

describe('toEditableFoods', () => {
  it('splits the estimate evenly, servings start at 1', () => {
    const foods = toEditableFoods(dinner);
    expect(foods).toHaveLength(4);
    expect(foods.every((f) => f.servings === 1)).toBe(true);
    expect(foods[0].per.protein).toBeCloseTo(13); // 52/4
  });
  it('initial totals equal the meal estimate (round-trip)', () => {
    expect(mealMacros(toEditableFoods(dinner))).toEqual({ protein: 52, kcal: 680, carbs: 64, fat: 18 });
  });
});

describe('mealMacros recompute', () => {
  it('doubling one food raises totals by that food share', () => {
    const foods = toEditableFoods(dinner);
    const edited: EditableFood[] = foods.map((f, i) => (i === 0 ? { ...f, servings: 2 } : f));
    const m = mealMacros(edited);
    expect(m.protein).toBe(65); // 52 + 13
  });
  it('removing a food (servings 0) drops its share', () => {
    const foods = toEditableFoods(dinner).map((f, i) => (i === 0 ? { ...f, servings: 0 } : f));
    expect(mealMacros(foods).protein).toBe(39); // 52 - 13
  });
});

describe('macroComposition', () => {
  it('sums to ~100 and is factual from macros', () => {
    const comp = macroComposition({ protein: 52, kcal: 680, carbs: 64, fat: 18 });
    const total = comp.reduce((a, c) => a + c.pct, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1);
    expect(comp.map((c) => c.label)).toEqual(['Protein', 'Carbs', 'Fat']);
  });
  it('is all zeros for an empty meal', () => {
    expect(macroComposition({ protein: 0, kcal: 0, carbs: 0, fat: 0 })).toEqual([
      { label: 'Protein', pct: 0 },
      { label: 'Carbs', pct: 0 },
      { label: 'Fat', pct: 0 },
    ]);
  });
});

describe('mealQuality', () => {
  it('rises with protein density', () => {
    const lean = mealQuality({ protein: 60, kcal: 400, carbs: 20, fat: 8 });
    const carby = mealQuality({ protein: 15, kcal: 600, carbs: 100, fat: 10 });
    expect(lean).toBeGreaterThan(carby);
  });
  it('is clamped 0-100 and 0 for an empty meal', () => {
    expect(mealQuality({ protein: 0, kcal: 0, carbs: 0, fat: 0 })).toBe(0);
    const q = mealQuality({ protein: 100, kcal: 400, carbs: 0, fat: 0 });
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(100);
  });
});

describe('stepServings', () => {
  it('steps by the delta and never goes below 0', () => {
    expect(stepServings(1, 0.5)).toBe(1.5);
    expect(stepServings(0, -0.5)).toBe(0);
  });
  it('caps at 10', () => {
    expect(stepServings(10, 0.5)).toBe(10);
  });
});
