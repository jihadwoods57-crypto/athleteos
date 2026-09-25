/* ONE TYPE SYSTEM FOR THE CONVERSATION (founder 2026-09-24: "the typography doesn't match the
 * group text", "I don't like that yellow text that pops up right there").
 *
 * Measured headless before the change (computed styles, all four renderers): the bubbles were the
 * phone's face at 17/600, but the quoted-reply chip over a reply was the BRAND face (Plus Jakarta
 * Sans, .quote.rq font-family: var(--font)), the earlier-messages pill was the brand face in bold,
 * "Your coach hasn't opened this yet." was a bordered bold capsule, the receipt's heading was
 * tracked uppercase, and the note under the box was amber. One screen, three typographies, and a
 * warning colour on a sentence that was not a warning.
 *
 * Pinned here: every piece of a thread is the phone's face at one of three sizes, and nothing a
 * thread says about itself is amber.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const JS = dirname(fileURLToPath(import.meta.url));
const SCREENS = readFileSync(join(JS, '..', 'css', 'screens.css'), 'utf8');
const FLOWS = readFileSync(join(JS, '..', 'css', 'flows.css'), 'utf8');
const rule = (css, sel) => {
  // At the start of a line, so '.corr-card' does not find '.msg .stack.rcpt-stack > .corr-card'.
  const at = (x) => (css.startsWith(x) ? 0 : (css.indexOf(`\n${x}`) >= 0 ? css.indexOf(`\n${x}`) + 1 : -1));
  const i = at(`${sel} {`) >= 0 ? at(`${sel} {`) : at(`${sel}{`);
  assert.ok(i >= 0, `missing rule ${sel}`);
  return css.slice(i, css.indexOf('}', i) + 1);
};

test('the thread and everything in it is the phone\'s face', () => {
  assert.match(rule(SCREENS, '.thread'), /font-family: var\(--font-chat\)/);
  // The chrome that sets its own family must set the chat one, never the brand face.
  for (const sel of ['.msg .quote.rq', '.msg .quote .qtext', '.cmp-note', '.disc .cont-earlier']) {
    assert.match(rule(SCREENS, sel), /font-family: ?var\(--font-chat\)/, sel);
  }
  assert.match(rule(FLOWS, '.msg-status'), /font-family: var\(--font-chat\)/);
});

test('three sizes: the message, the chrome around it, the small print', () => {
  assert.match(rule(SCREENS, '.msg .bubble'), /font-size:var\(--t-lg\); font-weight:600/);
  for (const sel of ['.msg .who', '.msg .quote .qtext', '.disc .cont-earlier']) {
    assert.match(rule(SCREENS, sel), /font-size: ?var\(--t-sm\)/, sel);
  }
  for (const sel of ['.tsep', '.dlv', '.seen', '.cmp-note']) {
    assert.match(rule(SCREENS, sel), /font-size: ?var\(--t-xs\)/, sel);
  }
  assert.match(rule(FLOWS, '.msg-status'), /font-size: var\(--t-xs\)/);
});

test('Nia\'s name is set like everyone\'s', () => {
  assert.doesNotMatch(SCREENS, /\.msg\.ai \.who \{ color: var\(--text-2\); font-weight: 600; \}/);
  assert.match(rule(SCREENS, '.msg .who .who-sub'), /font-size: var\(--t-sm\); font-weight: 400/);
});

test('a quoted message is a small copy of a bubble, not a bordered chip', () => {
  const q = rule(SCREENS, '.msg .quote .qtext');
  assert.match(q, /border: 0/);
  assert.match(q, /border-radius: calc\(var\(--r-card-sm\) \+ 2px\)/, 'the bubble\'s own corners');
});

test('what the thread says about itself is small print, not a capsule', () => {
  const st = rule(FLOWS, '.msg-status');
  assert.doesNotMatch(st, /border:|background:|border-radius/);
  assert.match(st, /font-weight: 500/);
});

test('the receipt reads as Nia\'s message: sentence case, her gray, a bubble\'s corners', () => {
  const head = rule(SCREENS, '.corr-head');
  assert.match(head, /text-transform:none/);
  assert.match(head, /letter-spacing:0/);
  assert.match(rule(SCREENS, '.corr-card'), /background:var\(--surface-3\)/);
});

test('nothing a thread says about itself is amber', () => {
  for (const sel of ['.cmp-note', '.mt-retry', '.cmp-note.cmp-err']) {
    assert.doesNotMatch(rule(SCREENS, sel), /amber|red-bright/, sel);
  }
  assert.match(SCREENS, /\.cmp-note \.mt-retry\[id\] \{ color: var\(--blue-bright\)/, 'a line you can act on carries its action in blue');
});

test('the note sits above the box, not under it', () => {
  const meal = readFileSync(join(JS, 'screens', 'meal.js'), 'utf8');
  const chat = readFileSync(join(JS, 'screens', 'nutrition-chat.js'), 'utf8');
  assert.ok(meal.indexOf('id="chat-note"') < meal.indexOf("inputId: 'meal-msg'"));
  assert.ok(chat.indexOf('id="nc-note"') < chat.indexOf("inputId: 'nc-msg'"));
});

test('the typing row and a sending bubble go above the thread\'s small print', () => {
  const live = readFileSync(join(JS, 'chat-live.js'), 'utf8');
  assert.match(live, /querySelector\(':scope > \.th-foot'\)/);
  assert.match(live, /foot\.insertAdjacentHTML\('beforebegin', html\)/);
  const meal = readFileSync(join(JS, 'screens', 'meal.js'), 'utf8');
  assert.match(meal, /<div class="msg-status th-foot">/);
  assert.match(meal, /<div class="seen th-foot">/);
});
