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

import { invalidateTeamBoard, nativeCaps, noteLocationArm, lastLocationArm, loadVerificationConsent, vcUid } from './commitment-data.js';
import { esc } from './components.js';
import { icon } from './icons.js';

export { nativeCaps };

/** Can THIS binary take a location reading? From the native capability line, never from the
 *  bridge shim (which exists on every build after an OTA). False in a browser and the harness. */
export function locationCapable() { return nativeCaps().location && !!loc(); }
/** May walk-in (region) check-in be offered on this phone? False when WALK_IN has it switched off
 *  (the device-test fallback) or the binary has no location at all. */
export function walkInCapable() { return nativeCaps().walkIn && !!loc(); }

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
 *  server's verdict; a miss is recorded as unverified with "Not at <place>", never as missed; the distance comes back here only), or
 *  { error } when no check could be made: 'unavailable' (no bridge), 'no-instance', or the phone's
 *  own reason. */
export async function imHere(instanceId) {
  const L = loc();
  // An old binary (no native location) answers 'unavailable' before any bridge call, so its reply
  // can never be recorded or shown as a location verdict (final review I-2).
  if (!L || typeof L.check !== 'function' || !locationCapable()) return { error: 'unavailable' };
  if (!instanceId) return { error: 'no-instance' };
  try {
    const r = await L.check(String(instanceId));
    if (!r || typeof r !== 'object') return { error: 'unavailable' };
    // The native seam's own "no module" answer is the app version, not a verdict.
    if (r.within !== true && /unavailable on this device/i.test(String(r.reason || ''))) return { error: 'unavailable' };
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

/** Whether this binary can open the coach's map at all (sync, for a render). False in a browser
 *  preview, the harness, and on a build from before the map picker: the screen then says so in
 *  plain words instead of offering a control that cannot work. */
export function mapAvailable() {
  const N = bridge();
  return nativeCaps().maps && !!(N && N.maps && typeof N.maps.pick === 'function');
}

/** The one line a coach reads where the map would be, when it cannot open (final review I-1). */
export function mapMissingLine() {
  return nativeCaps().mapReason === 'os'
    ? 'This phone can’t show the map. Pick a saved place, or add one from a newer phone.'
    : 'Update OnStandard to add a place.';
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
    noteLocationArm(r);
    const kept = r.kept === true;
    const armed = kept ? null : Math.max(0, Number(r.armed) || 0);
    const state = r.state ? String(r.state) : 'unavailable';
    // walkIn 'unavailable' = the OS refused to arm (logged natively); 'off' = WALK_IN. Never ok.
    const refused = r.walkIn === 'unavailable' || r.walkIn === 'off';
    const out = { ok: !refused && (kept || state === 'always'), armed, capped: Math.max(0, Number(r.capped) || 0), state, kept };
    if (r.walkIn) out.walkIn = String(r.walkIn);
    return out;
  } catch { return none; }
}

/** Tear down every armed region on this phone. True when the phone confirmed it. */
export async function disarmLocation() {
  const L = loc();
  if (!L || typeof L.disarm !== 'function') return false;
  try { return (await L.disarm()) === true; } catch { return false; }
}

/* ---------------------------------------------------------------- asking, in context
   (final fix round, item 2). Nothing asked for location before this: requestLocation had no
   caller, so "I'm here" answered "Location permission is off" on every phone and walk-in never
   armed. The consent screen that 8e7506bb removed is restored (screens/location-consent.js) and
   the ask now happens where it means something: the first time an athlete has a roll call with a
   place (the board card below), or when they tap "I'm here". Never at sign-up.

   Apple's two steps, in order:
     1. While Using. Explained first (one reading when you tap I'm here; the coach and team see
        Arrived or Not arrived), then the OS prompt.
     2. Always, offered ONLY after While Using, ONLY when walk-in may run on this phone (WALK_IN),
        and it says plainly that declining still leaves "I'm here" working.
   Denied: iOS never shows the prompt again, so the card says how to turn it on in Settings and
   offers the one button that goes there. */

let STATE = null;          // the last permission state the phone reported, null until asked
let PROBING = null;

/** The permission state as last reported, without asking (sync, for a render). */
export function locationStateCached() { return STATE; }
/** Harness + test seam. */
export function setLocationStateForHarness(s) { STATE = s || null; }

/* May this athlete be location-checked at all? (fix round 2, m2). ONE rule, and it is the
   SERVER's: has_verification_consent (0139) = not is_minor(), or a live consent row. The client
   keeps no copy of the age rule (memory guardian-gate-unknown-age-2026-09-22: two client copies read
   base_age alone, treated unknown age as a minor and walled off adults). loadVerificationConsent
   asks the RPC; screens/location-consent.js asks the same one. true / false / null (couldn't ask).
   A minor without consent is never shown the OS prompt: the server would refuse the check anyway. */
/* KEYED BY THE SIGNED-IN USER (fix round 3, R2-2): a cached yes must never outlive the account it
   was asked for. An adult signing out and a minor signing in on the same phone, in one session,
   would otherwise get the card and the OS prompt on the adult's answer. */
let CONSENT = null;        // true | false | null, for CONSENT_FOR only
let CONSENT_FOR = undefined;
let CONSENT_SETTLED = false;
let CONSENT_PROBING = null;
const who = () => { try { return vcUid() || null; } catch { return null; } };
function forCurrentUser() {
  const u = who();
  if (CONSENT_FOR !== u) { CONSENT_FOR = u; CONSENT = null; CONSENT_SETTLED = false; CONSENT_PROBING = null; }
}
/** The server's consent answer for the signed-in athlete: true | false | null (not known yet). */
export function consentCached() { forCurrentUser(); return CONSENT; }
/** Whether a probe has settled for this athlete (null + settled = the server couldn't be asked). */
export function consentSettled() { forCurrentUser(); return CONSENT_SETTLED; }
export function setConsentCachedForHarness(v) {
  forCurrentUser();
  CONSENT = v === true || v === false ? v : null;
  CONSENT_SETTLED = v === true || v === false;
}
/** Ask the server (has_verification_consent). A cached yes is kept unless `force`; anything else is
 *  re-asked (a guardian may have approved since). Coalesced per user. */
export function probeConsent(force = false) {
  forCurrentUser();
  if (CONSENT === true && !force) return Promise.resolve(true);
  if (CONSENT_PROBING) return CONSENT_PROBING;
  const asked = CONSENT_FOR;
  const p = Promise.resolve().then(() => loadVerificationConsent()).then((ok) => {
    if (CONSENT_FOR !== asked) return consentCached();   // the account changed mid-flight
    CONSENT_PROBING = null;
    CONSENT_SETTLED = true;
    if (ok === true || ok === false) CONSENT = ok;
    return CONSENT;
  }, () => {
    if (CONSENT_FOR === asked) { CONSENT_PROBING = null; CONSENT_SETTLED = true; }
    return consentCached();
  });
  CONSENT_PROBING = p;
  return p;
}

/** Ask the phone for its permission state (never prompts). Resolves the state, or null when there
 *  is no location on this binary. Coalesced: concurrent callers share one bridge call. */
export function probeLocation() {
  if (!locationCapable()) return Promise.resolve(null);
  if (PROBING) return PROBING;
  PROBING = locationAvailable().then((r) => {
    PROBING = null;
    STATE = r && r.available ? String(r.state || 'unavailable') : 'unavailable';
    return STATE;
  }, () => { PROBING = null; return STATE; });
  return PROBING;
}

/** Open the app's own page in the phone's Settings (the only way back after a No). */
export function openLocationSettings() {
  const L = loc();
  if (L && typeof L.settings === 'function') { try { L.settings(); return true; } catch { /* below */ } }
  return false;
}

const NOT_NOW_KEY = 'os.loc.alwaysNotNow';
const REFUSED_KEY = 'os.loc.alwaysRefused';
const flag = (k) => { try { return !!(typeof localStorage !== 'undefined' && localStorage.getItem(k)); } catch { return false; } };
/** Did the athlete say "Not now" to Always on this phone, or did iOS answer "Keep Only While
 *  Using"? Either way the card stops offering a button. Per-phone convenience only. */
export function alwaysDeclined() { return flag(NOT_NOW_KEY) || flag(REFUSED_KEY); }
/** iOS shows the Always upgrade ONCE. After "Keep Only While Using" another request does nothing
 *  at all, so a button that asks again would be dead (fix round 2, m1): only Settings can change
 *  it now. */
export function alwaysRefused() { return flag(REFUSED_KEY); }
/* "Not now" on the While Using card (G-P5). Remembered on this phone so the full ask does not
   come back on every roll call; the card shrinks to one line with the way back in. */
const WIU_NOT_NOW_KEY = 'os.loc.wiuNotNow';
function wiuDeclined() {
  try { return localStorage.getItem(WIU_NOT_NOW_KEY) === '1'; } catch { return false; }
}
function setWiuDeclined(on) {
  try { if (on) localStorage.setItem(WIU_NOT_NOW_KEY, '1'); else localStorage.removeItem(WIU_NOT_NOW_KEY); } catch { /* no storage */ }
}
function setAlwaysDeclined(on) {
  try { if (on) localStorage.setItem(NOT_NOW_KEY, '1'); else localStorage.removeItem(NOT_NOW_KEY); } catch { /* no storage */ }
}
function setAlwaysRefused(on) {
  try { if (on) localStorage.setItem(REFUSED_KEY, '1'); else localStorage.removeItem(REFUSED_KEY); } catch { /* no storage */ }
}

/** Step 1 then (optionally) step 2. `always` true asks for Always after While Using. Resolves the
 *  state; a grant of Always also arms walk-in right away. */
export async function allowLocation(always) {
  const askAlways = !!always && walkInCapable();
  const st = await requestLocation(askAlways);
  STATE = st;
  if (st === 'always') { setAlwaysDeclined(false); setAlwaysRefused(false); await armLocation(); }
  // Asked for Always and still While Using: iOS said "Keep Only While Using" (or had already), and
  // it will not ask again. Stop offering the button (m1).
  else if (askAlways && st === 'when_in_use') setAlwaysRefused(true);
  return st;
}

/** "I'm here", with the permission ask in front of it. Resolves imHere's answer, or
 *  { error: 'unavailable' } (old binary: say "Update OnStandard"), { error: 'denied' } (say how to
 *  turn it on in Settings), { error: 'not-allowed' } (the prompt was dismissed), or, with
 *  `prompt: false` on a phone never asked, { error: 'ask-first' }: the caller has no explanation on
 *  screen, so it sends the athlete to one instead of raising the OS prompt cold. */
export async function checkInHere(instanceId, { prompt = true } = {}) {
  if (!locationCapable()) return { error: 'unavailable' };
  // A minor without consent: no OS prompt, no reading (m2). The server rule, asked once.
  if ((consentCached() === null ? await probeConsent() : consentCached()) === false) return { error: 'consent' };
  let st = STATE || await probeLocation();
  if (st === 'unavailable' || st == null) return { error: 'unavailable' };
  if (st === 'undetermined' && !prompt) return { error: 'ask-first' };
  if (st === 'undetermined') st = await allowLocation(false);
  if (st === 'denied') return { error: 'denied' };
  if (st !== 'when_in_use' && st !== 'always') return { error: 'not-allowed' };
  return imHere(instanceId);
}

/** The plain sentence for a checkInHere error, or null when the answer was a verdict. */
export function hereErrorLine(r) {
  const e = r && r.error;
  if (!e) return null;
  if (e === 'unavailable') return 'Update OnStandard to check in by location.';
  if (e === 'denied') return 'Location is off for OnStandard. Turn it on in Settings to use I’m here.';
  if (e === 'not-allowed') return 'I’m here needs your location. Tap it again to continue.';
  if (e === 'ask-first') return 'Location comes first. It’s explained on the next screen.';
  if (e === 'consent') return 'A parent or guardian has to approve location check-in first.';
  return 'Couldn’t get your location. Try again.';
}

/** The in-context card: what the athlete should decide about location right now, for a roll call
 *  at `place`. Pure over its inputs so it holds still in a test. '' when there is nothing to ask.
 *  Its buttons are the selection-blue secondary (lk-go), never a second primary: I'm here, right
 *  above it, is the one primary on the board. */
export function locationAskHtml({ place = 'the check-in spot', state = null, walkIn = false, walkInStatus = null, optedOut = false, declined = false, consent = true, wiuDeclined = false } = {}) {
  const where = esc(place);
  const card = (title, body, acts, foot = '') => `<section class="card pad lk-ask" role="region" aria-labelledby="lk-ask-t">
    <h3 class="lk-t" id="lk-ask-t">${icon('pin', 16)} ${title}</h3>
    <p class="lk-s">${body}</p>
    <div class="lk-acts">${acts}</div>${foot ? `<p class="lk-foot">${foot}</p>` : ''}
  </section>`;
  const how = '<button type="button" class="btn ghost sm lk-how" data-go="location-consent">How it works</button>';
  // The server's consent rule first (m2): a minor without consent never sees a location prompt
  // here, only the way to a guardian. Unknown (the server couldn't be asked): no card yet.
  if (consent === false) {
    return card('A parent or guardian approves this first',
      'You’re under 18, so OnStandard won’t check your location until a guardian says yes. Until then, your coach sees Not arrived for the place.',
      '<button type="button" class="btn sm lk-go" data-go="location-consent">See how</button>');
  }
  if (consent !== true) return '';
  /* Every control below that leads to the phone's own question says Continue, never Allow, and
     no footer tells the athlete which answer to give (App Review 5.1.1(iv), G-L6). Declining is
     visible BEFORE the phone asks: Not now sits beside Continue on both cards (G-P5). */
  if (state === 'undetermined' && wiuDeclined) {
    return card('Location check-in is off',
      `You chose Not now. Until you turn it on, your coach sees Not arrived for ${where}, or marks you in.`,
      `<button type="button" class="btn sm lk-go" data-loc-allow>Continue</button>${how}`);
  }
  if (state === 'undetermined') {
    return card('Check in with your location',
      `When you tap I’m here, your phone takes one reading and checks it against ${where}. Your coach and team see Arrived or Not arrived, never where you are.`,
      `<button type="button" class="btn sm lk-go" data-loc-allow>Continue</button><button type="button" class="btn ghost sm" data-loc-wiu-notnow>Not now</button>${how}`,
      'Your phone asks next.');
  }
  if (state === 'denied') {
    return card('Location is off for OnStandard',
      'I’m here can’t check you in until you turn it on. In Settings, tap Location and choose While Using the App.',
      `<button type="button" class="btn sm lk-go" data-loc-settings>Open Settings</button>${how}`);
  }
  if (state === 'when_in_use' && walkIn && !optedOut && !declined) {
    return card('Check in without tapping',
      `Turn on walk-in check-in and your phone checks you in when you walk into ${where}, only during the check-in window. Rather not? I’m here works the same.`,
      '<button type="button" class="btn sm lk-go" data-loc-always>Continue</button><button type="button" class="btn ghost sm" data-loc-notnow>Not now</button>',
      'Your phone asks next.');
  }
  if (state === 'always' && walkIn && !optedOut) {
    return walkInStatus === 'unavailable'
      ? '<p class="lk-line warn" role="status">Walk-in check-in isn’t working on this phone. Tap I’m here when you arrive.</p>'
      : `<p class="lk-line" role="status">Walk-in check-in is on. Getting to ${where} checks you in.</p>`;
  }
  return '';
}

/** One click inside a rendered locationAskHtml, for a screen that delegates its clicks (the team
 *  board repaints its live region, so per-element listeners would not survive). True when the
 *  click was the card's. `repaint` redraws once the phone has answered. */
export function locationAskClick(target, repaint) {
  const t = target && typeof target.closest === 'function' ? target : null;
  if (!t) return false;
  const redo = () => { if (typeof repaint === 'function') repaint(); };
  const busy = (el) => { el.disabled = true; el.textContent = 'Asking…'; };
  const allow = t.closest('[data-loc-allow]');
  if (allow) { if (!allow.disabled) { busy(allow); allowLocation(false).then(redo, redo); } return true; }
  const always = t.closest('[data-loc-always]');
  if (always) { if (!always.disabled) { busy(always); allowLocation(true).then(redo, redo); } return true; }
  if (t.closest('[data-loc-notnow]')) { setAlwaysDeclined(true); redo(); return true; }
  if (t.closest('[data-loc-wiu-notnow]')) { setWiuDeclined(true); redo(); return true; }
  if (t.closest('[data-loc-settings]')) { openLocationSettings(); return true; }
  return false;
}

/** Wire a rendered locationAskHtml on a screen that does not delegate. */
export function mountLocationAsk(root, repaint) {
  if (!root) return;
  root.addEventListener('click', (ev) => { locationAskClick(ev.target, repaint); });
}

/** Everything a screen needs to paint the card for `place`: the cached state plus the flags. */
export function locationAskFor(place, optedOut = false) {
  const arm = lastLocationArm();
  return locationAskHtml({
    place, state: STATE, walkIn: walkInCapable(), walkInStatus: arm && arm.walkIn ? String(arm.walkIn) : null,
    optedOut: !!optedOut, declined: alwaysDeclined(), consent: consentCached(), wiuDeclined: wiuDeclined(),
  });
}
