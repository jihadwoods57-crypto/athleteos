/* Final whole-branch review, proto Minors fixed in the final fix round (2026-09-23).
 *
 *   M-2  wakeup-morning.js: "loaded" is keyed by the book, so a second coach in one session is
 *        never told "No wake-up was set" by the first coach's flag.
 *   M-5  keyboard.js: holding the end on keyboard hide is a thread's behaviour only.
 *   M-6  rollcall-board.js: the client kill switch sends a cached link Home.
 *   Item 7  coach-commitments.js: coaches see Arrived / Not arrived, never the athlete's reason.
 *
 * Run: node --test proto/redesign-2026-07/js/rollcall-final-minors.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JS = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(JS, p), 'utf8');

test('M-2: the morning screen remembers WHICH book loaded, not just that one did', () => {
  const src = read('screens/wakeup-morning.js');
  assert.doesNotMatch(src, /let LOADED = false/);
  assert.match(src, /let LOADED_FOR = null/);
  assert.match(src, /LOADED_FOR === \(bookId\(\) \|\| ''\)/);
});

test('M-5: no conversation dock, nothing focused: the keys going away never scroll a form', () => {
  const src = read('keyboard.js');
  assert.match(src, /if \(!atEndComposer && !document\.querySelector\('\.chat-dock'\)\) return;/);
});

test('M-6: with roll call switched off, the board redirects before it paints', () => {
  const src = read('screens/rollcall-board.js');
  assert.match(src, /if \(ROLLCALL_OFF\) return isOperator\(\)/);
});

test('item 7: the coach roster says Not arrived, never the athlete’s own reason', () => {
  const src = read('screens/coach-commitments.js');
  assert.doesNotMatch(src, /r\.unverified_reason \|\| 'Couldn’t verify'/);
  assert.match(src, /'Not arrived · place not confirmed'/);
});
