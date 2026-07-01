import {
  flagIngredients,
  scaleLabel,
  labelQuality,
  labelToMealResult,
  DEFAULT_ENABLED_FLAGS,
  HIGH_SODIUM_MG,
  type LabelFacts,
} from './nutritionLabel';

const bar: LabelFacts = {
  productName: 'Apex Protein Bar',
  servingSize: '1 bar (60g)',
  servingsPerContainer: 1,
  calories: 210,
  protein: 20,
  carbs: 22,
  fat: 7,
  sugar: 3,
  fiber: 10,
  sodium: 180,
  ingredients: ['Whey protein isolate', 'Almonds', 'Soluble corn fiber', 'Cane sugar', 'Sea salt', 'Natural flavor'],
};

describe('flagIngredients', () => {
  it('flags added sugar, nuts, dairy, ultra-processed from the ingredient list', () => {
    const flags = flagIngredients(bar);
    const keys = flags.map((f) => f.key);
    expect(keys).toContain('added_sugar'); // "Cane sugar"
    expect(keys).toContain('allergen_nuts'); // "Almonds"
    expect(keys).toContain('allergen_dairy'); // "Whey protein"
    expect(keys).toContain('ultra_processed'); // "Natural flavor"
  });

  it('reports the matched ingredient as evidence, de-duplicated', () => {
    const f = flagIngredients({ ingredients: ['Sugar', 'Brown sugar', 'Wheat flour'], sodium: 0 });
    const sugar = f.find((x) => x.key === 'added_sugar')!;
    expect(sugar.matched).toEqual(['Sugar', 'Brown sugar']);
  });

  it('respects the coach-enabled set (seed oils off by default, on when enabled)', () => {
    const facts = { ingredients: ['Soybean oil', 'Water'], sodium: 0 };
    expect(flagIngredients(facts).map((f) => f.key)).not.toContain('seed_oils');
    expect(flagIngredients(facts, ['seed_oils']).map((f) => f.key)).toContain('seed_oils');
  });

  it('flags high sodium off the printed fact, not an ingredient', () => {
    const f = flagIngredients({ ingredients: [], sodium: HIGH_SODIUM_MG });
    expect(f.map((x) => x.key)).toContain('high_sodium');
    expect(flagIngredients({ ingredients: [], sodium: HIGH_SODIUM_MG - 1 }).map((x) => x.key)).not.toContain('high_sodium');
  });

  it('default enabled set excludes seed oils but includes allergens', () => {
    expect(DEFAULT_ENABLED_FLAGS).not.toContain('seed_oils');
    expect(DEFAULT_ENABLED_FLAGS).toContain('allergen_gluten');
  });
});

describe('scaleLabel', () => {
  it('scales per-serving facts exactly by servings eaten', () => {
    const s = scaleLabel(bar, 2);
    expect(s.calories).toBe(420);
    expect(s.protein).toBe(40);
    expect(s.carbs).toBe(44);
    expect(s.sodium).toBe(360);
  });

  it('snaps servings to the nearest quarter and clamps to a sane range', () => {
    expect(scaleLabel(bar, 1.1).servings).toBe(1);
    expect(scaleLabel(bar, 1.13).servings).toBe(1.25);
    expect(scaleLabel(bar, 0).servings).toBe(0.25);
    expect(scaleLabel(bar, 999).servings).toBe(20);
    expect(scaleLabel(bar, NaN).servings).toBe(1);
  });

  it('handles a half serving with one-decimal macro rounding', () => {
    const s = scaleLabel(bar, 0.5);
    expect(s.calories).toBe(105);
    expect(s.protein).toBe(10);
  });
});

describe('labelQuality', () => {
  it('rewards a high-protein, low-sugar food', () => {
    const q = labelQuality(bar, flagIngredients(bar));
    expect(q).toBeGreaterThan(70);
  });

  it('penalizes a sugary, dyed, low-protein product', () => {
    const candy: LabelFacts = { calories: 200, protein: 1, carbs: 50, fat: 0, sugar: 40, ingredients: ['Sugar', 'Corn syrup', 'Red 40'] };
    const q = labelQuality(candy, flagIngredients(candy));
    expect(q).toBeLessThan(50);
  });

  it('is always bounded to 20..96 and independent of servings', () => {
    const q1 = labelQuality(bar, flagIngredients(bar));
    expect(q1).toBeGreaterThanOrEqual(20);
    expect(q1).toBeLessThanOrEqual(96);
    // quality is per-serving, so the bar's quality does not depend on how much you ate.
    expect(labelToMealResult(bar, 1).quality).toBe(labelToMealResult(bar, 3).quality);
  });
});

describe('labelToMealResult', () => {
  it('projects a scan into the MealResult logging shape with scaled macros', () => {
    const mr = labelToMealResult(bar, 2);
    expect(mr.name).toBe('Apex Protein Bar');
    expect(mr.protein).toBe(40);
    expect(mr.kcal).toBe(420);
    expect(mr.detected.length).toBeGreaterThan(0);
    expect(mr.note).toMatch(/label/i);
    expect(mr.note).toMatch(/2 servings/);
  });

  it('falls back to a neutral name when the label has no product name', () => {
    const mr = labelToMealResult({ ...bar, productName: undefined }, 1);
    expect(mr.name).toBe('Scanned food');
    expect(mr.note).toMatch(/1 serving\b/);
  });
});
