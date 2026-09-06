/* OnStandard, Apple Health: one screen for the whole integration (Settings > Apple Health).
 *
 * Before this (2026-09-06) the integration had two doors and no front: #health-consent (activity
 * for verified standards, reached only from Connected Standards) and #devices (sleep, HRV and
 * resting heart rate for Recovery, reached only from a hidden row on the check-in). Neither was in
 * Settings, so an athlete who allowed the wrong categories in Apple's sheet, or who wanted to turn
 * the whole thing off, had nowhere to go. This screen is the front door: the live state, what is
 * read and why, the phone-side steps to change what Health shares (the Health app is one tap
 * away), and Disconnect. Connecting still goes through #health-consent, because that is where the
 * minor / guardian gate and the server consent record live and they must run before the OS sheet.
 *
 * Honesty rules carried over from health-consent.js: iOS never says which categories were
 * allowed, so "connected" is only "has seen the sheet"; a real read is what earns "Reading". Every
 * reading shown here is context for the athlete; the score does not move because of it. */
import { icon } from '../icons.js';
import { backHead, esc, logoMark, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { refreshHealthConsent } from './health-consent.js';

const native = () => (typeof window !== 'undefined' && window.OnStandardNative) || null;
const healthN = () => { const n = native(); return n && n.health ? n.health : null; };

/** Module-scoped so Settings can read the same answer without re-probing. */
export const HK = {
  probed: false, available: null, connected: false, consent: null, isMinor: null,
  activity: null,   // today's { steps, distanceMeters, activeMinutes, workouts } or null
  recovery: null,   // last night's { sleepHours, hrvMs, restingHr } or null
  busy: false, note: '',
};

const hasActivity = (a) => !!(a && (a.steps != null || a.distanceMeters != null || a.activeMinutes != null || (a.workouts && a.workouts.length)));
const hasRecovery = (r) => !!(r && (r.sleepHours != null || r.hrvMs != null || r.restingHr != null));

export async function probeHealth() {
  const h = healthN();
  try {
    HK.available = h && h.available ? !!(await h.available()) : !!(await roles.healthAvailable());
  } catch { HK.available = false; }
  if (HK.available) {
    try { HK.connected = h && h.connected ? !!(await h.connected()) : !!(await roles.healthConnected()); }
    catch { HK.connected = false; }
  } else HK.connected = false;
  if (HK.connected) {
    if (h && h.readActivity) {
      const to = new Date(); const from = new Date(to); from.setHours(0, 0, 0, 0);
      HK.activity = await h.readActivity(from.toISOString(), to.toISOString()).catch(() => null);
    }
    HK.recovery = await roles.healthRead().catch(() => null);
  } else { HK.activity = null; HK.recovery = null; }
  const c = typeof window !== 'undefined' ? window.sb : null;
  if (c) {
    try {
      const { data: u } = await c.auth.getUser();
      const uid = u && u.user && u.user.id;
      if (uid) {
        const { data } = await c.rpc('has_health_consent', { p_athlete: uid });
        HK.consent = data === true;
        const { data: ap } = await c.from('athlete_profiles').select('base_age').eq('athlete_id', uid).maybeSingle();
        const age = ap && ap.base_age;
        HK.isMinor = age == null ? true : Number(age) < 18;
      }
    } catch { /* consent stays null: "checking", never a false yes */ }
  }
  HK.probed = true;
}

/** The one-line state Settings shows under "Apple Health". */
export function hkLabel() {
  if (!HK.probed) return 'Checking…';
  if (HK.available === false) return 'iPhone only';
  if (!HK.connected) return 'Not connected';
  return (hasActivity(HK.activity) || hasRecovery(HK.recovery)) ? 'Connected' : 'Connected, nothing shared yet';
}

const fmtSteps = (n) => Number(n).toLocaleString();
const fmtSleep = (h) => { const H = Math.floor(h), M = Math.round((h - H) * 60); return `${H}h${M ? ` ${M}m` : ''}`; };

function readingLine() {
  const bits = [];
  const a = HK.activity, r = HK.recovery;
  if (a && a.steps != null) bits.push(`${fmtSteps(a.steps)} steps today`);
  if (a && a.workouts && a.workouts.length) bits.push(`${a.workouts.length} workout${a.workouts.length === 1 ? '' : 's'}`);
  if (r && r.sleepHours != null) bits.push(`${fmtSleep(r.sleepHours)} sleep last night`);
  return bits.join(' · ');
}

function statusCard() {
  if (HK.available === false) return `
    <section class="card pad hk-card">
      <div class="hk-status">
        <div class="hk-ic">${icon('heart', 20)}</div>
        <div><div class="hk-t">Not on this phone</div>
        <div class="hk-s">Apple Health lives on iPhone. Here your standards verify by logging, and Recovery uses your nightly check-in.</div></div>
      </div>
    </section>`;
  if (!HK.connected) return `
    <section class="card pad hk-card">
      <div class="hk-status">
        <div class="hk-ic">${icon('heart', 20)}</div>
        <div><div class="hk-t">Not connected</div>
        <div class="hk-s">Connect once and your activity standards check themselves. Last night's sleep shows up on Recovery for context.</div></div>
      </div>
      <button class="btn primary hk-act" data-go="health-consent">${HK.isMinor === true && HK.consent !== true ? 'Connect, with a guardian' : 'Connect Apple Health'}</button>
    </section>`;
  const on = hasActivity(HK.activity) || hasRecovery(HK.recovery);
  return `
    <section class="card pad hk-card">
      <div class="hk-status ${on ? 'on' : 'warn'}">
        <div class="hk-ic">${icon(on ? 'checkCircle' : 'alert', 20)}</div>
        <div><div class="hk-t">${on ? 'Connected' : 'Connected, nothing shared yet'}</div>
        <div class="hk-s">${on
          ? esc(readingLine()) || 'Reading. Your standards verify on their own.'
          : 'Apple never tells an app which categories you allowed, so we looked: nothing has reached OnStandard yet. Turn the categories on in the Health app, then check again.'}</div></div>
      </div>
      ${on ? '' : `<button class="btn ghost hk-act" id="hk-recheck">Check again</button>`}
    </section>`;
}

function readRow(ic, title, sub, val, isOn) {
  return `<div class="lrow" role="listitem">
    <div class="lic">${icon(ic, 17)}</div>
    <div class="lm"><div class="lt">${esc(title)}</div><div class="ls">${esc(sub)}</div></div>
    ${val ? `<span class="lv ${isOn ? 'on' : ''}">${esc(val)}</span>` : ''}
  </div>`;
}

function readsCard() {
  const con = HK.connected;
  const actVal = !con ? '' : hasActivity(HK.activity) ? 'Reading' : 'No data yet';
  const recVal = !con ? '' : hasRecovery(HK.recovery) ? 'Reading' : 'No data yet';
  return `
    <h2 class="eyebrow">What OnStandard reads</h2>
    <section class="card rows hk-reads" role="list">
      ${readRow('bolt', 'Activity', 'Steps, walking and running distance, workouts. Verifies the standards your coach set.', actVal, hasActivity(HK.activity))}
      ${readRow('moon', 'Recovery', 'Last night’s sleep, HRV and resting heart rate. Shown on Recovery for context; the score is still yours to earn.', recVal, hasRecovery(HK.recovery))}
      ${readRow('shield', 'Never written', 'OnStandard reads only. Nothing is ever written to Health, and your coach never sees raw health data.', '', false)}
    </section>`;
}

function stepsCard() {
  return `
    <h2 class="eyebrow">Change what Health shares</h2>
    <section class="card pad">
      <div class="cs-p hk-lead">Apple keeps these switches in the Health app, not in OnStandard. It takes four taps.</div>
      <ol class="hk-steps">
        <li class="hk-step"><div class="hk-tile health">${icon('heart', 22)}</div><div class="hk-n">Open the <b>Health</b> app.</div></li>
        <li class="hk-step"><div class="hk-tile sys">${icon('user', 22)}</div><div class="hk-n">Tap your <b>picture</b> in the top right.</div></li>
        <li class="hk-step"><div class="hk-tile sys">${icon('hand', 22)}</div><div class="hk-n">Under Privacy, tap <b>Apps</b>.</div></li>
        <li class="hk-step"><div class="hk-tile app">${logoMark(26, 'hkapp')}</div><div class="hk-n">Tap <b>OnStandard</b> and turn on Steps, Walking + Running Distance, Workouts, Sleep, Heart Rate Variability and Resting Heart Rate.</div></li>
      </ol>
      <button class="btn primary hk-act" id="hk-open">${icon('external', 16)} Open the Health app</button>
      <div class="cs-p muted hk-fine">If it does not open, go to Settings, then Health, then Data Access &amp; Devices, then OnStandard.</div>
    </section>`;
}

export default {
  tab: 'profile',
  render() {
    const head = backHead('Apple Health', 'What it reads, and how to change it', 'settings');
    if (!HK.probed) return `${head}${skeletonRows(3, 'Checking Apple Health')}`;
    const ios = HK.available !== false;
    return `${head}
    ${statusCard()}
    ${ios ? readsCard() : ''}
    ${ios && HK.connected ? stepsCard() : ''}
    ${ios && HK.connected ? `
    <div class="hk-foot">
      <button class="btn ghost danger" id="hk-off" ${HK.busy ? 'disabled' : ''}>${HK.busy ? 'Disconnecting…' : 'Disconnect Apple Health'}</button>
      <div class="cs-p muted hk-center">Disconnecting stops OnStandard reading. To cut access at the phone level too, turn the categories off in the Health app.</div>
    </div>` : `
    <div class="cs-p muted hk-center tall">${ios ? 'Connecting Health is separate from arrival check-ins. One does not switch on the other.' : 'Nothing to set up here on Android.'}</div>`}
    ${HK.note ? `<div class="cs-p muted hk-note" role="status">${esc(HK.note)}</div>` : ''}`;
  },

  async mount(root) {
    if (!HK.probed) {
      await probeHealth();
      if (root.isConnected && window.__render) window.__render();
      return;
    }
    const open = root.querySelector('#hk-open');
    if (open) open.addEventListener('click', () => {
      const n = native();
      if (n && n.openUrl) { n.openUrl('x-apple-health://'); HK.note = ''; }
      else { HK.note = 'Open the Health app from your home screen.'; if (window.__render) window.__render(); }
    });
    const recheck = root.querySelector('#hk-recheck');
    if (recheck) recheck.addEventListener('click', async () => {
      recheck.disabled = true; recheck.textContent = 'Checking…';
      HK.probed = false;
      await probeHealth();
      if (window.__render) window.__render();
    });
    const off = root.querySelector('#hk-off');
    if (off) off.addEventListener('click', async () => {
      if (HK.busy) return;
      HK.busy = true; if (window.__render) window.__render();
      try {
        const c = window.sb;
        const { data: u } = await c.auth.getUser();
        const uid = u && u.user && u.user.id;
        const { error } = await c.rpc('revoke_health_consent', { p_athlete: uid });
        if (error) { HK.note = 'Could not disconnect. Check your connection and try again.'; }
        else { HK.connected = false; HK.consent = false; HK.activity = null; HK.recovery = null; HK.note = 'Disconnected. OnStandard is no longer reading Health.'; refreshHealthConsent(); }
      } catch { HK.note = 'Could not disconnect. Check your connection and try again.'; }
      HK.busy = false;
      if (window.__render) window.__render();
    });
  },
};

/** Reset so the next visit re-asks the phone rather than trusting a stale answer. */
export function refreshAppleHealth() { HK.probed = false; HK.note = ''; }
