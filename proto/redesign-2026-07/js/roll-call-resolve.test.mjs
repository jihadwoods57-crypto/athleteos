/* The roll-call deep link must never spin.

   `__render()` re-runs a screen's mount(), so "instance not in cache → fetch → re-render" is an
   infinite loop for any id that never resolves. On 2026-07-31 it was one: opening #roll-call with
   a cancelled id, an empty id, or no commitments loaded (which is what being OFFLINE looks like —
   loadMine swallows the failure and returns an empty list) froze the whole WebView hard enough
   that the QC harness could not evaluate a single expression on the page.

   These cases encode the rule, not the implementation:
     - one fetch in flight at a time — this is the loop guard
     - a settled lookup that found nothing is a TERMINAL screen, never a permanent "Loading…"
     - the athlete still gets a real retry once the cache would have gone stale anyway, so a
       tap made in a dead-zone locker room is not a permanent verdict
     - ids are independent: one dead link must not poison the next commitment */
import test from 'node:test';
import assert from 'node:assert/strict';

/* The screen graph touches the DOM at module eval; stub what it reads. Same shim as
   router-roles.test.mjs. */
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

const mod = await import('./screens/roll-call.js');
const { shouldResolve, resolveDone, resolveState } = mod;
const screen = mod.default;

const T0 = 1_700_000_000_000;

test('a fetch in flight blocks every re-render from starting another — the loop guard', () => {
  const m = new Map();
  assert.equal(shouldResolve('rc-1', T0, m), true, 'the first mount must actually fetch');
  // Every one of these is a re-render calling mount() again. Before the fix, each returned a
  // fresh pair of RPCs and re-rendered, forever.
  for (let i = 1; i <= 50; i++) {
    assert.equal(shouldResolve('rc-1', T0 + i, m), false, `re-render #${i} must not fetch again`);
  }
});

test('a settled lookup does not immediately refetch, so mount() stops calling __render()', () => {
  const m = new Map();
  shouldResolve('rc-1', T0, m);
  resolveDone('rc-1', m);
  assert.equal(shouldResolve('rc-1', T0 + 1, m), false);
  assert.equal(shouldResolve('rc-1', T0 + 29_999, m), false);
});

test('the athlete gets a real retry once the cache would be stale anyway', () => {
  const m = new Map();
  shouldResolve('rc-1', T0, m);
  resolveDone('rc-1', m);
  // Tapping the push again after regaining signal must reach the server, not a cached verdict.
  assert.equal(shouldResolve('rc-1', T0 + 30_000, m), true);
});

test('an id that never settles still never loops', () => {
  const m = new Map();
  assert.equal(shouldResolve('rc-1', T0, m), true);
  // A fetch that hangs forever: pending stays true, so no cooldown expiry lets a second one in.
  assert.equal(shouldResolve('rc-1', T0 + 10 * 60_000, m), false, 'pending outranks the cooldown');
});

test('one dead link does not poison the next commitment', () => {
  const m = new Map();
  shouldResolve('rc-dead', T0, m);
  assert.equal(shouldResolve('lf-live', T0, m), true);
});

test('an empty id is a real id — a push route can carry one', () => {
  const m = new Map();
  assert.equal(shouldResolve(undefined, T0, m), true);
  assert.equal(shouldResolve('', T0 + 1, m), false, 'undefined and "" are the same missing id');
  assert.equal(resolveState('', m), 'pending');
});

test('resolveState reports the three states render() distinguishes', () => {
  const m = new Map();
  assert.equal(resolveState('rc-1', m), 'never');
  shouldResolve('rc-1', T0, m);
  assert.equal(resolveState('rc-1', m), 'pending');
  resolveDone('rc-1', m);
  assert.equal(resolveState('rc-1', m), 'settled');
});

/* ---------------------------------------------------------------- what the athlete sees */

test('an unresolved instance renders "Loading…" first, then a terminal not-available screen', () => {
  // Fresh id, nothing asked yet: honest loading state.
  const loading = screen.render({ sub: 'rc-unknown-a' });
  assert.match(loading, /Loading your commitment/);

  // Now the module's own state cell goes through a real lookup that finds nothing.
  shouldResolve('rc-unknown-a');
  resolveDone('rc-unknown-a');

  const gone = screen.render({ sub: 'rc-unknown-a' });
  assert.doesNotMatch(gone, /Loading your commitment/, 'never sit on Loading… after a settled lookup');
  assert.match(gone, /isn’t available/);
  assert.match(gone, /Nothing is counted against you/, 'a missing record is not a miss');
  assert.match(gone, /data-go="home"/, 'the athlete must have a way out');
});
