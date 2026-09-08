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

for (const [name, src] of [['trust.js mealView', TRUST_SRC], ['coach.js coachMeal', COACH_SRC]]) {
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

test('trust.js mealView names the dash when a shown figure is absent', () => {
  assert.match(TRUST_SRC, /A dash means we do not have that number for this meal\. It is not a zero\./);
  // The note rides the same per-figure gates as the cells: only figures actually shown count.
  assert.match(TRUST_SRC, /const someMissing = shown\.some\(\(v\) => v == null\);/);
});

test('coach.js coachMeal names the dash on a partial read', () => {
  assert.match(COACH_SRC, /A dash means the photo did not give us that number, not a zero\./);
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
