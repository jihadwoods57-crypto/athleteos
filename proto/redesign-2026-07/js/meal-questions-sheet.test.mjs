/* The clarifying sheet: the ask that used to sit in a chat bubble below the fold.
 *
 * Source-shape pins plus the one piece that is pure enough to run: the once-per-meal guard. The
 * DOM half follows the house pattern for overlays (members-sheet, image-viewer, tapback), which
 * are proven by their shape and by the route sweep rather than by a synthetic DOM, since the
 * stub in this repo does not implement enough of the platform to open a real dialog. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');
const sheet = read('meal-questions-sheet.js');
const guard = read('overlay-guard.js');
const meal = read('screens', 'meal.js');
const css = read('..', 'css', 'screens.css');

/* ---- DOM stub: the module imports components.js, which touches document at eval time. ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {}, removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {}, focus() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.requestAnimationFrame = (fn) => fn();

const S = await import('./meal-questions-sheet.js');

test('the sheet joins the one-overlay-at-a-time list, and consults it', () => {
  assert.match(guard, /OVERLAY_MARKERS = \[[^\]]*'\.mqsheet'/);
  // Excluding its own marker, or it would veto itself.
  assert.match(sheet, /overlayOpen\('\.mqsheet'\)/);
});

test('it is a real dialog: labelled, modal, escapable, and it hands focus back', () => {
  assert.match(sheet, /role="dialog" aria-modal="true" aria-labelledby="mqs-title"/);
  assert.match(sheet, /if \(e\.key === 'Escape'\)/);
  assert.match(sheet, /e\.key === 'Tab'/);           // the trap aria-modal promises
  assert.match(sheet, /opener = document\.activeElement/);
  assert.match(sheet, /back\.focus\(\)/);
});

test('opening does not raise the keyboard: focus lands on the card, never the first field', () => {
  // An overlay that can arrive on its own must not also throw the keyboard up.
  assert.match(sheet, /card\.focus\(\)/);
  assert.ok(!/inputs\(\)\[0\]\.focus\(\)/.test(sheet), 'the first input is never auto-focused');
});

test('it rides the keyboard, because it is the one overlay holding text inputs', () => {
  assert.match(css, /\.mqsheet \{[^}]*var\(--kb, 0px\)/s);
  assert.match(css, /\.mqsheet \.mqs-card \{[^}]*overflow-y: auto/s);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.mqsheet \.mqs-card/);
});

test('the thread bubble points at the sheet instead of carrying a second copy of the form', () => {
  const bubble = /const qHead = [\s\S]*?'mq-bubble'\), ''\);/.exec(meal);
  assert.ok(bubble, 'the pending-questions bubble is still there');
  assert.ok(!/mq-input/.test(bubble[0]), 'the bubble no longer renders its own inputs');
  assert.match(bubble[0], /id="mq-thread-go"/);
  assert.match(bubble[0], /id="mq-thread-skip"/);
});

test('the breakdown says who it is waiting on, and offers the way in', () => {
  assert.match(meal, /const needsAnswer = Array\.isArray\(M\.pendingQuestions\)/);
  assert.match(meal, /id="mq-open-breakdown"/);
  assert.match(meal, /class="mq-blocked"/);
  // The waiting shimmer belongs to the actual wait, not to a question the athlete could answer.
  assert.match(meal, /M\.pending && !needsAnswer \? ' mv-wait' : ''/);
  // The button cannot be full-width inside that row: .btn is width:100% by default.
  assert.match(css, /\.mq-blocked \.btn \{[^}]*width: auto/s);
});

test('one entry point: the bubble, the breakdown and the automatic open all call it', () => {
  assert.match(meal, /function askPendingQuestions\(M\)/);
  assert.match(meal, /closest\('#mq-thread-go, #mq-thread-skip, #mq-open-breakdown/);
  const opens = meal.match(/askPendingQuestions\(/g) || [];
  assert.ok(opens.length >= 3, `expected the helper plus its callers, saw ${opens.length}`);
  assert.ok(!/openMealQuestions\(\{/.test(meal.replace(/function askPendingQuestions[\s\S]*?\n\}/, '')),
    'nothing opens the sheet around the helper');
});

test('the sheet comes up once per meal per session, and deliberate opens ignore that', () => {
  S.resetAutoShown();
  assert.equal(S.autoShownFor('lunch:2026-09-07'), false);
  S.markAutoShown('lunch:2026-09-07');
  assert.equal(S.autoShownFor('lunch:2026-09-07'), true);
  assert.equal(S.autoShownFor('dinner:2026-09-07'), false, 'the guard is per meal, not global');
  S.resetAutoShown();
  assert.equal(S.autoShownFor('lunch:2026-09-07'), false);
  // The automatic open is the only caller that consults it.
  assert.match(meal, /if \(!autoShownFor\(key\)\) \{/);
  assert.match(meal, /markAutoShown\(key\)/);
});

test('the automatic open waits for the entrance, and re-checks before it fires', () => {
  // A drain can land while the timer waits; opening then would ask an answered question.
  assert.match(meal, /const now = mealDetail\(slot\);/);
  assert.match(meal, /if \(!root\.isConnected \|\| !now \|\| !Array\.isArray\(now\.pendingQuestions\)/);
});

test('it asks nothing new: same questions, same two ways out', () => {
  assert.match(sheet, /Get my result/);
  assert.match(sheet, /Skip, just estimate/);
  // The same questions the model already asked, not a new interrogation built for this surface.
  assert.match(meal, /questions: M\.pendingQuestions/);
  assert.match(sheet, /\.slice\(0, 3\)/);   // the model asks one to three; the sheet holds to that
  assert.match(meal, /onAnswer: \(answers\) => act\.answerPendingQuestions\(M\.slot, answers\)/);
  assert.match(meal, /onSkip: \(\) => act\.skipPendingQuestions\(M\.slot\)/);
});

test('no inline styles and no em dashes in the new module', () => {
  assert.equal((sheet.match(/style="/g) || []).length, 0);
  assert.ok(!sheet.includes('—'));
});
