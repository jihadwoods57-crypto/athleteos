/* The coach-assigned morning as a scoring component.
 *
 * The whole point of this file is the FIRST block: the morning slot is threaded through every
 * weight table and every weighted sum in the engine, and at WAKEUP_SHIFT = 0 it changes nobody's
 * number by a single point. That is what makes turning it on a one-constant change instead of a
 * re-audit of four independent weighted sums.
 *
 * The second block proves the mix is well formed at the value it will be turned on to, so the
 * day it flips there is nothing left to discover.
 *
 * Run: node --test proto/redesign-2026-07/js/wakeup-score.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFor, computeComponents, weightsForDay, wakeupParts, evidenceCeiling, clampedScore } from './day.js';
import { PROFILE_WEIGHTS, WEIGHT_CAPS, WAKEUP_SHIFT, weightsForWakeupDay, weightsWithinCaps } from './plan-style.js';

/* The SAME fixture shape score-v2.test.mjs uses, on purpose: a plate that does not carry kcal is
   not nutrition evidence in v3, and a fixture that quietly fails the evidence gate would make
   every ceiling assertion below pass for the wrong reason. */
const day = (over = {}) => ({
  date: '2026-09-11',
  meals: {}, mealLoggedAt: {}, slotMacros: {}, quickAdded: [false, false, false],
  proteinTarget: 180, calTarget: 3200, scoringProfile: 'athlete',
  dailyCommitment: null, ci: {}, ciConfig: {}, ciSubmitted: false, ciLast: null,
  ...over,
});
/* All four meals on time with `p` total grams of protein spread evenly. */
function fed(p) {
  const keys = ['breakfast', 'lunch', 'snack', 'dinner'];
  const meals = {}, at = { breakfast: 500, lunch: 800, snack: 1000, dinner: 1200 }, sm = {};
  for (const k of keys) { meals[k] = true; sm[k] = { protein: p / 4, kcal: 800 }; }
  return { meals, mealLoggedAt: at, slotMacros: sm };
}
const CHECKED_IN = {
  ciSubmitted: true,
  ciConfig: { energy: 1, recovery: 1, sleep: 1, confidence: 1, soreness: 1, motivation: 1 },
  ci: { energy: 9, recovery: 9, sleep: 8, confidence: 9, soreness: 2, motivation: 9 },
};
const woke = (verdict, lateMin = 0) => ({ wakeup: { assigned: true, verdict, lateMin } });

/* ------------------------------------------------------------------ inert at rest */

test('the morning is wired into every weight table', () => {
  for (const [name, w] of Object.entries(PROFILE_WEIGHTS)) {
    assert.equal(typeof w.wakeup, 'number', `${name} has no wakeup slot`);
  }
  assert.equal(typeof WEIGHT_CAPS.wakeup, 'number', 'the caps table has no wakeup ceiling');
});

test('a day with NO wake-up scores exactly what it always did', () => {
  // The population this has to hold for is everybody: every athlete whose coach has not set a
  // wake-up, on every day, forever. Their mix is untouched and their ceiling is untouched.
  assert.deepEqual(weightsForDay(day()), PROFILE_WEIGHTS.athlete);
  assert.equal(scoreFor(day({ ...fed(180), ...CHECKED_IN })), 100);
  assert.equal(scoreFor(day({ ...fed(180) })), 82, 'perfect food alone is still 82');
  assert.equal(evidenceCeiling(day({ ...fed(180), ...CHECKED_IN })), 100);
  assert.equal(evidenceCeiling(day({ ...fed(180) })), 82);
  assert.equal(evidenceCeiling(day({ ...CHECKED_IN })), 18);
});

test('an undecided morning costs nothing, because the clock has not finished with it', () => {
  // Pending, under review and excused all leave the denominator. An athlete looking at their
  // score at 6:05 for a roll call that closes at 6:30 must not see it already docked.
  const base = day({ ...fed(180), ...CHECKED_IN });
  for (const v of ['pending', 'review', 'excused', 'something_new_the_server_added']) {
    assert.equal(scoreFor({ ...base, ...woke(v) }), 100, `verdict ${v} must not cost a point yet`);
    assert.deepEqual(weightsForDay({ ...base, ...woke(v) }), PROFILE_WEIGHTS.athlete);
  }
});

test('the morning is worth 8, and it comes out of the nightly check-in, never out of food', () => {
  const perfect = day({ ...fed(180), ...CHECKED_IN });
  assert.equal(scoreFor(perfect), 100, 'the day with no morning is the baseline');
  assert.equal(scoreFor({ ...perfect, ...woke('on_standard') }), 100, 'answered on time is still 100');
  assert.equal(scoreFor({ ...perfect, ...woke('late', 24) }), 96, 'late counts half: 4 of the 8');
  assert.equal(scoreFor({ ...perfect, ...woke('missed') }), 92, 'a missed morning costs the full 8');
  // Food is untouched in every one of those cases.
  const foodOnly = day(fed(180));
  for (const v of ['on_standard', 'late', 'missed']) {
    const c = computeComponents({ ...foodOnly, ...woke(v) });
    assert.equal(c.nutrition, computeComponents(foodOnly).nutrition);
  }
});

test('the morning alone can carry a day, and the ceiling lets it', () => {
  // An athlete who answered the roll call and logged nothing else has earned 8 points of
  // evidence. A ceiling that could not see the morning would clamp them straight back to 0.
  const only = day(woke('on_standard'));
  assert.equal(scoreFor(only), 8);
  assert.equal(evidenceCeiling(only), 8);
  assert.equal(clampedScore(only), 8, 'the ceiling must never erase a morning that was answered');
});

test('a missed morning is bounded at 92, the same number the engine computes for it', () => {
  // The ceiling asymmetry: being ASSIGNED shrinks the check-in slot; only being ANSWERED grants
  // the morning its 8. If those two ever come apart, an honest score gets clamped.
  const missed = { ...day({ ...fed(180), ...CHECKED_IN }), ...woke('missed') };
  assert.equal(scoreFor(missed), 92);
  assert.equal(evidenceCeiling(missed), 92);
  assert.equal(clampedScore(missed), 92);
});

/* ------------------------------------------------------------------ the verdict reader */

test('the reader never invents a verdict, it only reads the one the server stamped', () => {
  assert.deepEqual(wakeupParts(day()), { score: 0, assigned: false }, 'no morning assigned');
  assert.deepEqual(wakeupParts(day(woke('on_standard'))), { score: 100, assigned: true });
  assert.deepEqual(wakeupParts(day(woke('late', 24))), { score: 50, assigned: true },
    'on time counts full, late counts half, the same rule meals follow');
  assert.deepEqual(wakeupParts(day(woke('missed'))), { score: 0, assigned: true });
});

test('an excused morning leaves the denominator instead of scoring zero', () => {
  const excused = wakeupParts(day(woke('excused')));
  assert.equal(excused.assigned, false,
    'a coach who excused an athlete must not then dock them for the morning they were told to skip');
  // And because it is not assigned, the day is weighted as an ordinary day.
  assert.deepEqual(weightsForDay(day(woke('excused'))), PROFILE_WEIGHTS.athlete);
});

test('a malformed or half-written wakeup blob is treated as no morning, never as a throw', () => {
  for (const w of [null, undefined, {}, { assigned: false, verdict: 'on_standard' }, { assigned: true }]) {
    assert.doesNotThrow(() => wakeupParts(day({ wakeup: w })));
  }
  assert.equal(wakeupParts(day({ wakeup: { assigned: false, verdict: 'on_standard' } })).assigned, false,
    'a verdict without an assignment is not an assignment');
});

test('computeComponents reports the morning and whether it counts', () => {
  const c = computeComponents(day({ ...fed(180), ...woke('late', 12) }));
  assert.equal(c.wakeup, 50);
  assert.equal(c.wakeupAssigned, true);
  assert.equal(computeComponents(day(fed(180))).wakeupAssigned, false);
});

/* ------------------------------------------------------------------ ready for the flip */

test('the day mix is chosen per day, and only an assigned morning changes it', () => {
  assert.deepEqual(weightsForDay(day()), PROFILE_WEIGHTS.athlete);
  assert.deepEqual(weightsForDay(day(woke('on_standard'))), weightsForWakeupDay('athlete'));
});

test('the wake-up mix is a fresh object, and the shared profile row is frozen', () => {
  const before = { ...PROFILE_WEIGHTS.athlete };
  const w = weightsForWakeupDay('athlete');
  w.nutrition = 0.5; // careless, and it must not re-weight the season
  assert.deepEqual(PROFILE_WEIGHTS.athlete, before);
  // weightsFor hands the SAME row to every caller in the app by identity, so the row itself has
  // to refuse the write rather than accept it quietly.
  assert.ok(Object.isFrozen(PROFILE_WEIGHTS.athlete));
  assert.throws(() => { PROFILE_WEIGHTS.athlete.nutrition = 0.5; }, TypeError);
});

test('the mix is legal at every shift the morning could be turned on to', () => {
  // Proves the flip is safe before it happens: at 0.08 the mix is nutrition .82, wakeup .08,
  // recovery .05, checkin .05. Food untouched, the morning paid for out of the nightly 18.
  //
  // WEIGHT_CAPS.wakeup IS the shift, so this cannot lean on weightsWithinCaps for a shift the
  // build is not currently set to. It checks the same three things by hand instead.
  for (const shift of [0, 0.02, 0.04, 0.06, 0.08]) {
    for (const p of ['athlete', 'general', 'gain']) {
      const base = PROFILE_WEIGHTS[p];
      const half = shift / 2;
      const w = shift === 0 ? { ...base }
        : { ...base, recovery: base.recovery - half, checkin: base.checkin - half, wakeup: shift };
      const sum = w.nutrition + w.recovery + w.commitment + w.checkin + w.wakeup;
      assert.ok(Math.abs(sum - 1) < 1e-9, `${p} at shift ${shift} sums to ${sum}, not 1`);
      assert.equal(w.nutrition, 0.82, 'food must never pay for the morning');
      for (const k of ['nutrition', 'recovery', 'commitment', 'checkin']) {
        assert.ok(w[k] <= WEIGHT_CAPS[k] + 1e-9, `${p}.${k} at shift ${shift} breaches its cap`);
      }
      assert.ok(w.recovery >= 0 && w.checkin >= 0, 'the shift can never overdraw the check-in');
    }
  }
});

test('the build the engine is actually set to is within its own caps', () => {
  for (const p of ['athlete', 'general', 'gain']) {
    assert.ok(weightsWithinCaps(PROFILE_WEIGHTS[p]), `${p} ordinary-day mix is illegal`);
    assert.ok(weightsWithinCaps(weightsForWakeupDay(p)), `${p} wake-up-day mix is illegal`);
  }
  assert.equal(WEIGHT_CAPS.wakeup, WAKEUP_SHIFT,
    'the cap must BE the shift, or the server ceiling clamps every wake-up day the moment it is on');
});

test('the shift can only be paid for out of the check-in, never out of food', () => {
  const w = weightsForWakeupDay('athlete');
  const base = PROFILE_WEIGHTS.athlete;
  assert.equal(w.nutrition, base.nutrition);
  assert.ok(Math.abs((w.recovery + w.checkin + w.wakeup) - (base.recovery + base.checkin)) < 1e-9,
    'the morning plus the nightly check-in must still add up to the same 18');
});
