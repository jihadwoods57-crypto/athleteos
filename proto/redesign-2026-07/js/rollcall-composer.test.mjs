/* THE COACH-FACING ROLL CALL, after the 2026-09-14 redesign.
 *
 * The founder set one wake-up up and said it felt wrong. Four things were true at once, and each
 * one is pinned below because each one was invisible to every gate the repo already had.
 *
 *   FLAT — the alarm, the loudest thing this product does, was a lone chip inside a role="group"
 *   of one, styled identically to "5 min". DESIGN.md has said since 2026-09-06 that a boolean is
 *   a std-switch and chips are for choosing among several; nothing enforced it.
 *
 *   REPETITIVE — the window was stated three times: a hint under Grace, a hint under Closes that
 *   quoted Grace's number, and a summary line that said both again.
 *
 *   HIDDEN — Button words lived under "More options" while the visible alarm help text quoted its
 *   value, and "More options" was a 38px tap target guarding it.
 *
 *   BLIND — nothing showed the athlete's actual experience, and the one sentence that described
 *   it sat in `.wk-foot`, whose CSS rule was `height:0` (written for two empty spacer divs that
 *   share the class).
 *
 * Plus a data-loss bug found on the way: the escalation handler re-rendered without capturing the
 * textarea, so flipping the alarm after typing a morning message threw the message away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(JS, ...p), 'utf8');
const COMPOSER = stripComments(read('screens', 'coach-wakeup.js'));
const MORNING = stripComments(read('screens', 'wakeup-morning.js'));
const CSS = readFileSync(join(JS, '..', 'css', 'screens.css'), 'utf8');

/* screens/coach-wakeup.js reaches state.js, which touches the DOM at module eval. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { windowCells, windowLabel } = await import('./screens/coach-wakeup.js');

/* ---- the window is computed once, and drawn ------------------------------------------------ */

test('the three beats are the same arithmetic the server enforces', () => {
  const c = windowCells({ starts_min: 6 * 60, grace_min: 5, close_after_min: 30 });
  assert.deepEqual(c.map((x) => x.at), ['6:00 AM', '6:05 AM', '6:30 AM']);
  assert.deepEqual(c.map((x) => x.tone), ['g', 'a', 'r'], 'on standard green, late amber, missed red');
});

test('no grace still reads honestly, and close never lands before grace', () => {
  const none = windowCells({ starts_min: 6 * 60, grace_min: 0, close_after_min: 30 });
  assert.equal(none[0].at, '6:00 AM');
  assert.equal(none[1].at, '6:00 AM', 'with no grace, late starts the moment it opens');
  assert.match(none[1].label, /Late after/);
  // A 15-minute close under a 20-minute grace would otherwise close before the grace ended.
  const odd = windowCells({ starts_min: 6 * 60, grace_min: 20, close_after_min: 15 });
  assert.equal(odd[2].at, '6:20 AM', 'the close is max(grace, close_after), never earlier than grace');
});

test('the strip carries a spoken name, because it is a role="img"', () => {
  assert.match(windowLabel({ starts_min: 6 * 60, grace_min: 5, close_after_min: 30 }),
    /On standard at 6:00 AM, late from 6:05 AM, missed at 6:30 AM\./);
});

/* ---- flat: a boolean is a switch -------------------------------------------------------- */

test('every on/off on this screen is a std-switch, not a chip', () => {
  for (const key of ['alarm', 'breakthrough', 'notify_coach_on_miss']) {
    const re = new RegExp(`std-switch-row[^>]*data-esc="${key}"|data-esc="${key}"[^>]*`);
    assert.match(COMPOSER, re, `${key} must be a switch row`);
    assert.doesNotMatch(COMPOSER, new RegExp(`class="chip[^"]*"[^>]*data-esc="${key}"`),
      `${key} is a boolean; DESIGN.md reserves chips for choosing among several`);
  }
  assert.doesNotMatch(COMPOSER, /role="group" aria-label="How it arrives"/,
    'a role="group" containing one checkbox reads as an unmade selection');
});

/* ---- blind: the preview, and the sentence that was invisible ------------------------------- */

test('the composer shows the face the athlete wakes up to', () => {
  assert.match(COMPOSER, /wk-phone/, 'a preview of what lands on their phone');
  assert.match(COMPOSER, /id="wk-ph-b"/, 'including the button they actually tap');
  assert.match(COMPOSER, /id="wk-action"/, 'and the words on it, editable beside it');
  const foldStart = COMPOSER.indexOf('id="wk-more-panel"');
  assert.ok(foldStart > 0, 'the fold still exists');
  assert.ok(COMPOSER.indexOf('id="wk-action"') < foldStart,
    'Button words must sit with the button it labels, not under the fold the help text quotes');
});

test('the .wk-foot rule is scoped to the empty spacer it was written for', () => {
  assert.match(CSS, /\.wk-foot:empty\{height:0\}/,
    'an unscoped height:0 collapsed a real sentence on a shipped screen');
});

test('More options clears the 44px tap floor', () => {
  const rule = CSS.slice(CSS.indexOf('.wk-more{'), CSS.indexOf('.wk-more{') + 260);
  assert.match(rule, /min-height:44px/, 'it was 350x38 and it guards half the form');
});

/* ---- function: the message survives a toggle ----------------------------------------------- */

test('flipping a switch captures the draft first, so a typed message is not thrown away', () => {
  const i = COMPOSER.indexOf("querySelectorAll('[data-esc]')");
  assert.ok(i > 0, 'the escalation handler still exists');
  const body = COMPOSER.slice(i, i + 700);
  const capture = body.indexOf('capture()');
  const render = body.indexOf('__render');
  assert.ok(capture > 0 && capture < render,
    'render repaints the textarea from the draft; capturing after it means the message is gone');
});

/* ---- truth: nobody scheduled is not everyone answering ------------------------------------- */

test('an empty roll call reports empty instead of congratulating the coach', () => {
  assert.match(MORNING, /!s\.total \?/,
    'with a total of 0 this said "Everyone answered" and then "0% of the roster was up"');
  const i = MORNING.indexOf('!s.total ?');
  const branch = MORNING.slice(i, i + 420);
  assert.match(branch, /Nobody was on this roll call/);
  assert.doesNotMatch(branch, /Everyone answered/, 'the empty branch must not claim success');
});
