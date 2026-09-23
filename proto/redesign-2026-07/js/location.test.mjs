/* The proto's location + map wrappers (roll call rebuilt, Task 8, 2026-09-23).
 *
 * js/location.js is the only way a screen reaches window.OnStandardNative.location / .maps. Three
 * contracts matter and each has bitten a sibling seam before:
 *   - NO BRIDGE (browser preview, the QC harness, an OTA on a binary built without the module) is
 *     an answer, never a throw: null or { error: 'unavailable' }.
 *   - A bridge REJECTION (the shim rejects whenever the native side passes an error string) is an
 *     answer too: 'map-unavailable' / 'map-busy' come back as { error }, not as an exception.
 *   - arm() answering { kept: true } means "a network blip, the regions already armed stay armed".
 *     That is a success, never "0 armed".
 *
 * Run: node --test proto/redesign-2026-07/js/location.test.mjs
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const L = await import('./location.js');

const calls = [];
function shim(over = {}) {
  calls.length = 0;
  const rec = (name, v) => (...args) => { calls.push([name, ...args]); return typeof v === 'function' ? v(...args) : Promise.resolve(v); };
  window.OnStandardNative = {
    location: {
      available: rec('available', { available: true, state: 'when_in_use', presence: true }),
      request: rec('request', 'always'),
      arm: rec('arm', { armed: 2, capped: 0, state: 'always' }),
      disarm: rec('disarm', true),
      check: rec('check', { within: false, reason: '400 m from Weight room', distance_m: 400 }),
      ...(over.location || {}),
    },
    maps: { pick: rec('pick', { name: 'Weight room', address: '1 Main St', lat: 1, lng: 2, radius_m: 150 }), ...(over.maps || {}) },
  };
}
beforeEach(() => { delete window.OnStandardNative; });

test('no bridge: every wrapper answers, none throws', async () => {
  assert.equal(await L.locationAvailable(), null);
  assert.equal(await L.requestLocation(true), 'unavailable');
  assert.deepEqual(await L.imHere('i1'), { error: 'unavailable' });
  assert.deepEqual(await L.pickPlace(), { error: 'map-unavailable' });
  assert.deepEqual(await L.armLocation(), { ok: false, armed: 0, capped: 0, state: 'unavailable', kept: false });
  assert.equal(await L.disarmLocation(), false);
});

test('imHere passes the instance and returns the server verdict (never coordinates)', async () => {
  shim();
  const r = await L.imHere('inst-9');
  assert.deepEqual(calls[0], ['check', 'inst-9']);
  assert.deepEqual(r, { within: false, distance_m: 400, reason: '400 m from Weight room' });
});

test('imHere: a rejected bridge call is an { error }, not a throw', async () => {
  shim({ location: { check: () => Promise.reject(new Error('Something went wrong')) } });
  assert.deepEqual(await L.imHere('i1'), { error: 'Something went wrong' });
  assert.deepEqual(await L.imHere(''), { error: 'no-instance' });
});

test('requestLocation forwards the background flag', async () => {
  shim();
  assert.equal(await L.requestLocation(true), 'always');
  assert.deepEqual(calls[0], ['request', true]);
});

test('pickPlace: a place, a cancel, and the two rejections', async () => {
  shim();
  assert.deepEqual(await L.pickPlace({ lat: 1, lng: 2, radius_m: 150, name: 'Weight room' }),
    { name: 'Weight room', address: '1 Main St', lat: 1, lng: 2, radius_m: 150 });
  assert.deepEqual(calls[0][1], { lat: 1, lng: 2, radius_m: 150, name: 'Weight room' });
  shim({ maps: { pick: () => Promise.resolve(null) } });
  assert.equal(await L.pickPlace(), null, 'Cancel is null');
  shim({ maps: { pick: () => Promise.reject(new Error('map-busy')) } });
  assert.deepEqual(await L.pickPlace(), { error: 'map-busy' });
  shim({ maps: { pick: () => Promise.reject(new Error('map-unavailable')) } });
  assert.deepEqual(await L.pickPlace(), { error: 'map-unavailable' });
  window.OnStandardNative = { location: {} };   // a binary with location but no map
  assert.deepEqual(await L.pickPlace(), { error: 'map-unavailable' });
});

test('armLocation: kept:true is a success, not "0 armed"', async () => {
  shim({ location: { arm: () => Promise.resolve({ armed: 0, capped: 0, state: 'always', kept: true }) } });
  const r = await L.armLocation();
  assert.equal(r.ok, true);
  assert.equal(r.kept, true);
  assert.equal(r.armed, null, 'the count is unknown when the old regions were kept, never 0');
});

test('armLocation: a real count, a refusal, and a thrown bridge', async () => {
  shim();
  assert.deepEqual(await L.armLocation(), { ok: true, armed: 2, capped: 0, state: 'always', kept: false });
  shim({ location: { arm: () => Promise.resolve({ armed: 0, capped: 0, state: 'when_in_use' }) } });
  assert.equal((await L.armLocation()).ok, false, 'without Always nothing is armed, and that is not ok');
  shim({ location: { arm: () => Promise.reject(new Error('boom')) } });
  assert.deepEqual(await L.armLocation(), { ok: false, armed: 0, capped: 0, state: 'unavailable', kept: false });
});

test('disarmLocation reports the bridge answer', async () => {
  shim();
  assert.equal(await L.disarmLocation(), true);
  assert.deepEqual(calls[0], ['disarm']);
});
