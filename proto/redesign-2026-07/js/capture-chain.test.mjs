/* Guards the meal capture flow's shared-element chain.
 *
 * The flow is four screens and ONE photograph: the viewfinder frame, the photo you confirm, the
 * plate being read, the plate on its thread. `data-vt="plate"` is what carries that photograph
 * across all three navigations instead of it being destroyed and redrawn at each step.
 *
 * Why this needs a gate rather than trusting review: the failure is INVISIBLE. Delete a mark and
 * the flow still works perfectly — every screen renders, every navigation lands, nothing throws,
 * nothing logs. The photo just stops travelling, and the only way to notice is to watch the
 * animation frame by frame, which nobody does on an unrelated change to meal.js. The same is true
 * of the `{ dir, vt }` arguments: without `dir` the router has no gesture to read and the move
 * silently falls back to the plain deep-link fade, which is exactly the state this flow was found
 * in.
 *
 * The other half is the uniqueness rule from js/view-transition.js: TWO elements claiming one
 * view-transition-name aborts the entire transition. A second `plate` mark on any of these screens
 * is therefore WORSE than none, and it is an easy thing to add by accident when copying markup.
 *
 * WHY THERE IS NO COMMENT-STRIPPER HERE. The first version of this file counted marks in
 * comment-stripped source, the way depill.test.mjs does. That was inert: these screens use the
 * `${/* … *\/''}` idiom to put prose inside template literals, and a non-greedy /\*…\*\/ match over
 * that swallowed 5,259 characters of camera.js — including the whole `.cam-deck` block. A
 * duplicate mark planted in the eaten region did not change the count, so the assertion that was
 * supposed to catch the worst failure mode passed on a broken file. Every assertion below is
 * positional over RAW source instead: the tag pattern `<tag … data-vt="plate" …>` cannot match an
 * HTML comment (`<!--` has no letter after `<`), so comments exclude themselves and nothing has to
 * be stripped. Verified against six mutations; see the commit.
 *
 * Honest about its limits, like depill.test.mjs: this is regex over source, not a parser. It cannot
 * see a mark assembled at runtime. It catches deletion, duplication, relocation, and a navigation
 * that forgot to say what it carries, which are the four ways this actually breaks.
 * Run: node --test proto/redesign-2026-07/js/capture-chain.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, f), 'utf8');

const CAMERA = read('screens/camera.js');
const MEAL = read('screens/meal.js');

/** Every opening tag in `src` that claims the plate. `[a-z]` after `<` excludes `<!-- … -->`. */
const plateTags = (src) => src.match(/<[a-z]+[^>]*\sdata-vt="plate"[^>]*>/g) || [];

/* The four screens of the flow, and the anchor that holds the photograph on each. The anchor is the
   point: the mark has to be on the thing the eye is following, not on a wrapper near it. */
const CHAIN = [
  ['camera / the viewfinder frame', CAMERA, 'id="viewfinder"'],
  ['camera-confirm / the photo being confirmed', CAMERA, 'class="cc-photo"'],
  ['analyzing / the plate being read', MEAL, 'class="scanbox"'],
  ['meal thread / where the plate lands', MEAL, 'id="meal-hero"'],
];

test('each screen in the flow marks the element that holds the photograph', () => {
  for (const [label, src, anchor] of CHAIN) {
    const tags = plateTags(src);
    assert.ok(tags.some((t) => t.includes(anchor)),
      `${label}: no opening tag carries both ${anchor} and data-vt="plate".\nFound: ${JSON.stringify(tags, null, 1)}`);
  }
});

test('nothing ELSE claims the plate — a second claimant aborts the whole transition', () => {
  for (const [file, src, expected] of [['camera.js', CAMERA, 2], ['meal.js', MEAL, 2]]) {
    const tags = plateTags(src);
    assert.equal(tags.length, expected,
      `${file} has ${tags.length} elements claiming data-vt="plate", expected ${expected}. Two on one `
      + `screen makes the browser skip the ENTIRE transition, not just the morph.\n`
      + JSON.stringify(tags, null, 1));
  }
});

test('every navigation in the flow states its gesture AND what it carries', () => {
  /* A `[data-go]` tap tells the router both things by itself. These moves are made by the screens'
     own code, so they have to say it. `dir` is what stops the move reading as a deep link; `vt` is
     what makes the photo travel. */
  const MOVES = [
    [CAMERA, 'camera-confirm', 'the shutter firing'],
    [CAMERA, "'analyzing/' + slot", 'the confirm handing off'],
    [MEAL, "'meal-thread/' + slot", 'the analysis landing'],
  ];
  for (const [src, target, label] of MOVES) {
    const calls = (src.match(/window\.__go\([^)]*\)/g) || []).filter((c) => c.includes(target));
    assert.ok(calls.length > 0, `${label}: no window.__go call targeting ${target}`);
    for (const c of calls) {
      assert.match(c, /dir:\s*'push'/, `${label}: ${c} does not declare a gesture`);
      assert.match(c, /vt:\s*'plate'/, `${label}: ${c} does not carry the plate`);
    }
  }
});

test('the thread shows a photo it already holds BEFORE its first await', () => {
  /* The morph snapshots the hero at the end of mount. Everything after the dynamic photo-store
     import lands in a later frame, so a photo already in memory has to be assigned before it, or
     the flow ends on an empty gradient box that fills in a beat later. */
  const i = MEAL.indexOf("root.querySelector('#meal-photo')");
  assert.ok(i > 0, 'the thread no longer looks up #meal-photo — this guard needs rewriting');
  const after = MEAL.slice(i);
  const fast = after.indexOf('photo.src = M.img');
  const imported = after.indexOf("await import('../photo-store.js')");
  assert.ok(fast > 0, 'the in-memory fast path is gone');
  assert.ok(imported > 0, 'the photo-store import is gone — this guard needs rewriting');
  assert.ok(fast < imported,
    'the fast path moved AFTER the await, so the plate lands on an empty frame again');
});
