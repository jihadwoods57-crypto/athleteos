/* OnStandard: the proto's door to the phone's location and map (roll call rebuilt, 2026-09-23).

   Thin promise wrappers over window.OnStandardNative.location.* and .maps.pick (src/proto/bridge.ts).
   Every screen goes through here rather than touching the bridge, because the bridge has three
   ways to be absent and each one has to be an ANSWER, never a throw at tap time:
     - no bridge at all: a browser preview, the QC harness, node;
     - a binary built without the module: an OTA can land on one (builds before the 2026-09-23
       restore have no LOCATION_* messages; builds before the map picker have no `maps`);
     - a bridge call that REJECTS: the shim rejects whenever the native side passes an error
       string ('map-unavailable', 'map-busy', a failed fix).

   PRIVACY, by construction: nothing here ever receives or sends a coordinate for an athlete. The
   "I'm here" check takes one reading NATIVELY and sends it to verify_arrival_at, which measures the
   distance on the server and throws the position away; this module only ever sees
   { within, distance_m, reason }. The coach's map returns the PLACE's coordinates (a building,
   not a person), which savePlace() in commitment-data.js stores.

   Not in the eager boot graph: import it from a lazily loaded screen, or via import(). The
   sign-in / sign-out / foreground lifecycle lives in state.js and talks to the bridge directly,
   so the boot never needs this file. */

import { invalidateTeamBoard } from './commitment-data.js';

function bridge() {
  const w = typeof window !== 'undefined' ? window : null;
  return (w && w.OnStandardNative) || null;
}
function loc() {
  const N = bridge();
  return N && N.location && typeof N.location === 'object' ? N.location : null;
}
const msgOf = (e, fallback) => {
  const m = e && (e.message || (typeof e === 'string' ? e : ''));
  return String(m || fallback);
};

/** { available, state, presence } from the phone, or null when there is no location module to ask
 *  (render the place check as a tap-only fallback, never as broken). */
export async function locationAvailable() {
  const L = loc();
  if (!L || typeof L.available !== 'function') return null;
  try { return (await L.available()) || null; } catch { return null; }
}

/** Ask for permission. `background` true asks for Always (walk-in check-in) after the athlete has
 *  seen the explainer; false asks for While Using (enough for "I'm here"). Resolves the permission
 *  state the phone reports: 'always' | 'when_in_use' | 'denied' | 'undetermined' | 'unavailable'. */
export async function requestLocation(background) {
  const L = loc();
  if (!L || typeof L.request !== 'function') return 'unavailable';
  try { return (await L.request(!!background)) || 'unavailable'; } catch { return 'unavailable'; }
}

/** "I'm here": one reading, judged on the server. Resolves { within, distance_m, reason } (the
 *  server's verdict; a miss is recorded as unverified with "N m from <place>", never as missed), or
 *  { error } when no check could be made: 'unavailable' (no bridge), 'no-instance', or the phone's
 *  own reason. */
export async function imHere(instanceId) {
  const L = loc();
  if (!L || typeof L.check !== 'function') return { error: 'unavailable' };
  if (!instanceId) return { error: 'no-instance' };
  try {
    const r = await L.check(String(instanceId));
    if (!r || typeof r !== 'object') return { error: 'unavailable' };
    // Either verdict was written server-side (arrived, or unverified with the distance): the
    // cached team board is stale now, so the athlete's own tile updates on the next paint.
    invalidateTeamBoard(instanceId);
    return {
      within: r.within === true,
      distance_m: typeof r.distance_m === 'number' && isFinite(r.distance_m) ? r.distance_m : null,
      reason: r.reason ? String(r.reason) : null,
    };
  } catch (e) { return { error: msgOf(e, 'unavailable') }; }
}

/** The coach's map. `initial` ({ lat, lng, radius_m, name }) re-opens a saved place for editing.
 *  Resolves the picked place { name, address, lat, lng, radius_m }, null when the coach cancels,
 *  or { error: 'map-unavailable' | 'map-busy' } when no map could open (an older app binary, or a
 *  map already on screen). Check `r && r.error` before reading a place. */
export async function pickPlace(initial) {
  const N = bridge();
  const M = N && N.maps;
  if (!M || typeof M.pick !== 'function') return { error: 'map-unavailable' };
  try {
    const r = await M.pick(initial && typeof initial === 'object' ? initial : undefined);
    return r && typeof r === 'object' ? r : null;
  } catch (e) {
    const m = msgOf(e, 'map-unavailable');
    return { error: /busy/i.test(m) ? 'map-busy' : 'map-unavailable' };
  }
}

/** Ask the phone to (re)arm walk-in check-in for whatever roll call is in its window now.
 *  Normalised so a caller can never misread the native answer:
 *    ok     true when walk-in check-in is live on this phone: regions armed, OR the previous
 *           regions KEPT because the server read failed (`kept: true`, a network blip at 5:30 AM
 *           must not leave the athlete unseen at 5:43). A kept answer is a success, not "0 armed".
 *    armed  how many regions were armed; null when kept (the old count is unknown, not zero).
 *  Without Always permission the phone arms nothing and ok is false: that athlete checks in by tap. */
export async function armLocation() {
  const none = { ok: false, armed: 0, capped: 0, state: 'unavailable', kept: false };
  const L = loc();
  if (!L || typeof L.arm !== 'function') return none;
  try {
    const r = await L.arm();
    if (!r || typeof r !== 'object') return none;
    const kept = r.kept === true;
    const armed = kept ? null : Math.max(0, Number(r.armed) || 0);
    const state = r.state ? String(r.state) : 'unavailable';
    return { ok: kept || state === 'always', armed, capped: Math.max(0, Number(r.capped) || 0), state, kept };
  } catch { return none; }
}

/** Tear down every armed region on this phone. True when the phone confirmed it. */
export async function disarmLocation() {
  const L = loc();
  if (!L || typeof L.disarm !== 'function') return false;
  try { return (await L.disarm()) === true; } catch { return false; }
}
