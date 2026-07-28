/**
 * Proto nutrition grounding (Tier 1: DB-backed nutrition + session isolation).
 * nutrition.js is the shipped-WebView port of macroGrounding/foodDb: per-food macro
 * estimates bounded against the curated table, totals = the exact sum — so deleting
 * a food subtracts exactly its share and nothing of it survives in the totals.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import {
  FOOD_DB as PROTO_DB, searchFoods, matchFood, parseServings, foodHasMacros,
  groundFood, priceAddedFood, groundMealFromFoods, groundMealTotals,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/nutrition.js';
import { FOOD_DB as CORE_DB } from './foodDb';

describe('FOOD_DB parity with core', () => {
  test('proto table mirrors src/core/foodDb.ts (ids + per-serving macros)', () => {
    const core = new Map(CORE_DB.map((f) => [f.id, f.per]));
    expect(PROTO_DB.length).toBe(CORE_DB.length);
    for (const f of PROTO_DB as any[]) {
      expect(core.get(f.id)).toEqual(f.per);
    }
  });
});

describe('searchFoods / matchFood', () => {
  test('ranked search finds by name and alias', () => {
    expect(searchFoods('chicken', 1)[0].id).toBe('chicken-thigh'); // name starts-with outranks word-in-name (core semantics)
    expect(searchFoods('oj', 1)[0].id).toBe('orange-juice');
  });
  test('matchFood falls back to the longest significant word', () => {
    expect(matchFood('Pan-seared salmon with herbs')!.id).toBe('salmon');
    expect(matchFood('mystery casserole xyz')).toBeUndefined();
  });
});

describe('parseServings', () => {
  test('parses leading counts, decimals, and fractions with clamps', () => {
    expect(parseServings('2 eggs')).toBe(2);
    expect(parseServings('1.5 cups')).toBe(1.5);
    expect(parseServings('1/2 cup')).toBe(0.5);
    expect(parseServings('12 pancakes')).toBe(4);   // upper clamp — a plate, not a platter
    expect(parseServings('a splash')).toBe(1);      // unparseable → 1 serving
  });
});

describe('groundFood — per-food DB bounding', () => {
  test('a hallucinated protein number is pulled into the plausible band', () => {
    const g = groundFood({ name: 'Grilled chicken', per: { protein: 250, kcal: 1000, carbs: 0, fat: 5 } });
    // chicken-breast ref 35g → hi = 35*3 + 8 = 113
    expect(g.per.protein).toBeLessThanOrEqual(113);
    expect(g.adjusted).toBe(true);
    expect(g.matched).toBe(true);
  });
  test('kcal inconsistent with the food own macros snaps to Atwater', () => {
    const g = groundFood({ name: 'White rice', per: { protein: 4, kcal: 900, carbs: 45, fat: 0 } });
    expect(g.per.kcal).toBe(4 * g.per.protein + 4 * g.per.carbs + 9 * g.per.fat);
  });
  test('unmatched food keeps its estimate (nothing to bound against)', () => {
    const g = groundFood({ name: 'dragonfruit smoothie bowl xy', per: { protein: 12, kcal: 320, carbs: 55, fat: 6 } });
    expect(g.matched).toBe(false);
    expect(g.per.protein).toBe(12);
  });
});

describe('groundMealFromFoods — totals are the sum of the foods', () => {
  const plate = () => ([
    { name: 'Grilled chicken', confidence: 'high', per: { protein: 35, kcal: 190, carbs: 0, fat: 4 } },
    { name: 'White rice', confidence: 'high', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 } },
    { name: 'Broccoli', confidence: 'medium', per: { protein: 3, kcal: 31, carbs: 6, fat: 0 } },
  ]);
  test('totals equal the per-food sum (Atwater-reconciled)', () => {
    const g = groundMealFromFoods(plate());
    const sum = g.foods.reduce((a: any, f: any) => ({
      protein: a.protein + f.per.protein, carbs: a.carbs + f.per.carbs, fat: a.fat + f.per.fat,
    }), { protein: 0, carbs: 0, fat: 0 });
    expect(g.totals.protein).toBe(Math.round(sum.protein));
    expect(g.totals.carbs).toBe(Math.round(sum.carbs));
    expect(g.unpriced).toBe(0);
  });
  test('DELETION ISOLATION: removing a food subtracts exactly its grounded share', () => {
    const full = groundMealFromFoods(plate());
    const without = groundMealFromFoods(plate().slice(1)); // chicken removed
    expect(without.totals.protein).toBeLessThan(full.totals.protein);
    // the removed chicken's grounded protein is gone to the gram
    const chicken = full.foods[0].per.protein;
    expect(full.totals.protein - without.totals.protein).toBe(chicken);
  });
  test('user-added food without macros is priced from the DB × servings', () => {
    const g = groundMealFromFoods([{ name: 'Egg', confidence: 'high', userAdded: true, quantity: '2 eggs' }]);
    expect(g.unpriced).toBe(0);
    expect(g.foods[0].per.protein).toBe(12); // 6g × 2
  });
  test('unknown user-added food counts unpriced (totals stay honest)', () => {
    const g = groundMealFromFoods([{ name: 'grandma special zz', confidence: 'high', userAdded: true }]);
    expect(g.unpriced).toBe(1);
    expect(g.confidence).toBe('low');
  });
  test('empty plate grounds to zeros', () => {
    const g = groundMealFromFoods([]);
    expect(g.totals).toEqual({ protein: 0, kcal: 0, carbs: 0, fat: 0 });
  });
});

describe('groundMealTotals — fallback for payloads without per-food macros', () => {
  test('bounds meal totals against the summed DB reference (core semantics)', () => {
    const g = groundMealTotals({ protein: 300, kcal: 2000, carbs: 40, fat: 10 }, ['Grilled chicken', 'White rice']);
    // ref protein 39 → hi = 39*3*1 + 18 = 135
    expect(g.totals.protein).toBeLessThanOrEqual(135);
    expect(g.totals.kcal).toBe(4 * g.totals.protein + 4 * g.totals.carbs + 9 * g.totals.fat);
  });
  test('no detected names → estimate passes through untouched', () => {
    const g = groundMealTotals({ protein: 40, kcal: 700, carbs: 60, fat: 22 }, []);
    expect(g.totals.protein).toBe(40);
  });
});

describe('foodHasMacros', () => {
  test('true only when a per object carries a positive macro', () => {
    expect(foodHasMacros({ name: 'x', per: { protein: 10, kcal: 0, carbs: 0, fat: 0 } })).toBe(true);
    expect(foodHasMacros({ name: 'x', per: { protein: 0, kcal: 0, carbs: 0, fat: 0 } })).toBe(false);
    expect(foodHasMacros({ name: 'x' })).toBe(false);
  });
});
