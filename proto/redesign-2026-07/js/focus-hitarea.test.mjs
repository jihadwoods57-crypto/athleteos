/* Guards the hit-area pseudo-element that focus.css owns.
 *
 * focus.css expands ~18 small controls to the 44px touch floor by giving each an INVISIBLE
 * `::after` (`min-width/min-height: 44px`, centred with top/left 50% and a translate). An element
 * has exactly one `::after`, so a later rule that paints `<one of those>::after` does not replace
 * that rule, it MERGES with it, and the merge is silently wrong in both directions:
 *
 *   - `min-height: 44px` beats the new `height`, so a 2px underline renders 44px tall;
 *   - the centring `top: 50%` + translate survives, so it sits over the label instead of under it.
 *
 * That is exactly how the coach profile's active-tab underline shipped as a blue block across the
 * tab's own text (2026-08-28). The specificity does not save you: focus.css wraps the list in
 * `:where()`, which has ZERO specificity, so the new rule wins every property it declares and
 * inherits every property it does not.
 *
 * The fix is always the same: use `::before` for the decoration and leave `::after` alone.
 *
 * Honest about its limits, in the manner of depill.test.mjs: this is regex over stylesheets, not a
 * parser. It catches a rule that paints one of these selectors' `::after`, which is the regression
 * that actually happened.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_DIR = join(HERE, '..', 'css');

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

const FILES = walk(CSS_DIR, '.css').map((f) => ({ path: f, src: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const FOCUS = FILES.find((f) => f.path.endsWith('focus.css'));

/* The class list focus.css hands its 44px hit-area ::after, read out of the stylesheet itself so
   this test can never drift from the rule it is guarding. */
const GUARDED = (() => {
  const m = FOCUS.src.match(/:where\(([^)]*)\)::after\s*\{([^}]*)\}/);
  assert.ok(m, 'focus.css no longer has a :where(...)::after hit-area rule — has it moved? Update this test.');
  assert.match(m[2], /min-height:\s*44px/, 'the hit-area rule stopped guaranteeing 44px; that is the thing being protected');
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
})();

/* Just the class token each selector hangs on ('.est-note .link' -> 'link'). */
const GUARDED_CLASSES = [...new Set(GUARDED.map((s) => {
  const parts = s.split(/\s+/);
  const last = parts[parts.length - 1];
  const cls = last.match(/\.([A-Za-z0-9_-]+)/g);
  return cls ? cls[cls.length - 1].slice(1) : null;
}).filter(Boolean))];

const PAINTS = /(^|;)\s*(background|background-color|background-image|border|border-top|border-bottom|box-shadow|outline)\s*:/;

test('focus.css still owns a 44px hit-area ::after (the thing being guarded exists)', () => {
  assert.ok(GUARDED_CLASSES.length >= 10, `expected the hit-area list to cover the small controls, got ${GUARDED_CLASSES.length}`);
  assert.ok(GUARDED_CLASSES.includes('co-chip'), 'co-chip should still be in the hit-area list');
});

test('nothing paints the ::after that focus.css uses as a touch target', () => {
  const bad = [];
  for (const { path, src } of FILES) {
    if (path.endsWith('focus.css')) continue;               // the owner may style its own
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), decls = m[2];
      if (/^@/.test(sel)) continue;
      if (!/::after\b/.test(sel)) continue;
      if (!PAINTS.test(decls)) continue;
      // Only the compound the ::after actually hangs off matters: `.a::after .b` is not a thing,
      // but `.co-seg.co-tabs .co-chip.on::after` is, and its last compound carries .co-chip.
      for (const one of sel.split(',')) {
        const target = one.trim().split(/\s+/).pop() || '';
        if (!target.includes('::after')) continue;
        const hit = GUARDED_CLASSES.find((c) => new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(target));
        if (hit) bad.push(`${relative(CSS_DIR, path)}: "${one.trim()}" paints .${hit}'s hit-area ::after — use ::before`);
      }
    }
  }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}\n\nfocus.css owns ::after on these selectors for the 44px touch floor. ` +
    'A painted ::after merges with it (min-height:44px wins over height, and the centring transform survives), ' +
    'so the decoration renders 44px tall and centred over the label. Use ::before.');
});

test('the coach tab underline specifically is on ::before and stays thin', () => {
  const coach = FILES.find((f) => f.path.endsWith('coach.css')).src;
  const m = coach.match(/\.co-seg\.co-tabs\s+\.co-chip\.on::before\s*\{([^}]*)\}/);
  assert.ok(m, 'the active-tab underline must live on ::before (::after is the touch target)');
  assert.match(m[1], /height:\s*2px/, 'the underline is a thin rule, not a block');
  assert.match(m[1], /bottom:\s*0/, 'it sits under the label, never over it');
  assert.doesNotMatch(coach, /\.co-seg\.co-tabs\s+\.co-chip\.on::after/, 'nothing may claim the tab chip ::after');
});
