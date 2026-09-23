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
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const L = await import('./location.js');
const CD = await import('./commitment-data.js');

const calls = [];
function shim(over = {}, caps = { location: true, walkIn: true, maps: true }) {
  calls.length = 0;
  CD.setNativeCapsForHarness(caps);
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
beforeEach(() => { delete window.OnStandardNative; CD.setNativeCapsForHarness(null); L.setLocationStateForHarness(null); });

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

test('a successful I am here check clears the cached team board so the tile updates', async () => {
  let reads = 0;
  window.sb = { rpc: () => { reads++; return Promise.resolve({ data: { instance_id: 'i5', rows: [] }, error: null }); } };
  await CD.loadTeamBoard('i5', true);
  await CD.loadTeamBoard('i5');
  assert.equal(reads, 1, 'fresh cache');
  shim({ location: { check: () => Promise.resolve({ within: true, reason: null, distance_m: 20 }) } });
  await L.imHere('i5');
  await CD.loadTeamBoard('i5');
  assert.equal(reads, 2, 'stale after the check-in');
  delete window.sb;
});

/* ---- final fix round: the native capability line (I-1, I-2) and the in-context ask (item 2) ---- */

test('an OLD binary: the shim exists but the native line says no. Nothing is asked of it', async () => {
  shim({}, { location: false, walkIn: false, maps: false, mapReason: 'update' });
  assert.equal(L.locationCapable(), false);
  assert.equal(L.mapAvailable(), false, 'the shim has maps.pick, and still no map opens');
  assert.equal(L.mapMissingLine(), 'Update OnStandard to add a place.');
  assert.deepEqual(await L.imHere('i1'), { error: 'unavailable' });
  assert.deepEqual(await L.checkInHere('i1'), { error: 'unavailable' });
  assert.equal(calls.length, 0, 'no bridge call is made on an old binary');
});

test('no capability line at all (a browser, the harness) reads as an old binary', () => {
  shim({}, null);
  assert.equal(L.locationCapable(), false);
  assert.equal(L.mapAvailable(), false);
});

test('a binary with the map but an OS that cannot draw it says so, not "update"', () => {
  shim({}, { location: true, walkIn: true, maps: false, mapReason: 'os' });
  assert.match(L.mapMissingLine(), /This phone can’t show the map/);
});

test('the native "no module" reply is the app version, never a location verdict', async () => {
  shim({ location: { check: () => Promise.resolve({ within: false, reason: 'Location is unavailable on this device', distance_m: null }) } });
  assert.deepEqual(await L.imHere('i1'), { error: 'unavailable' });
});

test('I am here on a phone never asked: the While Using prompt first, then the reading', async () => {
  shim({ location: {
    available: () => Promise.resolve({ available: true, state: 'undetermined' }),
    request: (bg) => { calls.push(['request', bg]); return Promise.resolve('when_in_use'); },
  } });
  const r = await L.checkInHere('inst-1');
  assert.deepEqual(calls.find((c) => c[0] === 'request'), ['request', false], 'While Using, never Always, on a tap');
  assert.ok(calls.some((c) => c[0] === 'check'), 'then the reading');
  assert.equal(r.within, false);
});

test('I am here after a No: no prompt, no reading, the Settings sentence', async () => {
  shim({ location: { available: () => Promise.resolve({ available: true, state: 'denied' }) } });
  const r = await L.checkInHere('inst-1');
  assert.deepEqual(r, { error: 'denied' });
  assert.ok(!calls.some((c) => c[0] === 'check' || c[0] === 'request'));
  assert.match(L.hereErrorLine(r), /Turn it on in Settings/);
});

test('a dismissed prompt is not a check-in', async () => {
  shim({ location: {
    available: () => Promise.resolve({ available: true, state: 'undetermined' }),
    request: () => Promise.resolve('undetermined'),
  } });
  assert.deepEqual(await L.checkInHere('inst-1'), { error: 'not-allowed' });
  assert.ok(!calls.some((c) => c[0] === 'check'));
});

test('Allow Always asks for background and arms walk-in at once', async () => {
  shim();
  assert.equal(await L.allowLocation(true), 'always');
  assert.deepEqual(calls[0], ['request', true]);
  assert.ok(calls.some((c) => c[0] === 'arm'));
});

test('with walk-in switched off (WALK_IN), Allow Always only ever asks While Using', async () => {
  shim({ location: { request: (bg) => { calls.push(['request', bg]); return Promise.resolve('when_in_use'); } } },
    { location: true, walkIn: false, maps: true });
  await L.allowLocation(true);
  assert.deepEqual(calls.find((c) => c[0] === 'request'), ['request', false]);
});

test('an arm the OS refused is never ok, and the screens can read that it was refused', async () => {
  shim({ location: { arm: () => Promise.resolve({ armed: 0, capped: 0, state: 'always', walkIn: 'unavailable', error: 'x' }) } });
  const r = await L.armLocation();
  assert.equal(r.ok, false);
  assert.equal(r.walkIn, 'unavailable');
  assert.equal(CD.lastLocationArm().walkIn, 'unavailable');
});

test('the ask card: While Using explained first, Always only after, Settings after a No', () => {
  const place = 'Lincoln Weight Room';
  const first = L.locationAskHtml({ place, state: 'undetermined', walkIn: true });
  assert.match(first, /one reading/);
  assert.match(first, /Arrived or Not arrived, never where you are/);
  assert.match(first, /data-loc-allow/);
  assert.doesNotMatch(first, /Always/, 'step one never mentions Always');
  const second = L.locationAskHtml({ place, state: 'when_in_use', walkIn: true });
  assert.match(second, /data-loc-always/);
  assert.match(second, /I’m here works the same/, 'declining still leaves I’m here');
  assert.match(second, /data-loc-notnow/);
  assert.equal(L.locationAskHtml({ place, state: 'when_in_use', walkIn: false }), '', 'no Always offer when walk-in is off');
  assert.equal(L.locationAskHtml({ place, state: 'when_in_use', walkIn: true, declined: true }), '', 'Not now is remembered');
  assert.equal(L.locationAskHtml({ place, state: 'when_in_use', walkIn: true, optedOut: true }), '');
  const denied = L.locationAskHtml({ place, state: 'denied' });
  assert.match(denied, /data-loc-settings/);
  assert.match(denied, /While Using the App/);
  assert.match(L.locationAskHtml({ place, state: 'always', walkIn: true }), /Walk-in check-in is on/);
  assert.match(L.locationAskHtml({ place, state: 'always', walkIn: true, walkInStatus: 'unavailable' }), /isn’t working on this phone/);
  assert.equal(L.locationAskHtml({ place, state: null }), '', 'nothing before the phone has answered');
  assert.doesNotMatch(L.locationAskHtml({ place: '<b>x</b>', state: 'undetermined' }), /<b>x/, 'the place name is escaped');
});

/* ---- fix round 2: m1 (Keep Only While Using) and m2 (the server's consent rule) ---- */

test('after "Keep Only While Using" the Always button is gone, not dead (m1)', async () => {
  const mem = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    shim({ location: { request: () => Promise.resolve('when_in_use') } });
    L.setConsentCachedForHarness(true);
    assert.equal(await L.allowLocation(true), 'when_in_use');
    assert.equal(L.alwaysRefused(), true);
    assert.equal(L.alwaysDeclined(), true);
    L.setLocationStateForHarness('when_in_use');
    assert.equal(L.locationAskFor('Weight room'), '', 'no card asking again');
  } finally {
    globalThis.localStorage = prev;
    L.setConsentCachedForHarness(null);
  }
});

test('a minor without consent never sees the prompt: the card and the tap both stop (m2)', async () => {
  shim({ location: { available: () => Promise.resolve({ available: true, state: 'undetermined' }) } });
  L.setConsentCachedForHarness(false);
  try {
    const card = L.locationAskHtml({ place: 'Weight room', state: 'undetermined', walkIn: true, consent: false });
    assert.match(card, /parent or guardian/);
    assert.doesNotMatch(card, /data-loc-allow|data-loc-always/);
    assert.deepEqual(await L.checkInHere('i1'), { error: 'consent' });
    assert.ok(!calls.some((c) => c[0] === 'request' || c[0] === 'check'), 'no OS prompt, no reading');
    assert.match(L.hereErrorLine({ error: 'consent' }), /parent or guardian/);
    // Consent unknown (the server could not be asked): no card yet, never a guess.
    assert.equal(L.locationAskHtml({ place: 'x', state: 'undetermined', consent: null }), '');
  } finally {
    L.setConsentCachedForHarness(null);
  }
});

test('the client keeps no copy of the age rule: consent is the server RPC', () => {
  const src = readFileSync(new URL('./location.js', import.meta.url), 'utf8');
  assert.match(src, /loadVerificationConsent/);
  assert.doesNotMatch(src, /athlete_profiles|is_provable_minor/, 'no client query for age');
});
