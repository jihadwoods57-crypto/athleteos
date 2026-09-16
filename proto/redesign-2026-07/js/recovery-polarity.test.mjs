/* THE RECOVERY CHECK-IN'S MIXED SCALE POLARITY (impeccable critique, 2026-09-16).
 *
 * The check-in renders eight 1-5 rows as identical numbered chips in one card, and promises "20
 * seconds" on a screen an athlete reaches at 10pm after practice. Six of those rows run forward
 * (5 = good). Soreness and cravings run BACKWARD, because the stored value is the honest raw
 * answer and day.js inverts it for readers. The endpoint labels disclosed the flip, but identical
 * affordances invite straight-lining, and the screen's own copy tells the athlete the values do
 * not affect their score, which removes the last reason to read each row. Tapping down the "5"
 * column filed "peak energy AND maximum soreness" at once. That is the readiness signal a coach
 * acts on before the next practice, so contradictory data here is worse than no data.
 *
 * The fix is deliberately NOT a polarity flip. CI_INVERSE has four readers (day.js itself,
 * breakdown-model's CI_BEST, recovery-intel's per-signal fix text, plan-style's signal table) and
 * every check-in row already written to the database carries the current polarity. Flipping the
 * stored meaning would silently invert history. So storage does not move; the RENDER does: on an
 * inverse row the chips lay out 5→1 and the end labels swap with them, so on every row the
 * right-hand end is the good end and straight-lining is at least self-consistent.
 *
 * What this pins:
 *   1. The render hint is DERIVED from day.js CI_INVERSE, never re-declared. A fifth copy of the
 *      polarity is exactly how the tier ladder drifted to 75-vs-80 (score-band.js:41).
 *   2. The inverse row actually reverses both the chips and the end labels.
 *   3. data-n still carries the honest raw answer, so the submit path is untouched.
 *   4. CI_INVERSE still names soreness and cravings, so the hint has a real source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const read = (p) => stripComments(readFileSync(join(JS, p), 'utf8'));

const state = read('state.js');
const recovery = read('screens/recovery.js');
const day = read('day.js');

test('CI_INVERSE still names soreness and cravings, and is exported', () => {
  const m = day.match(/export const CI_INVERSE = \{([^}]*)\}/);
  assert.ok(m, 'day.js must export CI_INVERSE');
  assert.match(m[1], /soreness:\s*true/, 'soreness must stay an inverse signal');
  assert.match(m[1], /cravings:\s*true/, 'cravings must stay an inverse signal');
});

test('state.js derives the render hint from CI_INVERSE instead of re-declaring polarity', () => {
  assert.match(state, /CI_INVERSE,?\s*\n?\}\s*from '\.\/day\.js'/,
    'state.js must import CI_INVERSE from day.js');
  assert.match(state, /inverse:\s*!!CI_INVERSE\[a\.key\]/,
    'the recovery field model must read polarity from CI_INVERSE');
  // A second literal list of inverse keys is the drift this guards against.
  const anchors = state.slice(state.indexOf('const ANCHORS'), state.indexOf('const fields'));
  assert.doesNotMatch(anchors, /inverse:\s*true/,
    'polarity must not be hand-written into the anchor table as well');
});

test('an inverse row reverses both its chips and its end labels', () => {
  assert.match(recovery, /f\.inverse \? \[5,4,3,2,1\] : \[1,2,3,4,5\]/,
    'inverse rows must lay their chips out 5 to 1');
  assert.match(recovery, /f\.inverse \? f\.hi : f\.lo/, 'the low end label must swap on an inverse row');
  assert.match(recovery, /f\.inverse \? f\.lo : f\.hi/, 'the high end label must swap on an inverse row');
  assert.match(recovery, /data-inverse="1"/, 'an inverse row must be marked in the DOM');
});

test('the chip still stores the honest raw answer', () => {
  // The whole safety of the presentation fix rests on this: reversing the layout must not
  // reverse the value. data-n is what the toggle handler reads.
  const chipLine = recovery.split('\n').find(l => l.includes('data-n=') && l.includes('role="radio"'));
  assert.ok(chipLine, 'the check-in chip must still render data-n');
  assert.match(chipLine, /data-n="\$\{n\}"/, 'data-n must be the raw n, never a re-mapped value');
  assert.match(chipLine, /n === f\.val/, 'selection must still compare against the raw stored value');
});

test('the check-in no longer renders an unconditional 1-to-5 chip row', () => {
  const idx = recovery.indexOf('chips5');
  const near = recovery.slice(Math.max(0, idx - 400), idx + 400);
  assert.doesNotMatch(near, /\$\{\[1,2,3,4,5\]\.map/,
    'the chip row must go through the polarity-aware order, not a hard-coded 1-5 map');
});
