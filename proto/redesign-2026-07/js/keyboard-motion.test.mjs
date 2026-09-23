/* The keyboard is ONE motion (composer upgrade, 2026-09-23).
 *
 * Founder: tapping "Ask about this meal" raised the keyboard in a glitchy transition. The root
 * causes, each pinned here so a later edit cannot quietly bring one back:
 *   1. WKWebView's own scroll view shoved the app up to reveal the field, and the proto undid it a
 *      frame later. The shell turns that scroll view off on iOS (scrollEnabled).
 *   2. The shell learned the keyboard's height only once the keys had arrived (visualViewport), so
 *      the app shrank AFTER the keys covered the composer. The native keyboardWillShow/WillHide is
 *      forwarded to window.__nativeKeyboard, with the animation's duration, before the keys move.
 *   3. The conversation was scrolled to its end twice (now, and again 260ms later): a third move.
 *      It is held at the end every frame of the keyboard's own animation instead.
 *
 * Run: node --test proto/redesign-2026-07/js/keyboard-motion.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldHoldEnd } from './keyboard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const KB = read('keyboard.js');
const APP_CSS = read('..', 'css', 'app.css');
const SHELL = read('..', '..', '..', 'src', 'proto', 'ProtoApp.tsx');

test('a conversation-ending composer always holds the newest message on the keys', () => {
  assert.equal(shouldHoldEnd({ atEndComposer: true, scrollTop: 0, scrollHeight: 5000, clientHeight: 800 }), true);
});

test('a reader at (or within 120px of) the end stays at the end; one reading older messages does not', () => {
  assert.equal(shouldHoldEnd({ scrollTop: 4200, scrollHeight: 5000, clientHeight: 800 }), true);
  assert.equal(shouldHoldEnd({ scrollTop: 4081, scrollHeight: 5000, clientHeight: 800 }), true);
  assert.equal(shouldHoldEnd({ scrollTop: 3000, scrollHeight: 5000, clientHeight: 800 }), false);
});

test('the shell takes the keyboard from the native side, before the keys move', () => {
  assert.match(KB, /window\.__nativeKeyboard = nativeKeyboard/, 'keyboard.js installs the native channel');
  assert.match(KB, /let over = nativeKb != null \? nativeKb : overlap\(\)/, 'native height leads over visualViewport while present');
  // Review M-1: native keyboard frames are in screen coordinates, wrong for an iPad window in Stage
  // Manager; once the keys have landed, the browser's measure may correct the height upward.
  assert.match(KB, /performance\.now\(\) - nativeAt > kbMs \+ 80\) over = Math\.max\(over, overlap\(\)\)/);
  assert.match(KB, /recheck = setTimeout\(schedule, kbMs \+ 120\)/);
  assert.match(SHELL, /keyboardWillShow/);
  assert.match(SHELL, /keyboardWillHide/);
  assert.match(SHELL, /window\.__nativeKeyboard && window\.__nativeKeyboard\(/, 'ProtoApp.tsx forwards the keyboard to the page');
});

test('the WebView\'s own scroll view cannot shove the app on iOS', () => {
  assert.match(SHELL, /scrollEnabled=\{Platform\.OS !== 'ios'\}/);
});

test('the shell shrinks over the keyboard\'s own duration and curve', () => {
  assert.match(APP_CSS, /transition:\s*height var\(--kb-ms\) var\(--kb-ease\)/);
  assert.match(APP_CSS, /--kb-ms:\s*250ms/);
  assert.match(KB, /setProperty\('--kb-ms'/, 'keyboard.js writes the reported duration');
});

test('the conversation is held every frame, not scrolled twice', () => {
  assert.ok(!/setTimeout\(revealAt, 260\)/.test(KB), 'the fixed 260ms second scroll is gone');
  const m = KB.match(/function followKeyboard\(\)[\s\S]*?\n\}/);
  assert.ok(m, 'followKeyboard exists');
  assert.match(m[0], /requestAnimationFrame\(step\)/, 'it re-pins on every frame of the motion');
  assert.match(m[0], /kbMs/, 'for the length of the keyboard animation');
});

test('a lost "will hide" cannot leave the shell short', () => {
  // native-pickers-collapse-the-shell: a --kb that sticks makes the app untappable.
  assert.match(KB, /nativeKb && !focused/, 'no focused field for 800ms drops the native height');
  assert.match(KB, /if \(nativeKb && !isField\(document\.activeElement\)\) nativeKb = 0/, 'returning to the app re-measures');
});
