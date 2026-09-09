/* The Recent-results metric row must never cut the NUMBER (founder, 2026-09-09: a 100/100
 * breakfast rendered "100/10" on his own phone, and the weight card wrapped its "lb").
 *
 * Why it broke: the row is 132px wide inside a 158px card, and both children were freely
 * shrinkable with the label set to nowrap, so an overrun was resolved by whichever child lost —
 * then the card's overflow:hidden ate the tail. Measured in the real app at 390w:
 *
 *     label "MEAL QUALITY"  90px  +  value "100/100"  51px  +  gap 8  =  149  of  132
 *
 * Two digits fit by 1px of luck; three never did. The rule now is a priority, not a hope — the
 * value is flex:none and nowrap, and the label yields with an ellipsis — plus the two labels
 * that overran were shortened so nothing truncates in practice. Both halves are pinned here:
 * shortening the copy alone would leave the next long value to clip again, and the guard alone
 * would silently truncate a label on every card.
 *
 * Regex over sources, in the manner of score-credit.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/res-metric.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const HOME = read('screens', 'home.js');
const SCREENS_CSS = read('..', 'css', 'screens.css');

const rule = (sel) => {
  const m = SCREENS_CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  assert.ok(m, `screens.css lost ${sel}`);
  return m[1];
};

test('the value never shrinks and never wraps — it is the information', () => {
  const v = rule('.res-m .v');
  assert.match(v, /flex:\s*none/, 'the number must not be a shrinkable flex item');
  assert.match(v, /white-space:\s*nowrap/, '"150 lb" must not break onto a second line');
});

test('the label is what yields, and it truncates rather than overflowing', () => {
  const k = rule('.res-m .k');
  assert.match(k, /min-width:\s*0/, 'without min-width:0 a nowrap flex item refuses to shrink at all');
  assert.match(k, /overflow:\s*hidden/);
  assert.match(k, /text-overflow:\s*ellipsis/);
});

test('the row keeps a token gap, so the budget stays on the spacing scale', () => {
  assert.match(rule('.res-m'), /gap:\s*var\(--s1h\)/);
});

test('the labels that overran the row are short by measurement', () => {
  // "Meal Quality" is 90px of a 132px row shared with "100/100"; "Quality" is 53.5 and leaves
  // 21px spare. The card is already titled with the meal, so the word "Meal" said it twice.
  assert.match(HOME, /<span class="k">Quality<\/span>/);
  assert.doesNotMatch(HOME, /<span class="k">Meal Quality<\/span>/);
  // "This morning" is 91px and left a wrapped "lb" under a 150; the card is titled
  // "Morning Weight" above the word "Today", so the when was already said twice.
  const resk = HOME.match(/const RES_K = \{([^}]*)\}/);
  assert.ok(resk, 'home.js lost RES_K — update this test');
  assert.match(resk[1], /'Morning Weight':\s*'Weight'/);
  assert.doesNotMatch(resk[1], /This morning/);
});

test('the value still carries its unit and its tier colour', () => {
  // The fix is layout-only: a 100 is still green, a 65 still amber, and "/100" still renders.
  assert.match(HOME, /<span class="v \$\{a\.vClass\}">\$\{a\.value\}<small>\$\{a\.unit\}<\/small><\/span>/);
});
