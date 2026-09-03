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

test('the pill\'s shrunken buttons keep the 44px hit-area floor', () => {
  // The redesign took send and the AI sparkle from 48px circles to 30px, and attach to 40px.
  // Visually right; but the finger still needs 44, so all three must sit in focus.css's
  // expanded-hit-area list. button.send, not .send: the food search bar's send is a decorative
  // aria-hidden <span> and must not grow a target it cannot honour.
  const lists = FOCUS_CSS.match(/:where\(([\s\S]*?)\)(::after)?\s*\{/g) || [];
  const carrying = lists.filter((l) => l.includes('.composer button.send'));
  assert.equal(carrying.length, 2, 'both :where lists (position + ::after) carry .composer button.send');
  for (const l of carrying) {
    assert.match(l, /\.composer \.ai-ask/, 'the AI sparkle is in the same list');
    assert.match(l, /\.composer \.attach/, 'attach is in the same list');
    assert.ok(!/\.composer \.send[,)\s]/.test(l), 'bare .composer .send would catch the decorative span');
  }
});

test('a tap anywhere on the pill focuses the box, as it does in Messages', () => {
  // The field is 30px tall inside a 40px pill, so the pill's own ground — padding, the empty
  // run beside a short sentence, the search bar's decorative magnifier — must be a way in,
  // not a dead zone inside the thing that looks like a text box. Buttons keep their own taps.
  const m = KEYBOARD.match(/addEventListener\('click',[\s\S]*?\n  \}\);/);
  assert.ok(m, 'keyboard.js delegates a click handler for the pill');
  assert.match(m[0], /closest\('\.composer \.field'\)/, 'the handler targets the pill');
  assert.match(m[0], /closest\('button/, 'buttons inside the pill keep their own taps');
  assert.match(m[0], /focusComposer/, 'focus goes through focusComposer so the reveal runs');
});

test('the native shell hides WebKit\'s keyboard accessory bar', () => {
  assert.ok(/hideKeyboardAccessoryView/.test(SHELL), 'ProtoApp.tsx must pass hideKeyboardAccessoryView to the WebView');
});
