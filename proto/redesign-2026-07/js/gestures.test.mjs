/* The decisions behind the navigation gestures (js/gestures.js), tested without a DOM.
 *
 * The DOM half is plumbing: read touches, translate a layer, commit or snap back. The part that
 * decides whether a drag was a navigation is pure arithmetic, and it is the part that would be
 * wrong quietly — a threshold a hair too low turns every vertical scroll into a back-pop; a hair
 * too high and a flick that any iPhone honours snaps back instead. Run:
 *   node --test proto/redesign-2026-07/js/gestures.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDGE, AXIS_LOCK, axisOf, shouldCommit, lateralTarget, eligibleBack, eligibleLateral } from './gestures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

test('a back drag may only begin at the left edge, and the edge is a real thumb width', () => {
  assert.ok(EDGE >= 20 && EDGE <= 40, `EDGE ${EDGE}px is outside the 20..40 band a thumb lands in`);
});

test('the axis is undecided until the finger has moved, then horizontal only when clearly so', () => {
  assert.equal(axisOf(3, 2), null);
  assert.equal(axisOf(AXIS_LOCK + 1, 0), 'x');
  assert.equal(axisOf(0, AXIS_LOCK + 1), 'y');
  // A diagonal is a scroll. Losing a scroll to a gesture is the worse failure.
  assert.equal(axisOf(10, 9), 'y');
  assert.equal(axisOf(-14, 6), 'x');
});

test('a slow drag commits past a third of the width and not before', () => {
  assert.equal(shouldCommit({ dx: 100, dt: 600, width: 402 }), false);
  assert.equal(shouldCommit({ dx: 140, dt: 600, width: 402 }), true);
});

test('a quick flick commits short of the threshold, but a twitch does not', () => {
  assert.equal(shouldCommit({ dx: 60, dt: 80, width: 402 }), true);
  assert.equal(shouldCommit({ dx: 12, dt: 10, width: 402 }), false);
});

test('direction is honoured: a back drag going left never commits, a next-page drag going left does', () => {
  assert.equal(shouldCommit({ dx: -200, dt: 300, width: 402, dir: 1 }), false);
  assert.equal(shouldCommit({ dx: -200, dt: 300, width: 402, dir: -1 }), true);
});

test('the lateral target is the neighbour in the direction of travel, and nothing past the ends', () => {
  const subs = ['overview', 'nutrition', 'requirements', 'memory'];
  assert.equal(lateralTarget(subs, 'overview', -40), 'nutrition');
  assert.equal(lateralTarget(subs, 'nutrition', 40), 'overview');
  assert.equal(lateralTarget(subs, 'overview', 40), null);
  assert.equal(lateralTarget(subs, 'memory', -40), null);
  // No sub means resting on the first tab, exactly as the router's lateralStep reads it.
  assert.equal(lateralTarget(subs, '', -40), 'nutrition');
});

test('a flow interstitial, a full-bleed camera and an overlay are never swiped away', () => {
  assert.equal(eligibleBack({ transient: true }), false);
  assert.equal(eligibleBack({ bleed: true }), false);
  assert.equal(eligibleBack({}), true);
  assert.equal(eligibleBack(null), false);
});

test('only a screen that declares a strip pages sideways', () => {
  assert.equal(eligibleLateral({ subs: ['a', 'b'] }), true);
  assert.equal(eligibleLateral({ subs: ['a'] }), false);
  assert.equal(eligibleLateral({}), false);
});

test('the router hands the gestures a way in, and a swipe arrives with no second entrance', () => {
  const router = read('router.js');
  assert.ok(/initGestures\(/.test(router), 'router.js must call initGestures');
  assert.ok(/'swipe'/.test(router), "router.js must recognise the 'swipe' direction (already animated by the finger)");
});

test('Plan wraps its tab content in a pane the pager can move', () => {
  const plan = read('screens', 'plan.js');
  assert.ok(/class="pane"/.test(plan), 'plan.js render() must wrap the strip body in .pane');
});
