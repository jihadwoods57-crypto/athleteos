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
  './components.js': 'export function animateRing(root){ (globalThis.__drawn ||= []).push(root); }',
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

const { reveal, resetReveals, revealed, buzz, HAPTIC } = await import(
  new URL('./motion.js', import.meta.url).href
);

/* The smallest thing reveal() needs: querySelectorAll for the wind-back, offsetWidth for the
   reflow, and isConnected so the pending-node check is exercised. No IntersectionObserver is
   defined, so reveal() takes its documented synchronous path. */
function fakeRing({ connected = true } = {}) {
  const arc = { getAttribute: () => '185.4', style: {} };
  const num = { textContent: '84' };
  return {
    isConnected: connected,
    offsetWidth: 1,
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
    const observed = fakeRing({ connected: true });
    assert.equal(reveal(observed, { key: 'meal:lunch:abc', haptic: null }), true, 'claims it');
    assert.equal(reveal(observed, { key: 'meal:lunch:abc', haptic: null }), false, 'still waiting on that node');
    observed.isConnected = false;                      // the repaint threw that node away
    const fresh = fakeRing({ connected: true });
    assert.equal(reveal(fresh, { key: 'meal:lunch:abc', haptic: null }), true, 're-claimed by the live node');
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
