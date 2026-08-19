/* OnStandard — location permission explainer + minor consent (0139).
   Shown BEFORE any OS dialog. The athlete is told, in plain language, what is checked, when,
   what is stored, who sees it, and how to switch it off — because the iOS prompt is one line and
   one line is not enough to ask a teenager for background location.

   For a minor the OS prompt is NOT reached from here at all: the screen routes to the guardian
   request instead. The server enforces the same rule (has_verification_consent, 0139), so a
   client bug cannot open the gate. */
import { icon } from '../icons.js';
import { RT, act } from '../state.js';
import { backHead, esc } from '../components.js';
import { loadVerificationConsent, verifyArrival } from '../commitment-data.js';

const native = () => (typeof window !== 'undefined' ? window.OnStandardNative : null);
export const locationNative = () => {
  const n = native();
  return n && n.location ? n.location : null;
};

let STATE = null;      // 'always' | 'when_in_use' | 'denied' | 'undetermined' | 'unavailable'
let AVAILABLE = null;  // null = not probed yet
let BUSY = false;
/* The SERVER's answer to "may this athlete be verified at all" (has_verification_consent, 0139).
   null = not asked yet, and renders as "checking" — never as permission. */
let CONSENT = null;
/* Whether a consent probe has SETTLED at least once. null + settled means the server couldn't be
   asked — an honest "we couldn't confirm" with a retry, which is a different screen from
   "checking". */
let CONSENT_ASKED = false;

/* call() in the native bridge has no timeout: a handler that never answers would strand whatever
   awaits it — the arrival button on "Saving…", this screen on a probe — forever. Race the asks
   that have no legitimate reason to block against a clock. (The OS permission dialog itself is
   NOT raced: a person reading that prompt for a minute is normal, not a hang.) */
const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('native call timed out')), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const bullet = (ic, title, body) => `
  <div class="lrow" style="align-items:flex-start;cursor:default">
    <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(ic, 16)}</div>
    <div class="lm"><div class="lt">${esc(title)}</div><div class="ls">${esc(body)}</div></div>
  </div>`;

export default {
  tab: 'home',
  render() {
    // Consent is the server's call. CONSENT === false means "you need a guardian first"; null
    // means we haven't heard back and we show neither switch nor false reassurance.
    const needsGuardian = CONSENT === false;
    // The athlete's own opt-out outranks the OS permission: "off" they chose here must READ as
    // off, and stay off, even while the OS grant is still 'always'.
    const optedOut = !!RT.locationOptOut;
    const on = STATE === 'always' && !optedOut;
    const partial = STATE === 'when_in_use' && !optedOut;
    const denied = STATE === 'denied';

    return `
    ${backHead('Arrival check-in', 'How OnStandard confirms you showed up', 'home')}

    <section class="card pad">
      <div class="tt" style="font-size:15px">You tap once. Or you don’t have to tap at all.</div>
      <div class="ts" style="padding-top:6px">Your coach schedules a practice at a place. OnStandard confirms your phone got there inside the window they set — so you never have to argue about whether you showed up.</div>
    </section>

    <div class="eyebrow">What actually happens</div>
    <section class="card" style="padding:2px 16px">
      ${bullet('clock', 'Only around a scheduled commitment',
        'Your location is checked only in the window your coach set for that one event. Outside that window nothing is watched at all.')}
      ${bullet('shield', 'Only a yes or no is recorded',
        'Your phone compares itself to the place your coach picked and reports "arrived" or "couldn’t confirm". No coordinates leave your phone and none are stored.')}
      ${bullet('eye', 'Only your coaching staff can see it',
        'Your arrival time is visible to the staff responsible for you. There is no team list of who was late and no way for other athletes to see your record.')}
      ${bullet('x', 'You can turn it off whenever you want',
        'Switch it off here or in your phone settings. You’ll check in by tapping a button instead, and nothing you already earned is deleted.')}
    </section>

    ${AVAILABLE === false ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 19)}</div>
      <div>
        <div class="tt">Not available on this version</div>
        <div class="ts">Arrival check-in needs a newer build of the app. Until you update, you can check in by tapping the button on your commitment card — it counts exactly the same.</div>
      </div>
    </div>` : needsGuardian ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon a" style="width:38px;height:38px">${icon('user', 19)}</div>
      <div>
        <div class="tt">A parent or guardian has to approve this first</div>
        <div class="ts">You're under 18, so OnStandard won't check your location until a guardian says yes — or your school records that they already have your family's consent on file. Until then you can still check in by tapping.</div>
      </div>
    </div>
    <div style="height:14px"></div>
    ${RT.consent && RT.consent.guardianEmail ? `
    <div class="ts center">Your parent is already linked (${esc(RT.consent.guardianEmail)}). They approve arrival check-in from their own OnStandard app, on your card under the Athletes tab.</div>
    ` : `
    <button class="btn" id="lc-guardian" style="width:100%">${icon('message', 18)} Invite a parent to OnStandard</button>
    <div style="height:10px"></div>
    <div class="ts center">Once they're linked, they approve arrival check-in from their own app. Nothing about your location is checked or stored until they do.</div>`}
    ` : CONSENT === null ? (CONSENT_ASKED ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon a" style="width:38px;height:38px">${icon('bolt', 19)}</div>
      <div>
        <div class="tt">Couldn’t confirm your account just now</div>
        <div class="ts">We couldn’t reach the server to check whether arrival check-in is set up for you, so nothing is switched on yet. You can still check in by tapping the button on your commitment card.</div>
      </div>
    </div>
    <div style="height:14px"></div>
    <button class="btn ghost" id="lc-consent-retry" style="width:100%">Try again</button>
    ` : `
    <div style="height:14px"></div>
    <button class="btn" disabled style="width:100%">Checking your account…</button>
    <div style="height:10px"></div>
    <div class="ts" style="text-align:center">One moment: confirming arrival check-in is available for you.</div>
    `) : denied ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon a" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">Your phone is blocking location for OnStandard</div>
        <div class="ts">Location for this app is set to “Never” in your phone’s settings, so automatic check-in can’t run and asking again from here won’t bring the prompt back. To turn it on: open your phone’s Settings, find OnStandard, and set Location to “Always”. Until then, check in by tapping the button on your commitment card. It counts exactly the same.</div>
      </div>
    </div>` : `
    <div style="height:14px"></div>
    <button class="btn ${on ? '' : 'green'}" id="lc-enable" style="width:100%" ${BUSY ? 'disabled' : ''}>
      ${icon(on ? 'check' : 'target', 18)} ${on ? 'Automatic check-in is on' : partial ? 'Allow it to work in the background' : 'Turn on arrival check-in'}
    </button>
    <div style="height:10px"></div>
    <div class="ts" style="text-align:center">${on
      ? 'You don’t have to open the app — arriving is enough.'
      : partial
        ? 'Right now it only works while the app is open. Allowing "Always" means you never have to think about it.'
        : 'Your phone will ask next. Choosing "Always" is what lets it work at 5:43 AM without you opening anything.'}</div>
    ${on || partial ? `<div style="height:10px"></div>
      <button class="btn ghost" id="lc-off" style="width:100%">Turn it off</button>` : ''}
    `}
    <div style="height:20px"></div>`;
  },

  mount(root) {
    const loc = locationNative();
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };

    // Consent is re-asked while anything but a confirmed yes: null because a guardian may have
    // said yes since the failed probe, false because one may have approved since the last paint —
    // a stale "ask your parent" wall in front of an approved athlete is the worse failure.
    // Re-render only on the first settle or a changed answer, so a repeated null can't loop.
    if (CONSENT !== true) {
      loadVerificationConsent().then((ok) => {
        const first = !CONSENT_ASKED;
        CONSENT_ASKED = true;
        const prev = CONSENT;
        if (ok !== null) CONSENT = ok;
        if (first || CONSENT !== prev) rerender();
      });
    }

    // Permission is re-probed on EVERY mount, not once per session: the athlete may have just
    // changed it in the OS Settings app, and a screen reporting last week's answer reads as
    // broken. The cached value paints immediately; the probe corrects it if it moved.
    if (!loc) { AVAILABLE = false; STATE = 'unavailable'; }
    else {
      withTimeout(loc.available(), 8_000).then((r) => {
        const a = !!(r && r.available);
        const s = (r && r.state) || 'unavailable';
        const changed = a !== AVAILABLE || s !== STATE;
        AVAILABLE = a; STATE = s;
        if (changed) rerender();
      }).catch(() => {
        if (AVAILABLE === null) { AVAILABLE = false; STATE = 'unavailable'; rerender(); }
      });
    }

    const enable = root.querySelector('#lc-enable');
    if (enable) enable.addEventListener('click', async () => {
      if (!loc || BUSY) return;
      BUSY = true; enable.disabled = true; enable.textContent = 'Asking…';
      // Turning it on is also how an opted-out athlete opts back in.
      act.setLocationOptOut(false);
      try {
        // No timeout on request(): a person reading the OS dialog for a minute is not a hang.
        STATE = await loc.request(true);
        if (STATE === 'always') {
          const r = await withTimeout(loc.arm(), 8_000);
          ARM_CAPPED = !!(r && r.capped);
        }
      } catch {
        // The bridge failed or arm() stalled: re-probe for the truth instead of guessing at it.
        try { const r = await withTimeout(loc.available(), 8_000); STATE = (r && r.state) || STATE; }
        catch { /* keep the last known state */ }
      }
      BUSY = false;
      window.__render && window.__render();
    });

    const consentRetry = root.querySelector('#lc-consent-retry');
    if (consentRetry) consentRetry.addEventListener('click', async () => {
      consentRetry.disabled = true; consentRetry.textContent = 'Checking…';
      await refreshConsent();
      window.__render && window.__render();
    });

    const off = root.querySelector('#lc-off');
    if (off) off.addEventListener('click', async () => {
      if (!loc) return;
      off.disabled = true; off.textContent = 'Turning off…';
      // The persisted opt-out is what makes "off" TRUE. The old handler only disarmed and
      // flipped a local variable — the next Home load saw the OS grant still 'always' and
      // silently re-armed everything, breaking this screen's own promise.
      act.setLocationOptOut(true);
      try { await loc.disarm(); } catch { /* already disarmed */ }
      window.__render && window.__render();
    });

    const guardian = root.querySelector('#lc-guardian');
    // The old destination was '#guardian' — the 0008/0050 NUTRITION-data consent flow, which
    // writes a different table and could never bring this wall down. The real path: link a
    // parent (invite code), who then approves arrival check-in from their own hub.
    if (guardian) guardian.addEventListener('click', () => { location.hash = '#invite-parent'; });
  },
};

/* Whether the last arm() hit the OS's 16-region cap — commitments past the cap get NO automatic
   watch, and the athlete deserves to hear "tap when you arrive" instead of silence. */
let ARM_CAPPED = false;
export function armCapped() { return ARM_CAPPED; }

/* Called from Home once per load: keep the OS watching whatever is inside its window right now.
   Cheap and idempotent — refreshGeofences re-registers the current set and disarms when empty.
   The athlete's opt-out is honored HERE, which is what makes the off-switch real: before this
   check, "Turn it off" survived exactly until the next Home load re-armed everything. */
export function armIfPermitted() {
  const loc = locationNative();
  if (!loc || RT.locationOptOut) return Promise.resolve(null);
  return loc.available()
    .then((r) => (r && r.available && r.state === 'always' ? loc.arm() : null))
    .then((r) => { if (r) ARM_CAPPED = !!r.capped; return r; })
    .catch(() => null);
}

/* Exposed for the arrival card: one fix, compared on device, verdict written BY THIS CLIENT.
   Returns { within, recorded, reason }.

   The device check runs with report:false and the write goes through verifyArrival() here,
   because the native bridge's own report path discards the server's answer — a consent refusal,
   a cancelled instance or an expired session all painted as "arrived" on the athlete's phone
   and silently reverted on the next fetch. Now a refused write is SAID: recorded:false, with
   the reason. A negative device verdict still lands as 'unverified', never 'missed'. */
export async function tapToVerify(instanceId) {
  const loc = locationNative();
  if (!loc) return { within: false, recorded: false, reason: 'Location is unavailable on this build' };
  let device;
  try {
    // Raced against a clock: a stalled LOCATION_CHECK would otherwise pin the arrival button on
    // "Saving…" forever.
    device = await withTimeout(loc.check(instanceId, false), 15_000);
  } catch {
    return { within: false, recorded: false, reason: 'Couldn’t check right now' };
  }
  const within = !!(device && device.within);
  const res = await verifyArrival(instanceId, 'manual', within, device && device.reason);
  if (!res.ok) {
    const consent = /consent/i.test(res.error || '');
    return {
      within: false, recorded: false,
      reason: consent
        ? 'A parent has to approve arrival check-in first: nothing was recorded'
        : 'Couldn’t record this. Check your signal and tap again',
    };
  }
  return { within, recorded: true, reason: device && device.reason };
}

/** Re-ask the server on demand (e.g. after a guardian approves). */
export function refreshConsent() {
  return loadVerificationConsent().then((ok) => { if (ok !== null) CONSENT = ok; return ok; });
}
