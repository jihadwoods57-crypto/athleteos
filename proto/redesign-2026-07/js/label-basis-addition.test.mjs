// run: node --test proto/redesign-2026-07/js/label-basis-addition.test.mjs
//
// THE 12:44 SHAKE (2026-09-22). The photo showed a Nutrition Facts panel: 42g protein, 230 kcal.
// The curated reference prices a generic "protein shake" at 20g. When the AI READS a label, the
// printed figures are the truth, so they must beat the reference exactly the way the athlete's own
// stated figure already does (stated-macro-and-receipt.test.mjs). These pin that, and the
// coach-requested addition's application on the athlete's device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMealCorrection } from './meal-intel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

const plate = () => ({
  protein: 51, carbs: 54, fat: 28, kcal: 650, fiber: 6, quality: 70,
  detectedRich: [
    { name: 'Grilled chicken', per: { protein: 40, carbs: 0, fat: 8, kcal: 240 } },
    { name: 'Potatoes', per: { protein: 6, carbs: 44, fat: 12, kcal: 310 } },
    { name: 'Slaw', per: { protein: 5, carbs: 10, fat: 8, kcal: 100 } },
  ],
});
const shakeRow = (r) => r.meta.detectedRich.find((d) => d.name === 'protein shake');

test('a label the AI read beats the curated reference, exactly', () => {
  const r = applyMealCorrection(plate(), {
    kind: 'add-foods',
    foods: [{ name: 'protein shake', quantity: '1 bottle', basis: 'label', servings: 1, per: { protein: 42, kcal: 230, carbs: 9, fat: 5 } }],
  });
  const row = shakeRow(r);
  assert.equal(row.per.protein, 42, 'the printed 42, not the reference 20');
  assert.equal(row.per.kcal, 230);
  assert.equal(row.per.carbs, 9);
  assert.equal(row.per.fat, 5);
  assert.equal(row.basis, 'label', 'read evidence: groundFood never clamps it back');
  assert.equal(r.meta.protein, 93, '51 + 42');
  assert.equal(r.meta.kcal, 880, '650 + 230');
  assert.ok(r.meta.quality != null, 'the meal score recomputes');
});

test('servings multiply the printed per-serving figures', () => {
  const r = applyMealCorrection(plate(), {
    kind: 'add-foods',
    foods: [{ name: 'protein shake', basis: 'label', servings: 2, per: { protein: 21, kcal: 115, carbs: 5, fat: 2 } }],
  });
  assert.equal(shakeRow(r).per.protein, 42);
  assert.equal(shakeRow(r).per.kcal, 230);
});

test('an unreadable figure is filled by the reference ONLY for that figure', () => {
  // kcal unreadable: meal-chat drops it, so it arrives null. Protein is still the label's.
  const r = applyMealCorrection(plate(), {
    kind: 'add-foods',
    foods: [{ name: 'protein shake', basis: 'label', servings: 1, per: { protein: 42, kcal: null, carbs: 9, fat: 5 }, unreadable: ['kcal'] }],
  });
  const row = shakeRow(r);
  assert.equal(row.per.protein, 42);
  assert.equal(row.per.carbs, 9);
  assert.equal(row.per.kcal, 4 * 42 + 4 * 9 + 9 * 5, 'Atwater from the printed macros, never the reference kcal');
});

test('a model ESTIMATE still cannot beat the reference (the 60g egg rule is intact)', () => {
  const r = applyMealCorrection(plate(), {
    kind: 'add-foods', foods: [{ name: 'protein shake', basis: 'estimate', per: { protein: 42, kcal: 230, carbs: 9, fat: 5 } }],
  });
  assert.equal(shakeRow(r).per.protein, 20);
});

test('the athlete device applies a coach-requested addition once, through the correction engine', () => {
  const state = read('state.js');
  assert.match(state, /comment\.meta\.t === 'ai_addition'/);
  assert.match(state, /comment\.role === 'ai'/, 'only an ai row (service-role written) can carry one');
  assert.match(state, /fromAi: true/);
  assert.match(state, /!opts\.fromPro && !opts\.fromAi && this\._coachConnected\(\)/, 'no coach ping for what the coach asked for');
  const meal = read('screens', 'meal.js');
  assert.match(meal, /c\.meta\.t === 'pro_correction' \|\| c\.meta\.t === 'ai_addition'/);
});

test('the photo is part of the addressing decision on every athlete composer that attaches', () => {
  assert.match(read('screens', 'meal.js'), /photo: !!photoPath,/);
  assert.match(read('screens', 'trust.js'), /photo: !!photoPath,/);
});

/* ---------------- a coach-requested addition lands ONCE, on two devices ---------------- */
import { normalizeDetected } from './meal-intel.js';

const ADD_ID = '11111111-2222-4333-8444-555555555555';
const drink = [{ name: 'protein shake', quantity: '1 bottle', basis: 'label', servings: 1, per: { protein: 42, kcal: 230, carbs: 9, fat: 5 }, addId: ADD_ID }];

test('NO DOUBLE ADD: the coach wrote it into the row first, the athlete device applies it again, the drink counts once', () => {
  // Coach device: prices the addition into the meals row.
  const coach = applyMealCorrection(plate(), { kind: 'add-foods', foods: drink });
  assert.equal(coach.meta.protein, 93);
  assert.equal(shakeRow(coach).addId, ADD_ID, 'the addition id rides the item');
  // The row's detected list round-trips through normalizeDetected (how every device reads it).
  const fromRow = { ...coach.meta, detectedRich: normalizeDetected(coach.meta.detectedRich) };
  assert.equal(fromRow.detectedRich.find((d) => d.name === 'protein shake').addId, ADD_ID);
  // Athlete device, whose copy came from that row, applies the same ai_addition: nothing to add.
  assert.equal(applyMealCorrection(fromRow, { kind: 'add-foods', foods: drink }), null);
});

test('NO DOUBLE ADD: applying the same addition twice on one device is a no-op the second time', () => {
  const once = applyMealCorrection(plate(), { kind: 'add-foods', foods: drink });
  assert.equal(applyMealCorrection(once.meta, { kind: 'add-foods', foods: drink }), null);
});

test('the athlete device, from a copy WITHOUT the drink, lands on the same absolute numbers the coach wrote', () => {
  const coach = applyMealCorrection(plate(), { kind: 'add-foods', foods: drink });
  const athlete = applyMealCorrection(plate(), { kind: 'add-foods', foods: drink });
  for (const k of ['protein', 'carbs', 'fat', 'kcal', 'quality']) assert.equal(athlete.meta[k], coach.meta[k], k);
});

test('a DIFFERENT addition of the same food is still added', () => {
  const once = applyMealCorrection(plate(), { kind: 'add-foods', foods: drink });
  const again = applyMealCorrection(once.meta, { kind: 'add-foods', foods: [{ ...drink[0], addId: 'another-addition' }] });
  assert.equal(again.meta.protein, 135);
});

test('wiring: coach applies at once, athlete catches up on sync, receipts carry the addition id', () => {
  const coachJs = read('screens', 'coach.js');
  assert.match(coachJs, /if \(data\.addition && data\.addition\.id\) await applyAdditionHere\(data\.addition\)/);
  assert.match(coachJs, /addId: String\(add\.id\)/);
  assert.match(coachJs, /roles\.proCorrectMeal\(sub, fields, r\.summary\)/);
  assert.match(coachJs, /additionReceipt: \{ additionId: String\(add\.id\), rows \}/);
  const state = read('state.js');
  assert.match(state, /addId: String\(comment\.id\)/);
  assert.match(state, /async catchUpAiAdditions\(\)/);
  assert.match(state, /syncNotifications\(\);\n    void this\.catchUpAiAdditions\(\);/, 'every hydrate');
  assert.match(state, /act\.healDaySync\(\);\n      void act\.catchUpAiAdditions\(\);/, 'every return to the foreground');
  assert.match(state, /correctionReceipt: rows, \.\.\.\(additionId \? \{ additionId \} : \{\}\)/);
});

test('a photo turn says what the AI is doing', () => {
  assert.match(read('screens', 'meal.js'), /setTyping\(true, photoPath \? 'Reading the photo' : ''\)/);
  assert.match(read('screens', 'trust.js'), /label: photoPath \? 'Reading the photo' :/);
});
