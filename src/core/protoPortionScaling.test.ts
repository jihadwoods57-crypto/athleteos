/**
 * Portion is MEASURED now, not just described.
 *
 * The model has always returned a `quantity` per detected item in plain kitchen units. Nothing
 * ever converted it into an amount: it rode through meal-intel capped at 40 characters, got
 * printed beside the food, and was discarded. The only guard on the numbers was a plausibility
 * band anchored to the curated table's ONE-serving reference, which fails in both directions.
 *
 *   - It crushed real large portions. Six eggs is 36g of protein; the old ceiling was
 *     6g x 3 + 8 = 26g, so the athlete was told 26 and confidence quietly dropped.
 *   - It could not see a wrong portion at all. A read saying "1 cup rice" while pricing three
 *     cups passed every downstream check, because the totals check only proves the items sum to
 *     the total and the Atwater check only proves a macro set is internally consistent.
 *
 * servingsFor closes both by comparing the quantity to THAT FOOD'S OWN serving label, unit-aware.
 * The half of this that matters most is the refusals: when the two strings cannot be compared
 * honestly, it says so, and groundFood keeps the original wide band. That is what makes this
 * change safe to ship without new photographs to measure against.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import { servingsFor, groundFood, groundMealFromFoods, parseServings, matchFoodDetailed, FOOD_DB } from '../../proto/redesign-2026-07/js/nutrition.js';
// @ts-ignore — proto is plain ESM JS (allowJs)
import { applyFoodEdit, applyMealCorrection, normalizeDetected, hasUserEdits } from '../../proto/redesign-2026-07/js/meal-intel.js';

const sv = (q: string | undefined, label: string) => servingsFor(q, label) as { servings: number; resolved: boolean };

// The proto is plain JS, so these shapes are declared rather than inferred from a literal: the
// flags under test are exactly the ones a literal would type away.
type Row = {
  name: string; confidence: string; quantity?: string;
  per?: { protein: number; kcal: number; carbs: number; fat: number };
  edited?: boolean; portionEdited?: boolean; userAdded?: boolean;
};

describe('servingsFor: counts', () => {
  test('a count against a single-unit serving is simply that count', () => {
    expect(sv('6 eggs', '1 large')).toEqual({ servings: 6, resolved: true });
    expect(sv('2 eggs', '1 large')).toEqual({ servings: 2, resolved: true });
  });

  test('a count against a multi-unit serving divides by it', () => {
    // Bacon's reference is three strips, so nine strips is three servings, not nine.
    expect(sv('9 strips', '3 strips')).toEqual({ servings: 3, resolved: true });
    expect(sv('6 meatballs', '3 meatballs')).toEqual({ servings: 2, resolved: true });
  });

  test('a range is read as its midpoint, because that is what a range means', () => {
    expect(sv('6-8 strips', '3 strips').servings).toBeCloseTo(7 / 3, 3);
  });

  test('"half an egg" survives the article it contains', () => {
    expect(sv('half an egg', '1 large')).toEqual({ servings: 0.5, resolved: true });
  });

  test('a stated serving count needs no reference at all', () => {
    expect(sv('2 servings', '3 strips')).toEqual({ servings: 2, resolved: true });
  });
});

describe('servingsFor: mass and volume are unit-aware', () => {
  test('ounces divide by the serving ounces, not by one', () => {
    // This is the case that made the OLD parseServings unusable here: it reads "10 oz" as 10,
    // caps it at 4, and against a 4 oz serving the truth is 2.5.
    expect(sv('10 oz', '4 oz')).toEqual({ servings: 2.5, resolved: true });
    expect(parseServings('10 oz')).toBe(4);
  });

  test('mass units convert between themselves', () => {
    expect(sv('1 lb', '4 oz').servings).toBeCloseTo(4, 2);
    expect(sv('150 g', '4 oz').servings).toBeCloseTo(1.323, 2);
  });

  test('volume units convert between themselves', () => {
    expect(sv('3 cups', '1 cup')).toEqual({ servings: 3, resolved: true });
    expect(sv('1/2 cup', '1 cup')).toEqual({ servings: 0.5, resolved: true });
    expect(sv('1 cup', '1/2 cup')).toEqual({ servings: 2, resolved: true });
    expect(sv('2 tbsp', '1 tbsp')).toEqual({ servings: 2, resolved: true });
  });

  test('a mixed number keeps its fraction', () => {
    // "1 1/2 cups" must not be read as 1: the plain-number branch would swallow the 1 and lose
    // the half.
    expect(sv('1 1/2 cups', '1 cup')).toEqual({ servings: 1.5, resolved: true });
  });

  test('a parenthetical serving is usable from either side', () => {
    // Canned tuna's label is "1 can (5 oz)", so both phrasings have to land.
    expect(sv('5 oz', '1 can (5 oz)')).toEqual({ servings: 1, resolved: true });
    expect(sv('2 cans', '1 can (5 oz)')).toEqual({ servings: 2, resolved: true });
  });

  test('fluid ounces are volume, never weight', () => {
    expect(sv('12 fl oz', '20 oz').resolved).toBe(false);
  });
});

describe('servingsFor REFUSES rather than guesses', () => {
  // This block is the safety of the whole change. Every refusal here means groundFood keeps the
  // band that already shipped.
  test.each([
    ['a few', '1 large'],
    ['a handful', '1 oz'],
    ['some', '1 cup'],
    ['several', '3 strips'],
    ['a lot', '1 cup'],
    ['an egg', '1 large'],
    ['', '1 cup'],
  ])('%p against %p is unresolved', (q, label) => {
    expect(sv(q, label).resolved).toBe(false);
  });

  test('a count whose noun does not match a multi-unit serving is unresolved', () => {
    // "1 plate" against a 3-strip serving is not one third of anything. Guessing would be worse
    // than admitting we cannot tell.
    expect(sv('1 plate', '3 strips').resolved).toBe(false);
    expect(sv('3 pancakes', '2 cakes').resolved).toBe(false);
  });

  test('a missing quantity is unresolved', () => {
    expect(sv(undefined, '1 cup').resolved).toBe(false);
  });
});

describe('groundFood: the band follows the portion', () => {
  const eggs = { protein: 36, kcal: 432, carbs: 2, fat: 30 };

  test('a real large portion is no longer crushed', () => {
    // The old ceiling was one serving x 3 + 8 = 26g, so a six-egg omelette lost ten grams of
    // protein it actually contained.
    expect(groundFood({ name: 'Eggs', quantity: '6 eggs', per: eggs }).per.protein).toBe(36);
  });

  test('macros that contradict the stated quantity are pulled back', () => {
    // The model said four ounces of chicken and priced roughly twelve.
    const g = groundFood({
      name: 'Grilled chicken breast', quantity: '4 oz',
      per: { protein: 105, kcal: 561, carbs: 0, fat: 12 },
    });
    expect(g.per.protein).toBeLessThan(105);
    expect(g.adjusted).toBe(true);
  });

  test('prep variance is still allowed for', () => {
    // Four ounces of chicken cooked in real oil is 16g of fat against a 4g reference, and the
    // prompt explicitly tells the model to include an allowance it cannot see. Fat keeps the
    // widest band of the three for exactly this reason.
    const g = groundFood({
      name: 'Grilled chicken breast', quantity: '4 oz',
      per: { protein: 35, kcal: 290, carbs: 0, fat: 16 },
    });
    expect(g.per.fat).toBe(16);
    expect(g.per.protein).toBe(35);
  });

  test('an unresolvable quantity keeps the ORIGINAL wide band, unchanged', () => {
    // The load-bearing guarantee: nothing that passed before this change can start being clamped
    // because a parser got clever. 26g is the old one-serving ceiling for eggs.
    for (const quantity of ['a few', 'a handful', undefined, '']) {
      expect(groundFood({ name: 'Eggs', quantity, per: eggs }).per.protein).toBe(26);
    }
  });

  test('a read off a label still bypasses the band entirely', () => {
    // READ beats REFERENCE (the Core Power fix): portion scaling must not reintroduce the bug
    // where a true 42g shake got mangled back into a 14g one.
    const g = groundFood({
      name: 'Whey protein', quantity: '1 bottle', basis: 'label',
      per: { protein: 42, kcal: 230, carbs: 9, fat: 3 },
    });
    expect(g.per.protein).toBe(42);
  });

  test('a food the table genuinely does not know keeps its estimate', () => {
    const g = groundFood({ name: 'Zopf', quantity: '2 slices', per: { protein: 30, kcal: 700, carbs: 80, fat: 25 } });
    expect(g.per.protein).toBe(30);
    expect(g.matched).toBe(false);
  });
});

describe('an athlete correcting the portion moves the numbers', () => {
  // Before this, the quantity input on each breakdown row wrote a string and stopped. It set
  // `edited`, which makes groundFood skip the plausibility band entirely, and nothing ever
  // touched the item's macros: typing "2 cups" over the AI's "1 cup" changed a label and not
  // one number. hasUserEdits then went true and the breakdown printed "Macros and score
  // recalculated from the foods listed" over a recalculation that never ran. The athlete is
  // holding the food; the app is reading a photograph of it. They win.
  // The proto is plain JS, so these shapes are declared here rather than inferred from a
  // literal: the flags under test are exactly the ones a literal would type away.
  type Staged = { detectedRich: Row[]; detected: string[] };
  const rice = (): Staged => ({
    detectedRich: [{ name: 'White rice', confidence: 'high', quantity: '1 cup', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 } }],
    detected: ['White rice'],
  });

  test('doubling the stated portion doubles the item', () => {
    const r = rice();
    expect(applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: '2 cups' })).toBe(true);
    expect(r.detectedRich[0].per).toEqual({ protein: 8, kcal: 410, carbs: 90, fat: 0 });
  });

  test('halving it halves the item', () => {
    const r = rice();
    applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: '1/2 cup' });
    expect(r.detectedRich[0].per).toEqual({ protein: 2, kcal: 103, carbs: 23, fat: 0 });
  });

  test('the rescale is unit-aware, not a bare number', () => {
    // "8 oz" over a "4 oz" read is two of them. The old parseServings would have said eight.
    const r: Staged = {
      detectedRich: [{ name: 'Grilled chicken breast', confidence: 'high', quantity: '4 oz', per: { protein: 35, kcal: 187, carbs: 0, fat: 4 } }],
      detected: ['Grilled chicken breast'],
    };
    applyFoodEdit(r, { kind: 'quantity', name: 'Grilled chicken breast', quantity: '8 oz' });
    expect(r.detectedRich[0].per!.protein).toBe(70);
  });

  test('the totals and therefore the score follow the item', () => {
    const r = rice();
    applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: '2 cups' });
    // recomputeStagedMeal re-grounds from detectedRich, so proving the ground totals move is
    // proving the meal's kcal, macros and quality move with them.
    expect(groundMealFromFoods(r.detectedRich).totals.kcal).toBe(410);
  });

  test('a portion edit does NOT set the grounding bypass', () => {
    // `edited` means the reference no longer describes this FOOD. More of the same food is
    // still that food, so grounding must keep sanity-checking it at the corrected portion.
    const r = rice();
    applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: '2 cups' });
    expect(r.detectedRich[0].edited).toBeUndefined();
    expect(r.detectedRich[0].portionEdited).toBe(true);
  });

  test('the edit is still visible to the athlete', () => {
    const r = rice();
    applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: '2 cups' });
    expect(hasUserEdits(r)).toBe(true);
    expect((normalizeDetected(r.detectedRich) as Row[])[0].portionEdited).toBe(true);
  });

  test('an uncomparable correction invents nothing and keeps the old behaviour', () => {
    const r = rice();
    applyFoodEdit(r, { kind: 'quantity', name: 'White rice', quantity: 'a bit more' });
    expect(r.detectedRich[0].per).toEqual({ protein: 4, kcal: 205, carbs: 45, fat: 0 });
    expect(r.detectedRich[0].quantity).toBe('a bit more');
    expect(r.detectedRich[0].edited).toBe(true);
    expect(hasUserEdits(r)).toBe(true);
  });

  test('renaming still sets the bypass, because the reference really has changed', () => {
    const r = rice();
    applyFoodEdit(r, { kind: 'rename', name: 'White rice', newName: 'Fried rice with pork' });
    expect(r.detectedRich[0].edited).toBe(true);
  });
});

describe('the AI can route a portion correction through the same arithmetic', () => {
  // apply_correction had fields for the name and for each macro, and none for the amount. So
  // an athlete saying "that was two cups, not one" left the model one way to comply: restate
  // macros it had to invent. That is the exact thing the correction path exists to prevent,
  // since numbers are never supposed to come from prose. The tool now carries `quantity` and
  // the client rescales the item from its own logged numbers, using the SAME servingsFor the
  // breakdown's quantity field uses, so saying "2 cups" to the AI and typing "2 cups" into
  // the row have to land on identical numbers.
  const staged = () => ({
    mealId: 'm1', protein: 8, carbs: 90, fat: 2, kcal: 410, fiber: 2, quality: 70,
    detectedRich: [
      { name: 'White rice', confidence: 'high', quantity: '1 cup', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 } },
      { name: 'Grilled chicken breast', confidence: 'high', quantity: '4 oz', per: { protein: 35, kcal: 187, carbs: 0, fat: 4 } },
    ],
    foods: ['White rice', 'Grilled chicken breast'],
  });
  const correct = (corr: Record<string, unknown>) =>
    applyMealCorrection(staged(), { kind: 'item', ...corr }) as null | { meta: { kcal: number; detectedRich: Row[] } };
  const rowFor = (r: { meta: { detectedRich: Row[] } }, name: string) =>
    r.meta.detectedRich.find((d) => d.name === name)!;

  test('"two cups, not one" doubles the item and the meal', () => {
    const r = correct({ item: 'White rice', quantity: '2 cups' })!;
    expect(rowFor(r, 'White rice').per).toEqual({ protein: 8, kcal: 410, carbs: 90, fat: 0 });
    expect(r.meta.kcal).toBe(597);
  });

  test('the rescale is unit-aware here too', () => {
    // "8 oz" against a logged "4 oz" is two of them, not eight.
    const r = correct({ item: 'Grilled chicken breast', quantity: '8 oz' })!;
    expect(rowFor(r, 'Grilled chicken breast').per!.protein).toBe(70);
  });

  test('it lands on the same numbers as typing into the breakdown row', () => {
    // The two paths must never disagree; that is the reason they share servingsFor.
    const viaAi = rowFor(correct({ item: 'White rice', quantity: '2 cups' })!, 'White rice').per;
    const typed = { detectedRich: [{ name: 'White rice', confidence: 'high', quantity: '1 cup', per: { protein: 4, kcal: 205, carbs: 45, fat: 0 } }], detected: ['White rice'] };
    applyFoodEdit(typed, { kind: 'quantity', name: 'White rice', quantity: '2 cups' });
    expect(viaAi).toEqual(typed.detectedRich[0].per);
  });

  test('a pure portion correction does NOT switch grounding off', () => {
    const row = rowFor(correct({ item: 'White rice', quantity: '2 cups' })!, 'White rice');
    expect(row.edited).toBeUndefined();
    expect(row.portionEdited).toBe(true);
  });

  test('an amount the app cannot compare returns null rather than guessing', () => {
    // null is what makes the thread say "that didn't line up, fix it here" instead of leaving
    // the AI's "updating your numbers now" standing over numbers that never moved.
    expect(correct({ item: 'White rice', quantity: 'a bit more' })).toBeNull();
  });

  test('a stated macro applies to the CORRECTED amount, not the old one', () => {
    // "Two cups, and it was brown rice at 5g": the 5g is per the corrected portion.
    const row = rowFor(correct({ item: 'White rice', quantity: '2 cups', per: { protein: 5 } })!, 'White rice');
    expect(row.per!.protein).toBe(5);
    expect(row.per!.carbs).toBe(90);
    expect(row.edited).toBe(true);
  });

  test('a label correction with no amount behaves exactly as it always did', () => {
    const row = rowFor(correct({ item: 'White rice', per: { protein: 42 } })!, 'White rice');
    expect(row.per!.protein).toBe(42);
    expect(row.quantity).toBe('1 cup');
    expect(row.edited).toBe(true);
  });
});

describe('a word-fallback match NEVER gets the tighter band', () => {
  // matchFood falls back to a name's most identifying word, and on compound dishes it matches
  // badly: "Beef and broccoli stir fry" resolves to broccoli, "Jollof rice with goat" to rice
  // cakes, "Dinner roll" to rolled oats (the eval manifest records that last one itself). The
  // old wide band made a wrong reference survivable. A portion-anchored band would not, so
  // tightening is gated on a DIRECT match. This is the second of the change's two safety rules,
  // and the more dangerous one to get wrong.
  test('matchFoodDetailed reports how it matched', () => {
    expect(matchFoodDetailed('Grilled chicken breast').direct).toBe(true);
    expect(matchFoodDetailed('Beef and broccoli stir fry').direct).toBe(false);
    expect(matchFoodDetailed('Jollof rice with goat').direct).toBe(false);
    // The word fallback is LOOSE: 'nothing like a food at all' matches shrimp. Use a name with
    // no matchable word at all to exercise the genuine no-match path.
    expect(matchFoodDetailed('Kouign-amann').hit).toBeUndefined();
  });

  test('an honest compound-dish read is not crushed against the wrong reference', () => {
    // Grounded against broccoli (3g protein per cup), a tightened band would put this near 10g.
    const g = groundFood({
      name: 'Beef and broccoli stir fry', quantity: '1 cup',
      per: { protein: 35, kcal: 420, carbs: 18, fat: 22 },
    });
    // The old one-serving band still applies: 3 x 3 + 8 = 17.
    expect(g.per.protein).toBe(17);
  });
});

describe('every serving label in the table is parseable', () => {
  // The parser only has to cover the vocabulary the table actually uses. If a future food adds a
  // serving label nothing can read, portion scaling silently stops applying to it, so this fails
  // loudly instead.
  test('each FOOD_DB serving resolves against a quantity phrased in its own unit', () => {
    const unreadable: string[] = [];
    for (const food of FOOD_DB as Array<{ id: string; serving: string }>) {
      // Ask for exactly one serving, phrased identically. Anything the parser understands must
      // return 1; anything it cannot read is the gap this test exists to surface.
      const r = sv(food.serving.replace(/\s*\([^)]*\)/, ''), food.serving);
      if (!r.resolved || Math.abs(r.servings - 1) > 0.001) unreadable.push(`${food.id} (${food.serving})`);
    }
    expect(unreadable).toEqual([]);
  });
});
