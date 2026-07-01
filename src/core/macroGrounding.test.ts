import { groundMealMacros, groundMealResult, mealResultToFood } from './macroGrounding';
import type { MealResult } from './content';

describe('groundMealMacros — Atwater reconciliation', () => {
  it('keeps kcal when it is consistent with the macros', () => {
    // 4*40 + 4*60 + 9*20 = 580; stated 600 is within 12%.
    const g = groundMealMacros({ protein: 40, kcal: 600, carbs: 60, fat: 20 }, []);
    expect(g.kcal).toBe(600);
    expect(g.adjusted).toBe(false);
  });

  it('reconciles kcal to the macro-derived value when wildly inconsistent', () => {
    // macros imply 580 kcal but the model said 1500 — fix it.
    const g = groundMealMacros({ protein: 40, kcal: 1500, carbs: 60, fat: 20 }, []);
    expect(g.kcal).toBe(580);
    expect(g.adjusted).toBe(true);
  });

  it('fills a missing/zero kcal from the macros', () => {
    const g = groundMealMacros({ protein: 30, kcal: 0, carbs: 40, fat: 10 }, []);
    expect(g.kcal).toBe(4 * 30 + 4 * 40 + 9 * 10);
  });
});

describe('groundMealMacros — food-DB plausibility clamp', () => {
  it('pulls an absurd protein estimate down to a plausible band', () => {
    // chicken (35) + rice (4) + broccoli (3) ref protein ≈ 42/serving; 250g is impossible.
    const g = groundMealMacros({ protein: 250, kcal: 1400, carbs: 60, fat: 12 }, ['Grilled chicken', 'White rice', 'Broccoli']);
    expect(g.protein).toBeLessThan(150);
    expect(g.adjusted).toBe(true);
  });

  it('leaves a realistic estimate essentially untouched', () => {
    // chicken+rice+broccoli, a normal big plate: ~52g protein is within the band.
    const g = groundMealMacros({ protein: 52, kcal: 680, carbs: 64, fat: 18 }, ['Grilled chicken', 'White rice', 'Broccoli']);
    expect(g.protein).toBe(52);
    expect(g.adjusted).toBe(false);
    expect(g.confidence).toBe('high');
  });

  it('does not clamp a macro it has no reference for', () => {
    // all detected foods are pure protein; the model reports carbs from an unmatched food.
    const g = groundMealMacros({ protein: 30, kcal: 300, carbs: 40, fat: 5 }, ['Grilled chicken']);
    expect(g.carbs).toBe(40); // no carb reference → left alone
  });
});

describe('groundMealMacros — confidence + junk handling', () => {
  it('is low confidence when nothing matches the DB', () => {
    const g = groundMealMacros({ protein: 20, kcal: 300, carbs: 30, fat: 10 }, ['Mystery stew']);
    expect(g.confidence).toBe('low');
  });

  it('zeroes negative / non-finite macros', () => {
    const g = groundMealMacros({ protein: -5, kcal: NaN, carbs: 30, fat: 10 }, []);
    expect(g.protein).toBe(0);
    expect(g.kcal).toBe(4 * 0 + 4 * 30 + 9 * 10);
  });
});

describe('groundMealResult / mealResultToFood', () => {
  const mr: MealResult = { name: 'Chicken, Rice & Broccoli', quality: 94, protein: 250, kcal: 1400, carbs: 64, fat: 18, detected: ['Grilled chicken', 'White rice', 'Broccoli'], note: 'x' };

  it('grounds the macros but preserves name/quality/detected/note', () => {
    const out = groundMealResult(mr);
    expect(out.name).toBe(mr.name);
    expect(out.quality).toBe(94);
    expect(out.detected).toEqual(mr.detected);
    expect(out.protein).toBeLessThan(150); // clamped
  });

  it('projects a meal result into a single EditableFood for scoring', () => {
    const food = mealResultToFood({ ...mr, protein: 52, kcal: 680 });
    expect(food.servings).toBe(1);
    expect(food.per.protein).toBe(52);
    expect(food.name).toBe(mr.name);
  });
});

describe('groundMealResult — Slice 1 signal pass-through', () => {
  it('surfaces the grounder confidence onto the result', () => {
    const mr: MealResult = { name: 'Chicken, Rice & Broccoli', quality: 94, protein: 52, kcal: 680, carbs: 64, fat: 18, detected: ['Grilled chicken', 'White rice', 'Broccoli'], note: 'x' };
    expect(groundMealResult(mr).confidence).toBe('high');
  });

  it('keeps the model reconcile line and descriptionSignal through grounding', () => {
    const mr: MealResult = {
      name: 'Fried chicken & rice', quality: 70, protein: 45, kcal: 900, carbs: 80, fat: 40,
      detected: ['Fried chicken', 'White rice'], note: 'x',
      reconcile: 'Counting this as fried with sauce.', descriptionSignal: 'photo_heavier',
    };
    const out = groundMealResult(mr);
    expect(out.reconcile).toBe('Counting this as fried with sauce.');
    expect(out.descriptionSignal).toBe('photo_heavier');
  });
});
