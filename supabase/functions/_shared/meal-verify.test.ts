// The verification layer exists because of one real breakfast (2026-08-06): a Fairlife Core Power
// bottle with "42g" printed across its face was logged at 14g, the whole meal at 44g protein, and
// the AI then argued with the athlete's correction. Every test here is a contradiction the system
// must now catch in CODE before anything is scored or spoken.
import { verifyMealReport, repairMealReport, fixSlotWords, verifyCorrectionMessage } from './meal-verify';

// The real failing breakfast, as the model would report it after misreading the bottle.
const corePowerBreakfast = () => ({
  name: 'Omelet, fruit, PB&J and a protein shake',
  quality: 71, protein: 44, kcal: 710, carbs: 59, fat: 36, fiber: 4,
  analysis: 'Solid protein spread across the omelet and shake.',
  note: 'Protein-forward breakfast.',
  detected: [
    { name: 'Veggie & cheese omelet', kind: 'prepared', confidence: 'medium', protein: 22, kcal: 320, carbs: 4, fat: 24 },
    { name: 'Core Power shake', kind: 'packaged', brand: 'Fairlife', product: 'Core Power chocolate',
      confidence: 'high', basis: 'estimate',
      labelClaims: { proteinG: 42 }, protein: 14, kcal: 110, carbs: 9, fat: 2 },
    { name: 'Fruit cup', kind: 'prepared', confidence: 'high', protein: 1, kcal: 70, carbs: 17, fat: 0 },
    { name: 'Uncrustables PB&J', kind: 'packaged', brand: 'Smucker\'s', product: 'Uncrustables Peanut Butter & Grape Jelly',
      confidence: 'high', basis: 'estimate', protein: 7, kcal: 210, carbs: 29, fat: 10 },
  ],
});

describe('claim contradiction — the Core Power bug', () => {
  it('flags an item whose logged macro contradicts its printed claim', () => {
    const { violations } = verifyMealReport(corePowerBreakfast(), 'Breakfast');
    const claim = violations.find((v) => v.kind === 'claim_contradiction');
    expect(claim).toBeTruthy();
    expect(claim!.item).toBe('Core Power shake');
    expect(claim!.detail).toContain('42');
    expect(claim!.detail).toContain('14');
  });

  it('repair adopts the printed claim, re-derives the item kcal, marks basis label', () => {
    const { input, repaired } = repairMealReport(corePowerBreakfast(), 'Breakfast');
    const shake = (input.detected as any[]).find((d) => d.name === 'Core Power shake');
    expect(shake.protein).toBe(42);
    expect(shake.basis).toBe('label');
    expect(shake.confidence).toBe('high');
    // 42*4 + 9*4 + 2*9 = 222; the old 110 kcal can't hold 42g of protein.
    expect(shake.kcal).toBeGreaterThan(200);
    expect(repaired).toContain('claim_override:Core Power shake');
  });

  it('repair re-derives the meal totals from the corrected items', () => {
    const { input, remaining } = repairMealReport(corePowerBreakfast(), 'Breakfast');
    // 22 + 42 + 1 + 7 = 72g protein — the honest total for this plate.
    expect(input.protein).toBe(72);
    expect(remaining).toEqual([]);
  });

  it('a printed kcal claim is honored too', () => {
    const r = corePowerBreakfast();
    (r.detected[1] as any).labelClaims = { proteinG: 42, kcal: 230 };
    const { input } = repairMealReport(r, 'Breakfast');
    const shake = (input.detected as any[]).find((d) => d.name === 'Core Power shake');
    expect(shake.kcal).toBe(230);
  });

  it('an insane misread claim never overrides (420g protein bottle does not exist)', () => {
    const r = corePowerBreakfast();
    (r.detected[1] as any).labelClaims = { proteinG: 420 };
    const { input } = repairMealReport(r, 'Breakfast');
    const shake = (input.detected as any[]).find((d) => d.name === 'Core Power shake');
    expect(shake.protein).toBe(14); // untouched — the claim was rejected as junk
  });

  it('an item already agreeing with its claim is left alone', () => {
    const r = corePowerBreakfast();
    (r.detected[1] as any).protein = 42;
    (r.detected[1] as any).kcal = 230;
    const { violations } = verifyMealReport(r, 'Breakfast');
    expect(violations.filter((v) => v.kind === 'claim_contradiction')).toEqual([]);
  });
});

describe('sum + Atwater consistency', () => {
  it('flags totals the items cannot produce', () => {
    const r = corePowerBreakfast();
    r.protein = 90; // items only sum to 44
    const { violations } = verifyMealReport(r, 'Breakfast');
    expect(violations.some((v) => v.kind === 'sum_mismatch')).toBe(true);
  });

  it('accepts totals within tolerance of the item sum', () => {
    const r = {
      protein: 40, kcal: 500, carbs: 50, fat: 15,
      detected: [{ name: 'Bowl', confidence: 'high', protein: 41, kcal: 505, carbs: 49, fat: 16 }],
    };
    const { violations } = verifyMealReport(r as any, 'Lunch');
    expect(violations.filter((v) => v.kind === 'sum_mismatch')).toEqual([]);
  });

  it('flags calories food science cannot explain', () => {
    const r = { protein: 10, carbs: 10, fat: 2, kcal: 900, detected: [] as any[] };
    const { violations } = verifyMealReport(r as any);
    expect(violations.some((v) => v.kind === 'atwater')).toBe(true);
  });

  it('repair reconciles kcal to the macros', () => {
    const r = { protein: 10, carbs: 10, fat: 2, kcal: 900, detected: [] as any[] };
    const { input } = repairMealReport(r as any);
    expect(input.kcal).toBe(98); // 4*10 + 4*10 + 9*2
  });

  it('junk item values never throw and never poison the sums', () => {
    const r = {
      protein: 20, kcal: 300, carbs: 30, fat: 10,
      detected: [
        { name: 'Real food', confidence: 'high', protein: 20, kcal: 300, carbs: 30, fat: 10 },
        { name: 'Junk', confidence: 'low', protein: 'NaN', kcal: null, carbs: -5, fat: undefined },
        null, 'just a string',
      ],
    };
    expect(() => repairMealReport(r as any, 'Dinner')).not.toThrow();
    const { input } = repairMealReport(r as any, 'Dinner');
    expect(input.protein).toBe(20);
  });
});

describe('meal-slot context — a breakfast is never called lunch', () => {
  it('rewrites "this lunch" under a Breakfast header', () => {
    const { text, changed } = fixSlotWords('Based on this lunch, more protein earlier would help.', 'Breakfast');
    expect(changed).toBe(true);
    expect(text).toBe('Based on this breakfast, more protein earlier would help.');
  });

  it('leaves forward advice about OTHER meals alone', () => {
    const { changed } = fixSlotWords('Bring dinner in around 78g of protein and the day closes out.', 'Breakfast');
    expect(changed).toBe(false);
  });

  it('leaves "grab a snack later" alone on a breakfast', () => {
    const { changed } = fixSlotWords('Grab a snack with protein before practice.', 'Breakfast');
    expect(changed).toBe(false);
  });

  it('repair corrects the prose fields in place', () => {
    const r = corePowerBreakfast();
    r.analysis = 'Based on this lunch, protein is doing the work.';
    const { input, repaired } = repairMealReport(r, 'Breakfast');
    expect(input.analysis).toContain('this breakfast');
    expect(repaired).toContain('slot_words');
  });
});

describe('unresolved major packaged product', () => {
  it('flags a low-confidence unnamed package carrying a big share of the meal', () => {
    const r = {
      protein: 30, kcal: 600, carbs: 60, fat: 20,
      analysis: '', note: '',
      detected: [
        { name: 'Bottle drink', kind: 'packaged', confidence: 'low', protein: 20, kcal: 300, carbs: 30, fat: 10 },
        { name: 'Sandwich', kind: 'prepared', confidence: 'high', protein: 10, kcal: 300, carbs: 30, fat: 10 },
      ],
    };
    const { violations } = verifyMealReport(r as any, 'Lunch');
    expect(violations.some((v) => v.kind === 'unresolved_product')).toBe(true);
  });

  it('does not flag a resolved or minor package', () => {
    const r = {
      protein: 30, kcal: 600, carbs: 60, fat: 20,
      detected: [
        { name: 'Core Power', kind: 'packaged', product: 'Fairlife Core Power 42g chocolate', confidence: 'low', protein: 20, kcal: 300, carbs: 30, fat: 10 },
        { name: 'Sandwich', kind: 'prepared', confidence: 'high', protein: 10, kcal: 300, carbs: 30, fat: 10 },
      ],
    };
    const { violations } = verifyMealReport(r as any, 'Lunch');
    expect(violations.filter((v) => v.kind === 'unresolved_product')).toEqual([]);
  });
});

describe('escalation correction message', () => {
  it('lists the specific contradictions and the rules', () => {
    const { violations } = verifyMealReport(corePowerBreakfast(), 'Breakfast');
    const msg = verifyCorrectionMessage(violations);
    expect(msg).toContain('42');
    expect(msg).toContain('READ evidence');
    expect(msg).toContain('sum to the meal totals');
  });
});

describe('a clean report passes untouched', () => {
  it('verify finds nothing and repair changes nothing material', () => {
    const clean = {
      name: 'Chicken, rice & broccoli',
      protein: 45, kcal: 620, carbs: 55, fat: 18, fiber: 6,
      analysis: 'Strong plate for a training day.',
      detected: [
        { name: 'Grilled chicken', kind: 'prepared', confidence: 'high', protein: 38, kcal: 220, carbs: 0, fat: 7 },
        { name: 'White rice', kind: 'prepared', confidence: 'high', protein: 4, kcal: 240, carbs: 52, fat: 1 },
        { name: 'Broccoli', kind: 'prepared', confidence: 'high', protein: 3, kcal: 50, carbs: 8, fat: 0 },
        // fat sums a little under the stated total: within tolerance, left alone
      ],
    };
    const { violations } = verifyMealReport(clean as any, 'Dinner');
    expect(violations.filter((v) => v.kind !== 'sum_mismatch' && v.kind !== 'atwater')).toEqual([]);
    const { input } = repairMealReport(clean as any, 'Dinner');
    expect(input.analysis).toBe(clean.analysis);
  });
});
