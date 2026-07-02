import { parseServingGrams, foodLookupToEditable } from './foodSource';

describe('parseServingGrams', () => {
  it('parses a plain gram serving', () => {
    expect(parseServingGrams('30 g')).toBe(30);
  });
  it('parses a parenthesized gram weight', () => {
    expect(parseServingGrams('1 bar (60g)')).toBe(60);
    expect(parseServingGrams('2 tbsp (32 g)')).toBe(32);
  });
  it('returns null when no gram weight is present', () => {
    expect(parseServingGrams('1 cup')).toBeNull();
    expect(parseServingGrams(null)).toBeNull();
    expect(parseServingGrams(undefined)).toBeNull();
  });
});

describe('foodLookupToEditable', () => {
  it('scales per-100g macros to the serving grams', () => {
    const f = foodLookupToEditable({
      name: 'Protein bar',
      serving: '1 bar (60 g)',
      per100: { protein: 33, kcal: 367, carbs: 33, fat: 12 },
      source: 'off',
    });
    expect(f.servings).toBe(1);
    expect(f.per.protein).toBe(20); // 33 * 0.6 = 19.8 -> 20
    expect(f.per.kcal).toBe(220); //  367 * 0.6 = 220.2 -> 220
    expect(f.portion).toBe('1 bar (60 g)');
    expect(f.name).toBe('Protein bar');
  });

  it('defaults to a 100g serving when the gram weight is unknown', () => {
    const f = foodLookupToEditable({
      name: 'Greek yogurt',
      serving: '1 cup',
      per100: { protein: 10, kcal: 60, carbs: 4, fat: 2 },
      source: 'usda',
    });
    expect(f.per.protein).toBe(10);
    expect(f.portion).toBe('1 cup');
  });

  it('labels a 100g serving when no serving string is given', () => {
    const f = foodLookupToEditable({ name: 'Rice', serving: null, per100: { protein: 3, kcal: 130, carbs: 28, fat: 0 }, source: 'usda' });
    expect(f.portion).toBe('100 g');
    expect(f.per.kcal).toBe(130);
  });
});
