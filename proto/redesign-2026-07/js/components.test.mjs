/* The 2026-09-05 audit additions to components.js and the CSS primitives other screens are
 * counting on by exact name. Each assertion pins a name or a contract another agent's screen
 * now depends on, so a rename here fails loudly instead of rendering browser-default.
 *
 * components.js imports state.js, which is DOM-heavy but importable in node (score-summary.test
 * already does it). The CSS checks are regex over the stylesheet, in the manner of depill.test.
 *
 * Run: node --test proto/redesign-2026-07/js/components.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const APP_CSS = read('..', 'css', 'app.css');
const GLASS_CSS = read('..', 'css', 'glass.css');
const FOCUS_CSS = read('..', 'css', 'focus.css');

/* ---- DOM + storage stubs (module-eval only): the same preamble score-summary.test.mjs and
   client-experience.test.mjs use, because state.js touches window at import time. ---- */
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

const C = await import('./components.js');

/* A minimal element double: sayStatus only needs textContent, attributes and classList. */
function fakeEl() {
  const attrs = {};
  const classes = new Set();
  return {
    textContent: '',
    attrs,
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    classList: {
      toggle(c, force) { if (force) classes.add(c); else classes.delete(c); return classes.has(c); },
      contains(c) { return classes.has(c); },
    },
  };
}

test('sayStatus: a plain message is a polite status region with no error class', () => {
  const el = fakeEl();
  C.sayStatus(el, 'Saved');
  assert.equal(el.textContent, 'Saved');
  assert.equal(el.getAttribute('role'), 'status');
  assert.equal(el.getAttribute('aria-live'), 'polite');
  assert.equal(el.classList.contains('is-error'), false);
});

test('sayStatus: a failure is role=alert and carries .is-error, then clears on the next status', () => {
  const el = fakeEl();
  C.sayStatus(el, 'Could not save', { error: true });
  assert.equal(el.getAttribute('role'), 'alert');
  assert.equal(el.classList.contains('is-error'), true);
  C.sayStatus(el, 'Saved');
  assert.equal(el.getAttribute('role'), 'status');
  assert.equal(el.classList.contains('is-error'), false);
});

test('sayStatus: null element and null message are both safe', () => {
  assert.doesNotThrow(() => C.sayStatus(null, 'x'));
  const el = fakeEl();
  C.sayStatus(el, null);
  assert.equal(el.textContent, '');
});

test('.is-error is styled in app.css against the text-weight red', () => {
  assert.match(APP_CSS, /\.is-error[^{]*\{[^}]*var\(--red-bright\)/);
});

test('emptyState({ compact: true }) adds the compact class and nothing else changes', () => {
  const full = C.emptyState({ title: 'Nothing yet', body: 'Log a meal.' });
  const small = C.emptyState({ title: 'Nothing yet', body: 'Log a meal.', compact: true });
  assert.match(full, /class="state-demo"/);
  assert.match(small, /class="state-demo compact"/);
  assert.match(small, /Nothing yet/);
  assert.match(small, /Log a meal\./);
  // The compact rule exists, at the sizes the brief named.
  assert.match(APP_CSS, /\.state-demo\.compact \.sd-ic\s*\{[^}]*width:\s*40px/);
  assert.match(APP_CSS, /\.state-demo\.compact \.sd-t\s*\{[^}]*var\(--t-md\)/);
});

test('emptyState keeps its existing signature: action still renders a direct control', () => {
  const html = C.emptyState({ title: 'T', action: { label: 'Add', go: 'log' } });
  assert.match(html, /data-go="log"/);
  assert.match(html, />Add</);
});

test('skeletonRows announces: role=status plus screen-reader-only text naming what loads', () => {
  const html = C.skeletonRows(2, 'roster');
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<span class="sr-only">Loading roster<\/span>/);
  assert.equal((html.match(/class="sk-row"/g) || []).length, 2);
});

test('scoreRing is one picture to a screen reader: wrap labelled, SVG hidden', () => {
  const html = C.scoreRing({ score: 82, tierName: 'Locked In', tierCls: 'b', uid: 't' });
  assert.match(html, /class="ring-wrap" role="img" aria-label="Score 82 out of 100, Locked In"/);
  assert.match(html, /<svg class="ring-svg"[^>]*aria-hidden="true"/);
  const bare = C.scoreRing({ score: 45.4, uid: 'u' });
  assert.match(bare, /aria-label="Score 45 out of 100"/);
});

test('scoreRing hands its size over as --ring-size so app.css can shrink it on a short phone', () => {
  const html = C.scoreRing({ score: 50, size: 200, uid: 'v' });
  assert.match(html, /style="--ring-size:200px;/);
  assert.doesNotMatch(html, /style="width:min\(/);
  assert.match(APP_CSS, /\.ring-wrap\s*\{[^}]*min\(var\(--ring-size, 338px\), 100%\)/);
  assert.match(APP_CSS, /@media \(max-height: 700px\)\s*\{\s*\.ring-wrap\s*\{[^}]*280px/);
});

test('mealMedia decorative SVG is hidden from assistive tech', () => {
  assert.match(C.mealMedia('20', 96), /<svg[^>]*aria-hidden="true"/);
});

test('the primitives other screens are counting on exist by exact name', () => {
  assert.match(APP_CSS, /\n\.sr-only\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
  assert.match(APP_CSS, /\n\.btn\.danger\s*\{[^}]*var\(--danger-solid\)/);
  assert.match(APP_CSS, /\n\.btn\.ghost\.danger\s*\{[^}]*var\(--red-bright\)/);
  assert.match(APP_CSS, /\n\.stat\s*\{[^}]*var\(--surface-2\)/);
  assert.match(APP_CSS, /\n\.stat \.v\s*\{[^}]*var\(--t-2xl\)/);
  assert.match(APP_CSS, /\n\.stat \.k\s*\{[^}]*var\(--t-eyebrow\)/);
  assert.match(APP_CSS, /\n\.stat\.lg \.v\s*\{[^}]*var\(--t-3xl\)/);
  assert.match(GLASS_CSS, /--tab-clear:\s*calc\(var\(--tabbar-h\)/);
  assert.match(APP_CSS, /\.viewport\s*\{[^}]*var\(--tab-clear\)/);
  assert.doesNotMatch(APP_CSS, /var\(--nav-h\) \+ 62px/);
});

test('the danger buttons never carry a gradient', () => {
  const m = APP_CSS.match(/\n\.btn\.danger\s*\{([^}]*)\}/);
  assert.ok(m);
  assert.doesNotMatch(m[1], /gradient/);
});

test('.ev-x, .cm-rm and .std-chip sit in the 44px hit-area list, and the banner dismiss is a real button', () => {
  const lists = FOCUS_CSS.match(/:where\(\s*\.co-chip[\s\S]*?\)/g) || [];
  assert.ok(lists.length >= 2, 'the two hit-area :where() lists must both be present');
  for (const l of lists) for (const c of ['.ev-x', '.cm-rm', '.std-chip']) assert.match(l, new RegExp(c.replace('.', '\\.')));
  const src = read('components.js');
  assert.match(src, /<button class="ev-x" type="button" aria-label="Dismiss" id="ev-dismiss">/);
  assert.doesNotMatch(src, /<span role="button"[^>]*id="ev-dismiss"/);
});
