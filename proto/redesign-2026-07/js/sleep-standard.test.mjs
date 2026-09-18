// Phase 2: the coach-assigned Recovery Standard, as its own scoring slot.
//
// THE SLOT IS WORTH 0 TODAY AND THAT IS THE FEATURE, exactly as WAKEUP_SHIFT was at 0: it exists
// everywhere, flows through every sum and cap and test, and changes nobody's score by a point.
// These tests pin both halves: the ladder is right for when it is turned on, and turning it on is
// the ONLY thing that can change a score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryStandardParts, weightsForDay, scoreFor, computeComponents } from './day.js';
import { SLEEP_SHIFT, WAKEUP_SHIFT, weightsForAssigned, weightsWithinCaps } from './plan-style.js';

const STD = { targetHours: 7.5, minHours: 7 };
const day = (over = {}) => ({
  date: '2026-09-18', meals: {}, ci: {}, ciConfig: {}, scoringProfile: 'athlete', ...over,
});

test('no standard, or no reading, leaves the denominator rather than scoring zero', () => {
  // A ring on a charger is not evidence that an athlete slept badly.
  assert.deepEqual(recoveryStandardParts(day()), { score: 0, assigned: false });
  assert.deepEqual(recoveryStandardParts(day({ sleepStandard: STD })), { score: 0, assigned: false });
  assert.deepEqual(recoveryStandardParts(day({ sleepStandard: STD, sleepHours: 0 })), { score: 0, assigned: false });
  assert.deepEqual(recoveryStandardParts(day({ sleepHours: 7.6 })), { score: 0, assigned: false });
});

test('the ladder is graduated, with no cliff at either end', () => {
  const at = (h) => recoveryStandardParts(day({ sleepStandard: STD, sleepHours: h }));
  assert.deepEqual(at(8.0), { score: 100, assigned: true });   // over target
  assert.deepEqual(at(7.5), { score: 100, assigned: true });   // exactly target
  assert.deepEqual(at(7.1), { score: 85, assigned: true });    // over minimum
  assert.deepEqual(at(6.5), { score: 60, assigned: true });    // within an hour of minimum
  assert.deepEqual(at(4.0), { score: 25, assigned: true });    // well under, but he did sleep
  // A twenty-minute difference must not decide the whole slot.
  assert.notEqual(at(7.4).score, 0);
});

test('a standard with no explicit minimum falls back to the target', () => {
  const only = { targetHours: 8 };
  assert.equal(recoveryStandardParts(day({ sleepStandard: only, sleepHours: 8 })).score, 100);
  assert.equal(recoveryStandardParts(day({ sleepStandard: only, sleepHours: 7.5 })).score, 60);
});

test('AT SHIFT 0 AN ASSIGNED STANDARD CANNOT MOVE A SCORE', () => {
  // The whole safety argument for landing this while 1.0 is in review.
  const plain = day({ ciSubmitted: true, ci: { sleep: 8 }, ciConfig: { sleep: true } });
  const withStd = day({ ciSubmitted: true, ci: { sleep: 8 }, ciConfig: { sleep: true },
    sleepStandard: STD, sleepHours: 4.0 });
  assert.equal(SLEEP_SHIFT, 0, 'turning this on is a founder decision with a migration behind it');
  assert.equal(scoreFor(withStd), scoreFor(plain),
    'a catastrophic night changed the score while the shift is 0');
});

test('the slot exists in the components and in the mix, even at 0', () => {
  const c = computeComponents(day({ sleepStandard: STD, sleepHours: 4 }));
  assert.equal(c.sleepAssigned, true);
  assert.equal(c.sleep, 25);
  const w = weightsForDay(day({ sleepStandard: STD, sleepHours: 4 }));
  assert.equal(w.sleep, SLEEP_SHIFT);
});

test('every assignment combination still sums to 1 and stays within caps', () => {
  for (const wakeup of [false, true]) {
    for (const sleep of [false, true]) {
      for (const profile of ['athlete', 'general', 'gain']) {
        const w = weightsForAssigned(profile, { wakeup, sleep });
        const sum = w.nutrition + w.recovery + w.commitment + w.checkin + (w.wakeup || 0) + (w.sleep || 0);
        assert.ok(Math.abs(sum - 1) < 1e-9, `mix does not sum to 1: ${profile} ${wakeup} ${sleep}`);
        assert.ok(weightsWithinCaps(w), `mix breaches a cap: ${profile} ${wakeup} ${sleep}`);
        // Nutrition's 82 is never the thing that pays for a coach-assigned component.
        assert.equal(w.nutrition, 0.82);
      }
    }
  }
});

test('both shifts are paid out of the SAME 18, which is the decision behind raising either', () => {
  const both = weightsForAssigned('athlete', { wakeup: true, sleep: true });
  const taken = WAKEUP_SHIFT + SLEEP_SHIFT;
  assert.ok(Math.abs((both.recovery + both.checkin) - (0.18 - taken)) < 1e-9,
    'the two check-in slots did not give up exactly the two shifts');
});
