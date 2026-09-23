/* null and 0 are different facts on every macro readout (2026-09-08).
 *
 * A macro the read never returned is ABSENT, not zero. `meal.carbs || 0` printed "0g carbs ·
 * 0g fat" beside 52g protein and 780 calories — a plate that cannot exist, asserted with full
 * confidence. The 8 AM fix cured the professional's meal screen (coach.js coachMeal) and the
 * shared quality line (meal-intel qualityReason); the 1 PM audit found the athlete's own
 * past-meal view (trust.js mealView — the THIRD renderer the gotcha list warns about) still
 * lying, one tap off a notification, on the athlete's own record. This file pins all of it:
 * real calls for the pure function, source regexes (in the manner of depill.test.mjs) for the
 * two renderers, so `|| 0` cannot quietly return to either.
 *
 * Run: node --test proto/redesign-2026-07/js/null-macro.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { qualityReason } from './meal-intel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* ---- the shared quality line: balance is a claim about three numbers ---- */

test('all three macros known: the balance verdict still speaks', () => {
  const s = qualityReason({ protein: 40, carbs: 60, fat: 20 }, 6, []);
  assert.equal(s, 'Protein, carbs, and fat are in balance on this plate.');
});

test('a measured zero is a known number, not an absence', () => {
  // fat: 0 was measured — three knowns, so the judgment runs (and flags what a zero-fat,
  // carb-heavy plate actually is), rather than refusing to judge.
  const s = qualityReason({ protein: 10, carbs: 80, fat: 0 }, 6, []);
  assert.ok(s.length > 0);
  assert.doesNotMatch(s, /Only part of this plate/);
});

test('THE LIE, pinned: protein alone must not be called a balanced plate', () => {
  const s = qualityReason({ protein: 52, carbs: null, fat: null }, null, []);
  assert.equal(s, 'Only part of this plate was read, so the balance is not judged.');
});

test('no macros at all: nothing to say, which is the empty string the callers expect', () => {
  assert.equal(qualityReason({ protein: null, carbs: null, fat: null }, null, []), '');
  assert.equal(qualityReason({}, null, []), '');
  assert.equal(qualityReason(null, null, []), '');
});

/* ---- the two macro-tile renderers: absent renders as the null glyph, never as 0 ---- */

const TRUST_SRC = read('screens', 'trust.js');
const COACH_SRC = read('screens', 'coach.js');

const MEAL_SRC = read('screens', 'meal.js');
// trust.js mealView renders through meal.js mealReadHtml since 2026-09-14 (a past meal wears
// today's design), so the tile rule is pinned there; trust.js is pinned to hand the nulls over.
// coach.js coachMeal renders through the same mealReadHtml since 2026-09-14 (the coach's meal
// screen is the athlete's); it is pinned below to hand the row over, not to draw tiles itself.
for (const [name, src] of [['meal.js mealReadHtml', MEAL_SRC]]) {
  test(`${name}: the mg helper renders null as the glyph and keeps a measured zero`, () => {
    // v == null (not falsy!): 0 must fall through to print as 0.
    assert.match(src, /const mg = \(v, unit\) => \(v == null \? '—'/);
  });
  test(`${name}: no macro tile coerces with || 0 any more`, () => {
    for (const k of ['protein', 'carbs', 'fat', 'kcal']) {
      assert.doesNotMatch(src, new RegExp(`class="mv">\\$\\{t?\\}?\\$?\\{?(?:meal|m)\\.${k} \\|\\| 0`),
        `${k} tile reads the value through mg(), not through || 0`);
    }
  });
}

test('the shared read card names the dash when a shown figure is absent', () => {
  assert.match(MEAL_SRC, /A dash means we do not have that number for this meal\. It is not a zero\./);
  // The note rides the same per-figure gates as the cells: only figures actually shown count.
  assert.match(MEAL_SRC, /const someMissing = shownFigures\.some\(\(v\) => v == null\);/);
  // And the tiles read the raw figures, never the coerced ones.
  assert.match(MEAL_SRC, /const raw = M\.macrosRaw \|\| M\.macros;/);
});

test('trust.js pastMealDetail keeps a null figure null for the tiles', () => {
  assert.match(TRUST_SRC, /const nz = \(v\) => \(v == null \? null : v\);/);
  assert.match(TRUST_SRC, /macrosRaw: \{ protein: nz\(m\.protein\), carbs: nz\(m\.carbs\), fat: nz\(m\.fat\), cals: nz\(m\.kcal\) \}/);
  assert.match(TRUST_SRC, /mealReadHtml\(M, \{ exec: null, past: true, dayTotals: pastDayTotalsThrough\(m\) \}\)/);
});

test('coach.js coachMeal draws the plate through the shared read card, with every figure shown', () => {
  assert.match(COACH_SRC, /const M = meal \? pastMealDetail\(meal\) : null;/, 'the row is mapped like a past plate (nulls kept in macrosRaw)');
  assert.match(COACH_SRC, /viewer: 'coach'/);
  assert.match(COACH_SRC, /planStyle: \{ showMacros: true, showCalories: true/, 'a professional sees every figure whatever their own style');
  assert.doesNotMatch(COACH_SRC, /class="macro-row/, 'no tiles of its own any more');
});

/* ---- the correction path: a null macro stays null THROUGH a pro correction ---- */

test('persistPro writes back null for a macro the source row never had', () => {
  // metaFromRow coerces null to 0 so the deterministic engines can do arithmetic; the write-back
  // must undo that, or a coach correcting only the protein persists carbs: 0 into the live meals
  // row — the fabricated zero then poisons every renderer, the fixed ones included.
  assert.match(COACH_SRC, /const keep = \(src, val\) => \(src == null \? null : val\);/);
  for (const k of ['protein', 'carbs', 'fat', 'kcal']) {
    assert.match(COACH_SRC, new RegExp(`${k}: keep\\(row\\.${k}, r\\.meta\\.${k}\\)`),
      `${k} write-back preserves the source row's null`);
  }
});

test('the correction announcement never quotes a number the row does not have', () => {
  assert.match(COACH_SRC, /row\.protein != null \? \[`~\$\{r\.meta\.protein\}g protein`\] : \[\]/);
  assert.match(COACH_SRC, /row\.kcal != null \? \[`~\$\{r\.meta\.kcal\} kcal`\] : \[\]/);
});

/* ---- the score and the chips (review pass 2026-09-23, A-B4): unknown is not zero there either ---- */
import { mealQualityScore, scoreReasons, scoreRubric, coachFocus } from './meal-intel.js';

test('a missing carbs or fat earns no "in range" chip and no points', () => {
  const macros = { protein: 52, carbs: null, fat: null };
  const labels = scoreReasons({ macros, fiber: 6, detected: [], minutesLate: 0 }).map((r) => r.label);
  assert.ok(!labels.some((l) => /^Fat|^Carb/.test(l)), labels.join(' | '));
  // No independent calories: protein has no energy to be a share of, so nothing macro is judged
  // and there is no honest quality score.
  assert.equal(mealQualityScore({ macros, fiber: 6, detected: [], minutesLate: 0 }), null);
  const rows = scoreRubric({ macros, fiber: 6, detected: [], minutesLate: 0 }).rows.map((r) => r.k);
  assert.ok(!rows.includes('Fat within range') && !rows.includes('Carbohydrate balance'));
  assert.doesNotMatch(JSON.stringify(scoreRubric({ macros: { protein: 52, carbs: null, fat: 10, kcal: 780 } }).rows), /nullg/);
});

test('with an independent calorie read, the known macros are judged and the score is re-weighted', () => {
  // 52g protein of 780 kcal = 27% (met). Fat 10g of 780 = 12% (met). Carbs unknown: left out.
  const macros = { protein: 52, carbs: null, fat: 10, kcal: 780 };
  const q = mealQualityScore({ macros, fiber: 6, detected: [], minutesLate: 0 });
  assert.equal(q, 100, 'every JUDGED component met is 100, not 85 (carbs missing) or 100 by accident');
  const labels = scoreReasons({ macros, fiber: 6, detected: [], minutesLate: 0 }).map((r) => r.label);
  assert.ok(!labels.some((l) => /^Carb/.test(l)));
  // A calorie figure derived from the known macros alone (4p + 9f) is not independent: no judgment.
  assert.equal(mealQualityScore({ macros: { protein: 52, carbs: null, fat: 10, kcal: 52 * 4 + 90 }, fiber: 6 }), null);
  // A miss still costs its share of the re-weighted maximum.
  const heavy = mealQualityScore({ macros: { protein: 10, carbs: null, fat: 40, kcal: 700 }, fiber: 6, minutesLate: 0 });
  assert.ok(heavy < 70, `protein 6% and fat 51% of 700 kcal read poorly (${heavy})`);
});

test('all three known: the score is unchanged by the re-weighting', () => {
  // protein 40*4=160, carbs 60*4=240, fat 20*9=180 -> 580; 28% protein met, 41% carbs met, 31% fat met.
  assert.equal(mealQualityScore({ macros: { protein: 40, carbs: 60, fat: 20 }, fiber: 6, detected: [], minutesLate: 0 }), 100);
  assert.equal(mealQualityScore({ macros: { protein: 40, carbs: 60, fat: 20 }, fiber: 0, detected: [], minutesLate: 90 }), 35 + 15 + 20 + 5 + 2);
});

test('coachFocus never ranks an unjudged macro', () => {
  const f = coachFocus({ macros: { protein: 52, carbs: null, fat: null, kcal: 780 }, fiber: 6, detected: [], minutesLate: 0 });
  assert.doesNotMatch(f, /leaner|carbs/);
});

test('the coach reads the athlete in the third person (review pass C-M8)', () => {
  assert.match(MEAL_SRC, /return `Good balance for \$\{whose\} goals`/);
  assert.doesNotMatch(MEAL_SRC, /'Good balance for your goals'/);
  assert.match(COACH_SRC, /athleteName: \(\(CD\.roster && CD\.roster\.rows\.find/);
});
