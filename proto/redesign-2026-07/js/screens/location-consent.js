/* OnStandard: location check-in, explained and switched (restored 2026-09-23, final fix round
   item 2; the original was removed with arrival check-in in 8e7506bb and is restored from
   8e7506bb^:proto/redesign-2026-07/js/screens/location-consent.js, adapted to what the product
   does now).

   Shown BEFORE any OS dialog. The athlete is told, in plain language, what is checked, when, what
   is kept, who sees it, and how to switch it off, because the iOS prompt is one line and one line
   is not enough to ask a teenager for location.

   What changed from the original, because the product changed:
     - The reading goes to the SERVER once (verify_arrival_at, 0242), which measures the distance
       and keeps only Arrived or Not arrived. The old copy said no coordinate ever left the phone.
     - Teammates see Arrived / Not arrived on the team board (founder, 2026-09-23). The old copy
       said no other athlete could see the record.
     - Apple's two steps, in order: While Using first (all "I'm here" needs), then Always, offered
       only after, only where walk-in may run (WALK_IN), and it says declining changes nothing for
       "I'm here".
     - An app build without location says "Update OnStandard", from the native capability line.

   For a minor the OS prompt is NOT reached from here at all: the screen routes to the guardian
   request instead. The server enforces the same rule (has_verification_consent, 0139), so a
   client bug cannot open the gate.

   Styles: css/screens.css, the `lc-` block. */
import { icon } from '../icons.js';
import { RT, act } from '../state.js';
import { backHead, esc } from '../components.js';
import { lastLocationArm } from '../commitment-data.js';
import {
  locationCapable, walkInCapable, probeLocation, locationStateCached, allowLocation,
  disarmLocation, openLocationSettings, alwaysRefused,
  probeConsent, consentCached, consentSettled, setConsentCachedForHarness,
} from '../location.js';

/* The SERVER's answer to "may this athlete be verified at all" (has_verification_consent, 0139)
   is location.js's one cache, keyed by the signed-in user (fix round 3, R2-2): this screen and the
   board card read the same answer, and a sign-out never carries it to the next account. */
let BUSY = false;

/** Harness + test seam: stand in for the server's consent answer. */
export function setConsentForHarness(v) { setConsentCachedForHarness(v); }

const bullet = (ic, title, body) => `
  <div class="lrow lc-row" role="listitem">
    <div class="lic lc-ic">${icon(ic, 16)}</div>
    <div class="lm"><div class="lt">${esc(title)}</div><div class="ls">${esc(body)}</div></div>
  </div>`;

const note = (tone, ic, title, body) => `
  <div class="sidebox lc-note">
    <div class="req-icon ${tone} s38">${icon(ic, 19)}</div>
    <div><div class="tt">${esc(title)}</div><div class="ts">${esc(body)}</div></div>
  </div>`;

/** The part of the screen that depends on the phone and the server. Pure over its inputs. */
export function consentActionHtml({ capable, state, walkIn, consent, consentAsked, optedOut, walkInStatus, busy = false, refused = false }) {
  if (!capable) {
    return note('b', 'bolt', 'Update OnStandard to check in by location',
      'This version of the app can’t take a location reading. Until you update, your coach sees you as not arrived for a place check.');
  }
  if (consent === false) {
    return `${note('a', 'user', 'A parent or guardian has to approve this first',
      'You’re under 18, so OnStandard won’t check your location until a guardian says yes, or your school records that it already has your family’s consent.')}
    ${RT.consent && RT.consent.guardianEmail
      ? `<p class="ts lc-foot">Your parent is already linked (${esc(RT.consent.guardianEmail)}). They approve location check-in from their own OnStandard app.</p>`
      : `<button type="button" class="btn lc-btn" id="lc-guardian">${icon('message', 18)} Invite a parent to OnStandard</button>
    <p class="ts lc-foot">Once they’re linked, they approve it from their own app. Nothing about your location is checked until they do.</p>`}`;
  }
  if (consent == null) {
    return consentAsked
      ? `${note('a', 'bolt', 'Couldn’t confirm your account just now',
        'We couldn’t reach the server to check whether location check-in is set up for you, so nothing is switched on yet.')}
    <button type="button" class="btn ghost lc-btn" id="lc-consent-retry">Try again</button>`
      : '<button type="button" class="btn lc-btn" disabled>Checking your account…</button>';
  }
  if (state === 'denied') {
    return `${note('a', 'target', 'Location is off for OnStandard',
      'Your phone won’t show the question again, so it has to be turned on in Settings: tap Location and choose While Using the App. Until then, I’m here can’t check you in.')}
    <button type="button" class="btn primary lc-btn" id="lc-settings">Open Settings</button>`;
  }
  const on = state === 'always' && !optedOut;
  if (state === 'always' || state === 'when_in_use') {
    const walk = walkIn && !optedOut && state === 'always';
    const offerAlways = walkIn && (state === 'when_in_use' || optedOut);
    return `<p class="lc-state">${icon('check', 16)} I’m here is on. One tap at the place checks you in.</p>
    ${walk ? (walkInStatus === 'unavailable'
      ? note('a', 'alert', 'Walk-in check-in isn’t working on this phone', 'Your phone didn’t let OnStandard watch the place. Tap I’m here when you arrive. It counts exactly the same.')
      : `<p class="lc-state">${icon('check', 16)} Walk-in check-in is on. Arriving is enough.</p>
    <button type="button" class="btn ghost lc-btn" id="lc-off" ${busy ? 'disabled' : ''}>Turn off walk-in check-in</button>`) : ''}
    ${offerAlways && refused && state === 'when_in_use'
      // iOS asks for Always ONCE (fix round 2, m1). After "Keep Only While Using" a request does
      // nothing, so the only way to walk-in check-in is Settings; never a button that asks again.
      ? `<button type="button" class="btn ghost lc-btn" id="lc-settings">Open Settings</button>
    <p class="ts lc-foot">For walk-in check-in, tap Location in Settings and choose Always. Rather not? I’m here works the same.</p>`
      : offerAlways ? `<button type="button" class="btn primary lc-btn" id="lc-always" ${busy ? 'disabled' : ''}>${icon('target', 18)} Also check me in when I walk in</button>
    <p class="ts lc-foot">${on ? '' : 'Your phone asks next. Choose Change to Always Allow. '}Rather not? I’m here works the same, and nothing you earned changes.</p>` : ''}`;
  }
  // Never asked (or the prompt was dismissed): step one, While Using.
  return `<button type="button" class="btn primary lc-btn" id="lc-allow" ${busy ? 'disabled' : ''}>${icon('target', 18)} Allow location while using the app</button>
    <p class="ts lc-foot">Your phone asks next. Choose Allow While Using App. That is all I’m here needs.</p>`;
}

export default {
  tab: 'profile',
  render() {
    const capable = locationCapable();
    const arm = lastLocationArm();
    return `
    ${backHead('Location check-in', 'How showing up is confirmed', 'profile')}

    <section class="card pad lc-lead">
      <div class="tt">Tap once when you get there. Or don’t tap at all.</div>
      <div class="ts">Your coach can add a place to a roll call. OnStandard confirms you got there inside the window they set, so nobody has to argue about whether you showed up.</div>
    </section>

    <h2 class="eyebrow">What actually happens</h2>
    <section class="card lc-list" role="list">
      ${bullet('clock', 'Only for a roll call with a place',
        'Your location is checked only for a roll call your coach gave a place, and only during its check-in window. Outside that window nothing is checked at all.')}
      ${bullet('shield', 'One reading, then it’s gone',
        'Your phone takes one reading when you tap I’m here, or when you walk in. OnStandard checks it against the place and keeps only Arrived or Not arrived. The reading itself is not kept.')}
      ${bullet('eye', 'Who sees what',
        'Your coach and your team see Arrived or Not arrived on the team board. Nobody sees where you are. Only you see how far away you were.')}
      ${bullet('toggle', 'You decide',
        'Walk-in check-in is optional. Turn it off here or in your phone’s Settings. I’m here still works, and it counts exactly the same.')}
    </section>

    <div class="lc-act">${consentActionHtml({
      capable, state: locationStateCached(), walkIn: walkInCapable(), consent: consentCached(), consentAsked: consentSettled(),
      optedOut: !!RT.locationOptOut, walkInStatus: arm && arm.walkIn ? String(arm.walkIn) : null, busy: BUSY,
      refused: alwaysRefused(),
    })}</div>`;
  },

  mount(root) {
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };

    // Consent is re-asked while anything but a confirmed yes (a guardian may have said yes since).
    // Re-render only on the first settle or a changed answer, so a repeated null can't loop.
    if (consentCached() !== true) {
      const first = !consentSettled();
      const prev = consentCached();
      probeConsent(true).then((now) => { if (first || now !== prev) rerender(); }, () => {});
    }
    // Permission is re-probed on EVERY mount: the athlete may have just changed it in Settings.
    if (locationCapable()) {
      const before = locationStateCached();
      probeLocation().then((st) => { if (st !== before) rerender(); }, () => {});
    }

    const run = async (btn, fn) => {
      if (!btn || BUSY) return;
      BUSY = true; btn.disabled = true; btn.textContent = 'Asking…';
      try { await fn(); } catch { /* the re-probe below tells the truth */ }
      try { await probeLocation(); } catch { /* keep the last known state */ }
      BUSY = false;
      rerender();
    };
    const allow = root.querySelector('#lc-allow');
    if (allow) allow.addEventListener('click', () => run(allow, () => allowLocation(false)));
    const always = root.querySelector('#lc-always');
    if (always) always.addEventListener('click', () => run(always, () => {
      // Turning it on is also how an opted-out athlete opts back in.
      act.setLocationOptOut(false);
      return allowLocation(true);
    }));
    const off = root.querySelector('#lc-off');
    if (off) off.addEventListener('click', () => run(off, () => {
      // The persisted opt-out is what makes "off" TRUE: the lifecycle arm honours it
      // (state.js _armLocation), so the next foreground cannot quietly re-arm.
      act.setLocationOptOut(true);
      return disarmLocation();
    }));
    const settings = root.querySelector('#lc-settings');
    if (settings) settings.addEventListener('click', () => { openLocationSettings(); });
    const retry = root.querySelector('#lc-consent-retry');
    if (retry) retry.addEventListener('click', async () => {
      retry.disabled = true; retry.textContent = 'Checking…';
      await probeConsent(true);
      rerender();
    });
    // The real path for a minor: link a parent (invite code), who then approves from their hub.
    const guardian = root.querySelector('#lc-guardian');
    if (guardian) guardian.addEventListener('click', () => { location.hash = '#invite-parent'; });
  },
};
