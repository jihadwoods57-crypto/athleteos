/* The roll call is switched off (commitments.js, founder 2026-09-24). What the PHONE holds has to
 * go too, because none of it asks the server before it fires: AlarmKit / setAlarmClock alarms armed
 * up to 14 days ahead, walk-in geofences, and a Live Activity already up.
 *
 * Once per launch, through the path that used to ARM them (state.js _armLocation: sign-in, a
 * restored session, every foreground), feature-detected for the older builds an OTA lands on.
 * Drives the real state.js and rollcall-off-sweep.js against a fake bridge (the harness is
 * location-lifecycle.test.mjs's).
 *
 * Run: node --test proto/redesign-2026-07/js/rollcall-off-phone.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
const fullBridge = () => ({
  location: {
    arm: () => { calls.push('arm'); return Promise.resolve({ armed: 1, capped: 0, state: 'always' }); },
    disarm: () => { calls.push('disarm'); return Promise.resolve(true); },
  },
  wakeAlarms: { sync: (a, o) => { calls.push(['alarms', a, o]); return Promise.resolve(0); } },
  rollcall: { endAll: () => { calls.push('endAll'); return Promise.resolve(2); } },
  notify: { sync() {} },
});
window.OnStandardNative = fullBridge();

const { ROLLCALL_OFF } = await import('./commitments.js');
const { act, RT } = await import('./state.js');
const { sweepRollcallOff, _resetRollcallOffSweep } = await import('./rollcall-off-sweep.js');
const tick = () => new Promise((r) => setTimeout(r, 10));

test('the switch this file depends on is thrown', () => {
  assert.equal(ROLLCALL_OFF, true);
});

test('a launch never arms: it cancels every alarm, disarms every region and ends every card', async () => {
  calls.length = 0;
  await act._syncSession({ id: 'u-1', email: 'a@b.c' });
  await tick();
  assert.ok(!calls.includes('arm'), 'no geofence is armed while the roll call is off');
  assert.deepEqual(calls, [['alarms', [], { complete: true }], 'disarm', 'endAll']);
});

test('once per launch: a sign-in, a restored session and every foreground after it add nothing', async () => {
  calls.length = 0;
  RT.userId = 'u-1';
  const fire = () => (docListeners.visibilitychange || []).forEach((fn) => fn());
  fire(); fire(); fire();
  act._armLocation({ force: true });
  await tick();
  assert.deepEqual(calls, []);
});

test('the sweep answers what it did', async () => {
  _resetRollcallOffSweep();
  calls.length = 0;
  assert.deepEqual(await sweepRollcallOff(), { alarms: true, location: true, cards: 2 });
});

test('an older build: each missing bridge method is skipped, nothing throws', async () => {
  // Build 43 had location and wake alarms but no rollcall.endAll (it arrives with this OTA's shim).
  _resetRollcallOffSweep();
  calls.length = 0;
  const b = fullBridge();
  delete b.rollcall;
  window.OnStandardNative = b;
  assert.deepEqual(await sweepRollcallOff(), { alarms: true, location: true, cards: null });
  assert.deepEqual(calls, [['alarms', [], { complete: true }], 'disarm']);
  // A shell whose calls reject is still no throw.
  _resetRollcallOffSweep();
  window.OnStandardNative = {
    wakeAlarms: { sync: () => Promise.reject(new Error('old')) },
    location: { disarm: () => Promise.reject(new Error('old')) },
    rollcall: { endAll: () => Promise.reject(new Error('old')) },
  };
  assert.deepEqual(await sweepRollcallOff(), { alarms: false, location: false, cards: null });
  // No bridge at all (a browser, the QC harness).
  _resetRollcallOffSweep();
  delete window.OnStandardNative;
  assert.deepEqual(await sweepRollcallOff(), { alarms: false, location: false, cards: null });
});

test('sign-out still sweeps the device as before', async () => {
  window.OnStandardNative = fullBridge();
  calls.length = 0;
  await act.signOut();
  assert.ok(calls.includes('disarm'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'alarms' && c[2] && c[2].complete === true));
});
