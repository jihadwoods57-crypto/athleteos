/* The "+N from this meal" credit on a meal revisit is NEUTRAL, never tier-tinted (2026-09-04).
 *
 * Why this is pinned: the revisit pill was tinted by tier(S.score) — "where the day stands" —
 * which read fine in the justLogged move bar, where the tinted day number sits right beside the
 * gain and owns the colour. Alone in its row, the tint landed on the credit itself: a 2-of-4 day
 * is under 60 by construction, so every on-time lunch's "+10" rendered in alarm red for the rest
 * of the day. A live day has no verdict yet (the .status-pill.inprog rule in screens.css), so the
 * credit claims no standing in either direction — no red alarm, and not the flat success-green an
 * earlier version wore (which told a 62 it was on standard; that fix stays fixed too).
 *
 * Regex over sources, in the manner of depill.test.mjs / composer-pill.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/score-credit.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const MEAL = read('screens', 'meal.js');
const HOME = read('screens', 'home.js');
const SCREENS_CSS = read('..', 'css', 'screens.css');

// The revisit block: from the mealScoreImpact call to the close of its template.
const revisitBlock = (() => {
  const m = MEAL.match(/const gain = S\.mealScoreImpact\(M\.slot\)[\s\S]*?from this meal[\s\S]*?<\/div>` : '';/);
  assert.ok(m, 'meal.js no longer renders the revisit credit via mealScoreImpact — update this test');
  return m[0];
})();

test('the revisit credit is neutral: class "gain n", nothing interpolated into the class', () => {
  assert.match(revisitBlock, /class="gain n"/);
  // The class attribute must be the literal "gain n" — no ${...} picking a colour at render
  // time. (Scoped to the attribute, not the block, so the rationale comment can mention tier().)
  assert.doesNotMatch(revisitBlock, /class="gain[^"]*\$\{/, 'the revisit credit must not borrow a computed colour');
});

test("Home's Recent Results card renders the same credit muted, never success-green", () => {
  const m = HOME.match(/Score credit<\/span><span class="v ([a-z]+)"/);
  assert.ok(m, "home.js no longer renders the Score credit metric — update this test");
  assert.equal(m[1], 'muted', 'the same fact must not wear a verdict on Home that the meal screen refuses');
});

test('the neutral treatment exists in CSS and uses quiet ink, not a status colour', () => {
  const rule = SCREENS_CSS.match(/\.mt-confirm \.score-line \.gain\.n\{([^}]*)\}/);
  assert.ok(rule, 'screens.css lost .mt-confirm .score-line .gain.n');
  assert.match(rule[1], /--text-2/);
  assert.doesNotMatch(rule[1], /--(green|red|amber|blue)-/, 'neutral means no status colour family');
});

test('the justLogged move bar still tints its gain by the destination tier', () => {
  // There the day number sits beside the gain and owns the colour — that pairing is honest and
  // deliberately unchanged. If this stops matching, the change was bigger than this test's brief.
  assert.match(MEAL, /<span class="gain \$\{toTier\.cls\}">\+\$\{move\.gain\}<\/span>/);
});
