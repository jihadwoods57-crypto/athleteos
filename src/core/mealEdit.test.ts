import { toEditableFoods, mealMacros, macroComposition, mealQuality, stepServings, resolvePortion, foodToEditable, addFood, removeFood, type EditableFood } from './mealEdit';

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

const eggs = { name: 'Egg', serving: '1 large', per: { protein: 6, kcal: 72, carbs: 0, fat: 5 } };

describe('foodToEditable', () => {
  it('carries the real per-serving macros at one serving', () => {
    const f = foodToEditable(eggs);
    expect(f).toEqual({ name: 'Egg', portion: '1 large', servings: 1, per: { protein: 6, kcal: 72, carbs: 0, fat: 5 } });
  });
  it('clones per so editing the result does not mutate the source', () => {
    const f = foodToEditable(eggs);
    f.per.protein = 999;
    expect(eggs.per.protein).toBe(6);
  });
});

describe('addFood', () => {
  it('appends a new food with its real macros and recomputes totals', () => {
    const base = toEditableFoods(dinner); // 52p / 680k / 64c / 18f
    const next = addFood(base, eggs);
    expect(next).toHaveLength(5);
    expect(mealMacros(next)).toEqual({ protein: 58, kcal: 752, carbs: 64, fat: 23 });
  });
  it('bumps servings instead of duplicating an existing name', () => {
    const once = addFood([], eggs);
    const twice = addFood(once, eggs);
    expect(twice).toHaveLength(1);
    expect(twice[0].servings).toBe(2);
    expect(mealMacros(twice)).toEqual({ protein: 12, kcal: 144, carbs: 0, fat: 10 });
  });
  it('is pure — does not mutate the input array', () => {
    const base = toEditableFoods(dinner);
    addFood(base, eggs);
    expect(base).toHaveLength(4);
  });
});

describe('resolvePortion — the actual amount at a serving multiplier', () => {
  it('scales the leading number and keeps the unit', () => {
    expect(resolvePortion('7 oz', 1.5)).toBe('10.5 oz');
    expect(resolvePortion('1 cup', 0.5)).toBe('0.5 cup');
    expect(resolvePortion('1.5 cups', 2)).toBe('3 cups');
  });
  it('drops a trailing .0 (no "10.0 oz")', () => {
    expect(resolvePortion('5 oz', 2)).toBe('10 oz');
  });
  it('returns the label unchanged at 1 serving', () => {
    expect(resolvePortion('7 oz', 1)).toBe('7 oz');
  });
  it('handles a multi-word unit', () => {
    expect(resolvePortion('2 slices bread', 2)).toBe('4 slices bread');
  });
  it('returns null when there is no parseable leading number', () => {
    expect(resolvePortion('a handful', 2)).toBeNull();
    expect(resolvePortion('', 2)).toBeNull();
  });
  it('resolves a bare number with no unit', () => {
    expect(resolvePortion('2', 1.5)).toBe('3');
  });
});

describe('removeFood', () => {
  it('removes the food at the index and recomputes', () => {
    const foods = addFood([], eggs);
    expect(removeFood(foods, 0)).toEqual([]);
  });
  it('is a no-op for an out-of-range index, returning a copy', () => {
    const foods = addFood([], eggs);
    const out = removeFood(foods, 5);
    expect(out).toEqual(foods);
    expect(out).not.toBe(foods);
  });
});
