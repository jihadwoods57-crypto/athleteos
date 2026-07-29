/* The empty read — pure-module tests (node --test).

   The bug this guard exists for: a photo of steak, sweet potato fries, green beans, pineapple and
   a protein shake came back as "~0g protein · high confidence", and could never be fixed. The
   analyzer had hit its output-token ceiling mid-report, so the tool call arrived carrying nothing;
   the app wrote four zeros, cleared `pending`, and from that moment the meal was frozen — every
   correction rule either scales the stored numbers or nudges them, and no arithmetic rescues zero.

   So the rule encoded here is simple and one-directional: a read with no numbers in it is not a
   meal, it is a failure, and it must be REFUSED rather than stored. Anything the athlete typed
   themselves (a nutrition label, a manual entry) is exempt — those numbers are not a model's
   guess and a genuinely zero-calorie entry is theirs to make. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteMealResult } from './nutrition.js';

const read = (over = {}) => ({
  protein: 81, kcal: 985, carbs: 75, fat: 37, fiber: 10,
  detectedRich: [{ name: 'ribeye', confidence: 'high' }],
  ...over,
});

test('a read that landed is accepted', () => {
  assert.equal(isCompleteMealResult(read()), true);
});

test('a small snack is not an empty read', () => {
  assert.equal(isCompleteMealResult(read({ protein: 4, carbs: 22, fat: 1, kcal: 110 })), true);
});

test('one zero macro is fine — a plate can genuinely have no fat', () => {
  assert.equal(isCompleteMealResult(read({ fat: 0 })), true);
});

test('the wire shape counts too: `detected` before grounding renames it', () => {
  const wire = { protein: 30, kcal: 400, carbs: 40, fat: 10, detected: [{ name: 'rice' }] };
  assert.equal(isCompleteMealResult(wire), true);
});

test('THE BUG: all four macros at zero is refused', () => {
  assert.equal(isCompleteMealResult(read({ protein: 0, kcal: 0, carbs: 0, fat: 0 })), false);
});

test('a report that named no food is refused', () => {
  assert.equal(isCompleteMealResult(read({ detectedRich: [], detected: [] })), false);
});

test('a half-written number is refused, not coerced to zero', () => {
  // Number(null) and Number('') are both 0 — finite, and therefore invisible to a naive check.
  // That is exactly how a truncated report used to pass as a meal.
  assert.equal(isCompleteMealResult(read({ carbs: null })), false);
  assert.equal(isCompleteMealResult(read({ protein: undefined })), false);
  assert.equal(isCompleteMealResult(read({ kcal: '' })), false);
  assert.equal(isCompleteMealResult(read({ fat: 'thirty' })), false);
});

test('nonsense is refused', () => {
  assert.equal(isCompleteMealResult(read({ fat: -12 })), false);
  assert.equal(isCompleteMealResult(read({ detectedRich: 'ribeye', detected: undefined })), false);
  assert.equal(isCompleteMealResult(null), false);
  assert.equal(isCompleteMealResult(undefined), false);
  assert.equal(isCompleteMealResult('{}'), false);
});

test('what the athlete entered themselves is theirs — labels and manual entries pass', () => {
  // A zero-calorie manual entry (black coffee, a diet soda) is a real thing a person can log.
  assert.equal(isCompleteMealResult({ source: 'label', protein: 0, kcal: 0, carbs: 0, fat: 0 }), true);
  assert.equal(isCompleteMealResult({ source: 'manual', protein: 0, kcal: 0, carbs: 0, fat: 0 }), true);
});
