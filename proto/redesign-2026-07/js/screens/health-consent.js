/* OnStandard — health permission explainer + minor consent (0155).
   Shown BEFORE any OS dialog. The athlete is told, in plain language, what is read, when, who
   sees it, and how to switch it off — because Apple's prompt is a list of data types and a list
   of data types is not enough to ask a teenager for their step count.

   For a minor the OS prompt is NOT reached from here at all: the screen routes to the guardian
   request instead. The server enforces the same rule (has_health_consent, 0155), so a client bug
   cannot open the gate.

   ⚠ THIS IS A SEPARATE ASK FROM ARRIVAL VERIFICATION. An athlete may well want their coach to
   confirm they showed up to practice and still not want their resting activity read all day.
   health_share_consent is its own record and revoking it does not touch the other. */
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

const native = () => (typeof window !== 'undefined' ? window.OnStandardNative : null);
export const healthNative = () => {
  const n = native();
  return n && n.health ? n.health : null;
};

let AVAILABLE = null;   // null = not probed yet
let CONNECTED = false;
let CONSENT = null;     // the SERVER's answer; null renders as "checking", never as permission
let IS_MINOR = null;
let BUSY = false;

const bullet = (ic, title, body) => `
  <div class="lrow" style="align-items:flex-start;cursor:default">
    <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon(ic, 16)}</div>
    <div class="lm"><div class="lt">${esc(title)}</div><div class="ls">${esc(body)}</div></div>
  </div>`;

async function probe() {
  const h = healthNative();
  AVAILABLE = h ? await h.available().catch(() => false) : false;
  if (AVAILABLE && h) CONNECTED = await h.connected().catch(() => false);
  const c = window.sb;
  if (!c) return;
  try {
    const { data: u } = await c.auth.getUser();
    const uid = u && u.user && u.user.id;
    if (!uid) return;
    const { data } = await c.rpc('has_health_consent', { p_athlete: uid });
    CONSENT = data === true;
    // Age drives which grant is even possible. Unknown age is treated as a minor by is_minor()
    // server-side, and the copy below follows the same default rather than promising a button
    // that the server will refuse.
    const { data: ap } = await c.from('athlete_profiles').select('base_age').eq('athlete_id', uid).maybeSingle();
    const age = ap && ap.base_age;
    IS_MINOR = age == null ? true : Number(age) < 18;
  } catch { /* leave CONSENT null — "checking", never a false yes */ }
}

export default {
  tab: 'home',
  render() {
    const needsGuardian = IS_MINOR === true && CONSENT !== true;

    return `${backHead('Connect Apple Health', 'Verify your standards automatically', 'connected-standards')}

    <section class="card pad">
      <div class="tt">Let your standards check themselves</div>
      <div class="ts" style="padding-top:6px">Your coach set an activity standard. With Health connected, OnStandard reads your totals and marks it complete on its own — no screenshots, no logging.</div>
    </section>

    <section class="card" style="padding:6px 16px;margin-top:10px">
      ${bullet('bolt', 'What OnStandard reads',
        'Step count, walking and running distance, and workout totals — only for the standards assigned to you.')}
      ${bullet('shield', 'What your coach sees',
        'How far you got toward the target they set, and whether it verified. Never your raw health data, your routes, or your history.')}
      ${bullet('clock', 'When it reads',
        'While a standard is open, and once more after its deadline. Nothing is read on a day you have no standard.')}
      ${bullet('check', 'Your control',
        'Turn it off any time in Settings. A dead battery or a sync gap never counts against you — you can always log it by hand instead.')}
    </section>

    ${CONSENT === null ? `
      <section class="card pad" style="margin-top:10px"><div class="ts dim">Checking your account…</div></section>`
    : needsGuardian ? `
      <section class="card pad" style="margin-top:10px;border-color:var(--amber-border)">
        <div class="tt">A parent or guardian has to approve this</div>
        <div class="ts" style="padding-top:6px">You’re under 18, so we ask your guardian before reading any health data — your own tap isn’t enough, and the server enforces that too.</div>
        <button class="btn" data-go="guardian" style="margin-top:12px">Ask my guardian</button>
      </section>`
    : CONNECTED ? `
      <section class="card pad" style="margin-top:10px;border-color:var(--green-border)">
        <div class="tt">Connected</div>
        <div class="ts" style="padding-top:6px">Your standards are verifying themselves. You can disconnect any time.</div>
        <button class="btn ghost" id="hc-off" style="margin-top:12px">Disconnect</button>
      </section>`
    : AVAILABLE === false ? `
      <section class="card pad" style="margin-top:10px"><div class="ts dim">Taking you back…</div></section>`
    : `
      <div style="padding:12px 20px 0">
        <button class="btn" id="hc-go">Continue to Apple Health</button>
        <button class="btn ghost" data-go="connected-standards" style="margin-top:8px">Not now — I’ll log manually</button>
      </div>`}

    <div class="ts dim" style="text-align:center;padding:14px 20px 24px">
      Connecting Health is separate from arrival check-ins. Turning one on doesn’t turn on the other.
    </div>`;
  },

  async mount(root) {
    if (AVAILABLE === null || CONSENT === null) {
      await probe();
      // ⚠ NO REACHABLE "COMING SOON". Until the native module is wired, isHealthAvailable is
      // false and this screen has nothing to offer, so it hands the athlete back the way #devices
      // does rather than showing a dead end that promises a button nobody can press. The
      // manual path on the standard itself still works, which is what makes that acceptable.
      if (AVAILABLE === false) { location.hash = '#connected-standards'; return; }
      if (root.isConnected && window.__render) window.__render();
      return;
    }

    const go = root.querySelector('#hc-go');
    if (go) go.addEventListener('click', async () => {
      if (BUSY) return;
      BUSY = true; go.disabled = true; go.textContent = 'Opening…';
      try {
        const c = window.sb;
        const { data: u } = await c.auth.getUser();
        const uid = u && u.user && u.user.id;
        // Record consent BEFORE the OS prompt. If the athlete grants at the OS level but the
        // consent row never lands, the server refuses every reading and the feature looks broken
        // for reasons no one can see.
        const { error } = await c.rpc('grant_health_consent', { p_athlete: uid, p_kind: 'self' });
        if (error) { BUSY = false; go.disabled = false; go.textContent = 'Couldn’t save — try again'; return; }
        const h = healthNative();
        const res = h && h.connectScoped
          ? await h.connectScoped(['activity']).catch(() => ({ connected: false }))
          : { connected: false };
        CONNECTED = !!(res && res.connected);
        CONSENT = true;
        if (CONNECTED && h && h.observeActivity) await h.observeActivity().catch(() => false);
      } finally {
        BUSY = false;
        if (window.__render) window.__render();
      }
    });

    const off = root.querySelector('#hc-off');
    if (off) off.addEventListener('click', async () => {
      off.disabled = true; off.textContent = 'Disconnecting…';
      try {
        const c = window.sb;
        const { data: u } = await c.auth.getUser();
        const uid = u && u.user && u.user.id;
        await c.rpc('revoke_health_consent', { p_athlete: uid });
        CONNECTED = false; CONSENT = false;
      } catch { /* the button re-renders either way */ }
      if (window.__render) window.__render();
    });
  },
};

/** Reset the probe so a fresh visit re-asks the server rather than trusting a stale yes. */
export function refreshHealthConsent() { AVAILABLE = null; CONSENT = null; CONNECTED = false; }
