/* Compare is a MODE of #progress-photos, not a route.
 *
 * It shipped as its own screen (#progress-compare) for a while, and it was never a destination:
 * the only door was a button on the photo timeline, it read that module's photo list and that
 * module's signed-URL map, and its back chip came straight back. This suite is the net for the
 * fold-in, and it pins the four things a repaint-based mode can quietly break:
 *
 *   1. both panels still render from a fixture, with the picker under them;
 *   2. tapping a thumbnail actually changes the pair;
 *   3. the dead route has no callers left anywhere;
 *   4. switching modes does NOT refetch, re-sign, or clear what is already cached.
 *
 * (4) is the load-bearing one. A refetch is not free: a list read plus a batch signing round
 * trip. There is no Supabase client in this environment, so any list read flips CACHE.failed to
 * true and any signing call would blank the URL map. That is the detector the assertions below
 * turn on, and it is why they check identity rather than contents.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

/* ---- DOM + storage stubs, enough for module eval (mirrors client-experience.test.mjs) ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
let RENDERS = 0;
globalThis.window = {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  __render() { RENDERS++; },
};
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

const mod = await import('./progress-photos.js');
const screen = mod.default;
const cache = mod.progressPhotoCache();

/* ---- fixture: three shots, newest first, every URL already signed ---- */
const PHOTOS = [
  { id: 'p3', photo_path: 'u1/3.jpg', taken_on: '2026-08-30', weight_lb: 178, pose: 'Front', note: null },
  { id: 'p2', photo_path: 'u1/2.jpg', taken_on: '2026-08-16', weight_lb: 183, pose: 'Front', note: null },
  { id: 'p1', photo_path: 'u1/1.jpg', taken_on: '2026-08-02', weight_lb: 186, pose: 'Front', note: null },
];
/* Real-shaped signed URLs: components.js safeImg() only lets a Supabase storage URL through, so
   a made-up host would render an empty src and this suite would pass on a blank panel. */
const sign = (n) => `https://demo.supabase.co/storage/v1/object/sign/progress-photos/u1/${n}.jpg`;
const URLS = { 'u1/1.jpg': sign(1), 'u1/2.jpg': sign(2), 'u1/3.jpg': sign(3) };

/* A root that answers the handful of selectors mount() asks for, and records the handlers so a
   test can fire a real click the way a thumb would. */
function node(attrs = {}) {
  const handlers = [];
  return {
    disabled: false, value: '', files: null,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (ev, fn) => { if (ev === 'click') handlers.push(fn); },
    click: () => handlers.forEach((fn) => fn()),
    querySelector: () => null, querySelectorAll: () => [],
  };
}
function rootOf(map) {
  return {
    querySelector: (sel) => (map[sel] && map[sel][0]) || null,
    querySelectorAll: (sel) => map[sel] || [],
  };
}
/* Every test starts from the same known state: the fixture cached, both URLs signed, timeline
   showing, no pair picked. Module state is deliberately long-lived in this screen, so a suite
   that leaned on the previous test's leftovers would be pinning nothing. */
function reset({ photos = PHOTOS.slice(), failed = false } = {}) {
  cache.photos = photos;
  cache.urls = { ...URLS };
  cache.loading = false; cache.resolving = false; cache.failed = failed;
  // Drive the mode control back to the timeline the way a person would, then clear the pair by
  // switching to a photo set the selection cannot survive and back again.
  setMode('timeline');
  pick('before', null); pick('after', null);
}
function modeNodes() {
  return { '[data-pp-mode]': [node({ 'data-pp-mode': 'timeline' }), node({ 'data-pp-mode': 'compare' })] };
}
function setMode(m) {
  const nodes = modeNodes();
  screen.mount(rootOf(nodes));
  nodes['[data-pp-mode]'][m === 'timeline' ? 0 : 1].click();
  return nodes;
}
/* Tap a thumbnail in one of the two picker strips. `null` re-selects the default. */
function pick(side, id) {
  const n = node({ 'data-cmp-side': side, 'data-cmp-id': id == null ? '' : id });
  screen.mount(rootOf({ '[data-cmp-id]': [n] }));
  n.click();
}

/* ================================================================ the control itself */

test('the mode switch is the shared .seg radiogroup, not a new control', () => {
  reset();
  const html = screen.render();
  assert.match(html, /<div class="seg pp-modes" role="radiogroup" aria-label="Photo view">/);
  assert.match(html, /data-pp-mode="timeline" role="radio" aria-checked="true"/);
  assert.match(html, /data-pp-mode="compare" role="radio" aria-checked="false"/);
  assert.ok(html.includes('>Timeline<') && html.includes('>Compare<'), 'both halves are labelled');
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1, 'exactly one half is checked');
  // The timeline keeps its own chrome, and the old cross-route button is gone.
  assert.match(html, /id="pp-add"/);
  assert.ok(!html.includes('data-go="progress-compare"'));
});

test('the back chip points at Progress in BOTH modes: a mode is not a page to escape', () => {
  reset();
  assert.match(screen.render(), /data-back="progress"/);
  setMode('compare');
  const compare = screen.render();
  assert.match(compare, /data-back="progress"/);
  // ...and the way back to the timeline is on screen, so compare is never a dead end.
  assert.match(compare, /data-pp-mode="timeline" role="radio" aria-checked="false"/);
  assert.match(compare, /data-pp-mode="compare" role="radio" aria-checked="true"/);
});

/* ================================================================ compare mode renders */

test('compare mode renders both panels, the delta and the picker from a fixture', () => {
  reset();
  setMode('compare');
  const html = screen.render();
  // Before = oldest, after = newest, straight off a newest-first list.
  assert.match(html, /<div class="cmp-panel"><div class="cmp-lab">Before<\/div>/);
  assert.match(html, /<div class="cmp-panel"><div class="cmp-lab">After<\/div>/);
  assert.ok(html.includes(`src="${sign(1)}"`), 'the Before panel shows the oldest shot');
  assert.ok(html.includes(`src="${sign(3)}"`), 'the After panel shows the newest shot');
  // 186 lb on Aug 2 against 178 lb on Aug 30.
  assert.match(html, /<div class="cmp-delta"><b>-8 lb<\/b> over 28 days<\/div>/);
  // One picker strip per side, every photo in each, the current pick pressed.
  assert.equal((html.match(/class="cmp-strip"/g) || []).length, 2);
  assert.equal((html.match(/data-cmp-side="before"/g) || []).length, PHOTOS.length);
  assert.equal((html.match(/data-cmp-side="after"/g) || []).length, PHOTOS.length);
  assert.match(html, /data-cmp-side="before" data-cmp-id="p1" aria-pressed="true"/);
  assert.match(html, /data-cmp-side="after" data-cmp-id="p3" aria-pressed="true"/);
});

test('the picker changes the pair, and the pick survives the repaint', () => {
  reset();
  setMode('compare');
  const before = RENDERS;
  pick('before', 'p2');
  assert.ok(RENDERS > before, 'a pick repaints the screen');
  const html = screen.render();
  assert.match(html, /data-cmp-side="before" data-cmp-id="p2" aria-pressed="true"/);
  assert.match(html, /data-cmp-side="before" data-cmp-id="p1" aria-pressed="false"/);
  assert.ok(html.includes(`src="${sign(2)}"`), 'the Before panel followed the pick');
  // The pair is now 183 lb on Aug 16 against 178 lb on Aug 30.
  assert.match(html, /<b>-5 lb<\/b> over 14 days/);
  // The selection is module state, so a second paint with no interaction keeps it.
  assert.match(screen.render(), /data-cmp-side="before" data-cmp-id="p2" aria-pressed="true"/);
  // And the after side is pickable on its own.
  pick('after', 'p2');
  assert.match(screen.render(), /data-cmp-side="after" data-cmp-id="p2" aria-pressed="true"/);
});

test('a pair that no longer exists falls back to real photos instead of blank panels', () => {
  reset();
  setMode('compare');
  pick('before', 'p2');
  // The athlete deletes the shot they had picked.
  cache.photos = PHOTOS.filter((p) => p.id !== 'p2');
  const html = screen.render();
  assert.match(html, /data-cmp-side="before" data-cmp-id="p1" aria-pressed="true"/);
  assert.ok(!html.includes('data-cmp-id="p2"'), 'the deleted shot is out of both strips');
  assert.ok(!html.includes('<div class="cmp-empty">'), 'neither panel fell back to a placeholder');
});

test("compare's own empty and error states survived the fold-in", () => {
  reset({ photos: [PHOTOS[0]] });
  setMode('compare');
  let html = screen.render();
  assert.match(html, /Two photos needed/);
  assert.match(html, /line up any before against any after/);

  // A FAILED load is the opposite message, and it keeps a retry.
  reset({ photos: [], failed: true });
  setMode('compare');
  html = screen.render();
  assert.match(html, /Couldn&#39;t load your photos/);
  assert.match(html, /Nothing was deleted\./);
  assert.match(html, /id="pp-retry"/);
  assert.ok(!html.includes('Two photos needed'), 'a dropped connection never reads as "go add two"');
  // The way back to the timeline is still on screen in every one of those states.
  assert.match(html, /data-pp-mode="timeline"/);
});

/* ================================================================ the cache is not disturbed */

test('switching modes does not refetch, re-sign, or clear the cache', () => {
  reset();
  setMode('compare');
  pick('before', 'p2');
  const photosRef = cache.photos;
  const urlsRef = cache.urls;

  setMode('timeline');
  screen.render();
  setMode('compare');
  screen.render();

  assert.equal(cache.photos, photosRef, 'the photo list is the same array, not a refetched one');
  assert.equal(cache.urls, urlsRef, 'the signed-URL map is the same object');
  assert.deepEqual(Object.keys(cache.urls).sort(), Object.keys(URLS).sort());
  // The detector: with no Supabase client here, ANY list read sets failed and clears loading last.
  assert.equal(cache.failed, false, 'no list read was issued');
  assert.equal(cache.loading, false, 'no list read was issued');
  assert.equal(cache.resolving, false, 'no signing round trip was left in flight');
  // ...and the pair the athlete picked is still theirs.
  assert.match(screen.render(), /data-cmp-side="before" data-cmp-id="p2" aria-pressed="true"/);
});

test('re-tapping the mode already showing is a no-op, not a repaint', () => {
  reset();
  const nodes = setMode('compare');
  screen.render();
  const before = RENDERS;
  nodes['[data-pp-mode]'][1].click();
  assert.equal(RENDERS, before, 'the current mode does not repaint itself');
});

/* ================================================================ the route is gone */

test('the #progress-compare route is deleted and has no callers anywhere', () => {
  assert.ok(!existsSync(join(here, 'progress-compare.js')), 'the screen file is gone');
  const registry = read('index.js');
  assert.ok(!registry.includes('progress-compare'), 'the registry entry is gone');
  const screenSrc = read('progress-photos.js');
  assert.ok(!/data-go="progress-compare"/.test(screenSrc), 'the old Compare button is gone');
  assert.ok(!/from '\.\/progress-compare\.js'/.test(screenSrc), 'nothing imports the old module');
  // The capture sweep reaches compare through the mode control, so a removed route can never
  // silently become a #notfound screenshot.
  const qc = readFileSync(join(here, '../../../../scripts/qc-capture.mjs'), 'utf8');
  assert.ok(!qc.includes("route: 'progress-compare'"), 'no shot points at the dead route');
  assert.match(qc, /data-pp-mode="compare"/);
});

test('the fold-in added no inline styles, and every compare rule still has a caller', () => {
  const src = read('progress-photos.js');
  // Ceiling from tools/inline-style-baseline.json at the time of the fold-in. Compare arrived
  // with zero of its own: every hand-written margin it carried became a class.
  assert.ok((src.match(/style\s*=\s*["']/g) || []).length <= 18, 'inline-style ratchet ceiling held');
  assert.ok(!src.includes('margin-top:14px'), 'the picker headings use .cmp-pick');
  const css = read('../../css/screens.css');
  assert.match(css, /\.cmp-pick\{margin-top:var\(--s3h\)\}/);
  assert.match(css, /\.pp-modes\{margin:var\(--s3\) 0\}/);
  // Every .cmp- rule that survived still has a caller in the merged screen.
  for (const cls of ['cmp-row', 'cmp-panel', 'cmp-lab', 'cmp-img', 'cmp-empty', 'cmp-sub', 'cmp-delta', 'cmp-strip', 'cmp-thumb', 'cmp-thumb-img', 'cmp-thumb-load', 'cmp-pick']) {
    assert.ok(src.includes(cls), `.${cls} is still rendered by progress-photos.js`);
  }
});
