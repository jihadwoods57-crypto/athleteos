/* The lazy screen registry (js/screens/index.js) and the boot shell that fronts it.
 *
 * With no bundler, a registry entry that names the wrong export, or a consumer that treats a thunk
 * as a module, throws at CLICK time on a phone. This walks the whole table under Node, resolves
 * every thunk, and checks the shapes the router and scripts/qc-capture.mjs rely on. Run:
 *   node --test proto/redesign-2026-07/js/router-lazy.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* The screen graph touches the DOM at module eval; stub what it reaches for (router-roles does the same). */
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

const reg = await import('./screens/index.js');
const { screens, isLazy, loadScreen, loadAllScreens, OPERATOR_TAB_ROUTES } = reg;

// What the athlete needs on the first frame: the tab bar's five routes, the welcome door, and
// the two modules the router substitutes synchronously. Everything else is a thunk until used.
const EAGER = ['home', 'plan', 'log', 'progress', 'profile', 'welcome', 'notfound', 'notpermitted'];

test('the athlete first paint is eager; everything else is a thunk until first use', () => {
  for (const r of EAGER) assert.ok(!isLazy(screens[r]) && typeof screens[r].render === 'function', `${r} must be eager`);
  const lazyCount = Object.keys(screens).filter((r) => isLazy(screens[r])).length;
  assert.ok(lazyCount > 100, `expected most of the registry to be lazy, got ${lazyCount}`);
  // A thunk must never look like a module to a consumer that forgot to check.
  for (const r of Object.keys(screens)) if (isLazy(screens[r])) assert.equal(screens[r].render, undefined);
});

test('scripts/qc-capture.mjs --all can still enumerate every route by regex over this file', () => {
  const src = read('screens', 'index.js');
  const names = new Set(Array.from(src.matchAll(/^\s*'?([a-z0-9-]+)'?\s*:/gim)).map((m) => m[1]));
  const routes = Object.keys(screens);
  // Every non-shorthand route must be one `name: value,` line; shorthand entries (home, plan,
  // ...) are the eager set the default shot list already covers.
  for (const r of routes) if (!EAGER.includes(r)) assert.ok(names.has(r), `qc-capture cannot see route '${r}'`);
  // ... and nothing that is not a route may match, or the sweep renders a phantom screen.
  for (const n of names) assert.ok(routes.includes(n), `'${n}:' matches the route regex but is not a route`);
});

test('every thunk resolves to a module with render(), and aliases share the loaded object', async () => {
  const before = Object.keys(screens).filter((r) => isLazy(screens[r]));
  const loaded = await loadAllScreens();
  for (const r of Object.keys(loaded)) {
    assert.ok(!isLazy(loaded[r]), `${r} still lazy after loadAllScreens`);
    assert.equal(typeof loaded[r].render, 'function', `${r} resolved to something without render()`);
  }
  assert.ok(before.length > 100);
  assert.equal(screens.coach, screens['coach-home'], 'coach is an alias of coach-home');
  assert.equal(screens.trainer, screens['coach-home'], 'trainer renders the operator Home');
  assert.equal(screens['trainer-inbox'], screens['coach-inbox']);
  // loadScreen on an already-loaded (or eager) entry hands back the module without a thunk.
  assert.equal(await loadScreen('home'), screens.home);
  assert.equal(await loadScreen('no-such-route'), undefined);
  for (const r of OPERATOR_TAB_ROUTES) assert.ok(loaded[r], `operator preload names an unregistered route: ${r}`);
});

test('the tab-bar badge modules are in the operator preload set', async () => {
  await loadAllScreens();
  for (const r of ['coach-inbox', 'trainer-profile', 'trainer-grow']) {
    assert.equal(typeof screens[r].badge, 'function', `${r} lost its badge()`);
    assert.ok(OPERATOR_TAB_ROUTES.includes(r), `${r} has a badge the tab bar reads; it must be preloaded`);
  }
});

test('the router never reads a thunk as a module', () => {
  const router = read('router.js');
  // Every synchronous registry read goes through modOf() (null for a thunk); render() is the one
  // place that may see a thunk, and it awaits it.
  const raw = router.match(/screens\[[^\]]+\]/g) || [];
  const allowed = [
    'screens[route]',        // modOf(), render()'s resolved lookup, shellFor's registered check
    'screens[t.route]',      // tabbar: registered-but-lazy -> wantBadge
    'screens[r]',            // badge roll-up, same rule
  ];
  for (const m of raw) assert.ok(allowed.includes(m), `router.js reads ${m} directly; use modOf()`);
  assert.match(router, /function modOf\(route\)/);
  assert.match(router, /if \(isLazy\(resolved\)\)/, 'render() must resolve a lazy entry before reading it');
  assert.match(router, /LOAD_FAILED/, 'a failed import must render an error state, not retry forever');
  assert.match(router, /errorState\(\{/, 'the failed-load screen uses errorState semantics');
});

test('the first frame is in index.html and bootShell() is idempotent over it', () => {
  const html = read('..', 'index.html');
  const router = read('router.js');
  assert.match(html, /<div class="screen booting">/, 'index.html must ship the boot skeleton inline');
  assert.match(html, /<main class="view" id="view" aria-busy="true"/, 'the skeleton view is the main landmark');
  assert.match(html, /class="card sk-card"/, 'the skeleton rows must be the same primitive bootShell() paints');
  assert.match(router, /device\.querySelector\('\.screen\.booting'\)/, 'bootShell() must look for the inline skeleton before painting one');
  assert.match(router, /primeDayFromCache\(RT\.userId\)\) render\(\{ prehydrate: true \}\)/, 'the cached day paints before hydrateDay()');
  assert.match(router, /if \(mod\.mount && !prehydrate\)/, 'the pre-hydrate paint must not run mount()');
});

test('landmarks and tabs: <main class="view">, a labelled tablist, role=tab with aria-selected', () => {
  const router = read('router.js');
  assert.match(router, /<main class="view\$\{enterCls\}/, 'render() must paint the view as <main>');
  assert.match(router, /<nav class="tabbar" aria-label="Main" role="tablist"/);
  assert.match(router, /<div class="tab \$\{on\}" role="tab" aria-selected="\$\{on \? 'true' : 'false'\}" \$\{on \? 'aria-current="page"' : ''\}/);
  // The promote pass keeps an author role, and the document-level net activates role="tab".
  assert.match(router, /if \(!el\.hasAttribute\('role'\)\) el\.setAttribute\('role', 'button'\)/);
  assert.match(router, /role !== 'button' && role !== 'switch' && role !== 'radio' && role !== 'tab'/);
  // No stylesheet keys the view or the bar off the old tag names.
  for (const f of ['app.css', 'screens.css', 'glass.css', 'flows.css', 'coach.css', 'ob2.css', 'focus.css', 'view-transition.css']) {
    const css = read('..', 'css', f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/(^|[\s,>+~])div\.view\b/m.test(css), `${f} selects div.view`);
    assert.ok(!/(^|[\s,>+~])div\.tabbar\b/m.test(css), `${f} selects div.tabbar`);
  }
});

test('a sheet takes focus on arrival and hands it back to its opener on close', () => {
  const router = read('router.js');
  assert.match(router, /if \(mod\.transient && enter\)/, 'focus moves into the sheet only on arrival');
  assert.match(router, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(router, /OPENER = \{ from: currentFull\(\), key: focusKeyOf\(document\.activeElement\) \}/, 'navigateTo records the opener');
  assert.match(router, /RETURN_FOCUS = \(leaving && leaving\.transient && OPENER\) \? OPENER : null/, 'goBack hands the opener to the next render');
});

test('the promotion pass reads every cursor before it writes any attribute', () => {
  const router = read('router.js');
  const i = router.indexOf('const candidates = Array.from(device.querySelectorAll(');
  assert.ok(i > 0, 'the class-based promotion must collect its candidates first');
  const block = router.slice(i, router.indexOf('candidates.forEach', i));
  assert.ok(/getComputedStyle\(el\)\.cursor/.test(block), 'the reads happen in the map pass');
  assert.ok(!/promote\(/.test(block), 'no write may sit between the reads');
});
