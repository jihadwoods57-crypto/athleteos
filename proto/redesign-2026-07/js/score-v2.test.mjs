import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFor, computeComponents, checkinReal, PROFILE_WEIGHTS, evidenceCeiling, hasNutritionEvidence,
  setDayStandard,
} from './day.js';
import { STD_SLOT_MAP } from './requirements.js';

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

/* --------------------------------------------------------------------------------------------
 * Round 2 (re-review, 2026-08-09): a 400k-case fuzz against the real engine found the shared
 * `hasNutritionEvidence` gate still had two ways to disagree with the actual scoring path:
 *  (a) it scanned the hardcoded classic MEAL_KEYS, not scoredSlotKeys(std) — a 5-/6-meal coach
 *      standard's `meal-5`/`meal-6` slots (STD_SLOT_MAP, requirements.js) could score real
 *      nutrition credit while the gate still saw nothing, erasing the whole day to a ceiling of 0.
 *  (b) it counted any non-empty `slotMacros`, including a dup-flagged (photo-reuse) plate — the
 *      0062 photo-hash wall exists specifically so a reused photo scores nothing; the old gate
 *      handed it nutrition credit anyway.
 * Both are now one thing: hasNutritionEvidence(day, std) routes every slot through mealScored
 * (excludes dup) across scoredSlotKeys(std) (honors the standard). These tests pin the two
 * counterexamples the fuzzer found, then sweep the general invariant across coach standards too.
 * ------------------------------------------------------------------------------------------- */

test('a dup-flagged plate is not nutrition evidence — the photo-reuse wall still walls', () => {
  const d = day({
    meals: { breakfast: true },
    slotMacros: { breakfast: { protein: 45, flagged: 'dup' } },
    planStyle: 'intuitive',
  });
  assert.equal(hasNutritionEvidence(d), false, 'a dup-flagged slot must not count as evidence');
  const c = computeComponents(d);
  assert.equal(c.nutrition, 0, 'reusing a photo must buy zero nutrition credit, not a third of it');
  assert.equal(evidenceCeiling(d), 0, 'no real evidence on the day → no ceiling headroom');
});

test('a 6-meal coach standard: meal-5/meal-6 alone are real evidence, not an erased score', () => {
  setDayStandard({ mealsRequired: 6, slots: STD_SLOT_MAP[6] });
  try {
    const d = day({ meals: { 'meal-5': true, 'meal-6': true }, scoringProfile: 'general', planStyle: 'guided' });
    assert.equal(hasNutritionEvidence(d), true, 'meal-5/meal-6 must count under a 6-meal standard');
    assert.ok(evidenceCeiling(d) > 0, 'the ceiling must not erase a real 6-meal-standard day to 0');
    assert.ok(scoreFor(d) <= evidenceCeiling(d));
  } finally {
    setDayStandard(null); // never leak this module's STD into another test file
  }
});

test('the write-path invariant: scoreFor(day) never exceeds evidenceCeiling(day), across coach standards', () => {
  const PROFILES = ['athlete', 'general', 'gain'];
  const STYLES = ['structured', 'guided', 'intuitive'];
  const STANDARDS = [
    { label: 'classic-4', std: null },
    { label: '5-meal', std: { mealsRequired: 5, slots: STD_SLOT_MAP[5] } },
    { label: '6-meal', std: { mealsRequired: 6, slots: STD_SLOT_MAP[6] } },
  ];
  let cases = 0;
  try {
    for (const { label: stdLabel, std } of STANDARDS) {
      setDayStandard(std);
      // The slots beyond the classic four (meal-5 [+ meal-6]) — the exact keys a hardcoded
      // MEAL_KEYS check cannot see. Empty for the classic-4 standard.
      const extraSlots = std ? std.slots.slice(4) : [];
      const SHAPES = {
        empty: () => day(),
        quickAddOnly: () => day({ quickAdded: [true, true, true] }),
        checkinOnly: () => day({ ...GOOD_CI }),
        intuitiveCheckinOnlyNoFood: () => day({ ...GOOD_CI, planStyle: 'intuitive' }),
        fullDay: () => day({ ...fed(180), ...GOOD_CI, dailyCommitment: 'yes' }),
        dupFlaggedOnly: () => day({
          meals: { breakfast: true },
          slotMacros: { breakfast: { protein: 45, flagged: 'dup' } },
        }),
        ...(extraSlots.length ? {
          // The reviewer's worst measured case: only the standard's NEW slots logged, nothing else.
          extraSlotsOnly: () => day({ meals: Object.fromEntries(extraSlots.map((k) => [k, true])) }),
        } : {}),
      };
      for (const profile of PROFILES) {
        for (const style of STYLES) {
          for (const [label, make] of Object.entries(SHAPES)) {
            const d = make();
            d.scoringProfile = profile;
            if (d.planStyle == null) d.planStyle = style; // explicit shapes (intuitive) keep their own stamp
            const score = scoreFor(d, std);
            const ceiling = evidenceCeiling(d, std);
            cases++;
            assert.ok(score <= ceiling,
              `${stdLabel}/${style}/${profile}/${label}: stored score ${score} exceeds evidence ceiling ${ceiling} — this is the exact server-side corruption Task 4's trigger would freeze in`);
          }
        }
      }
    }
  } finally {
    setDayStandard(null); // never leak module STD state into other test files
  }
  // 3 profiles x 3 styles x (6 shapes on classic-4 + 7 shapes each on 5-meal and 6-meal) = 9 x 20 = 180
  assert.equal(cases, 180, `expected a real sweep (180 cases), only ran ${cases}`);
});
