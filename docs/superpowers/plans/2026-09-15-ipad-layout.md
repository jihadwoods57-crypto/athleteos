# iPad Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OnStandard a real iPad app: full screen in every orientation and Split View, a navigation rail plus a centered column on every screen, and master/detail panes for the coach's roster and inbox.

**Architecture:** One root attribute, `html[data-layout]` (`wide` at 700px+, `split` at 1000px+), is owned by a new `js/layout.js` and read by a new `css/wide.css`, so the phone is untouched by construction. The router learns one contract, `pane: 'master' | 'detail'` on a screen module, and in the split tier renders the master beside the detail. The native shell flips `supportsTablet` and drops its 440px cap.

**Tech Stack:** Expo SDK 57 (`app.json` config plugins), plain ES modules + CSS in `proto/redesign-2026-07/` (no bundler), `node:test` suites run by `npm run test:proto`, `npm run verify` gates.

**Spec:** `docs/superpowers/specs/2026-09-15-ipad-layout-design.md`

## Global Constraints

- Below 700px wide, nothing changes. Every new CSS rule is scoped under `html[data-layout]`.
- The tier applies only when `(pointer: coarse) and (hover: none)` matches, or `?layout=auto` is in `location.search`.
- No new inline `style=` attributes in proto JS (inline-style ratchet). No off-scale px padding/margin/gap (spacing ratchet: 4/8/12/16/20/24/32/40/56 plus 6/10/14/18). No new raw `font-size` (type ratchet). No em dashes in copy.
- Commit with explicit paths, never `git add -A` (shared working tree).
- `wide.css` links after `glass.css` and before `focus.css`.
- Phone stays `orientation: "portrait"`; `ios.requireFullScreen` stays unset.

---

### Task 1: Native shell flags

**Files:**
- Modify: `app.json` (`ios.supportsTablet`)
- Modify: `app/_layout.tsx:14,40-45,68-72`
- Modify: `docs/APP-STORE-READINESS.md`

- [ ] **Step 1: Flip the flag**

In `app.json` set `"supportsTablet": true`. Add a sibling comment key `"_supportsTablet_comment": "2026-09-15: iPad is a first-class target. Expo's withRequiresFullScreen plugin writes all four UISupportedInterfaceOrientations~ipad values because requireFullScreen is unset; orientation:'portrait' above still locks the PHONE. Do not add the ~ipad key by hand."`

- [ ] **Step 2: Drop the max-width cap**

In `app/_layout.tsx` remove `DEVICE_MAX_WIDTH` from the tokens import, delete the `flow`/`isOversight`/`frameMaxWidth` block and `useWindowDimensions` import, and replace the two nested Views with one:

```tsx
<View style={{ flex: 1, backgroundColor: palette.bg }}>
  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
</View>
```

Replace the comment above it with: `// The proto owns layout at every width (css/wide.css); the shell never boxes it.`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .` Expected: clean (an unused `useStore` import will fail here; remove it if so).

- [ ] **Step 4: Note the screenshot debt**

Append to `docs/APP-STORE-READINESS.md` a short section "iPad (2026-09-15)": tablet support is on, so App Store Connect requires 12.9" and 13" iPad screenshots alongside the phone set; the layout is in `css/wide.css`; a new EAS build is required (an OTA cannot change `supportsTablet`).

- [ ] **Step 5: Commit**

```bash
git add app.json app/_layout.tsx docs/APP-STORE-READINESS.md
git commit -m "feat(ios): the app is an iPad app; the shell stops boxing the proto"
```

---

### Task 2: `js/layout.js` with tests

**Files:**
- Create: `proto/redesign-2026-07/js/layout.js`
- Test: `proto/redesign-2026-07/js/layout.test.mjs`

**Interfaces:**
- Produces: `WIDE_MIN = 700`, `SPLIT_MIN = 1000`, `layoutTier(width, phoneNative, force) -> 'wide' | 'split' | null`, `masterFor({ mod, route, tab, tabs, modOf }) -> null | { route, mod, self } | { route, mod: null, pending: true }`, `initLayout(onChange)`, `currentTier()`.

- [ ] **Step 1: Write the failing tests**

```js
/* The layout tier and the master/detail pairing (js/layout.js), tested without a DOM. Run:
 *   node --test proto/redesign-2026-07/js/layout.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDE_MIN, SPLIT_MIN, layoutTier, masterFor } from './layout.js';

test('the tier is keyed on width and only on a touch device without hover', () => {
  assert.equal(WIDE_MIN, 700); assert.equal(SPLIT_MIN, 1000);
  assert.equal(layoutTier(699, true), null);
  assert.equal(layoutTier(700, true), 'wide');
  assert.equal(layoutTier(999, true), 'wide');
  assert.equal(layoutTier(1000, true), 'split');
  assert.equal(layoutTier(1366, true), 'split');
  assert.equal(layoutTier(1366, false), null, 'a desktop browser keeps the phone bezel');
  assert.equal(layoutTier(1366, false, true), 'split', '?layout=auto drops the pointer condition');
  assert.equal(layoutTier(320, true), null, 'Slide Over is the phone layout');
});

const TABS = [
  { id: 'home', route: 'coach-home' }, { id: 'roster', route: 'coach-roster' },
  { id: 'create', route: 'coach-create', fab: true }, { id: 'inbox', route: 'coach-inbox' },
];
const ROSTER = { pane: 'master' };
const ATHLETE = { pane: 'detail' };

test('a master route pairs with itself', () => {
  const r = masterFor({ mod: ROSTER, route: 'coach-roster', tab: 'roster', tabs: TABS, modOf: () => ROSTER });
  assert.deepEqual(r, { route: 'coach-roster', mod: ROSTER, self: true });
});

test('a detail pairs with the loaded master behind its origin tab', () => {
  const r = masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'roster', tabs: TABS, modOf: (x) => (x === 'coach-roster' ? ROSTER : undefined) });
  assert.deepEqual(r, { route: 'coach-roster', mod: ROSTER, self: false });
});

test('a detail whose master has not loaded yet asks for it', () => {
  const r = masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'roster', tabs: TABS, modOf: () => null });
  assert.deepEqual(r, { route: 'coach-roster', mod: null, pending: true });
});

test('a detail opened from Home, a plain screen, and a sheet all render one column', () => {
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'home', tabs: TABS, modOf: () => ({}) }), null);
  assert.equal(masterFor({ mod: {}, route: 'coach-home', tab: 'home', tabs: TABS, modOf: () => ROSTER }), null);
  assert.equal(masterFor({ mod: { pane: 'detail', transient: true }, route: 'log', tab: 'roster', tabs: TABS, modOf: () => ROSTER }), null);
  assert.equal(masterFor({ mod: ATHLETE, route: 'coach-athlete', tab: 'nope', tabs: TABS, modOf: () => ROSTER }), null);
  assert.equal(masterFor({ mod: null, route: 'x', tab: 'roster', tabs: TABS, modOf: () => ROSTER }), null);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test proto/redesign-2026-07/js/layout.test.mjs` Expected: fails, module not found.

- [ ] **Step 3: Implement**

```js
/* The layout tier: ONE root attribute, html[data-layout], that css/wide.css keys every wide-screen
   rule on and the router reads to decide whether a route renders beside its list. Absent below
   700px (the phone, and a Slide Over strip); 'wide' from 700; 'split' from 1000. Only on a touch
   device with no hover, the same condition app.css uses for phone-native mode, so the desktop
   preview at :8124 keeps its bezel unless ?layout=auto asks otherwise. */
export const WIDE_MIN = 700;
export const SPLIT_MIN = 1000;

export function layoutTier(width, phoneNative, force = false) {
  if (!phoneNative && !force) return null;
  if (width >= SPLIT_MIN) return 'split';
  if (width >= WIDE_MIN) return 'wide';
  return null;
}

/* Which list a screen renders beside, in the split tier. A master pairs with itself (its detail
   pane shows a placeholder); a detail pairs with the master behind its ORIGIN tab, and only when
   that module has loaded and declares itself a master. `pending` asks the router to load it. */
export function masterFor({ mod, route, tab, tabs, modOf }) {
  if (!mod || mod.transient) return null;
  if (mod.pane === 'master') return { route, mod, self: true };
  if (mod.pane !== 'detail') return null;
  const t = (tabs || []).find((x) => x.id === tab && !x.fab);
  if (!t || t.route === route) return null;
  const m = modOf(t.route);
  if (m === null) return { route: t.route, mod: null, pending: true };
  if (!m || m.pane !== 'master') return null;
  return { route: t.route, mod: m, self: false };
}

export function currentTier() {
  return typeof document === 'undefined' ? null : (document.documentElement.getAttribute('data-layout') || null);
}

/* Keeps html[data-layout] honest as the iPad rotates or a Split View divider moves, and tells the
   router when it changed so the shell re-lays out. */
export function initLayout(onChange) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const force = /(?:^|[?&])layout=auto(?:&|$)/.test(location.search);
  const mq = window.matchMedia ? window.matchMedia('(pointer: coarse) and (hover: none)') : null;
  const apply = () => {
    const tier = layoutTier(window.innerWidth, !!(mq && mq.matches), force);
    const was = currentTier();
    if (tier) document.documentElement.setAttribute('data-layout', tier);
    else document.documentElement.removeAttribute('data-layout');
    if (tier !== was && onChange) onChange(tier, was);
  };
  apply();
  window.addEventListener('resize', apply);
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
}
```

- [ ] **Step 4: Run to see it pass**

Run: `node --test proto/redesign-2026-07/js/layout.test.mjs` Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/layout.js proto/redesign-2026-07/js/layout.test.mjs
git commit -m "feat(proto): the layout tier, one root attribute the wide screen keys on"
```

---

### Task 3: The rail and the column (`css/wide.css`, `tabbar()` `--n`)

**Files:**
- Create: `proto/redesign-2026-07/css/wide.css`
- Modify: `proto/redesign-2026-07/index.html:58-60` (link)
- Modify: `proto/redesign-2026-07/js/router.js:164` (tabbar inline style), top of file (initLayout)
- Modify: `proto/redesign-2026-07/css/app.css:596-604` (`.tabbar` grid columns)
- Test: `proto/redesign-2026-07/js/wide.test.mjs`

- [ ] **Step 1: Write the failing contract tests**

```js
/* The wide-screen layer (css/wide.css) keeps the promise that the phone is untouched: every rule
   is scoped under html[data-layout], the file sits between glass and focus, and the rail is the
   same tab bar markup. Regex over sources, in the manner of glass.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/wide.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const WIDE = read('..', 'css', 'wide.css');
const APP = read('..', 'css', 'app.css');
const INDEX = read('..', 'index.html');
const ROUTER = read('router.js');

test('wide.css links after glass.css and before focus.css', () => {
  const wide = INDEX.indexOf('css/wide.css'), glass = INDEX.indexOf('css/glass.css'), focus = INDEX.indexOf('css/focus.css');
  assert.ok(wide > glass && wide < focus);
});

test('every rule in wide.css is scoped under html[data-layout] (the phone is untouched by construction)', () => {
  const stripped = WIDE.replace(/\/\*[\s\S]*?\*\//g, '');
  // Top-level selectors: text before a `{` at nesting depth 0, outside @keyframes bodies.
  const selectors = [];
  let depth = 0, buf = '', inKeyframes = false;
  for (const ch of stripped) {
    if (ch === '{') {
      const sel = buf.trim(); buf = '';
      if (depth === 0) { inKeyframes = sel.startsWith('@keyframes'); if (!inKeyframes && !sel.startsWith('@')) selectors.push(sel); }
      else if (!inKeyframes && !selectors.at(-1)?.startsWith('@')) selectors.push(sel);
      depth++;
    } else if (ch === '}') { depth--; buf = ''; }
    else buf += ch;
  }
  const bad = selectors.filter((s) => !s.split(',').every((part) => /^\s*html\[data-layout/.test(part)));
  assert.deepEqual(bad, [], 'unscoped selectors in wide.css');
});

test('the tab bar publishes its column count as --n instead of an inline grid', () => {
  assert.ok(!/grid-template-columns:\s*repeat\(\$\{tabs\.length\}/.test(ROUTER));
  assert.ok(/style="--n:\s*\$\{tabs\.length\}"/.test(ROUTER));
  assert.ok(/\.tabbar\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--n,\s*5\),\s*1fr\)/.test(APP));
});

test('the rail overrides the capsule geometry and the bottom clearance', () => {
  assert.ok(/html\[data-layout\]\s*\{[^}]*--tab-clear:/.test(WIDE));
  assert.ok(/html\[data-layout\]\s+\.tabbar\s*\{[^}]*width:\s*var\(--rail-w\)/.test(WIDE));
  assert.ok(/html\[data-layout\]\s+\.view\s*\{[^}]*max-width:\s*720px/.test(WIDE));
  assert.ok(/html\[data-layout\]\s+body\.kb-open\s+\.tabbar\s*\{[^}]*transform:\s*none/.test(WIDE));
});

test('the router installs the layout tier once and repaints on a change', () => {
  assert.ok(/import \{[^}]*initLayout[^}]*\} from '\.\/layout\.js'/.test(ROUTER));
  assert.ok(/initLayout\(\(\)\s*=>/.test(ROUTER));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test proto/redesign-2026-07/js/wide.test.mjs` Expected: fails on the missing file.

- [ ] **Step 3: `--n` on the tab bar**

In `js/router.js:164` change `style="grid-template-columns: repeat(${tabs.length}, 1fr)"` to `style="--n: ${tabs.length}"`. In `css/app.css` `.tabbar` rule change `grid-template-columns: repeat(5, 1fr)` to `grid-template-columns: repeat(var(--n, 5), 1fr)`. Add after `initKeyboard();` in router.js:

```js
import { initLayout, currentTier, masterFor } from './layout.js';
// The wide-screen tier (iPad): html[data-layout] is set here once and kept current on rotate and
// Split View resize; a tier change re-lays the shell out, and render() reads it for the panes.
initLayout(() => { if (window.__render) window.__render(); });
```

(Place the import with the other imports; `currentTier`/`masterFor` are used in Task 4.)

- [ ] **Step 4: Write `css/wide.css`**

```css
/* OnStandard, the wide screen (iPad). Every rule is scoped under html[data-layout], which
   js/layout.js sets to 'wide' from 700px and 'split' from 1000px on a touch device with no hover.
   Absent on the phone, so this file cannot touch it. Linked after glass.css (it overrides the
   capsule) and before focus.css (which owns ::after). Design: docs/superpowers/specs/2026-09-15-ipad-layout-design.md */

html[data-layout] {
  --rail-w: 88px;
  --pane-master-w: 380px;
  /* Nothing floats over the bottom edge any more, so the clearance is the inset plus a breath. */
  --tab-clear: calc(24px + env(safe-area-inset-bottom, 0px));
}

/* ===== The rail: the same tab bar markup, stood on its side ===== */
html[data-layout] .screen { padding-left: calc(var(--rail-w) + env(safe-area-inset-left, 0px)); }
html[data-layout] .tabbar {
  position: absolute; left: 0; right: auto; top: 0; bottom: 0;
  width: var(--rail-w); height: auto;
  padding: calc(env(safe-area-inset-top, 0px) + var(--s4)) 0 var(--s4);
  display: grid; grid-template-columns: 1fr; grid-template-rows: repeat(var(--n, 5), 64px);
  align-content: start; align-items: center;
  border-radius: 0; border: 0; border-right: 1px solid var(--hairline);
  box-shadow: none; transform: none;
}
html[data-layout] .tabbar::before { display: none; }
html[data-layout] .tab { gap: var(--s1); }
html[data-layout] .tabbar .fab { margin-top: 0; }
html[data-layout] .tabbar .fabslot::before { display: none; }
html[data-layout] .tab-lens {
  top: calc(env(safe-area-inset-top, 0px) + var(--s4)); bottom: auto;
  left: var(--s2); right: var(--s2); width: auto; height: 64px;
  transform: translate3d(0, calc(var(--i, 0) * 100%), 0);
}
html[data-layout] .tabbar.switch .tab-lens { animation-name: railLensSlide; }
@keyframes railLensSlide { from { transform: translate3d(0, calc(var(--from, 0) * 100%), 0); } }
/* The rail does not leave for the keyboard; there is nothing under it to reach. */
html[data-layout] body.kb-open .tabbar { transform: none; }

/* ===== The column: every screen, every role ===== */
html[data-layout] .viewport { padding-left: var(--s6); padding-right: var(--s6); }
html[data-layout] .view { max-width: 720px; width: 100%; margin: 0 auto; }

/* ===== Bottom-anchored overlays become centered dialogs ===== */
html[data-layout] .sheet {
  left: 50%; right: auto; top: 50%; bottom: auto;
  width: min(480px, calc(100% - var(--s9)));
  transform: translate(-50%, -50%);
  animation: dialogIn var(--dur-2) var(--ease-out);
  box-shadow: var(--glass-shadow);
}
@keyframes dialogIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } }
html[data-layout] .memsheet, html[data-layout] .mqsheet { place-items: center; padding: 0 0 var(--kb, 0px); }

/* ===== Split: the list stays while the detail opens beside it ===== */
html[data-layout="split"] .screen.split {
  display: grid;
  grid-template-columns: var(--pane-master-w) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}
html[data-layout="split"] .screen.split > .statusbar { grid-column: 1 / -1; }
html[data-layout="split"] .screen.split > .tabbar { grid-row: 1 / -1; }
html[data-layout="split"] .pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
html[data-layout="split"] .pane-master { border-right: 1px solid var(--hairline); }
html[data-layout="split"] .pane > .viewport { flex: 1 1 auto; min-height: 0; }
html[data-layout="split"] .pane-master .viewport { padding-left: var(--s4); padding-right: var(--s4); }
html[data-layout="split"] .pane-master .view { max-width: none; }
html[data-layout="split"] .pane-master [aria-current="page"] { background: var(--blue-surface); box-shadow: inset 0 0 0 1px var(--blue-border); border-radius: var(--r-card-sm); }
html[data-layout="split"] .pane-empty { display: grid; place-items: center; min-height: 60vh; }
```

Link it in `index.html` directly after the `glass.css` line: `<link rel="stylesheet" href="./css/wide.css" />`.

- [ ] **Step 5: Run the tests and the ratchets**

Run: `node --test proto/redesign-2026-07/js/wide.test.mjs proto/redesign-2026-07/js/glass.test.mjs && npm run lint:inline && npm run lint:space && npm run lint:type` Expected: all pass. If the spacing ratchet objects to a px value, use a token.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/css/wide.css proto/redesign-2026-07/css/app.css proto/redesign-2026-07/index.html proto/redesign-2026-07/js/router.js proto/redesign-2026-07/js/wide.test.mjs
git commit -m "feat(proto): the rail and the column, the wide screen's shell"
```

---

### Task 4: Two-pane in the router, the module contract, the gesture gate

**Files:**
- Modify: `proto/redesign-2026-07/js/router.js` (render: after `activeTab`; `layered`/`vtDir`; `commit()` html; after commit; mount)
- Modify: `proto/redesign-2026-07/js/screens/coach-roster.js:310`, `js/screens/coach.js:107,453,1809,2726,3186`
- Modify: `proto/redesign-2026-07/js/gestures.js:65-67,167`
- Test: `proto/redesign-2026-07/js/wide.test.mjs` (declarations), `js/gestures.test.mjs` (split refusal)

- [ ] **Step 1: Failing tests**

Append to `wide.test.mjs`:

```js
test('the two masters and four details declare their pane', () => {
  const ROSTER = read('screens', 'coach-roster.js'), COACH = read('screens', 'coach.js');
  assert.ok(/export const coachRoster = \{\s*nav: 'operator', tab: 'roster', pane: 'master'/.test(ROSTER));
  for (const [name, pane] of [['coachInbox', 'master'], ['coachAthlete', 'detail'], ['coachMeal', 'detail'], ['coachPlan', 'detail'], ['coachAssign', 'detail']]) {
    assert.ok(new RegExp(`export const ${name} = \\{[^}]*?pane: '${pane}'`).test(COACH), `${name} must declare pane: '${pane}'`);
  }
});

test('the router renders the master beside the detail and marks the open row', () => {
  assert.ok(/class="screen split"/.test(ROUTER));
  assert.ok(/pane pane-master/.test(ROUTER) && /pane pane-detail/.test(ROUTER));
  assert.ok(/id="viewport-master"/.test(ROUTER));
  assert.ok(/aria-current', 'page'/.test(ROUTER));
});
```

Append to `gestures.test.mjs`:

```js
test('a split screen refuses the back drag: the list is already beside the detail', () => {
  assert.equal(eligibleBack({ nav: 'operator' }, true), false);
  assert.equal(eligibleBack({ nav: 'operator' }, false), true);
});
```

Run both: expect failures.

- [ ] **Step 2: Declare the panes**

`coach-roster.js:311`: `nav: 'operator', tab: 'roster', pane: 'master',`. In `coach.js` add `pane: 'master',` to `coachInbox` (line ~1810) and `pane: 'detail',` to `coachAthlete`, `coachMeal`, `coachPlan`, `coachAssign` on their `nav:` line.

- [ ] **Step 3: Gesture gate**

`gestures.js`:
```js
export function eligibleBack(mod, split = false) {
  return !split && !!mod && !mod.transient && !mod.bleed;
}
```
In `initGestures` touchstart: `const split = !!device.querySelector('.screen.split');` then `if (x <= EDGE && eligibleBack(cur.mod, split) && api.backTarget() && ...)`, and the pager line `target.closest('#viewport')` instead of `.viewport`. Update the header comment: "In the split tier the list is beside the detail, so there is nothing to slide back to, and the pager arms only inside the detail's own viewport."

- [ ] **Step 4: Router pairing**

In `render()` after `const activeTab = ...` add:

```js
  // The split tier (iPad, 1000px+): a master renders beside its detail. Resolved here, before
  // the transition decisions, because a paired render is never a slide or a morph. A master that
  // has not loaded is asked for and the detail paints alone until it lands.
  const pairing = (currentTier() === 'split' && !denied && !prehydrate)
    ? masterFor({ mod, route, tab: NAV.tab, tabs: NAVS[navRole] || [], modOf }) : null;
  if (pairing && pairing.pending) loadScreen(pairing.route).then(() => { if (window.__render) window.__render(); }, () => { /* renders alone */ });
  const paired = pairing && pairing.mod ? pairing : null;
  const prevMasterVp = document.getElementById('viewport-master');
  const prevMasterScroll = prevMasterVp ? prevMasterVp.scrollTop : 0;
```

Change `const layered = !!(enter && ...` to include `&& !paired`, and `const vtDir = layered ? null : ((enter || restate) ? dir : null);` to `const vtDir = (layered || paired) ? null : (...)`.

In `commit()` replace the `const html = ...` template with:

```js
  const vpCls = `viewport ${mod.bleed ? 'bleed' : ''}${mod.hideTabs ? ' notabs' : ''}${mod.fill ? ' fill' : ''}`;
  const busy = prehydrate ? ' aria-busy="true"' : '';
  const own = `<main class="view${enterCls}${dirClsUsed}${settleCls}" id="view">${body}</main>`;
  let inner;
  if (paired && paired.self) {
    // The master IS the current screen: it keeps #viewport/#view and the detail pane is a prompt.
    inner = `<div class="pane pane-master"><div class="${vpCls}" id="viewport"${busy}>${own}</div></div>
      <div class="pane pane-detail"><div class="viewport"><main class="view">${panePlaceholder(route)}</main></div></div>`;
  } else if (paired) {
    const masterBody = memoTick(() => paired.mod.render({ sub: null, S }));
    inner = `<div class="pane pane-master"><div class="viewport" id="viewport-master"><main class="view" id="view-master">${masterBody}</main></div></div>
      <div class="pane pane-detail"><div class="${vpCls}" id="viewport"${busy}>${own}</div></div>`;
  } else {
    inner = `<div class="${vpCls}" id="viewport"${busy}>${own}</div>`;
  }
  const html = `
    <div class="island"></div>
    <div class="screen${paired ? ' split' : ''}">
      ${statusbar()}
      ${inner}
      ${mod.hideTabs ? '' : memoTick(() => tabbar(activeTab, navRole))}
    </div>`;
```

Add near `statusbar()`:

```js
/* The detail pane before anything is chosen (split tier). The noun follows the book. */
function panePlaceholder(masterRoute) {
  const noun = CD.kind === 'practice' ? 'client' : 'athlete';
  const inbox = /inbox/.test(masterRoute);
  return `<div class="pane-empty">${emptyState({
    icon: inbox ? 'message' : 'users',
    title: inbox ? 'Choose a thread' : `Choose ${noun === 'athlete' ? 'an' : 'a'} ${noun}`,
    body: inbox ? 'It opens here, and the inbox stays put.' : `Their day opens here, and the roster stays put.`,
  })}</div>`;
}
```
and add `emptyState` to the `./components.js` import.

After the `device.innerHTML = html` / `replaceChildren` block, add:

```js
  if (paired && !paired.self) {
    // The open row, so the list says where you are.
    device.querySelectorAll('.pane-master [data-go]').forEach((el) => {
      if (el.getAttribute('data-go') === full) el.setAttribute('aria-current', 'page');
    });
    const mvp = document.getElementById('viewport-master');
    if (mvp) { try { mvp.scrollTo({ top: prevMasterScroll, behavior: 'instant' }); } catch { mvp.scrollTop = prevMasterScroll; } }
  }
```

At the mount site (`if (mod.mount && !prehydrate) mod.mount(device, { sub, S });`), before it:

```js
  // The master mounts first, against its own pane, so its lookups never reach the detail. The
  // detail mounts against #device exactly as it always has. window.__screenCleanup and
  // __threadTick are single slots: neither master (roster, inbox) registers one today; a future
  // master that does must have the router chain them here.
  if (paired && !paired.self && paired.mod.mount && !prehydrate) {
    const pane = device.querySelector('.pane-master');
    if (pane) paired.mod.mount(pane, { sub: null, S });
  }
```

- [ ] **Step 5: Run the suites**

Run: `npm run test:proto && npm run lint:undef && npm run lint:inline` Expected: green.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/router.js proto/redesign-2026-07/js/gestures.js proto/redesign-2026-07/js/gestures.test.mjs proto/redesign-2026-07/js/wide.test.mjs proto/redesign-2026-07/js/screens/coach-roster.js proto/redesign-2026-07/js/screens/coach.js
git commit -m "feat(proto): the roster and the inbox stay while their detail opens beside them"
```

---

### Task 5: Headless iPad render (opt-in) and the visual pass

**Files:**
- Create: `scripts/ipad-shots.mjs`
- Modify: `package.json` (`"shots:ipad": "node scripts/ipad-shots.mjs"`)

- [ ] **Step 1: Write the script**

Serve `proto/redesign-2026-07` on a free port with `node:http` (static, from disk), borrow `playwright-core` via `createRequire('c:/Users/Administrator/Downloads/Formation IQ/app/package.json')`, and for each viewport `[820,1180],[1180,820],[1024,1366],[375,1024]` open `index.html?layout=auto#welcome`, wait for fonts, screenshot to `.tmp/ipad-shots/<w>x<h>-welcome.png`. Then seed a coach by module mutation (`RT.userId='ipad'`, `RT.authRole='coach'`, `RT.profile={...}`, `window.sb` = a Proxy whose every call resolves `{ data: [], error: null }`), navigate `#coach-home`, `#coach-roster`, `#coach-athlete/x` and screenshot each. Assert per page: `document.documentElement.scrollWidth <= innerWidth`, `#device.scrollWidth <= #device.clientWidth`, and at width >= 700 `getComputedStyle(.tabbar).position === 'absolute' && width === 88px`; at >= 1000 on `#coach-roster` `.screen.split` exists. Print a table of results and exit 1 on any failure. If playwright-core cannot be required, print how to get it and exit 2 (never 0).

- [ ] **Step 2: Run it, read every PNG, fix what is wrong**

Run: `npm run shots:ipad`. Open each image with Read. Expected defects to look for: rail icons crowding the top, the lens missing, the FAB scrim disc, sheets off-center, the master pane's rows not highlighting, header back chip in the detail. Fix in `wide.css`, rerun until clean. Both themes: shoot with `data-theme="light"` too.

- [ ] **Step 3: Commit**

```bash
git add scripts/ipad-shots.mjs package.json proto/redesign-2026-07/css/wide.css
git commit -m "chore(proto): headless iPad render, opt-in, four viewports and both themes"
```

---

### Task 6: Ship

- [ ] **Step 1:** `node scripts/build-proto-zip.mjs` then `npm run verify`. Expected: every gate green, twelve plus none skipped.
- [ ] **Step 2:** Commit `assets/proto.zip` and `src/proto/protoVersion.ts` with explicit paths: `git commit -m "chore(proto): rebuild proto.zip with the iPad layout"`.
- [ ] **Step 3:** `git pull --rebase && git push`.
- [ ] **Step 4:** Do NOT run `eas build` or `eas update`. Report: a native build is required for `supportsTablet`; the OTA path is inert on phones.
