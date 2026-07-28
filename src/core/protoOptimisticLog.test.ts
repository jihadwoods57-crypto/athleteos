/**
 * Optimistic meal logging: the meal counts the instant the athlete logs it, and the AI read lands
 * seconds later.
 *
 * THE CLAIM THIS FILE EXISTS TO PROVE: a meal whose analysis is still in flight scores EXACTLY as a
 * manually-logged meal already does — timing credit only, no fabricated macros, no invented
 * quality. If that ever stops being true, the product is quietly crediting athletes for food the
 * AI has not read, and "the score never lies" becomes false.
 *
 * The scoring engine was deliberately NOT changed for this feature. These tests are what make that
 * claim checkable rather than merely asserted.
 */
const path = require('path');
const DAY_JS = path.join(__dirname, '..', '..', 'proto', 'redesign-2026-07', 'js', 'day.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DAY, dayResetLocal, dayLogMeal, mealScored, computeComponents, scoreFor } = require(DAY_JS);

const ISO = '2026-07-28';

function freshDay() {
  dayResetLocal(ISO);
  return DAY;
}

/** A pending meal: photo logged, analysis not back yet. */
const PENDING_META = { name: 'Dinner', pending: true, pendingHash: 'abc123', source: 'live', live: true, minutesLate: 0 };
/** The manual path that has always existed: logged with no AI read at all. */
const MANUAL_META = { name: 'Dinner', source: 'manual', live: false, minutesLate: 0 };
const ZERO = { protein: 0, kcal: 0, carbs: 0, fat: 0 };

describe('a pending meal scores exactly like a manual meal', () => {
  it('produces identical components and score', () => {
    freshDay();
    dayLogMeal(null, 'dinner', ZERO, { ...PENDING_META });
    const pendingComponents = JSON.stringify(computeComponents(DAY));
    const pendingScore = scoreFor(DAY);

    freshDay();
    dayLogMeal(null, 'dinner', ZERO, { ...MANUAL_META });
    const manualComponents = JSON.stringify(computeComponents(DAY));
    const manualScore = scoreFor(DAY);

    expect(pendingComponents).toEqual(manualComponents);
    expect(pendingScore).toEqual(manualScore);
  });

  it('counts as a logged meal (timing credit) but contributes no macros', () => {
    freshDay();
    dayLogMeal(null, 'dinner', ZERO, { ...PENDING_META });
    expect(mealScored(DAY, 'dinner')).toBe(true);          // the slot IS logged
    expect(DAY.slotMacros.dinner.protein || 0).toBe(0);     // …and claims no protein
    expect(DAY.slotMacros.dinner.quality).toBeUndefined();  // …and no quality
  });

  it('the pending markers do not leak into the score', () => {
    // Same meal, once with the display-only markers and once without. If any scoring path ever
    // starts reading `pending`, these diverge and this test fails.
    freshDay();
    dayLogMeal(null, 'lunch', { protein: 40, kcal: 600, carbs: 50, fat: 20 }, { name: 'Lunch', quality: 80, pending: true, pendingHash: 'x' });
    const withMarkers = scoreFor(DAY);
    freshDay();
    dayLogMeal(null, 'lunch', { protein: 40, kcal: 600, carbs: 50, fat: 20 }, { name: 'Lunch', quality: 80 });
    const withoutMarkers = scoreFor(DAY);
    expect(withMarkers).toEqual(withoutMarkers);
  });

  it('a dup-flagged pending meal still never scores', () => {
    freshDay();
    dayLogMeal(null, 'dinner', ZERO, { ...PENDING_META });
    DAY.slotMacros.dinner = { ...DAY.slotMacros.dinner, flagged: 'dup' };
    expect(mealScored(DAY, 'dinner')).toBe(false);
  });
});

describe('applying the analysis raises the score', () => {
  it('macros landing on a pending slot increases the meal score', () => {
    freshDay();
    dayLogMeal(null, 'dinner', ZERO, { ...PENDING_META });
    const before = scoreFor(DAY);

    // What applyAnalysisResult does to the slot: drop the pending markers, land the real numbers.
    const { pending, pendingHash, ...keep } = DAY.slotMacros.dinner;
    DAY.slotMacros.dinner = { ...keep, protein: 45, kcal: 700, carbs: 60, fat: 22, quality: 88 };
    const after = scoreFor(DAY);

    expect(after).toBeGreaterThan(before);
    expect(DAY.slotMacros.dinner.pending).toBeUndefined();
  });
});
