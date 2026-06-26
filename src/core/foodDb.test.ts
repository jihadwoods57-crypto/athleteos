import { FOOD_DB, searchFoods, foodById } from './foodDb';

describe('FOOD_DB integrity', () => {
  it('has a non-trivial number of foods', () => {
    expect(FOOD_DB.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique ids', () => {
    const ids = FOOD_DB.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every food has a name, serving, category, and finite non-negative macros', () => {
    for (const f of FOOD_DB) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.serving.length).toBeGreaterThan(0);
      expect(f.category.length).toBeGreaterThan(0);
      for (const key of ['protein', 'kcal', 'carbs', 'fat'] as const) {
        const v = f.per[key];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('per-serving kcal is roughly consistent with the macro breakdown', () => {
    // Atwater: 4/4/9. Allow a wide band for rounding + fiber/alcohol-free foods.
    for (const f of FOOD_DB) {
      const derived = f.per.protein * 4 + f.per.carbs * 4 + f.per.fat * 9;
      const diff = Math.abs(derived - f.per.kcal);
      // within 35 kcal or 25% of the stated calories, whichever is larger
      const tol = Math.max(35, f.per.kcal * 0.25);
      expect(diff).toBeLessThanOrEqual(tol);
    }
  });

  it('no em dashes in any name (shipped copy ban)', () => {
    for (const f of FOOD_DB) expect(f.name).not.toContain('—');
  });
});

describe('searchFoods', () => {
  it('returns [] for an empty or blank query', () => {
    expect(searchFoods('')).toEqual([]);
    expect(searchFoods('   ')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const lower = searchFoods('chicken');
    const upper = searchFoods('CHICKEN');
    expect(upper.map((f) => f.id)).toEqual(lower.map((f) => f.id));
    expect(lower.length).toBeGreaterThan(0);
  });

  it('matches on aliases, not just the display name', () => {
    // "shake" is an alias of whey protein; the name contains no "shake"
    const ids = searchFoods('shake').map((f) => f.id);
    expect(ids).toContain('whey-protein');
  });

  it('ranks an exact name match first', () => {
    const res = searchFoods('banana');
    expect(res[0].id).toBe('banana');
  });

  it('ranks a name-prefix match ahead of a mid-word substring match', () => {
    // query "rice" — "Rice cakes" (prefix) should outrank "Brown rice" (word-prefix)
    const res = searchFoods('rice');
    const cakes = res.findIndex((f) => f.id === 'rice-cakes');
    const brown = res.findIndex((f) => f.id === 'brown-rice');
    expect(cakes).toBeGreaterThanOrEqual(0);
    expect(brown).toBeGreaterThanOrEqual(0);
    expect(cakes).toBeLessThan(brown);
  });

  it('is deterministic and stable across repeated calls', () => {
    expect(searchFoods('o').map((f) => f.id)).toEqual(searchFoods('o').map((f) => f.id));
  });

  it('respects the limit', () => {
    expect(searchFoods('a', 3).length).toBeLessThanOrEqual(3);
    expect(searchFoods('a', 0)).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    expect(searchFoods('zzzznotafood')).toEqual([]);
  });
});

describe('foodById', () => {
  it('finds a known food', () => {
    expect(foodById('banana')?.name).toBe('Banana');
  });
  it('returns undefined for an unknown id', () => {
    expect(foodById('nope')).toBeUndefined();
  });
});
