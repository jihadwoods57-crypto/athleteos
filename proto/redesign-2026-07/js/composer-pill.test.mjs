/* The message box is a pill that grows, the way the phone's own Messages box does (founder,
 * 2026-09-03, with side-by-side screenshots).
 *
 * What the screenshots showed, and what each assertion pins:
 *   1. A one-line <input> scrolled the sentence off the LEFT edge; Messages wraps it and grows the
 *      pill a line at a time. So a conversation-ending composer is a <textarea>, one row tall, and
 *      keyboard.js grows it.
 *   2. Send sat OUTSIDE the box as a 48px circle; Messages tucks it INSIDE the pill's right edge.
 *      So send renders inside the .field wrapper, after the textarea.
 *   3. An empty bordered strip sat under the box on every meal thread: .composer-attach-pending's
 *      class display beat the `hidden` attribute (the same bug .cont-earlier and #ps-apply already
 *      carry explicit rules for).
 *   4. "Back to Home" rendered BELOW the composer, so when the keyboard came up the button — not
 *      the conversation — was what sat on the keys. The composer is now the last thing on the meal
 *      screen.
 *   5. WebKit's up/down/Done accessory bar sat between the box and the keys. Messages has none.
 *
 * Regex over sources, in the manner of depill.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/composer-pill.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const COMPONENTS = read('components.js');
const KEYBOARD = read('keyboard.js');
const SCREENS_CSS = read('..', 'css', 'screens.css');
const FOCUS_CSS = read('..', 'css', 'focus.css');
const MEAL = read('screens', 'meal.js');
const SHELL = read('..', '..', '..', 'src', 'proto', 'ProtoApp.tsx');

const composerSrc = (() => {
  const m = COMPONENTS.match(/export function composer\([\s\S]*?\n\}\n/);
  assert.ok(m, 'components.js no longer exports composer() — update this test');
  return m[0];
})();

test('a conversation-ending composer is a one-row textarea whose return key reads Send', () => {
  assert.match(composerSrc, /<textarea[^>]*rows="1"/, 'atEnd composer must render <textarea rows="1">');
  assert.match(composerSrc, /enterkeyhint="send"/);
});

test('send lives INSIDE the pill, after the field', () => {
  const field = composerSrc.indexOf('class="field"');
  const box = composerSrc.indexOf('${fieldEl}');
  const send = composerSrc.indexOf('${sendEl}');
  assert.ok(field > -1, 'composer wraps the text box in .field');
  assert.ok(box > field && send > box, 'order must be .field > text box > send');
});

test('the pill grows with its text and never wears the focus ring', () => {
  assert.match(KEYBOARD, /\.composer textarea/, 'keyboard.js owns textarea growth');
  assert.match(KEYBOARD, /style\.height/, 'growth is measured off scrollHeight, not rows');
  assert.match(SCREENS_CSS, /\.composer textarea\s*\{[^}]*resize:\s*none/);
  assert.match(FOCUS_CSS, /\.composer (input|textarea)[^{]*:focus-visible[^{]*\{[^}]*outline:\s*none/);
});

test('the pending-photo strip is genuinely gone while hidden', () => {
  assert.match(SCREENS_CSS, /\.composer-attach-pending\[hidden\]\s*\{\s*display:\s*none/);
});

test('nothing renders below the meal composer', () => {
  const ret = MEAL.slice(MEAL.indexOf('return `<div class="meal-screen">'));
  const stop = ret.indexOf('`;');
  const tpl = ret.slice(0, stop);
  assert.ok(tpl.includes('${discussion}'), 'meal template still places ${discussion}');
  assert.ok(!tpl.includes('Back to Home'), 'Back to Home must not follow the composer');
});

test('the native shell hides WebKit\'s keyboard accessory bar', () => {
  assert.ok(/hideKeyboardAccessoryView/.test(SHELL), 'ProtoApp.tsx must pass hideKeyboardAccessoryView to the WebView');
});
