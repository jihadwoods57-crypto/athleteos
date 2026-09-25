/* "I HAD DOUBLE CHICKEN" (founder, 2026-09-24, 9:09 PM ET).
 *
 * The real thread (meal f4c982bb, prod meal_comments, read-only): "I had double chicken" (no
 * reply), "Nia in my meal i had double chicken. This from chipotle", Nia: "Good catch, Jihad.
 * Double chicken it is, your numbers and score are updating now" (meta analysis_update, filed by
 * meal-chat at 01:09:59 UTC, ai_calls outcome correction_returned), then "Double chicken". Nothing
 * moved, and an amber line under the box said so.
 *
 * THE PLATE. The six detected foods live only on the athlete's device: the meals row was inserted
 * at log time with the plate still being read (name "Dinner", detected []), and the late read's
 * mirror wrote macros only (fixed in the same change, state.js). So the plate below is RECONSTRUCTED
 * from what prod does hold: the title the app showed ("Chicken Salad Bowl with Corn, Slaw, and ..."),
 * the read's own words ("least sure on the sour cream or crema portion"), six items, and the row's
 * totals, 29g protein / 400 kcal / 32g carbs / 19g fat, which these six sum to exactly.
 *
 * What the model can send for "double chicken", every one of which used to change nothing:
 *   quantity "double"   (a word servingsFor cannot compare to "3 oz")
 *   quantity "2x"       (a count against a mass)
 *   newName "Double chicken" and no quantity (a rename of the same food: macros unchanged)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlateEdits, matchPlateFood, scaledQuantity, portionFactor, resolveChatCorrection, correctionOutcome } from './plate-edits.js';
import { applyMealCorrection } from './meal-intel.js';
import { servingsFor } from './nutrition.js';

const BOWL = {
  name: 'Chicken Salad Bowl with Corn, Slaw, and Sour Cream', mealId: 'f4c982bb-4b2c-464c-930a-d14f168c3b5b',
  protein: 29, kcal: 400, carbs: 32, fat: 19, fiber: 6, quality: 92,
  foods: ['Grilled chicken', 'Romaine lettuce', 'Roasted corn salsa', 'Cabbage slaw', 'Sour cream', 'Chipotle-lime dressing'],
  detectedRich: [
    { name: 'Grilled chicken', quantity: '3 oz', confidence: 'high', per: { protein: 21, kcal: 140, carbs: 0, fat: 6 } },
    { name: 'Romaine lettuce', quantity: '2 cups', confidence: 'high', per: { protein: 1, kcal: 15, carbs: 3, fat: 0 } },
    { name: 'Roasted corn salsa', quantity: '1/2 cup', confidence: 'high', per: { protein: 3, kcal: 80, carbs: 16, fat: 1 } },
    { name: 'Cabbage slaw', quantity: '1/2 cup', confidence: 'medium', per: { protein: 1, kcal: 50, carbs: 6, fat: 3 } },
    { name: 'Sour cream', quantity: '2 tbsp', confidence: 'low', per: { protein: 1, kcal: 60, carbs: 2, fat: 5 } },
    { name: 'Chipotle-lime dressing', quantity: '1 tbsp', confidence: 'medium', per: { protein: 2, kcal: 55, carbs: 5, fat: 4 } },
  ],
};
const SAID = 'Nia in my meal i had double chicken. This from chipotle';

/** What state.js correctMeal does with the parts, minus the device: each applied in turn. */
function apply(meta, parts) {
  let m = meta; const done = [];
  for (const p of parts) { const r = applyMealCorrection(m, p); if (r) { m = r.meta; done.push(r); } }
  if (!done.length) return null;
  return { meta: m, moved: done.some((r) => r.moved), unpriced: done.flatMap((r) => r.unpriced || []), nothingPriced: done.every((r) => r.nothingPriced) };
}

test('the reconstructed plate sums to the prod row (29g / 400 kcal / 32g / 19g)', () => {
  const sum = (k) => BOWL.detectedRich.reduce((a, d) => a + d.per[k], 0);
  assert.deepEqual([sum('protein'), sum('kcal'), sum('carbs'), sum('fat')], [29, 400, 32, 19]);
});

test('the three things the founder typed each read as "double the chicken"', () => {
  for (const s of ['I had double chicken', SAID, 'Double chicken']) {
    assert.deepEqual(readPlateEdits(s).map((e) => [e.op, e.factor, e.food]), [['scale', 2, 'chicken']], s);
  }
});

test('the other ways people say an amount changed', () => {
  const read = (s) => readPlateEdits(s).map((e) => [e.op, e.factor || null, e.food]);
  assert.deepEqual(read('extra guac'), [['scale', 1.5, 'guac']]);
  assert.deepEqual(read('no sour cream'), [['remove', null, 'sour cream']]);
  assert.deepEqual(read('half the rice'), [['scale', 0.5, 'rice']]);
  assert.deepEqual(read('2x chicken'), [['scale', 2, 'chicken']]);
  assert.deepEqual(read('chicken x2'), [['scale', 2, 'chicken']]);
  assert.deepEqual(read('the rice was doubled'), [['scale', 2, 'rice']]);
  assert.deepEqual(read('double portion of chicken'), [['scale', 2, 'chicken']]);
  assert.deepEqual(read('added guac'), [['add', null, 'guac']]);
  assert.deepEqual(read('I didn\u2019t have the rice'), [['remove', null, 'rice']]);
  assert.deepEqual(read('2x chicken and no rice'), [['scale', 2, 'chicken'], ['remove', null, 'rice']]);
});

test('words that only look like edits are not edits', () => {
  for (const s of ['extra protein', 'no problem', 'double check the numbers', 'should I get double chicken?',
    "it wasn't double chicken", 'no, it was chicken', 'Thanks']) {
    assert.deepEqual(readPlateEdits(s), [], s);
  }
});

test('chicken on this plate is one food, a portion of its own', () => {
  assert.deepEqual(matchPlateFood(BOWL.detectedRich, ['chicken']), { idx: 0 });
  // Two salsas is a question, not a pick.
  const two = [...BOWL.detectedRich, { name: 'Tomatillo salsa', quantity: '2 tbsp' }];
  assert.deepEqual(matchPlateFood(two, ['salsa']), { candidates: [2, 6] });
  assert.deepEqual(matchPlateFood(BOWL.detectedRich, ['steak']), { none: true });
  // "chicken" is not "chickpea"; "guac" is "guacamole".
  assert.deepEqual(matchPlateFood([{ name: 'Chickpeas' }], ['chicken']), { none: true });
  assert.deepEqual(matchPlateFood([{ name: 'Guacamole' }], ['guac']), { idx: 0 });
});

test('a doubled amount keeps the row\'s own unit, and servingsFor reads it back as exactly 2', () => {
  for (const [q, f, want] of [['3 oz', 2, '6 oz'], ['1/2 cup', 2, '1 cup'], ['1 bowl', 2, '2 bowls'], ['2 eggs', 0.5, '1 egg'], ['1 1/2 cups', 2, '3 cups']]) {
    const got = scaledQuantity(q, f);
    assert.equal(got, want);
    assert.deepEqual(servingsFor(got, q), { servings: f, resolved: true }, `${got} over ${q}`);
  }
  // No comparable amount on the row: servings, which servingsFor reads without a label.
  assert.equal(scaledQuantity('', 2), '2 servings');
  assert.equal(scaledQuantity('~4 oz', 2), '2 servings');
  assert.deepEqual(servingsFor('2 servings', '~4 oz'), { servings: 2, resolved: true });
});

test('portion words from the model are amounts, not strings', () => {
  assert.equal(portionFactor('double'), 2);
  assert.equal(portionFactor('2x'), 2);
  assert.equal(portionFactor('double portion'), 2);
  assert.equal(portionFactor('half'), 0.5);
  assert.equal(portionFactor('8 oz'), null);
  assert.equal(portionFactor('a bit more'), null);
});

/* ---- the incident, end to end through the real reducer ------------------------------------ */

for (const [label, correction] of [
  ['quantity "double"', { item: 'Grilled chicken', quantity: 'double', per: {} }],
  ['quantity "2x" on a shortened name', { item: 'chicken', quantity: '2x', per: {} }],
  ['a rename to "Double chicken"', { item: 'Grilled chicken', newName: 'Double chicken', per: {} }],
  ['nothing usable at all', { item: 'Chipotle chicken bowl', per: {} }],
]) {
  test(`"double chicken" doubles the chicken whatever the model sent (${label})`, () => {
    const { parts, asks } = resolveChatCorrection(BOWL, correction, SAID);
    assert.deepEqual(asks, []);
    assert.equal(parts.length, 1, 'one edit, the athlete\'s, and the model\'s version of it is not applied twice');
    assert.deepEqual([parts[0].kind, parts[0].item, parts[0].quantity], ['item', 'Grilled chicken', '6 oz']);
    const r = apply(BOWL, parts);
    assert.ok(r && r.moved);
    const chicken = r.meta.detectedRich.find((d) => /chicken/i.test(d.name));
    assert.equal(chicken.name, 'Grilled chicken', 'never renamed "Double chicken"');
    assert.deepEqual(chicken.per, { protein: 42, kcal: 280, carbs: 0, fat: 12 });
    assert.deepEqual([r.meta.protein, r.meta.kcal, r.meta.carbs, r.meta.fat], [50, 540, 32, 25]);
    assert.deepEqual(correctionOutcome({ applied: r, asks }), { applied: true, unpriced: [] });
  });
}

test('the model alone (no edit words) still lands when it says "double"', () => {
  const { parts, asks } = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'double', per: {} }, 'Nia fix the chicken please');
  assert.deepEqual(asks, []);
  assert.equal(parts[0].quantity, '6 oz');
  assert.equal(apply(BOWL, parts).meta.protein, 50);
});

test('a real amount from the model keeps working ("6 oz" over "3 oz")', () => {
  const { parts } = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: '6 oz', per: {} }, 'it was 6 oz of chicken');
  assert.equal(parts[0].quantity, '6 oz');
  assert.equal(apply(BOWL, parts).meta.protein, 50);
});

/* ---- ask, never guess ----------------------------------------------------------------------- */

test('two chickens: Nia asks which one, and nothing changes', () => {
  const plate = { ...BOWL, detectedRich: [{ name: 'Chicken', quantity: '4 oz', per: { protein: 28, kcal: 180, carbs: 0, fat: 8 } }, { name: 'Chicken salad', quantity: '1 cup', per: { protein: 14, kcal: 220, carbs: 8, fat: 15 } }] };
  const { parts, asks } = resolveChatCorrection(plate, { item: 'Chicken', quantity: 'double', per: {} }, 'double chicken');
  assert.deepEqual(parts, [], 'the model picking one row is still a guess');
  assert.deepEqual(asks, [{ reason: 'ambiguous', verb: 'double', factor: 2, food: 'chicken', candidates: ['Chicken', 'Chicken salad'] }]);
  assert.deepEqual(correctionOutcome({ applied: null, asks }), { applied: false, ask: asks[0] });
});

test('a chicken that only exists inside a dish is asked about, not doubled with its rice', () => {
  const plate = { ...BOWL, detectedRich: [{ name: 'Chicken burrito bowl', quantity: '1 bowl', per: { protein: 40, kcal: 800, carbs: 90, fat: 25 } }] };
  const { parts, asks } = resolveChatCorrection(plate, { item: 'Chicken burrito bowl', quantity: 'double', per: {} }, 'double chicken');
  assert.deepEqual(parts, []);
  assert.equal(asks[0].reason, 'composite');
  assert.equal(asks[0].dish, 'Chicken burrito bowl');
});

test('a food the read never had: asked about for an amount, added for "added"', () => {
  const a = resolveChatCorrection(BOWL, { item: 'steak', quantity: 'double', per: {} }, 'double steak');
  assert.deepEqual([a.parts.length, a.asks[0].reason, a.asks[0].food], [0, 'missing', 'steak']);
  const b = resolveChatCorrection(BOWL, { missed: [{ name: 'guacamole' }] }, 'added guac');
  assert.deepEqual(b.parts.map((p) => [p.kind, p.foods.map((f) => f.name)]), [['add-foods', ['guac']]], 'the athlete\'s word, once');
});

test('what is clear lands and what is not is asked, in the same turn', () => {
  const plate = { ...BOWL, detectedRich: [...BOWL.detectedRich, { name: 'Tomatillo salsa', quantity: '2 tbsp', per: { protein: 0, kcal: 10, carbs: 2, fat: 0 } }] };
  const { parts, asks } = resolveChatCorrection(plate, {}, 'double chicken and no salsa');
  assert.deepEqual(parts.map((p) => p.item), ['Grilled chicken']);
  assert.deepEqual([asks[0].reason, asks[0].verb, asks[0].candidates], ['ambiguous', 'remove', ['Roasted corn salsa', 'Tomatillo salsa']]);
  const r = apply(plate, parts);
  assert.deepEqual(correctionOutcome({ applied: r, asks }), { applied: true, unpriced: [], ask: asks[0] });
});

test('"no sour cream" takes it off and the totals with it', () => {
  const { parts } = resolveChatCorrection(BOWL, {}, 'no sour cream');
  assert.deepEqual(parts.map((p) => [p.kind, p.item]), [['remove', 'Sour cream']]);
  const r = apply(BOWL, parts);
  assert.ok(r.moved);
  assert.deepEqual([r.meta.protein, r.meta.kcal], [28, 340]);
  assert.ok(!r.meta.detectedRich.some((d) => d.name === 'Sour cream'));
  assert.ok(!r.meta.foods.includes('Sour cream'), 'the flat list follows');
});

test('a model item that matches nothing is a question naming what IS on the plate', () => {
  const { parts, asks } = resolveChatCorrection(BOWL, { item: 'tofu', quantity: '2 cups', per: {} }, 'Nia it was more');
  assert.deepEqual(parts, []);
  assert.equal(asks[0].reason, 'no_match');
  assert.equal(asks[0].candidates.length, 4);
});

test('an amount nobody can compare is asked about, never invented', () => {
  const { parts, asks } = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'a bit more', per: {} }, 'a bit more chicken');
  assert.deepEqual(parts, []);
  assert.deepEqual([asks[0].reason, asks[0].food], ['amount', 'Grilled chicken']);
});

test('a rename that really is a different food still re-prices (correction follows the food)', () => {
  const { parts, asks } = resolveChatCorrection(BOWL, { item: 'Grilled chicken', newName: 'Grilled salmon', per: {} }, "it's actually salmon");
  assert.deepEqual(asks, []);
  const r = apply(BOWL, parts);
  assert.ok(r.moved);
  assert.equal(r.meta.detectedRich[0].name, 'Grilled salmon');
});

test('a stated macro still beats the reference (the 42g shake rule)', () => {
  const { parts } = resolveChatCorrection(BOWL, { missed: [{ name: 'protein shake' }] }, 'I also had a 42g protein shake');
  const r = apply(BOWL, parts);
  assert.equal(r.meta.protein, 29 + 42);
});

test('the outcome for every miss is a question, never silence', () => {
  assert.deepEqual(correctionOutcome({ applied: { nothingPriced: true, unpriced: ['moon dust'] } }), { applied: false, ask: { reason: 'unpriced', unpriced: ['moon dust'] } });
  assert.deepEqual(correctionOutcome({ applied: { moved: false }, correction: { newName: 'Adobo chicken' } }), { applied: false, ask: { reason: 'unchanged', newName: 'Adobo chicken' } });
  assert.deepEqual(correctionOutcome({ applied: null }), { applied: false, ask: { reason: 'nothing' } });
});
