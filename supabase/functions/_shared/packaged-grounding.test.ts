// Packaged grounding before the score (2026-09-10). The first read of a named packaged product
// used to carry the model's guess into the score; enrich-meal runs after the log and may not touch
// it. These pin the four things that make the pre-score grounding safe: the match rule, the totals
// recompute, the untouched-on-failure rule, and the per-read lookup cap.
import {
  packagedMatchScore, pickUsdaPackaged, pickOffPackaged, servingCountFrom, resolvePackagedProduct,
  type PackagedHit,
} from './packaged-resolve';
import { groundPackagedItems, recomputeTotals, groundable, MAX_LOOKUPS } from './packaged-grounding';

const usdaFood = (over: Record<string, unknown> = {}) => ({
  description: 'CORE POWER CHOCOLATE HIGH PROTEIN MILK SHAKE, 42G',
  brandName: 'Core Power', brandOwner: 'Fairlife, LLC',
  servingSize: 414, servingSizeUnit: 'ml',
  // per 100 ml: 10.1g protein, 55 kcal, 6.3g carbs, 0.8g fat -> ~42g / 230 kcal per bottle
  foodNutrients: [
    { nutrientNumber: '203', value: 10.1 }, { nutrientNumber: '208', value: 55 },
    { nutrientNumber: '205', value: 6.3 }, { nutrientNumber: '204', value: 0.8 },
  ],
  ...over,
});

describe('the match rule: a confident match names the SAME product, never a sibling', () => {
  it('matches a candidate that carries the brand, the number and most of the words', () => {
    expect(packagedMatchScore('CORE POWER CHOCOLATE HIGH PROTEIN MILK SHAKE, 42G Core Power Fairlife', 'Core Power', 'Core Power 42g chocolate, 14 fl oz'))
      .toBeGreaterThan(0);
  });

  it('refuses the 26g sibling of a 42g product: the number is a hard gate', () => {
    expect(packagedMatchScore('CORE POWER CHOCOLATE PROTEIN SHAKE 26G Core Power', 'Core Power', 'Core Power 42g chocolate')).toBe(0);
  });

  it('refuses a candidate from a different brand', () => {
    expect(packagedMatchScore('PREMIER PROTEIN CHOCOLATE SHAKE 30G', 'Core Power', 'chocolate shake 30g')).toBe(0);
  });

  it('refuses a candidate that covers under 60% of the product words', () => {
    expect(packagedMatchScore('CLIF BAR', 'Clif', 'Crunchy peanut butter energy bar')).toBe(0);
  });

  it('tolerates plurals and package-size noise', () => {
    expect(packagedMatchScore('Quest Protein Bar Cookies & Cream', 'Quest', 'Quest cookie and cream protein bars, 2.12 oz'))
      .toBeGreaterThan(0);
  });

  it('nothing to match on scores zero', () => {
    expect(packagedMatchScore('anything', '', '')).toBe(0);
    expect(packagedMatchScore('anything', undefined, null)).toBe(0);
  });
});

describe('serving count from the kitchen-units quantity', () => {
  it('counts units, treats a size as one, clamps to one sitting', () => {
    expect(servingCountFrom('2 bars')).toBe(2);
    expect(servingCountFrom('1 bottle')).toBe(1);
    expect(servingCountFrom('14 fl oz')).toBe(1);
    expect(servingCountFrom('half a bar')).toBe(0.5);
    expect(servingCountFrom('12 bottles')).toBe(6);
    expect(servingCountFrom(undefined)).toBe(1);
    expect(servingCountFrom('')).toBe(1);
  });
});

describe('picking a hit scales per-100 data by the printed serving', () => {
  it('USDA Branded: per-serving macros from per-100 and servingSize, basis database', () => {
    const hit = pickUsdaPackaged([usdaFood()], 'Core Power', 'Core Power 42g chocolate, 14 fl oz');
    expect(hit).not.toBeNull();
    expect(Math.round(hit!.perServing.protein)).toBe(42);
    expect(Math.round(hit!.perServing.kcal)).toBe(228);
    expect(hit!.basis).toBe('database');
    expect(hit!.source).toBe('usda');
  });

  it('USDA Branded: no serving size means no hit (cannot scale honestly)', () => {
    expect(pickUsdaPackaged([usdaFood({ servingSize: undefined })], 'Core Power', 'Core Power 42g chocolate')).toBeNull();
  });

  it('OFF: the label\'s own per-serving values win and carry basis label', () => {
    const hit = pickOffPackaged([{
      product_name: 'Core Power Chocolate 42g', brands: 'Core Power, Fairlife',
      serving_size: '414 ml', serving_quantity: 414,
      nutriments: { 'proteins_serving': 42, 'energy-kcal_serving': 230, 'carbohydrates_serving': 26, 'fat_serving': 3.5, 'proteins_100g': 10.1, 'energy-kcal_100g': 55 },
    }], 'Core Power', 'Core Power 42g chocolate');
    expect(hit).not.toBeNull();
    expect(hit!.basis).toBe('label');
    expect(hit!.perServing.protein).toBe(42);
  });

  it('OFF: falls back to per-100 scaled by serving_quantity, basis database', () => {
    const hit = pickOffPackaged([{
      product_name: 'Core Power Chocolate 42g', brands: 'Core Power', serving_quantity: 414,
      nutriments: { 'proteins_100g': 10.1, 'energy-kcal_100g': 55, 'carbohydrates_100g': 6.3, 'fat_100g': 0.8 },
    }], 'Core Power', 'Core Power 42g chocolate');
    expect(hit!.basis).toBe('database');
    expect(Math.round(hit!.perServing.protein)).toBe(42);
  });
});

describe('resolvePackagedProduct spends at most its fetch budget and never throws', () => {
  it('USDA first; a hit there costs one fetch', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return { foods: [usdaFood()] }; };
    const r = await resolvePackagedProduct('Core Power', 'Core Power 42g chocolate', 'KEY', { fetcher });
    expect(r.hit).not.toBeNull();
    expect(r.fetches).toBe(1);
    expect(urls[0]).toContain('api.nal.usda.gov');
    expect(urls[0]).toContain('dataType=Branded');
  });

  it('falls through to OFF on a USDA miss; two fetches', async () => {
    const fetcher = async (url: string) => url.includes('usda') ? { foods: [] } : {
      products: [{ product_name: 'Core Power Chocolate 42g', brands: 'Core Power', nutriments: { 'proteins_serving': 42, 'energy-kcal_serving': 230 } }],
    };
    const r = await resolvePackagedProduct('Core Power', 'Core Power 42g chocolate', 'KEY', { fetcher });
    expect(r.hit?.source).toBe('off');
    expect(r.fetches).toBe(2);
  });

  it('honours maxFetches: with one left it never reaches OFF', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return { foods: [] }; };
    const r = await resolvePackagedProduct('Core Power', 'Core Power 42g chocolate', 'KEY', { fetcher, maxFetches: 1 });
    expect(r.hit).toBeNull();
    expect(calls).toBe(1);
  });

  it('a throwing fetcher resolves to null, not a throw', async () => {
    const fetcher = async () => { throw new Error('boom'); };
    await expect(resolvePackagedProduct('Core Power', 'Core Power 42g chocolate', 'KEY', { fetcher })).resolves.toEqual({ hit: null, fetches: 1 });
  });

  it('a name too short to mean anything costs nothing', async () => {
    const r = await resolvePackagedProduct('', 'ab', 'KEY', { fetcher: async () => ({}) });
    expect(r).toEqual({ hit: null, fetches: 0 });
  });
});

const hitFor = (protein: number, kcal: number, basis: 'label' | 'database' = 'database'): PackagedHit => ({
  name: 'resolved', perServing: { protein, kcal, carbs: 26, fat: 3 }, basis, source: 'usda', serving: '414 ml', score: 1,
});

const plate = () => ({
  name: 'Shake and a bar', protein: 40, kcal: 500, carbs: 60, fat: 12,
  detected: [
    { name: 'Core Power shake', kind: 'packaged', basis: 'estimate', product: 'Core Power 42g chocolate', quantity: '1 bottle', confidence: 'medium', protein: 26, kcal: 170, carbs: 20, fat: 3 },
    { name: 'Rice', kind: 'prepared', basis: 'estimate', quantity: '1 cup', confidence: 'high', protein: 4, kcal: 200, carbs: 40, fat: 1 },
    { name: 'Protein bar', kind: 'packaged', basis: 'label', product: 'Quest bar', confidence: 'high', protein: 10, kcal: 130, carbs: 0, fat: 8 },
  ],
});

describe('groundPackagedItems', () => {
  it('only a packaged ESTIMATE with a named product qualifies', () => {
    expect(groundable(plate().detected[0])).toBe(true);
    expect(groundable(plate().detected[1])).toBe(false);   // prepared
    expect(groundable(plate().detected[2])).toBe(false);   // label read
    expect(groundable({ name: 'Bar', kind: 'packaged', basis: 'database', product: 'X bar' })).toBe(false);
    expect(groundable({ name: 'Bar', kind: 'packaged', basis: 'estimate' })).toBe(false);   // nothing named
    expect(groundable({ name: 'Bar', kind: 'packaged', product: 'X bar' })).toBe(true);     // basis omitted = estimate
    expect(groundable({ name: 'Bar', kind: 'packaged', product: 'X bar', labelClaims: { proteinG: 20 } })).toBe(false); // a read label wins
  });

  it('replaces the item macros with resolved per-serving values times the serving count, marks it, and RECOMPUTES the totals', async () => {
    const raw = plate();
    const rep = await groundPackagedItems(raw, async () => ({ hit: hitFor(42, 230), fetches: 1 }));
    const shake = (rep.input.detected as Array<Record<string, unknown>>)[0];
    expect(shake.protein).toBe(42);
    expect(shake.kcal).toBe(230);
    expect(shake.basis).toBe('database');
    expect(shake.confidence).toBe('high');
    // items: 42+4+10 protein, 230+200+130 kcal
    expect(rep.input.protein).toBe(56);
    expect(rep.input.kcal).toBe(560);
    expect(rep.input.carbs).toBe(66);
    expect(rep.input.fat).toBe(12);
    expect(rep.grounded).toEqual(['Core Power shake']);
    expect(rep.lookups).toBe(1);
    // the caller's object was never mutated
    expect(raw.detected[0].protein).toBe(26);
    expect(raw.protein).toBe(40);
  });

  it('scales by the read serving count ("2 bars")', async () => {
    const raw = { protein: 1, kcal: 1, carbs: 1, fat: 1, detected: [
      { name: 'Bar', kind: 'packaged', basis: 'estimate', product: 'Quest cookie bar', quantity: '2 bars', confidence: 'low', protein: 15, kcal: 180, carbs: 20, fat: 6 },
    ] };
    const rep = await groundPackagedItems(raw, async () => ({ hit: hitFor(20, 190, 'label'), fetches: 1 }));
    const bar = (rep.input.detected as Array<Record<string, unknown>>)[0];
    expect(bar.protein).toBe(40);
    expect(bar.kcal).toBe(380);
    expect(bar.basis).toBe('label');
    expect(rep.input.protein).toBe(40);
  });

  it('a miss, a throw, or a zero-calorie hit leaves the item EXACTLY as the model read it', async () => {
    const before = JSON.stringify(plate().detected[0]);
    for (const resolver of [
      async () => ({ hit: null, fetches: 2 }),
      async () => { throw new Error('network'); },
      async () => ({ hit: hitFor(0, 0), fetches: 1 }),
    ]) {
      const rep = await groundPackagedItems(plate(), resolver as any);
      expect(JSON.stringify((rep.input.detected as unknown[])[0])).toBe(before);
      expect(rep.grounded).toEqual([]);
      expect(rep.missed).toEqual(['Core Power shake']);
      // totals untouched when nothing was grounded
      expect(rep.input.protein).toBe(40);
      expect(rep.input.kcal).toBe(500);
    }
  });

  it('spends at most MAX_LOOKUPS network calls per read, whatever the plate holds', async () => {
    const many = { protein: 0, kcal: 0, carbs: 0, fat: 0, detected: Array.from({ length: 6 }, (_, i) => (
      { name: `Item ${i}`, kind: 'packaged', basis: 'estimate', product: `Brand product ${i}`, confidence: 'medium', protein: 5, kcal: 100, carbs: 10, fat: 2 }
    )) };
    let calls = 0;
    const seenBudgets: number[] = [];
    const rep = await groundPackagedItems(many, async (_b, _p, o) => { calls++; seenBudgets.push(o.maxFetches); return { hit: null, fetches: 1 }; });
    expect(MAX_LOOKUPS).toBe(3);
    expect(calls).toBe(3);
    expect(rep.lookups).toBe(3);
    expect(seenBudgets).toEqual([3, 2, 1]);
    expect(rep.missed.length).toBe(3);
  });

  it('a resolver that over-reports its fetches cannot push the count past the cap', async () => {
    const many = { protein: 0, kcal: 0, carbs: 0, fat: 0, detected: Array.from({ length: 4 }, (_, i) => (
      { name: `Item ${i}`, kind: 'packaged', basis: 'estimate', product: `Brand product ${i}`, confidence: 'medium', protein: 5, kcal: 100, carbs: 10, fat: 2 }
    )) };
    let calls = 0;
    const rep = await groundPackagedItems(many, async () => { calls++; return { hit: null, fetches: 99 }; });
    expect(calls).toBe(1);
    expect(rep.lookups).toBe(3);
  });

  it('recomputeTotals sums the items exactly, leaving a plate with no item macros alone', () => {
    expect(recomputeTotals({ protein: 9, kcal: 9, carbs: 9, fat: 9, detected: [{ name: 'x' }] }).protein).toBe(9);
    const t = recomputeTotals({ protein: 0, kcal: 0, carbs: 0, fat: 0, detected: [
      { protein: 10, kcal: 100, carbs: 5, fat: 2 }, { protein: 12, kcal: 150, carbs: 7, fat: 9 },
    ] });
    expect([t.protein, t.kcal, t.carbs, t.fat]).toEqual([22, 250, 12, 11]);
  });
});
