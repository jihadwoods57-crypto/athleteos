// Phase 2: the coach-assigned Recovery Standard, as its own scoring slot.
//
// THE SLOT IS WORTH 0 TODAY AND THAT IS THE FEATURE, exactly as WAKEUP_SHIFT was at 0: it exists
// everywhere, flows through every sum and cap and test, and changes nobody's score by a point.
// These tests pin both halves: the ladder is right for when it is turned on, and turning it on is
// the ONLY thing that can change a score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryStandardParts, weightsForDay, scoreFor, computeComponents } from './day.js';
import { SLEEP_SHIFT, WAKEUP_SHIFT, NIGHT_SHIFT, weightsForAssigned, weightsWithinCaps } from './plan-style.js';

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

test('the standard is LIVE, and an unassigned day is untouched by it', () => {
  // Turned on 2026-09-18 with all three: shared night budget, server ceiling (0234), cutover
  // argument (none needed, no engine before today writes checkin.sleepStandard).
  assert.equal(SLEEP_SHIFT, NIGHT_SHIFT, 'sleep carries the whole night budget when nothing shares it');
  const plain = day({ ciSubmitted: true, ci: { sleep: 8 }, ciConfig: { sleep: true } });
  const before = scoreFor(plain);
  // An athlete whose coach set no standard scores exactly as before, which is most of a roster.
  // The mix is the UNTOUCHED frozen profile row, so it carries no sleep key at all; absent reads
  // as 0 in weightsWithinCaps and in scoreFor, and that is the contract rather than an oversight.
  assert.equal(weightsForDay(plain).sleep || 0, 0);
  assert.equal(scoreFor(plain), before);
  // A standard with no reading also cannot move it: a ring on a charger is not evidence.
  const noReading = day({ ...plain, sleepStandard: STD });
  assert.equal(scoreFor(noReading), before, 'an unread standard moved a score');
});

test('a met standard pays, and a missed one costs, once it is assigned', () => {
  const base = { ciSubmitted: true, ci: { sleep: 8 }, ciConfig: { sleep: true } };
  const met = scoreFor(day({ ...base, sleepStandard: STD, sleepHours: 8 }));
  const missed = scoreFor(day({ ...base, sleepStandard: STD, sleepHours: 4 }));
  assert.ok(met > missed, 'meeting the standard scored no better than missing it');
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

test('ONE NIGHT, ONE BUDGET: a second way of watching it never costs the athlete more', () => {
  const wakeOnly = weightsForAssigned('athlete', { wakeup: true });
  const sleepOnly = weightsForAssigned('athlete', { sleep: true });
  const both = weightsForAssigned('athlete', { wakeup: true, sleep: true });

  // Whichever is assigned, the check-in gives up the SAME amount. This is the decision: letting
  // each take its own 0.08 would leave the two check-in slots 0.02 between them, and the check-in
  // is the one component every athlete can earn with no hardware at all.
  const given = (w) => 0.18 - (w.recovery + w.checkin);
  for (const w of [wakeOnly, sleepOnly, both]) {
    assert.ok(Math.abs(given(w) - NIGHT_SHIFT) < 1e-9, 'the night took more or less than its budget');
  }
  // Alone each carries the whole night; together they split it.
  assert.equal(wakeOnly.wakeup, NIGHT_SHIFT);
  assert.equal(sleepOnly.sleep, NIGHT_SHIFT);
  assert.ok(Math.abs(both.wakeup - NIGHT_SHIFT / 2) < 1e-9);
  assert.ok(Math.abs(both.sleep - NIGHT_SHIFT / 2) < 1e-9);
  // And the check-in never falls below what a wake-up day already costs it today.
  assert.ok(both.checkin >= 0.05 - 1e-9 && both.recovery >= 0.05 - 1e-9);
});
