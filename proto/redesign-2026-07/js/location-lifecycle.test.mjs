/* Walk-in check-in's lifecycle in the proto (roll call rebuilt, Task 8, 2026-09-23).
 *
 * The native side arms the OS geofences for whatever roll call is in its window, but only when it
 * is ASKED (LOCATION_ARM), and it keeps regions across sign-out unless told otherwise
 * (LOCATION_DISARM). So the proto owes the phone two things:
 *   - arm on sign-in, on a restored session at launch, and on every return to the foreground
 *     (throttled: each arm is one server read on the native side);
 *   - disarm on EVERY way out of an account: sign-out, account deletion, and a launch that finds
 *     no live session. A region left armed fires arrivals against a session that no longer
 *     exists, or under whoever signs in next on this phone.
 *
 * Drives the real state.js against a fake bridge. Run:
 *   node --test proto/redesign-2026-07/js/location-lifecycle.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The roll call is switched off (commitments.js, 2026-09-24). This file tests the roll call itself,
// so it runs it switched ON, as it will be when it comes back; rollcall-off.test.mjs pins the off state.
import { rollcallOnForTests } from './commitments.js';
rollcallOnForTests();


const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
const docListeners = {};
globalThis.window = { location: { hash: '' }, addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), {
  createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el(),
  visibilityState: 'visible',
  addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
});
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

/* A Supabase double that answers every chain with an empty success. */
function chain() {
  const p = Promise.resolve({ data: null, error: null });
  const api = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? p.then.bind(p) : k === 'catch' ? p.catch.bind(p) : () => api),
    apply: () => api,
  });
  return api;
}
window.sb = {
  from: () => chain(),
  rpc: () => Promise.resolve({ data: null, error: null }),
  auth: { signOut: () => Promise.resolve({ error: null }) },
  storage: { from: () => chain() },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
};

const calls = [];
window.OnStandardNative = {
  location: {
    arm: () => { calls.push('arm'); return Promise.resolve({ armed: 1, capped: 0, state: 'always' }); },
    disarm: () => { calls.push('disarm'); return Promise.resolve(true); },
  },
  notify: { sync() {} },
};

const { act, RT } = await import('./state.js');
const tick = () => new Promise((r) => setTimeout(r, 5));

test('a restored session at launch arms the geofences', async () => {
  calls.length = 0;
  await act._syncSession({ id: 'u-1', email: 'a@b.c' });
  await tick();
  assert.deepEqual(calls, ['arm']);
});

test('returning to the foreground re-arms, throttled so a flurry is one server read', async () => {
  RT.userId = 'u-1';
  act._armLocation({ reset: true });   // clear the throttle window the launch arm opened
  calls.length = 0;
  const fire = () => (docListeners.visibilitychange || []).forEach((fn) => fn());
  fire(); fire(); fire();
  await tick();
  assert.deepEqual(calls, ['arm']);
});

test('no signed-in user: the foreground beat does not arm', async () => {
  const was = RT.userId;
  RT.userId = null;
  act._armLocation({ reset: true });
  calls.length = 0;
  (docListeners.visibilitychange || []).forEach((fn) => fn());
  await tick();
  assert.deepEqual(calls, []);
  RT.userId = was;
});

test('sign-out disarms', async () => {
  RT.userId = 'u-1';
  calls.length = 0;
  await act.signOut();
  assert.ok(calls.includes('disarm'));
  assert.ok(!calls.includes('arm'));
});

test('roll call v3: sign-out sweeps every wake alarm this device holds, feature-detected', async () => {
  const wakeCalls = [];
  window.OnStandardNative.wakeAlarms = {
    sync: (alarms, opts) => { wakeCalls.push([alarms, opts]); return Promise.resolve(0); },
  };
  RT.userId = 'u-1';
  await act.signOut();
  assert.deepEqual(wakeCalls, [[[], { complete: true }]],
    'an empty set with complete:true sweeps every alarm the device holds, not just this process\'s own');
  delete window.OnStandardNative.wakeAlarms;
  // An older shell with no wakeAlarms bridge at all must not throw or block sign-out.
  RT.userId = 'u-1';
  await assert.doesNotReject(act.signOut());
});

test('roll call v3: sign-out fires onstd:account-wipe, so home.js can re-arm its own module state', async () => {
  const events = [];
  const realDispatch = window.dispatchEvent;
  window.dispatchEvent = (ev) => { events.push(ev && ev.type); return realDispatch(ev); };
  RT.userId = 'u-1';
  try {
    await act.signOut();
  } finally {
    window.dispatchEvent = realDispatch;
  }
  assert.ok(events.includes('onstd:account-wipe'),
    'home.js has no other way to hear that the account under it just changed');
});

test('deleting the account disarms', async () => {
  RT.userId = 'u-1';
  calls.length = 0;
  await act.deleteAccount();
  assert.ok(calls.includes('disarm'));
});

test('a bridge that throws never breaks the lifecycle', async () => {
  window.OnStandardNative.location = {
    arm: () => { throw new Error('boom'); },
    disarm: () => Promise.reject(new Error('boom')),
  };
  act._armLocation({ reset: true });
  await act._syncSession({ id: 'u-2', email: 'x@y.z' });
  RT.userId = 'u-2';
  await act.signOut();
  delete window.OnStandardNative.location;
  act._armLocation({ reset: true });
  await act._syncSession({ id: 'u-3', email: 'x@y.z' });
  await act.signOut();
});

test('a native disarm that never answers cannot block sign-out or account deletion', async () => {
  const { LOC_DISARM_WAIT_MS } = await import('./state.js');
  assert.ok(LOC_DISARM_WAIT_MS <= 3000);
  window.OnStandardNative.location = { arm: () => Promise.resolve({}), disarm: () => new Promise(() => {}) };
  RT.userId = 'u-4';
  let t = Date.now();
  await act.signOut();
  assert.ok(Date.now() - t < LOC_DISARM_WAIT_MS + 1000, 'sign-out finished');
  assert.equal(RT.userId, null, 'and the local state was wiped');
  RT.userId = 'u-5';
  t = Date.now();
  const ok = await act.deleteAccount();
  assert.ok(Date.now() - t < LOC_DISARM_WAIT_MS + 1000, 'deletion finished');
  assert.equal(typeof ok, 'boolean');
});

test('roll call v3: a wake-alarm sweep that never answers cannot block sign-out either', async () => {
  const { WAKE_SWEEP_WAIT_MS, LOC_DISARM_WAIT_MS } = await import('./state.js');
  assert.ok(WAKE_SWEEP_WAIT_MS <= 3000);
  window.OnStandardNative.location = { arm: () => Promise.resolve({}), disarm: () => Promise.resolve(true) };
  window.OnStandardNative.wakeAlarms = { sync: () => new Promise(() => {}) };
  RT.userId = 'u-6';
  const t = Date.now();
  await act.signOut();
  assert.ok(Date.now() - t < WAKE_SWEEP_WAIT_MS + LOC_DISARM_WAIT_MS + 1000, 'sign-out finished');
  assert.equal(RT.userId, null, 'and the local state was still wiped');
  delete window.OnStandardNative.wakeAlarms;
});
