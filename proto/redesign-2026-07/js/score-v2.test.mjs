import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFor, computeComponents, checkinReal, PROFILE_WEIGHTS, evidenceCeiling, hasNutritionEvidence } from './day.js';

/* A day fixture. Protein target 180, four classic slots, all on time. */
function day(over = {}) {
  return {
    date: '2026-08-20',
    meals: {}, mealLoggedAt: {}, slotMacros: {}, quickAdded: [false, false, false],
    proteinTarget: 180, calTarget: 3200, scoringProfile: 'athlete',
    dailyCommitment: null, ci: {}, ciConfig: {}, ciSubmitted: false, ciLast: null,
    ...over,
  };
}
/* All four meals on time with `p` total grams of protein spread evenly. */
function fed(p) {
  const keys = ['breakfast', 'lunch', 'snack', 'dinner'];
  const meals = {}, at = { breakfast: 500, lunch: 800, snack: 1000, dinner: 1200 }, sm = {};
  for (const k of keys) { meals[k] = true; sm[k] = { protein: p / 4 }; }
  return { meals, mealLoggedAt: at, slotMacros: sm };
}
const GOOD_CI = {
  ciSubmitted: true,
  ciConfig: { energy: 1, recovery: 1, sleep: 1, confidence: 1, soreness: 1, motivation: 1 },
  ci: { energy: 9, recovery: 9, sleep: 8, confidence: 9, soreness: 2, motivation: 9 },
};

test('weights are the v2 mix and commitment carries none of it', () => {
  assert.deepEqual(PROFILE_WEIGHTS.athlete, { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
  assert.deepEqual(PROFILE_WEIGHTS.general, { nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 });
  assert.deepEqual(PROFILE_WEIGHTS.gain, { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
});

test('a day with nothing logged and no check-in scores exactly 0', () => {
  assert.equal(scoreFor(day()), 0);
});

test('the daily commitment moves the score by nothing at all', () => {
  const base = day({ ...fed(180), ...GOOD_CI });
  const yes = scoreFor({ ...base, dailyCommitment: 'yes' });
  const no = scoreFor({ ...base, dailyCommitment: 'no' });
  const unanswered = scoreFor({ ...base, dailyCommitment: null });
  assert.equal(yes, no, 'an honest "no" must cost nothing');
  assert.equal(yes, unanswered);
});

test('a check-in from earlier in the week no longer counts today', () => {
  const carried = day({ ...fed(180), ciLast: { date: '2026-08-18', recovery: 90 } });
  assert.equal(checkinReal(carried), false, 'only tonight counts');
  const c = computeComponents(carried);
  assert.equal(c.checkin, 0);
  assert.equal(c.recoveryContribution, 0, 'recovery must not carry either');
});

test('perfect food with no check-in caps at 76, not 100', () => {
  assert.equal(scoreFor(day({ ...fed(180) })), 76);
});

test('effort outranks attendance: full food beats half food plus a check-in', () => {
  const allFoodNoCheckin = scoreFor(day({ ...fed(162) }));            // 90% protein, 4 meals
  const halfFoodGoodCheckin = scoreFor(day({
    meals: { breakfast: true, lunch: true },
    mealLoggedAt: { breakfast: 500, lunch: 800 },
    slotMacros: { breakfast: { protein: 45 }, lunch: { protein: 45 } },
    ...GOOD_CI,
  }));
  assert.ok(allFoodNoCheckin > halfFoodGoodCheckin,
    `${allFoodNoCheckin} must beat ${halfFoodGoodCheckin} — the athlete who ate on standard did more`);
});

test('submitting the check-in is worth 12 guaranteed, before any answer quality', () => {
  const withoutCi = scoreFor(day({ ...fed(180) }));
  const withCi = scoreFor(day({ ...fed(180), ...GOOD_CI }));
  assert.ok(withCi - withoutCi >= 12, `check-in added only ${withCi - withoutCi}`);
});

/* --------------------------------------------------------------------------------------------
 * The write-path invariant (Task 2 review, 2026-08-09): evidenceCeiling() runs on the WRITE path
 * (the days upsert) and must never clamp a score BELOW what scoreFor() honestly computed — that
 * is silent corruption of the stored row against the athlete's own screen. Two bugs broke this:
 * `evidenceCeiling` didn't count `quickAdded` as nutrition evidence (a logged quick-add day got
 * clamped to 0), and Intuitive's awareness credit unlocked off a check-in alone (a food-free day
 * could out-earn its own ceiling). Both are fixed by giving `evidenceCeiling` and the awareness
 * `engaged` gate the SAME `hasNutritionEvidence` check. These tests prove the invariant directly
 * instead of trusting the two symptom-level fixes above.
 * ------------------------------------------------------------------------------------------- */

test('a quick-add-only day IS nutrition evidence, unlocks ceiling headroom, and is not clamped to 0', () => {
  const d = day({ quickAdded: [true, true, true] });
  assert.equal(hasNutritionEvidence(d), true, 'a quick-add is nutrition evidence, exactly like a plated meal');
  assert.ok(evidenceCeiling(d) > 0, `evidenceCeiling(${JSON.stringify(d.quickAdded)}) must unlock nutrition headroom`);
  assert.ok(scoreFor(d) > 0, 'the athlete logged food — the stored score must not silently be 0');
});

test('Intuitive + a check-in + no food earns zero nutrition credit — awareness never substitutes for food', () => {
  const d = day({ ...GOOD_CI, planStyle: 'intuitive' });
  assert.equal(hasNutritionEvidence(d), false);
  const c = computeComponents(d);
  assert.equal(c.nutrition, 0, 'no plate and no quick-add: awareness must not manufacture nutrition credit');
});

test('the write-path invariant: scoreFor(day) never exceeds evidenceCeiling(day)', () => {
  const PROFILES = ['athlete', 'general', 'gain'];
  const STYLES = ['structured', 'guided', 'intuitive'];
  const SHAPES = {
    empty: () => day(),
    quickAddOnly: () => day({ quickAdded: [true, true, true] }),
    checkinOnly: () => day({ ...GOOD_CI }),
    intuitiveCheckinOnlyNoFood: () => day({ ...GOOD_CI, planStyle: 'intuitive' }),
    fullDay: () => day({ ...fed(180), ...GOOD_CI, dailyCommitment: 'yes' }),
  };
  for (const profile of PROFILES) {
    for (const style of STYLES) {
      for (const [label, make] of Object.entries(SHAPES)) {
        const d = make();
        d.scoringProfile = profile;
        if (d.planStyle == null) d.planStyle = style; // explicit shapes (intuitive) keep their own stamp
        const score = scoreFor(d);
        const ceiling = evidenceCeiling(d);
        assert.ok(score <= ceiling,
          `${style}/${profile}/${label}: stored score ${score} exceeds evidence ceiling ${ceiling} — this is the exact server-side corruption Task 4's trigger would freeze in`);
      }
    }
  }
});
