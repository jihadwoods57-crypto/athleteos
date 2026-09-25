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
import { readPlateEdits, matchPlateFood, scaledQuantity, portionFactor, resolveChatCorrection, correctionOutcome, isProteinItem } from './plate-edits.js';
import { applyMealCorrection, normalizeDetected } from './meal-intel.js';
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
  let m = meta; const done = []; const landed = [];
  for (const p of parts) { const r = applyMealCorrection(m, p); if (r) { m = r.meta; done.push(r); landed.push(p); } }
  if (!done.length) return null;
  return { meta: m, landed, moved: done.some((r) => r.moved), unpriced: done.flatMap((r) => r.unpriced || []), nothingPriced: done.every((r) => r.nothingPriced) };
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
  assert.deepEqual(matchPlateFood([{ name: 'Guacamole' }], ['guac']), { idx: 0, strict: true }, 'every word of the name: near-exact');
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
    const { parts, asks, exact } = resolveChatCorrection(BOWL, correction, SAID);
    assert.deepEqual(asks, []);
    assert.equal(parts.length, 1, 'one edit, the athlete\'s, and the model\'s version of it is not applied twice');
    assert.deepEqual([parts[0].kind, parts[0].item, parts[0].quantity], ['item', 'Grilled chicken', '6 oz']);
    const r = apply(BOWL, parts);
    assert.ok(r && r.moved);
    const chicken = r.meta.detectedRich.find((d) => /chicken/i.test(d.name));
    assert.equal(chicken.name, 'Grilled chicken', 'never renamed "Double chicken"');
    assert.deepEqual(chicken.per, { protein: 42, kcal: 280, carbs: 0, fat: 12 });
    assert.deepEqual([r.meta.protein, r.meta.kcal, r.meta.carbs, r.meta.fat], [50, 540, 32, 25]);
    const o = correctionOutcome({ applied: r, asks, exact, parts });
    assert.deepEqual([o.applied, o.unpriced, o.done], [true, [], [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }]]);
    // The model's ack is filed word for word only when its own part landed as it described.
    assert.equal(o.exact, !!correction.quantity || !!correction.newName, label);
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
  const plate = { ...BOWL, detectedRich: [{ name: 'Grilled chicken', quantity: '4 oz', per: { protein: 28, kcal: 180, carbs: 0, fat: 8 } }, { name: 'Chicken salad', quantity: '1 cup', per: { protein: 14, kcal: 220, carbs: 8, fat: 15 } }] };
  const { parts, asks } = resolveChatCorrection(plate, { item: 'chicken', quantity: 'double', per: {} }, 'double chicken');
  assert.deepEqual(parts, [], 'the model saying "chicken" is not a pick between two chickens');
  assert.deepEqual(asks, [{ reason: 'ambiguous', verb: 'double', food: 'chicken', candidates: ['Grilled chicken', 'Chicken salad'] }]);
  assert.deepEqual(correctionOutcome({ applied: null, asks }), { applied: false, ask: asks[0], asks });
});

test('a row literally named what was said is that food, not a tie ("Chicken" beside "Chicken salad")', () => {
  const plate = { ...BOWL, detectedRich: [{ name: 'Chicken', quantity: '4 oz', per: { protein: 28, kcal: 180, carbs: 0, fat: 8 } }, { name: 'Chicken salad', quantity: '1 cup', per: { protein: 14, kcal: 220, carbs: 8, fat: 15 } }] };
  const { parts, asks } = resolveChatCorrection(plate, { item: 'Chicken', quantity: 'double', per: {} }, 'double chicken');
  assert.deepEqual(asks, []);
  assert.deepEqual(parts.map((p) => [p.item, p.quantity]), [['Chicken', '8 oz']]);
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
  assert.deepEqual(b.parts.map((p) => [p.kind, p.foods.map((f) => f.name)]), [['add-foods', ['guacamole']]], 'the model\'s add, once');
  const c = resolveChatCorrection(BOWL, {}, 'added guac');
  assert.deepEqual(c.parts.map((p) => [p.kind, p.foods.map((f) => f.name)]), [['add-foods', ['guac']]], 'the athlete\'s word when the model sent none');
});

test('what is clear lands and what is not is asked, in the same turn', () => {
  const plate = { ...BOWL, detectedRich: [...BOWL.detectedRich, { name: 'Tomatillo salsa', quantity: '2 tbsp', per: { protein: 0, kcal: 10, carbs: 2, fat: 0 } }] };
  const { parts, asks } = resolveChatCorrection(plate, {}, 'double chicken and no salsa');
  assert.deepEqual(parts.map((p) => p.item), ['Grilled chicken']);
  assert.deepEqual([asks[0].reason, asks[0].verb, asks[0].candidates], ['ambiguous', 'remove', ['Roasted corn salsa', 'Tomatillo salsa']]);
  const r = apply(plate, parts);
  const o = correctionOutcome({ applied: r, asks });
  assert.deepEqual([o.applied, o.exact, o.ask, o.done.map((d) => d.food)], [true, false, asks[0], ['Grilled chicken']]);
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

/* ============================ REVIEW FINDINGS (2026-09-24) ============================
 * Nia's words must always match what actually happened. Each block below is a reviewer repro
 * (the pe3 script), pinned before the fix. */

const chickenOf = (m) => m.detectedRich.find((d) => /chicken/i.test(d.name));

/* C1. "Double chicken" said twice doubled it twice (3 oz -> 6 -> 12 -> 24). */
test('C1: a second "double chicken" is already counted, and nothing moves', () => {
  const first = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'double', per: {} }, SAID);
  let meta = apply(BOWL, first.parts).meta;
  assert.equal(chickenOf(meta).quantity, '6 oz');
  assert.equal(chickenOf(meta).origQuantity, '3 oz', 'the original read amount is kept on the row the first time');
  for (const [said, model] of [
    ['Double chicken', { item: 'Grilled chicken', quantity: '6 oz', per: {} }],
    ['yes double chicken', { item: 'Grilled chicken', quantity: '6 oz', per: {} }],
    ['Double chicken', { item: 'Grilled chicken', quantity: 'double', per: {} }],
    ['double chicken', {}],
  ]) {
    const r = resolveChatCorrection(meta, model, said);
    assert.deepEqual(r.parts, [], `${said} ${JSON.stringify(model)}: nothing to apply`);
    assert.deepEqual(r.asks, [{ reason: 'counted', verb: 'double', food: 'Grilled chicken', amount: '6 oz' }], said);
    assert.equal(correctionOutcome({ applied: null, asks: r.asks }).applied, false);
  }
  // "triple" after a double is 3x the ORIGINAL (9 oz), not 3x the doubled amount.
  const t = resolveChatCorrection(meta, {}, 'actually triple chicken');
  assert.equal(t.parts[0].quantity, '9 oz');
  meta = apply(meta, t.parts).meta;
  assert.equal(chickenOf(meta).origQuantity, '3 oz', 'the original survives a second edit');
});

test('C1: the original amount rides the row through the saves (normalizeDetected keeps it)', () => {
  const [row] = normalizeDetected([{ name: 'Grilled chicken', quantity: '6 oz', origQuantity: '3 oz', per: { protein: 42, kcal: 280, carbs: 0, fat: 12 } }]);
  assert.equal(row.origQuantity, '3 oz');
  assert.equal(normalizeDetected([{ name: 'Rice', quantity: '1 cup' }])[0].origQuantity, undefined, 'absent stays absent');
});

test('C1: the model\'s absolute amount wins over the athlete\'s word', () => {
  const r = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: '8 oz', per: {} }, 'double chicken');
  assert.deepEqual(r.parts.map((p) => [p.item, p.quantity, p.verb]), [['Grilled chicken', '8 oz', undefined]], '8 oz is not "a double" of 3 oz, so it is not called one');
  const agree = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: '6 oz', per: {} }, 'double chicken');
  assert.deepEqual(agree.parts.map((p) => [p.quantity, p.verb]), [['6 oz', 'double']]);
});

/* C2. Negations and "no X, it was Y" removed the wrong food, or dropped the model's part. */
test('C2: "no chicken salad, it was grilled chicken" never removes the grilled chicken', () => {
  const r = resolveChatCorrection(BOWL, { item: 'Grilled chicken', newName: 'Grilled chicken', per: {} }, 'Nia I had no chicken salad, it was grilled chicken');
  assert.ok(!r.parts.some((p) => p.kind === 'remove'), JSON.stringify(r.parts));
  const out = apply(BOWL, r.parts);
  assert.ok(!out || chickenOf(out.meta), 'the chicken is still on the plate');
  // The read already says grilled chicken: Nia says so, and nothing moves.
  assert.deepEqual(r.asks, [{ reason: 'counted', verb: '', food: 'Grilled chicken', amount: '' }]);
});

test('C2: "i did not have double chicken" is not a removal', () => {
  assert.deepEqual(readPlateEdits('i did not have double chicken'), []);
  assert.deepEqual(readPlateEdits("I didn't get extra rice"), []);
  const r = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: '3 oz', per: {} }, 'i did not have double chicken');
  assert.ok(!r.parts.some((p) => p.kind === 'remove'));
  const out = apply(BOWL, r.parts);
  assert.ok(!out || chickenOf(out.meta).quantity === '3 oz');
});

test('C2: "no sour cream, it was guac" applies the model\'s rename, not a removal', () => {
  const r = resolveChatCorrection(BOWL, { item: 'Sour cream', newName: 'Guacamole', per: {} }, 'Nia there was no sour cream, it was guac');
  assert.deepEqual(r.parts.map((p) => [p.kind, p.item, p.newName]), [['item', 'Sour cream', 'Guacamole']]);
  const out = apply(BOWL, r.parts);
  assert.ok(out.meta.detectedRich.some((d) => d.name === 'Guacamole'));
});

test('C2: "no rice, it was cauliflower rice" keeps the model\'s add', () => {
  const r = resolveChatCorrection(BOWL, { missed: [{ name: 'Cauliflower rice', quantity: '1 cup' }] }, 'no rice, it was cauliflower rice');
  assert.deepEqual(r.asks, []);
  assert.deepEqual(r.parts.map((p) => [p.kind, (p.foods || []).map((f) => f.name)]), [['add-foods', ['Cauliflower rice']]]);
});

test('C2: one shared word is never enough to take a food off', () => {
  const r = resolveChatCorrection(BOWL, {}, 'no chicken');
  assert.deepEqual(r.parts, []);
  assert.deepEqual([r.asks[0].reason, r.asks[0].verb, r.asks[0].candidates], ['confirm', 'remove', ['Grilled chicken']]);
  // The whole name, or all of its words, is.
  assert.deepEqual(resolveChatCorrection(BOWL, {}, 'no grilled chicken').parts.map((p) => [p.kind, p.item]), [['remove', 'Grilled chicken']]);
  assert.deepEqual(resolveChatCorrection(BOWL, {}, 'hold the sour cream').parts.map((p) => [p.kind, p.item]), [['remove', 'Sour cream']]);
  // And when the model named that row with nothing on it, it is the model's call, refined.
  assert.deepEqual(resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: '0', per: {} }, 'no chicken').parts.map((p) => [p.kind, p.item]), [['remove', 'Grilled chicken']]);
});

test('C2: the parser never drops a model rename or add because it shares a word', () => {
  const r = resolveChatCorrection(BOWL, { item: 'Roasted corn salsa', newName: 'Pico de gallo', per: {}, missed: [{ name: 'Chicken tortilla soup' }] }, 'the salsa was pico and I also had chicken soup');
  assert.ok(r.parts.some((p) => p.kind === 'item' && p.newName === 'Pico de gallo'));
  assert.ok(r.parts.some((p) => p.kind === 'add-foods' && p.foods.some((f) => f.name === 'Chicken tortilla soup')));
});

/* I6. "extra X" = 2x for a protein, 1.5x otherwise (founder ruling). */
test('I6: extra chicken is a second portion; extra salsa is half again', () => {
  assert.equal(resolveChatCorrection(BOWL, {}, 'extra chicken').parts[0].quantity, '6 oz');
  assert.equal(resolveChatCorrection(BOWL, {}, 'extra salsa').parts[0].quantity, '3/4 cup');
  assert.equal(resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'extra', per: {} }, 'Nia I had extra chicken').parts[0].quantity, '6 oz');
  assert.equal(resolveChatCorrection(BOWL, { item: 'Grilled chicken', newName: 'Extra chicken', per: {} }, 'Nia fix it').parts[0].quantity, '6 oz');
  assert.equal(resolveChatCorrection(BOWL, { item: 'Sour cream', quantity: 'extra', per: {} }, 'Nia fix it').parts[0].quantity, '3 tbsp');
});

test('I6: a protein is judged by its macros first, a short word list second', () => {
  assert.equal(isProteinItem({ name: 'Grilled chicken', per: { protein: 21, kcal: 140 } }), true);
  assert.equal(isProteinItem({ name: 'Sour cream', per: { protein: 1, kcal: 60 } }), false);
  assert.equal(isProteinItem({ name: 'Chicken salad', per: { protein: 14, kcal: 220 } }), false, 'macros outrank the word');
  assert.equal(isProteinItem({ name: 'Steak' }), true, 'no macros: the word list');
  assert.equal(isProteinItem({ name: 'Rice' }), false);
});

/* Unit words and plurals. */
test('a unit word is not a food ("a half cup of rice" never asks about "cup")', () => {
  assert.deepEqual(readPlateEdits('I had the chicken x2 and a half cup of rice').map((e) => [e.op, e.food]), [['scale', 'chicken'], ['set', 'rice']]);
  const r = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'double', per: {}, missed: [{ name: 'White rice', quantity: '1/2 cup' }] }, 'I had the chicken x2 and a half cup of rice');
  assert.deepEqual(r.asks, [], 'no "I don\'t see cup"');
  assert.deepEqual(r.parts.map((p) => p.kind), ['item', 'add-foods']);
  assert.equal(r.parts[0].quantity, '6 oz');
});

test('a scaled count keeps its size word and pluralises the food ("2 medium bananas")', () => {
  assert.equal(scaledQuantity('1 medium banana', 2), '2 medium bananas');
  assert.equal(scaledQuantity('2 large eggs', 0.5), '1 large egg');
});

/* I5. What Nia says is checked against what applied. */
test('I5: the outcome says exactly what landed, and whether it is what the model described', () => {
  const founder = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'double', per: {} }, SAID);
  assert.equal(founder.exact, true, 'the model said double, the plate doubled');
  const r = apply(BOWL, founder.parts);
  const o = correctionOutcome({ applied: r, asks: founder.asks, exact: founder.exact });
  assert.equal(o.exact, true);
  assert.deepEqual(o.done, [{ op: 'scale', verb: 'double', food: 'Grilled chicken', to: '6 oz' }]);

  const plate = { ...BOWL, detectedRich: [...BOWL.detectedRich, { name: 'Tomatillo salsa', quantity: '2 tbsp', per: { protein: 0, kcal: 10, carbs: 2, fat: 0 } }] };
  const mixed = resolveChatCorrection(plate, { item: 'Grilled chicken', quantity: 'double', per: {} }, 'double chicken and no salsa');
  assert.equal(mixed.exact, false, 'a part became a question');
  const o2 = correctionOutcome({ applied: apply(plate, mixed.parts), asks: mixed.asks, exact: mixed.exact });
  assert.equal(o2.exact, false);
  assert.equal(o2.asks[0].reason, 'ambiguous');

  const parserOnly = resolveChatCorrection(BOWL, { item: 'Grilled chicken', quantity: 'double', per: {} }, 'double chicken and no sour cream');
  assert.equal(parserOnly.exact, false, 'the athlete\'s words added an edit the model never described');
});
