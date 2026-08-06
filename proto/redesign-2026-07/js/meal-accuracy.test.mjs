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
import { normalizeDetected, estimateConfidence, applyMealCorrection, mealQualityScore } from './meal-intel.js';
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
