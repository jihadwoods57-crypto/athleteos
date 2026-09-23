/* The bottom of every thread is ONE flush bar (composer upgrade, 2026-09-23).
 *
 * Founder: "Clean up that whole area at the bottom as well. It should be as good as iMessage, or
 * even this Claude app." His screenshot: the pill floating over a grey band with "Back to Home"
 * under it. What each assertion pins:
 *   - All four thread screens end with their dock (.dock-end): the live meal page, a past meal,
 *     the full chat and the coach's view of a meal. Nothing renders below it.
 *   - The exit is the header's back control; the "Back to Home" / "Back to History" slab is gone.
 *   - The scroller gives the dock its bottom padding back, and the dock sits at bottom:0 in BOTH
 *     keyboard states, carrying the home-indicator inset itself, with its padding animated over
 *     the keyboard's own motion (no one-frame switch on kb-open).
 *   - The note line under the box takes no room until it has something to say.
 *   - The microphone rides in send's slot and shows only where dictation can run.
 *
 * Run: node --test proto/redesign-2026-07/js/composer-bar.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* DOM + storage stubs (module-eval only), the preamble components.test.mjs uses: components.js
   imports state.js, which touches window at import time. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;
const { composer } = await import('./components.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const CSS = read('..', 'css', 'screens.css');
const FOCUS = read('..', 'css', 'focus.css');
const SCREENS = {
  meal: read('screens', 'meal.js'),
  past: read('screens', 'trust.js'),
  chat: read('screens', 'nutrition-chat.js'),
  coach: read('screens', 'coach.js'),
};

test('all four threads end with a flush dock', () => {
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.match(src, /class="chat-dock[^"]*\bdock-end\b/, `${name}: its dock is marked dock-end`);
  }
});

test('the dock is the last thing on the meal, past-meal and coach screens', () => {
  const meal = SCREENS.meal.slice(SCREENS.meal.indexOf('return `<div class="meal-screen">'));
  assert.match(meal.slice(0, meal.indexOf('`;')), /\$\{discussion\}<\/div>$/, 'meal: ${discussion} closes the screen');
  const past = SCREENS.past.slice(SCREENS.past.indexOf('return `<div class="meal-screen">${backHead(M.dish'));
  assert.match(past.slice(0, past.indexOf('`;')), /\$\{discussion\}<\/div>$/, 'past meal: ${discussion} closes the screen');
  // Coach: the dock closes .disc. After it come only the private notes, hidden unless there are
  // notes or the coach opened the note box, and OUTSIDE the section so the sticky bar's range ends
  // above them (review I-2: inside it, the bar covered the note box being typed in).
  assert.match(SCREENS.coach, /<div class="chat-dock disc-dock dock-end">[\s\S]{0,600}?<\/div>\n    <\/section>\n[\s\S]{0,700}?<div class="cm-after">/);
  const after = SCREENS.coach.slice(SCREENS.coach.indexOf('<div class="cm-after">'));
  assert.match(after, /<div id="cm-notes-wrap"\$\{notes\.length \? '' : ' hidden'\}>/, 'notes hidden when there are none');
  assert.match(after, /<div id="cm-note-box" hidden/, 'the note box hidden until opened');
  assert.match(CSS, /\.cm-after:has\(> :not\(\[hidden\]\)\) \{ padding-bottom:/);
});

test('the exit is the header back control, not a slab under the box', () => {
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.ok(!/class="meal-foot"/.test(src), `${name}: no .meal-foot`);
    assert.ok(!/>\$\{icon\('back', 16\)\} Back to (Home|History)</.test(src), `${name}: no Back to Home / History button`);
  }
  assert.match(SCREENS.meal, /backHead\(M\.dish \|\| M\.name, [^)]*'home'\)\}\$\{execTop\}/, 'meal: the header back falls back to Home');
  assert.match(SCREENS.past, /backHead\(M\.dish \|\| M\.name, '', 'history'\)/, 'past meal: the header back falls back to History');
  assert.ok(!/\.meal-foot/.test(CSS), 'the dead .meal-foot rules went with it');
});

test('flush in both keyboard states, and nothing switches in one frame', () => {
  assert.match(CSS, /body \.viewport\.notabs:has\(\.chat-dock\.dock-end\) \{ padding-bottom: 0; \}/);
  const rest = CSS.match(/\.viewport\.notabs \.chat-dock\.dock-end \{([^}]*)\}/);
  assert.ok(rest, 'resting dock-end rule');
  assert.match(rest[1], /bottom: 0/);
  assert.match(rest[1], /padding-bottom: calc\(var\(--s2h\) \+ env\(safe-area-inset-bottom/);
  assert.match(rest[1], /transition: padding-bottom var\(--kb-ms/, 'the inset leaves on the keyboard\'s own motion');
  assert.match(CSS, /body\.kb-open \.viewport\.notabs \.chat-dock\.dock-end \{ bottom: 0; margin-bottom: 0; padding-bottom: var\(--s2h\); \}/);
});

test('the note line under the box takes no room while empty', () => {
  assert.match(CSS, /\.cmp-note:empty \{ display: none; \}/);
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.ok(!/id="(chat|mv|nc|cm)-note" style=/.test(src), `${name}: the note is a class, not an 18px inline spacer`);
  }
});

test('a conversation box carries a mic in send\'s slot; a search box does not', () => {
  const box = composer({ inputId: 'x', sendId: 'y', placeholder: 'Ask', atEnd: true });
  const mic = box.indexOf('class="cmp-mic"');
  const send = box.indexOf('class="send"');
  assert.ok(mic > box.indexOf('<textarea') && mic < send, 'mic sits inside the pill, just before send');
  assert.match(box, /aria-label="Dictate a message"/);
  assert.ok(!composer({ inputId: 's', placeholder: 'Search foods' }).includes('class="cmp-mic"'), 'the food search has no mic');
});

test('the mic shows only where dictation can run, and trades places with send', () => {
  assert.match(CSS, /\.composer \.cmp-mic \{\s*display: none;/, 'hidden by default (web, old binaries)');
  assert.match(CSS, /html\.can-dictate \.composer\.at-end:not\(\.has-text\):not\(\.has-photo\) \.cmp-mic,/);
  assert.match(CSS, /html\.can-dictate \.composer\.at-end:not\(\.has-text\):not\(\.has-photo\) \.send,/);
  assert.match(CSS, /html\.can-dictate \.composer\.cmp-listening \.cmp-mic \{ background: var\(--blue\)/, 'listening is the selected blue');
  assert.ok((FOCUS.match(/\.composer \.cmp-mic,/g) || []).length === 2, 'the 30px mic keeps the 44px hit area');
});
