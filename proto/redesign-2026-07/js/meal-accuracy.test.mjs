/* First-attempt accuracy — pure-module tests (node --test).

   The bug this suite exists for (founder escalation 2026-08-06): a breakfast photo held a
   Fairlife Core Power bottle with "42g" printed across its face. The vision read logged the shake
   at 14g protein, the whole breakfast at 44g, and when the athlete corrected it in the thread the
   AI argued back and told them to update the log themselves and notify their coach.

   The client-side half of the fix, encoded here:
     * normalizeDetected preserves per-item PROVENANCE (kind/brand/product/basis) — everything
       downstream keys off it, so a normalizer that strips it silently reverts the whole feature;
     * grounding never clamps a label-read item back into a generic reference band (the exact
       mangling that could turn a true 42 back into something smaller);
     * overall confidence can't read "high" while a major packaged product is an unresolved guess;
     * applyMealCorrection kind 'item' — the structured chat correction — updates the item,
       re-derives calories from food science, re-sums the totals, fully re-scores through
       mealQualityScore, and keeps the audit trail;
     * labelProducts builds the product-cache warming payload from label-read items only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetected, estimateConfidence, applyMealCorrection, mealQualityScore, correctionAxes } from './meal-intel.js';
import { groundFood, labelProducts, gapFoods } from './nutrition.js';

/* ---------------- provenance survives normalization ---------------- */

test('normalizeDetected preserves kind/brand/product/basis on the wire shape', () => {
  const [d] = normalizeDetected([{
    name: 'Core Power shake', confidence: 'high', kind: 'packaged', brand: 'Fairlife',
    product: 'Core Power 42g chocolate, 14 fl oz', basis: 'label',
    protein: 42, kcal: 230, carbs: 9, fat: 4,
  }]);
  assert.equal(d.kind, 'packaged');
  assert.equal(d.brand, 'Fairlife');
  assert.equal(d.product, 'Core Power 42g chocolate, 14 fl oz');
  assert.equal(d.basis, 'label');
  assert.deepEqual(d.per, { protein: 42, kcal: 230, carbs: 9, fat: 4 });
});

test('normalizeDetected drops junk provenance values instead of storing them', () => {
  const [d] = normalizeDetected([{ name: 'Shake', confidence: 'high', kind: 'weird', basis: 'vibes', protein: 10, kcal: 100, carbs: 5, fat: 2 }]);
  assert.equal(d.kind, undefined);
  assert.equal(d.basis, undefined);
});

/* ---------------- honest overall confidence ---------------- */

test('an unresolved packaged product caps the read at medium, never high', () => {
  const conf = estimateConfidence('live', [
    { name: 'Omelet', confidence: 'high' },
    { name: 'Mystery bottle', confidence: 'high', kind: 'packaged' }, // no basis, no product
  ]);
  assert.equal(conf, 'medium');
});

test('a label-read package keeps a clean plate at high confidence', () => {
  const conf = estimateConfidence('live', [
    { name: 'Omelet', confidence: 'high' },
    { name: 'Core Power', confidence: 'high', kind: 'packaged', basis: 'label' },
  ]);
  assert.equal(conf, 'high');
});

test('a named exact product also keeps high (variant resolved, macros estimated)', () => {
  const conf = estimateConfidence('live', [
    { name: 'Core Power', confidence: 'high', kind: 'packaged', product: 'Core Power 26g chocolate' },
  ]);
  assert.equal(conf, 'high');
});

/* ---------------- correction axes: rank on facts, never on an invented confidence ----------------
   The panel shows ONE dimension at a time, so whichever axis leads is the one most athletes
   will answer. It has to be earned from real data: there is no per-axis confidence in the
   model's output, and these tests exist so nobody later "improves" this into pretending
   there is. */

test('a cooked protein puts Cooking first', () => {
  const [lead] = correctionAxes({ source: 'live', detectedRich: [{ name: 'Grilled chicken', confidence: 'high' }] });
  assert.equal(lead.kind, 'cooking');
});

test('an answered axis sinks and is marked, never leads again', () => {
  const axes = correctionAxes({
    source: 'live',
    detectedRich: [{ name: 'Grilled chicken', confidence: 'high' }],
    corrections: [{ kind: 'cooking', value: 'oil' }],
  });
  assert.notEqual(axes[0].kind, 'cooking');
  assert.equal(axes.find((a) => a.kind === 'cooking').answered, true);
  assert.equal(axes[axes.length - 1].kind, 'cooking');
});

test('a note that already states the cooking method demotes that axis', () => {
  const axes = correctionAxes({
    source: 'live',
    detectedRich: [{ name: 'Grilled chicken', confidence: 'high' }],
    userNote: 'air fried it, no oil',
  });
  assert.notEqual(axes[0].kind, 'cooking');
});

test('a drink already in frame ranks below one that never was', () => {
  const withDrink = correctionAxes({ source: 'live', detectedRich: [{ name: 'Oatmeal' }, { name: 'Orange juice', kind: 'beverage' }] });
  const without = correctionAxes({ source: 'live', detectedRich: [{ name: 'Oatmeal' }] });
  const at = (axes) => axes.findIndex((a) => a.kind === 'drink');
  assert.ok(at(withDrink) > at(without), 'a detected beverage should demote the Drink axis');
});

test('a low-confidence read leads with Portion', () => {
  const [lead] = correctionAxes({ source: 'live', detectedRich: [{ name: 'Pasta bowl', confidence: 'low' }] });
  assert.equal(lead.kind, 'portion');
});

test('every axis carries its own chips and the full set is always offered', () => {
  const axes = correctionAxes({ source: 'live', detectedRich: [{ name: 'Toast' }] });
  assert.equal(axes.length, 5);
  assert.deepEqual(axes.map((a) => a.kind).sort(), ['cooking', 'drink', 'portion', 'sauce', 'side']);
  axes.forEach((a) => {
    assert.ok(a.opts.length >= 3, `${a.kind} should keep its options`);
    assert.ok(a.label, `${a.kind} needs a label`);
  });
});

/* ---------------- grounding respects READ evidence ---------------- */

test('groundFood never clamps a label-read item against the curated reference', () => {
  // "Protein shake" exists in FOOD_DB with a small reference — the exact mangling risk.
  const g = groundFood({ name: 'Protein shake', basis: 'label', per: { protein: 42, kcal: 230, carbs: 9, fat: 4 } });
  assert.equal(g.per.protein, 42);
  assert.equal(g.per.kcal, 230);
  assert.equal(g.matched, true);
  assert.equal(g.adjusted, false);
});

test('groundFood still bounds a plain visual estimate', () => {
  const est = groundFood({ name: 'Protein shake', per: { protein: 400, kcal: 4000, carbs: 9, fat: 4 } });
  assert.ok(est.per.protein < 400, 'a 400g-protein estimate must be clamped');
});

test('a label item with kcal food science cannot explain snaps to Atwater', () => {
  const g = groundFood({ name: 'Protein shake', basis: 'label', per: { protein: 42, kcal: 20, carbs: 9, fat: 4 } });
  assert.equal(g.per.kcal, 42 * 4 + 9 * 4 + 4 * 9);
});

/* ---------------- the structured chat correction (kind 'item') ---------------- */

const corePowerMeta = () => ({
  name: 'Breakfast plate', mealId: 'm1',
  protein: 44, kcal: 710, carbs: 59, fat: 36, fiber: 4, quality: 71,
  foods: ['Veggie & cheese omelet', 'Core Power shake', 'Fruit cup', 'Uncrustables PB&J'],
  detectedRich: [
    { name: 'Veggie & cheese omelet', confidence: 'medium', per: { protein: 22, kcal: 320, carbs: 4, fat: 24 } },
    { name: 'Core Power shake', confidence: 'high', kind: 'packaged', per: { protein: 14, kcal: 110, carbs: 9, fat: 2 } },
    { name: 'Fruit cup', confidence: 'high', per: { protein: 1, kcal: 70, carbs: 17, fat: 0 } },
    { name: 'Uncrustables PB&J', confidence: 'high', per: { protein: 7, kcal: 210, carbs: 29, fat: 10 } },
  ],
});

test('item correction adopts the stated protein, re-derives item kcal, re-sums totals', () => {
  const r = applyMealCorrection(corePowerMeta(), {
    kind: 'item', item: 'Core Power shake',
    newName: 'Fairlife Core Power 42g chocolate',
    per: { protein: 42 }, minutesLate: 61,
  });
  assert.ok(r, 'correction must apply');
  const shake = r.meta.detectedRich.find((d) => /Core Power/.test(d.name));
  assert.equal(shake.name, 'Fairlife Core Power 42g chocolate');
  assert.equal(shake.per.protein, 42);
  assert.ok(shake.per.kcal > 200, `item kcal must re-derive from macros, got ${shake.per.kcal}`);
  assert.equal(shake.basis, 'label');
  assert.equal(shake.confidence, 'high');
  // Totals re-derive from the items: 22 + 42 + 1 + 7 = 72g protein.
  assert.equal(r.meta.protein, 72);
  // The audit trail holds: original frozen once, correction logged.
  assert.equal(r.meta.orig.protein, 44);
  assert.equal(r.meta.corrections.length, 1);
  assert.equal(r.meta.corrections[0].kind, 'item');
  // The flat foods list follows the rename (it is what persists as `detected`).
  assert.ok(r.meta.foods.includes('Fairlife Core Power 42g chocolate'));
  assert.ok(!r.meta.foods.includes('Core Power shake'));
});

test('item correction FULLY re-scores through mealQualityScore — no nudge arithmetic', () => {
  const meta = corePowerMeta();
  const r = applyMealCorrection(meta, {
    kind: 'item', item: 'Core Power shake', per: { protein: 42 }, minutesLate: 61,
  });
  const expected = mealQualityScore({
    macros: r.meta, fiber: r.meta.fiber, detected: r.meta.detectedRich, minutesLate: 61,
  });
  assert.equal(r.meta.quality, expected);
  assert.equal(r.meta.qualityAdj, undefined);
});

test('item correction matches loosely on name ("the shake" → Core Power shake)', () => {
  const r = applyMealCorrection(corePowerMeta(), {
    kind: 'item', item: 'shake', per: { protein: 42 },
  });
  assert.ok(r);
  assert.equal(r.meta.detectedRich[1].per.protein, 42);
});

test('an unknown item never fabricates a correction', () => {
  assert.equal(applyMealCorrection(corePowerMeta(), { kind: 'item', item: 'lasagna', per: { protein: 42 } }), null);
});

test('kcalDelta reports how far the meal moved (drives the coach notification)', () => {
  const r = applyMealCorrection(corePowerMeta(), { kind: 'item', item: 'Core Power shake', per: { protein: 42 } });
  assert.ok(r.kcalDelta > 0);
});

test('legacy chip corrections still work exactly as before', () => {
  const r = applyMealCorrection(corePowerMeta(), { kind: 'cooking', value: 'oil' });
  assert.ok(r);
  assert.equal(r.meta.fat, 36 + 12);
});

/* ---------------- ingredients the athlete ADDS (founder escalation 2026-08-09) ----------------

   The second correction the system could not keep its promise about. An athlete logged two
   foil-wrapped sausage breakfast sandwiches, then told the thread "it had egg and cheese on both
   as well". The AI answered "Updating this sandwich's numbers now" — and nothing moved, because
   apply_correction could only RESTATE an item's macros, never ADD a component to it. The athlete
   stated no numbers (they were describing composition, not reading a label), so every macro field
   came back empty, the server decided nothing had changed, and the promise was already in the
   thread. These tests pin the missing half: composition the athlete states is priced from our own
   food reference, folded into the item, and re-scored — numbers never come from the AI's prose. */

const sandwichMeta = () => ({
  name: 'Breakfast', mealId: 'm2',
  protein: 26, kcal: 700, carbs: 62, fat: 34, fiber: 2, quality: 64,
  foods: ['Foil-wrapped sausage breakfast sandwiches', 'Vanilla yogurt'],
  detectedRich: [
    { name: 'Foil-wrapped sausage breakfast sandwiches', confidence: 'medium', quantity: '2', per: { protein: 20, kcal: 560, carbs: 44, fat: 30 } },
    { name: 'Vanilla yogurt', confidence: 'high', per: { protein: 6, kcal: 140, carbs: 18, fat: 4 } },
  ],
});

test('added ingredients are priced from the food DB and folded into the item', () => {
  const r = applyMealCorrection(sandwichMeta(), {
    kind: 'item', item: 'sausage breakfast sandwich',
    add: [{ name: 'egg', quantity: '2' }, { name: 'cheese', quantity: '2' }],
    minutesLate: 0,
  });
  assert.ok(r, 'an ingredient addition must apply');
  const s = r.meta.detectedRich[0];
  // 2 eggs = 12g protein, 2 cheese = 14g protein, on top of the sandwiches' own 20g.
  assert.equal(s.per.protein, 20 + 12 + 14);
  assert.ok(s.per.kcal > 560, 'the item kcal must grow with what was added');
  // Totals re-derive from the items: 46 + 6 = 52g protein.
  assert.equal(r.meta.protein, 52);
  // The reference DB priced it, so grounding must never clamp it back to a plain sandwich.
  assert.equal(s.basis, 'database');
  assert.equal(s.edited, true);
  // Audit trail: the original estimate is frozen and the addition is logged by name.
  assert.equal(r.meta.orig.protein, 26);
  assert.equal(r.meta.corrections.length, 1);
  assert.deepEqual(r.meta.corrections[0].add.map((a) => a.name), ['egg', 'cheese']);
});

test('an added ingredient RE-SCORES through mealQualityScore, never a nudge', () => {
  const r = applyMealCorrection(sandwichMeta(), {
    kind: 'item', item: 'sausage breakfast sandwich', add: [{ name: 'egg', quantity: '2' }],
  });
  const expected = mealQualityScore({
    macros: r.meta, fiber: r.meta.fiber, detected: r.meta.detectedRich, minutesLate: undefined,
  });
  assert.equal(r.meta.quality, expected);
  assert.equal(r.meta.qualityAdj, undefined);
});

test('a food the DB does not know falls back to the stated estimate, marked as one', () => {
  const r = applyMealCorrection(sandwichMeta(), {
    kind: 'item', item: 'sausage breakfast sandwich',
    add: [{ name: 'birria consomme', quantity: '1', per: { protein: 9, kcal: 120, carbs: 3, fat: 7 } }],
  });
  assert.ok(r);
  assert.equal(r.meta.detectedRich[0].per.protein, 20 + 9);
  assert.equal(r.meta.detectedRich[0].basis, 'estimate');
});

test('an ingredient that can be neither priced nor estimated is REPORTED, never dropped', () => {
  const r = applyMealCorrection(sandwichMeta(), {
    kind: 'item', item: 'sausage breakfast sandwich',
    add: [{ name: 'egg', quantity: '2' }, { name: 'zzzqqx paste', quantity: '1' }],
  });
  assert.ok(r);
  assert.deepEqual(r.unpriced, ['zzzqqx paste']);
  assert.equal(r.meta.detectedRich[0].per.protein, 20 + 12, 'the priceable ingredient still lands');
  assert.match(r.summary, /zzzqqx paste/i);
});

test('a correction that adds NOTHING and states nothing is a null, not a silent no-op', () => {
  assert.equal(applyMealCorrection(sandwichMeta(), { kind: 'item', item: 'sausage breakfast sandwich' }), null);
  assert.equal(applyMealCorrection(sandwichMeta(), { kind: 'item', item: 'sausage breakfast sandwich', add: [] }), null);
});

test('a rename with no numbers and no additions never claims a recalculation', () => {
  const r = applyMealCorrection(sandwichMeta(), {
    kind: 'item', item: 'sausage breakfast sandwich', newName: 'Jimmy Dean sausage sandwiches',
  });
  assert.ok(r, 'a pure rename still applies');
  assert.equal(r.meta.protein, 26, 'but it moves no numbers');
  assert.equal(r.kcalDelta, 0);
  assert.match(r.summary, /renamed/i, `a rename must not claim macros changed: "${r.summary}"`);
});

/* ---------------- product-cache warming payload ---------------- */

test('labelProducts collects only label-read items with a brand or product', () => {
  const out = labelProducts([
    { name: 'Core Power', basis: 'label', brand: 'Fairlife', product: 'Core Power 42g chocolate', quantity: '14 fl oz', per: { protein: 42, kcal: 230, carbs: 9, fat: 4 } },
    { name: 'Omelet', per: { protein: 22, kcal: 320, carbs: 4, fat: 24 } },              // not label
    { name: 'Bar', basis: 'label', per: { protein: 20, kcal: 200, carbs: 20, fat: 8 } }, // no brand/product
    { name: 'Empty', basis: 'label', brand: 'X', per: { protein: 0, kcal: 0, carbs: 0, fat: 0 } }, // junk macros
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].brand, 'Fairlife');
  assert.deepEqual(out[0].per, { protein: 42, kcal: 230, carbs: 9, fat: 4 });
});

test('gapFoods skips label/database items — a read claim is not a gap to enrich', () => {
  const out = gapFoods([
    { name: 'Zebra protein blaster', basis: 'label', per: { protein: 42, kcal: 230, carbs: 9, fat: 4 } },
    { name: 'Zebra mystery bowl', per: { protein: 20, kcal: 400, carbs: 40, fat: 12 } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Zebra mystery bowl');
});
