/* The reveal's once-only guard.
 *
 * This is the test that matters for motion.js: __render() re-runs mount(), and screens repaint for
 * reasons unrelated to the number, so an unguarded reveal replays the signature moment several
 * times per visit (which is exactly what Home was doing with its unconditional animateRing). These
 * assert the guard from both directions — the same number never replays, a NEW number always does.
 *
 * motion.js imports state.js and components.js, both of which are DOM- and app-heavy, so this suite
 * stubs the module graph rather than booting the app: the logic under test is the bookkeeping, not
 * the drawing. Run: node --test proto/redesign-2026-07/js/motion.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* A loader that resolves motion.js's two imports to in-memory stubs. Keeps this suite dependency-
   free (the repo pattern) without pulling the whole app graph into a node process with no DOM. */
const LOADER = `
const STUBS = {
  './state.js': 'export const RT = { haptics: true };',
  './components.js': 'export function animateRing(root){ (globalThis.__drawn ||= []).push(root); }\\nexport function animateFills(root){ (globalThis.__filled ||= []).push(root); }',
};
export function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: 'stub:' + spec, shortCircuit: true };
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  const key = url.startsWith('stub:') ? url.slice(5) : null;
  if (key) return { format: 'module', source: STUBS[key], shortCircuit: true };
  return next(url, ctx);
}
`;
register(`data:text/javascript,${encodeURIComponent(LOADER)}`, import.meta.url);

const { reveal, resetReveals, revealed, buzz, HAPTIC, pauseReveals, resumeReveals } = await import(
  new URL('./motion.js', import.meta.url).href
);

/* The smallest thing reveal() needs: querySelectorAll for the wind-back, offsetWidth for the
   reflow, and isConnected so the pending-node check is exercised. No IntersectionObserver is
   defined, so reveal() takes its documented synchronous path. */
function fakeRing({ connected = true, height = 200 } = {}) {
  const arc = { getAttribute: () => '185.4', style: {} };
  const num = { textContent: '84' };
  return {
    isConnected: connected,
    offsetWidth: 1,
    getBoundingClientRect: () => ({ height }),
    querySelectorAll(sel) { return sel.includes('data-count') ? [num] : [arc]; },
    _arc: arc,
    _num: num,
  };
}

test('a reveal plays once per key, however many times mount() runs', () => {
  resetReveals();
  const el = fakeRing();
  assert.equal(reveal(el, { key: 'day:2026-07-29:84', haptic: null }), true, 'first call owns it');
  assert.equal(reveal(el, { key: 'day:2026-07-29:84', haptic: null }), false, 'a repaint does not replay');
  assert.equal(reveal(el, { key: 'day:2026-07-29:84', haptic: null }), false, 'nor does the next one');
  assert.equal(revealed('day:2026-07-29:84'), true);
});

test('a NEW number reveals again — that is the part worth replaying', () => {
  resetReveals();
  const el = fakeRing();
  assert.equal(reveal(el, { key: 'day:2026-07-29:41', haptic: null }), true);
  assert.equal(reveal(el, { key: 'day:2026-07-29:67', haptic: null }), true, 'the score changed, so it draws');
});

test('the wind-back reads each arc dash length instead of assuming one ring size', () => {
  resetReveals();
  const el = fakeRing();
  reveal(el, { key: 'meal:lunch:abc', haptic: null });
  assert.equal(el._arc.style.strokeDashoffset, '185.4', 'arc wound back to its own dasharray');
  assert.equal(el._num.textContent, '0', 'number wound back to zero');
  assert.deepEqual(globalThis.__drawn?.includes(el), true, 'animateRing played it forward');
});

test('a key claimed against a node that a repaint replaced is re-claimable', () => {
  resetReveals();
  // Stand in for a below-the-fold reveal: an observer is attached, then the screen repaints and the
  // observed node is discarded. Without the isConnected check the key stays claimed forever and the
  // moment is lost for the rest of the session.
  globalThis.IntersectionObserver = class { constructor() {} observe() {} disconnect() {} };
  try {
    const seen = { key: 'meal:lunch:abc', haptic: null, whenSeen: true };
    const observed = fakeRing({ connected: true });
    assert.equal(reveal(observed, seen), true, 'claims it');
    assert.equal(reveal(observed, seen), false, 'still waiting on that node');
    observed.isConnected = false;                      // the repaint threw that node away
    assert.equal(reveal(fakeRing({ connected: true }), seen), true, 're-claimed by the live node');
  } finally {
    delete globalThis.IntersectionObserver;
  }
});

test('a whenSeen target taller than the viewport still asks for a reachable ratio', () => {
  // The regression this exists to prevent: an element taller than the screen has a maximum
  // intersection ratio of viewportHeight/elementHeight, so a fixed 0.6 means "never". The reveal
  // never played, and what stayed on screen was the markup's placeholder -- an undrawn ring
  // reading 0 where the score should be.
  resetReveals();
  let asked = null;
  globalThis.IntersectionObserver = class {
    constructor(_cb, opts) { asked = opts.threshold; }
    observe() {} disconnect() {}
  };
  globalThis.innerHeight = 844;
  try {
    reveal(fakeRing({ height: 3000 }), { key: 'tall', haptic: null, whenSeen: true });
    const max = Math.max(...asked);
    assert.ok(max <= 844 / 3000, `asked for ${max}, which a 3000px element can never reach`);

    resetReveals();
    reveal(fakeRing({ height: 120 }), { key: 'short', haptic: null, whenSeen: true, threshold: 0.6 });
    assert.ok(asked.includes(0.6), 'a small target still uses the requested threshold');
  } finally {
    delete globalThis.IntersectionObserver;
    delete globalThis.innerHeight;
  }
});

test('reveal plays immediately by default — above-the-fold rings must not wait to be seen', () => {
  resetReveals();
  globalThis.IntersectionObserver = class { constructor() { throw new Error('must not observe'); } };
  try {
    const el = fakeRing();
    assert.equal(reveal(el, { key: 'hero', haptic: null }), true);
    assert.equal(el._num.textContent, '0', 'wound back, so animateRing has a start to draw from');
  } finally {
    delete globalThis.IntersectionObserver;
  }
});

test('buzz never fires the global tap haptic, and stays silent without a bridge', () => {
  // 'tap' is the native shim's job (capture-phase light impact on every interactive element). Firing
  // it from screen code lands a second impact, which reads as one mushier buzz rather than emphasis.
  assert.equal(buzz('tap'), false);
  assert.equal(HAPTIC.tap, 'light');
  assert.equal(buzz('reveal'), false, 'no OnStandardNative in node — silent, not a throw');
});

test('buzz maps the vocabulary to real bridge styles', () => {
  const seen = [];
  globalThis.window = { OnStandardNative: { haptic: (s) => seen.push(s) } };
  try {
    buzz('reveal'); buzz('lock'); buzz('milestone'); buzz('warn');
    assert.deepEqual(seen, ['success', 'heavy', 'success', 'warning']);
  } finally {
    delete globalThis.window;
  }
});

/* ---- reveals held while the screen itself is moving (js/view-transition.js) --------------- */

test('a paused reveal is HELD, not skipped, and plays when the screen stops moving', () => {
  resetReveals();
  globalThis.__drawn = [];
  const el = fakeRing();
  pauseReveals();
  assert.equal(reveal(el, { key: 'day:2026-08-16:84', haptic: null }), true, 'the claim still happens');
  assert.equal(el._num.textContent, '84', 'nothing is wound back while the screen is in flight');
  assert.equal(globalThis.__drawn.length, 0);
  resumeReveals();
  assert.equal(el._num.textContent, '0', 'wound back only once there is a settled screen to draw on');
  assert.equal(globalThis.__drawn.length, 1);
});

test('a dropped reveal never draws, and its key is retired so it cannot fire later', () => {
  resetReveals();
  globalThis.__drawn = [];
  pauseReveals();
  reveal(fakeRing(), { key: 'day:2026-08-16:84', haptic: null });
  // A ring that MORPHED across the navigation has already landed; drawing it again would wind the
  // number back to zero after the athlete has already read it.
  resumeReveals({ drop: true });
  assert.equal(globalThis.__drawn.length, 0);
  assert.equal(revealed('day:2026-08-16:84'), true, 'retired, so the next repaint does not replay the moment it missed');
  assert.equal(reveal(fakeRing(), { key: 'day:2026-08-16:84', haptic: null }), false);
});

test('the queue holds several reveals and releases them in order', () => {
  resetReveals();
  globalThis.__drawn = [];
  pauseReveals();
  const a = fakeRing(), b = fakeRing();
  reveal(a, { key: 'a', haptic: null });
  reveal(b, { key: 'b', haptic: null });
  assert.equal(globalThis.__drawn.length, 0);
  resumeReveals();
  assert.deepEqual(globalThis.__drawn, [a, b]);
});

test('resetReveals clears a pause left behind by a torn-down transition', () => {
  pauseReveals();
  resetReveals();
  globalThis.__drawn = [];
  reveal(fakeRing(), { key: 'fresh', haptic: null });
  assert.equal(globalThis.__drawn.length, 1, 'a stale pause would silently stop every reveal in the suite after it');
});

/* onPlay is the hook the perfect-plate burst hangs off. It must fire exactly when the reveal
   PLAYS — once per key, never on the repaint calls the guard swallows — and a throwing hook must
   not stop the draw. perfectBurst itself: stamps the class, appends the particles, honours
   reduced motion, and refuses a detached chip. */
test('onPlay fires once, with the element, on the call that owns the reveal', () => {
  resetReveals();
  const el = fakeRing();
  const seen = [];
  const opts = { key: 'meal:dinner:p100', haptic: null, onPlay: (x) => seen.push(x) };
  assert.equal(reveal(el, opts), true);
  assert.equal(reveal(el, opts), false);
  assert.equal(reveal(el, opts), false);
  assert.deepEqual(seen, [el], 'one play, one hook call');
});

test('a throwing onPlay never breaks the reveal', () => {
  resetReveals();
  const el = fakeRing();
  globalThis.__drawn = [];
  assert.equal(reveal(el, { key: 'meal:lunch:boom', haptic: null, onPlay: () => { throw new Error('x'); } }), true);
  assert.equal(globalThis.__drawn.includes(el), true, 'the ring still drew');
});

test('perfectBurst stamps .perfect, drops PERFECT_PARTICLES particles, and skips a detached chip', async () => {
  const { perfectBurst, PERFECT_PARTICLES } = await import(new URL('./motion.js', import.meta.url).href);
  const classes = new Set();
  let appended = null;
  const chip = {
    isConnected: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    querySelector: () => null,
    appendChild: (n) => { appended = n; },
  };
  const prevDoc = globalThis.document;
  globalThis.document = { createElement: (tag) => ({ tag, kids: [], vars: {}, style: { setProperty(k, v) { this.vars = this.vars || {}; this.vars[k] = v; } }, appendChild(n) { this.kids.push(n); }, setAttribute() {}, remove() {} }) };
  try {
    assert.equal(perfectBurst(chip, 0), true);
    assert.ok(classes.has('perfect'));
    assert.ok(appended, 'particles appended');
    assert.equal(appended.kids.length, PERFECT_PARTICLES);
    assert.ok(appended.kids.every((k) => /^var\(--ring-[abc]\)$/.test(k.style.vars['--c'])), 'particles wear the sweep colours');
    assert.ok(appended.kids.every((k) => /deg$/.test(k.style.vars['--a']) && /px$/.test(k.style.vars['--d'])), 'angle + distance set');
    const gone = { ...chip, isConnected: false, classList: { add: () => { throw new Error('must not stamp'); } } };
    assert.equal(perfectBurst(gone, 0), true, 'returns true (scheduled) but does nothing on a detached chip');
    // A detached chip WITH an id re-finds the live node the repaint put in its place.
    const liveClasses = new Set();
    let liveAppended = null;
    const liveChip = { isConnected: true, classList: { add: (c) => liveClasses.add(c) }, querySelector: () => null, appendChild: (n) => { liveAppended = n; } };
    globalThis.document.getElementById = (id) => (id === 'meal-scorechip' ? liveChip : null);
    const stale = { ...gone, id: 'meal-scorechip' };
    assert.equal(perfectBurst(stale, 0), true);
    assert.ok(liveClasses.has('perfect'), 'the live chip got the class');
    assert.equal(liveAppended.kids.length, PERFECT_PARTICLES, 'and the particles');
    assert.equal(perfectBurst(null), false);
  } finally {
    globalThis.document = prevDoc;
  }
});
