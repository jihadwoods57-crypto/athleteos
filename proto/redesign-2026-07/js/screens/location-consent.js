/* OnStandard — location permission explainer + minor consent (0139).
   Shown BEFORE any OS dialog. The athlete is told, in plain language, what is checked, when,
   what is stored, who sees it, and how to switch it off — because the iOS prompt is one line and
   one line is not enough to ask a teenager for background location.

   For a minor the OS prompt is NOT reached from here at all: the screen routes to the guardian
   request instead. The server enforces the same rule (has_verification_consent, 0139), so a
   client bug cannot open the gate. */
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { loadVerificationConsent } from '../commitment-data.js';

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
    const on = STATE === 'always';
    const partial = STATE === 'when_in_use';

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

    ${needsGuardian ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon a" style="width:38px;height:38px">${icon('user', 19)}</div>
      <div>
        <div class="tt">A parent or guardian has to approve this first</div>
        <div class="ts">You're under 18, so OnStandard won't check your location until a guardian says yes — or your school records that they already have your family's consent on file. Until then you can still check in by tapping.</div>
      </div>
    </div>
    <div style="height:14px"></div>
    <button class="btn" id="lc-guardian" style="width:100%">${icon('message', 18)} Ask a parent to approve</button>
    <div style="height:10px"></div>
    <div class="ts" style="text-align:center">Nothing about your location is checked or stored until they do.</div>
    ` : AVAILABLE === false ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 19)}</div>
      <div>
        <div class="tt">Not available on this version</div>
        <div class="ts">Arrival check-in needs a newer build of the app. Until you update, you can check in by tapping the button on your commitment card — it counts exactly the same.</div>
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
    if (CONSENT === null) {
      loadVerificationConsent().then((ok) => {
        if (ok === null) return;           // couldn't ask — leave it unknown, show nothing false
        CONSENT = ok;
        if (root.isConnected) window.__render && window.__render();
      });
    }
    if (AVAILABLE === null) {
      if (!loc) { AVAILABLE = false; STATE = 'unavailable'; }
      else {
        loc.available().then((r) => {
          AVAILABLE = !!(r && r.available);
          STATE = (r && r.state) || 'unavailable';
          if (root.isConnected) window.__render && window.__render();
        }).catch(() => { AVAILABLE = false; STATE = 'unavailable'; });
      }
    }

    const enable = root.querySelector('#lc-enable');
    if (enable) enable.addEventListener('click', async () => {
      if (!loc || BUSY) return;
      BUSY = true; enable.disabled = true; enable.textContent = 'Asking…';
      try {
        STATE = await loc.request(true);
        if (STATE === 'always') await loc.arm();
      } catch { STATE = 'unavailable'; }
      BUSY = false;
      window.__render && window.__render();
    });

    const off = root.querySelector('#lc-off');
    if (off) off.addEventListener('click', async () => {
      if (!loc) return;
      off.disabled = true; off.textContent = 'Turning off…';
      try { await loc.disarm(); } catch { /* already disarmed */ }
      STATE = 'when_in_use';
      window.__render && window.__render();
    });

    const guardian = root.querySelector('#lc-guardian');
    if (guardian) guardian.addEventListener('click', () => { location.hash = '#/guardian'; });
  },
};

/* Called from Home once per load: keep the OS watching whatever is inside its window right now.
   Cheap and idempotent — refreshGeofences re-registers the current set and disarms when empty. */
export function armIfPermitted() {
  const loc = locationNative();
  if (!loc) return Promise.resolve(null);
  return loc.available()
    .then((r) => (r && r.available && r.state === 'always' ? loc.arm() : null))
    .catch(() => null);
}

/* Exposed for the arrival card: one fix, compared natively, verdict written server-side.
   Returns { within, reason }. A negative verdict lands on 'unverified', never 'missed'. */
export function tapToVerify(instanceId) {
  const loc = locationNative();
  if (!loc) return Promise.resolve({ within: false, reason: 'Location is unavailable on this build' });
  return loc.check(instanceId, true).catch(() => ({ within: false, reason: 'Couldn’t check right now' }));
}

/** Re-ask the server on demand (e.g. after a guardian approves). */
export function refreshConsent() {
  return loadVerificationConsent().then((ok) => { if (ok !== null) CONSENT = ok; return ok; });
}
