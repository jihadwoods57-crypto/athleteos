/* Two founder reports from the same pair of screenshots, 2026-09-17.
 *
 * 1. "I had a 42g protein shake as well" -> protein moved 51g to 71g. Twenty, not forty-two.
 *    applyMealCorrection priced the shake from the curated reference and only ever consulted a
 *    stated figure as a FALLBACK for foods the table does not carry. That rule is right for a
 *    number the model invented and wrong for one the athlete read off their own bottle - which is
 *    the same distinction groundFood() has drawn since the Core Power fix, where the comment
 *    already names "a true 42g-protein shake" as what a generic reference mangles.
 *
 * 2. "I want the updated macros to stay in the team discussion group chat. Even after I exit out
 *    of the meal log." The receipt was ONE module-level slot on meal.js with a two-minute TTL, so
 *    it died on navigation, on a timer, and on the next correction overwriting it. The founder's
 *    second screenshot shows all of that: the first receipt gone, a bare avatar where the second
 *    should be. It is a meal_comments row now.
 *
 * Run: node --test proto/redesign-2026-07/js/stated-macro-and-receipt.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statedMacros, applyMealCorrection } from './meal-intel.js';
import { isCorrectionReceipt, correctionRowsOf, correctionReceiptText } from './chat-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* ---- what the athlete actually said ---- */

test('a stated macro is read out of the athletes own words', () => {
  assert.deepEqual(statedMacros('I had a 42g protein shake as well'), { protein: 42 });
  assert.deepEqual(statedMacros('I had a 42 protein shake'), { protein: 42 }, 'the unit is optional');
  assert.deepEqual(statedMacros('42 grams of protein and 300 calories'), { protein: 42, kcal: 300 });
  // The founder's second message, verbatim. "went up 20" puts its number AFTER the macro word and
  // is not a claim about the food, so 42 is still the only figure stated.
  assert.deepEqual(statedMacros('I told you i had a 42 protein shake and i the protein only went up 20'), { protein: 42 });
});

test('a COUNT is not a macro', () => {
  assert.equal(statedMacros('I had 2 protein shakes'), null, 'two shakes is not two grams');
  assert.equal(statedMacros('a shake'), null);
  assert.equal(statedMacros(''), null);
});

test('an ambiguous figure is not evidence', () => {
  assert.equal(statedMacros('it was 42g protein, no 30g protein'), null,
    'two different figures for one macro means the athlete is unsure; let the reference price it');
});

/* A figure is read from its FIRST digit or not at all. Both patterns used to start scanning at any
 * digit, so a number with a thousands separator or a decimal point had its TAIL read as the whole
 * figure: "1,200 calories" became 200, "22.5 g protein" became 5, "0.75 g fat" became 75. That is
 * the exact failure this whole path exists to end - a wrong number wearing the athlete's own
 * authority, and now beating the curated reference with it. */
test('a grouped thousand is read whole, not by its last three digits', () => {
  assert.deepEqual(statedMacros('that was about 1,200 calories'), { kcal: 1200 });
  assert.deepEqual(statedMacros('it had 1,500 cal'), { kcal: 1500 });
  assert.deepEqual(statedMacros('roughly 2,000 calories today'), { kcal: 2000 });
  assert.deepEqual(statedMacros('1,200g carbs'), { carbs: 1200 });
});

test('a decimal figure is read whole, not by its fractional digits', () => {
  assert.deepEqual(statedMacros('22.5 g protein'), { protein: 22.5 });
  assert.deepEqual(statedMacros('it was 0.75 g fat'), { fat: 0.75 });
  assert.deepEqual(statedMacros('1.5 g fat'), { fat: 1.5 });
});

test('a figure we cannot read is not evidence either', () => {
  // Malformed grouping is a guess, not a reading. Let the reference price it.
  assert.equal(statedMacros('add 1,20 calories'), null);
  assert.equal(statedMacros('1,20 g protein'), null);
  // European decimal comma vs thousands separator is genuinely ambiguous; refuse it.
  assert.equal(statedMacros('1.200 calories'), null);
  // Still bounded: a figure no food can have stays rejected.
  assert.equal(statedMacros('12,000 calories'), null);
  // And an unreadable figure poisons its macro, so a second one cannot quietly take its place.
  assert.equal(statedMacros('1,20 g protein, no 42 g protein'), null);
});

/* ---- THE BUG, pinned against the founder's own plate ---- */

const plate = () => ({
  protein: 51, carbs: 54, fat: 28, kcal: 650, fiber: 6, quality: 70,
  detectedRich: [
    { name: 'Grilled chicken', per: { protein: 40, carbs: 0, fat: 8, kcal: 240 } },
    { name: 'Potatoes', per: { protein: 6, carbs: 44, fat: 12, kcal: 310 } },
    { name: 'Slaw', per: { protein: 5, carbs: 10, fat: 8, kcal: 100 } },
  ],
});
// What the AI passed for a generic shake, and what the screenshots show it produced.
const shake = [{ name: 'protein shake', per: { protein: 20, carbs: 22, fat: 7, kcal: 210 } }];
const addedIn = (r) => r.meta.detectedRich.find((d) => d.name === 'protein shake');

test('THE BUG: without the stated figure the plate reproduces the screenshot exactly', () => {
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: shake });
  assert.equal(r.meta.protein, 71, 'the 51 -> 71 the founder photographed');
  assert.equal(r.meta.carbs, 76);
  assert.equal(r.meta.fat, 35);
  assert.equal(r.meta.kcal, 860);
});

test('THE FIX: the athlete said 42, so the plate gains 42', () => {
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: shake, said: 'I had a 42g protein shake as well' });
  assert.equal(r.meta.protein, 93, '51 + 42, not 51 + 20');
  // Only the macro they NAMED is overridden: a 42g shake says nothing about its carbs.
  assert.equal(r.meta.carbs, 76, 'carbs still come from the reference');
  assert.equal(addedIn(r).per.protein, 42);
  assert.equal(addedIn(r).basis, 'label', 'read evidence, so groundFood never clamps it back down');
});

test('kcal re-derives so the four numbers cannot disagree', () => {
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: shake, said: 'I had a 42g protein shake' });
  assert.equal(addedIn(r).per.kcal, 4 * 42 + 4 * 22 + 9 * 7, 'Atwater from the corrected macros');
});

test('a stated calorie figure is taken as stated, not re-derived', () => {
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: shake, said: 'a 42g protein shake, 300 calories' });
  assert.equal(addedIn(r).per.kcal, 300);
});

test('two foods make it ambiguous, so the reference keeps winning', () => {
  const two = [shake[0], { name: 'roll', per: { protein: 5, carbs: 30, fat: 2, kcal: 160 } }];
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: two, said: 'I had a 42g protein shake and a roll' });
  assert.equal(addedIn(r).per.protein, 20, 'which food the 42 describes is a guess, and a guess is the bug');
});

test('the model alone still cannot beat the reference', () => {
  // The hallucinated-60g-protein-egg rule. It must not have moved.
  const r = applyMealCorrection(plate(), { kind: 'add-foods', foods: shake, said: 'I had a shake too' });
  assert.equal(addedIn(r).per.protein, 20);
});

/* ---- the receipt is a record, not a 120-second animation ---- */

test('a filed receipt is an AI row the client cannot forge', () => {
  const row = { role: 'ai', meta: { t: 'correction_receipt', rows: [{ label: 'Protein', from: 51, to: 93, unit: 'g' }] } };
  assert.ok(isCorrectionReceipt(row));
  assert.equal(isCorrectionReceipt({ ...row, role: 'athlete' }), false, 'only the service role writes one');
  assert.equal(isCorrectionReceipt({ role: 'ai', meta: { t: 'analysis' } }), false);
  assert.equal(isCorrectionReceipt({ role: 'ai', meta: { t: 'correction_receipt', rows: [] } }), false);
});

test('a stored row is data from the wire, so every field is bounded', () => {
  const rows = correctionRowsOf({
    role: 'ai',
    meta: { t: 'correction_receipt', rows: [
      { label: '<b>Protein</b>', from: '51', to: '93', unit: 'g', band: 'g' },
      { label: 'Broken', from: null, to: 93 },
      { label: 'Score', from: 70, to: 84, score: true, band: '<script>' },
    ] },
  });
  assert.equal(rows.length, 2, 'a half-change is dropped rather than half-rendered');
  assert.equal(rows[0].label, 'bProtein/b', 'markup stripped');
  assert.equal(rows[0].from, 51, 'strings coerce to numbers');
  assert.equal(rows[1].band, 'script', 'band is letters only');
});

test('the receipt carries a true sentence for anything that cannot draw the card', () => {
  assert.equal(correctionReceiptText([{ label: 'Protein', from: 51, to: 93, unit: 'g' }]),
    'Updated: Protein 51g to 93g.');
  // An older client, the season-long thread and a push preview show this instead of a blank
  // bubble - which is what the founder's second screenshot caught the ephemeral card doing.
  assert.ok(correctionReceiptText([]).length > 0, 'never empty');
});

test('the receipt is posted, and the ephemeral card stands down once it lands', () => {
  const state = read('state.js');
  const meal = read('screens', 'meal.js');
  // 2026-09-22: the call also names the coach-requested addition it came from, when there is one.
  assert.match(state, /_postCorrectionReceipt\(r, opts\.additionId \|\| null\);/, 'every applied correction files one');
  assert.match(state, /correctionReceipt: rows/, 'written service-side as an unforgeable ai row');
  assert.match(state, /if \(!rows\.length\) return;/, 'nothing moved, nothing filed');
  // 2026-09-24: the live card is gone. The filed row IS the receipt, and it counts up as it
  // arrives (chat-view.js playFreshReceipts). A chat correction files it with Nia's words, so the
  // reducer's own receipt is skipped for it (noReceipt) rather than landing twice.
  assert.match(meal, /playFreshReceipts\(threadEl/, 'the arriving receipt is what animates');
  assert.match(state, /if \(!opts\.noReceipt\) void this\._postCorrectionReceipt/);
  assert.match(read('correction-turn.js'), /noReceipt: !!token/);
});

test('every thread renderer draws a filed receipt', () => {
  for (const f of [['screens', 'meal.js'], ['screens', 'coach.js'], ['screens', 'trust.js'], ['screens', 'nutrition-chat.js']]) {
    const src = read(...f);
    // ONE card for all four (chat-view.js receiptCardHtml, 2026-09-22): four copies of the same
    // markup was exactly how a courtesy reached one renderer and not the others.
    assert.match(src, /if \(isCorrectionReceipt\(c\)\) return receiptCardHtml\(c, esc/, `${f.join('/')} renders the card`);
    assert.match(src, /receiptCardHtml,/, `${f.join('/')} imports it`);
  }
});

test('the athletes own words reach the reducer from both chat surfaces', () => {
  for (const f of [['screens', 'meal.js'], ['screens', 'nutrition-chat.js']]) {
    assert.match(read(...f), /said: text,/, `${f.join('/')} passes the message through`);
  }
  assert.match(read('plate-edits.js'), /said: said \|\| undefined/, 'and every part it builds carries it to the reducer');
});

test('the edge function bounds the receipt and spends nothing to file it', () => {
  const fn = readFileSync(join(HERE, '..', '..', '..', 'supabase/functions/meal-chat/index.ts'), 'utf8');
  assert.match(fn, /function correctionReceiptRows\(raw: unknown\): ReceiptRow\[\] \| null/);
  // 2026-09-22: the rows may be trimmed to the athlete's plan style for a coach-requested
  // addition, which also carries its attribution note and id.
  assert.match(fn, /meta: \{ t: 'correction_receipt', rows, \.\.\.\(note \? \{ note, additionId \} : \{\}\) \}/);
  assert.match(fn, /role: 'ai',/);
  // Before the daily AI cap and before any model call: a day of honest corrections must not be
  // able to lock the athlete out of their own nutritionist.
  const guardAt = fn.indexOf('if (receiptRows) {');
  const capAt = fn.indexOf('await withinKeyCap(');   // the first CALL, not the definition
  assert.ok(guardAt > -1 && capAt > -1 && guardAt < capAt, 'the receipt path returns before the AI cap');
});
