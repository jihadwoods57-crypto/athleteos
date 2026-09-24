/* Notifications and alarms are asked for from a moment that explains itself (review pass
 * 2026-09-23, G-R10 and G-P2).
 *
 * The system notification question used to appear the moment Home first loaded (the push-token
 * read asked), and AlarmKit's arrived with it (scheduling an alarm asks implicitly). Nothing on
 * screen said why. Apple allows it, but it is the "nothing requested at launch" item reviewers
 * look for, and it wastes the one chance to ask.
 *
 * Now: nothing asks on its own. The native side only READS permission (src/lib/notify), and the
 * one ask is this primer, shown where the reason is on screen:
 *   - on an athlete's roll call, "Get the roll call on your lock screen", which asks for
 *     notifications;
 *   - on the Notifications settings screen, for every role.
 * Alarms are NOT asked here since roll call v3 (2026-09-24): that is the once-per-account alarm
 * primer, js/alarm-primer.js, which shares Home's slot with this card and goes first.
 * Its button says Continue, never Allow, and it never says which answer to pick.
 *
 * Pure markup + a thin bridge wrapper, no import from state.js (state.js imports this module).
 */
import { icon } from './icons.js';
import { alarmsFor } from './wake-alarms.js';

let PERM = null;    // 'granted' | 'denied' | 'undetermined' | 'unsupported' | null (not asked yet)
const LATER_KEY = 'os.notif.primerLater';

const native = () => (typeof window !== 'undefined' ? window.OnStandardNative : null);

/** Where notification permission stands. Never asks unless `ask`. Null when this shell cannot say
 *  (the web preview, an older binary). */
export async function notifyPermission(ask = false) {
  const N = native();
  if (!N || !N.notify || typeof N.notify.permission !== 'function') return null;
  try { PERM = (await N.notify.permission(!!ask)) || null; } catch { /* keep the last answer */ }
  return PERM;
}

/** The last answer this session heard, without a round trip. */
export function notifyPermissionCached() { return PERM; }

/** Harness + test seam. */
export function setNotifyPermissionForHarness(v) { PERM = v; }

/** Alarms: the state, asking only when `ask`. { supported, authorization, armed } or null. */
export async function alarmPermission(ask = false) {
  const N = native();
  if (!N || !N.wakeAlarms || typeof N.wakeAlarms.state !== 'function') return null;
  try { return await N.wakeAlarms.state({ ask: !!ask }); } catch { return null; }
}

/* Not now lasts for the DAY, not for ever (review I4): a coach's wake-up tomorrow deserves the
   question again tomorrow. */
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function laterSet() { try { return localStorage.getItem(LATER_KEY) === dayKey(); } catch { return false; } }
function setLater() { try { localStorage.setItem(LATER_KEY, dayKey()); } catch { /* no storage */ } }

/** The alarm primer's Not now (js/alarm-primer.js) also quiets this card for the day. */
export function notifyPrimerLater() { setLater(); }

/**
 * The primer card. '' unless notifications were never asked. Never shown after a Not now today,
 * except on the settings screen. Pure over its inputs. The alarm question is js/alarm-primer.js
 * (roll call v3); `alarm` is accepted and ignored so an older caller cannot bring it back here.
 * @param {{ perm?: string|null, alarm?: string|null, context?: 'rollcall'|'settings', later?: boolean }} o
 */
export function notifyPrimerHtml({ perm = PERM, context = 'rollcall', later = laterSet() } = {}) {
  const askNotify = perm === 'undetermined';
  const askAlarm = false; // roll call v3: the alarm question is js/alarm-primer.js, once per account
  if (!askNotify) return '';
  if (later && context !== 'settings') return '';
  const t = context !== 'rollcall' ? 'Turn on reminders' : 'Get the roll call on your lock screen';
  const s = context !== 'rollcall'
    ? 'OnStandard sends the reminders you choose here, your coach’s roll calls and messages from your team. Your phone asks next.'
    : 'OnStandard can put your coach’s roll call on your lock screen, so one tap checks you in. Your phone asks next.';
  return `<section class="card pad np-card" role="region" aria-labelledby="np-t">
    <h3 class="np-t" id="np-t">${icon('bell', 16)} ${t}</h3>
    <p class="np-s">${s}</p>
    <div class="np-acts">
      <button type="button" class="btn sm np-go" data-np-go data-np-notify="${askNotify ? '1' : ''}" data-np-alarm="${askAlarm ? '1' : ''}">Continue</button>
      ${context === 'settings' ? '' : '<button type="button" class="btn ghost sm" data-np-later>Not now</button>'}
    </div>
  </section>`;
}

/** Of the athlete's roll-call rows, is there one still ahead or open (so reaching the phone
 *  matters), and one whose coach asked for an alarm? Pure. */
export function rollcallReach(rows, nowMs = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const live = list.some((r) => r && r.instance_status !== 'cancelled' && r.skipped !== true
    && (!r.verdict || r.verdict === 'pending') && r.status !== 'excused'
    && Date.parse(r.closes_at || r.respond_by_at || r.starts_at || '') > nowMs);
  return { live, alarm: alarmsFor(list, nowMs).length > 0 };
}

/**
 * The primer wherever an athlete sees an assigned roll call (review I4): Home's slot (after the
 * alarm primer, js/alarm-primer.js mountPrimers), the team board and Your day. Reads (never asks)
 * notification permission; draws the card only while it is unanswered; Continue asks
 * notifications only. Athletes who already answered see nothing. `after` registers the token and
 * re-arms.
 */
export async function mountRollcallPrimer(host, rows, after = () => reachAfter(rows)) {
  if (!host || host.querySelector('.np-card')) return;
  const reach = rollcallReach(rows);
  if (!reach.live && !reach.alarm) return;
  const perm = await notifyPermission(false);
  const html = notifyPrimerHtml({ perm, context: 'rollcall' });
  if (!html || !host.isConnected || host.querySelector('.np-card')) return;
  const slot = document.createElement('div');
  slot.className = 'np-slot';
  slot.innerHTML = html;
  host.appendChild(slot);
  wireNotifyPrimer(slot, { after });
}

/** After a primer's yes: mint the push token, reschedule reminders, arm the mornings. Loaded
 *  lazily with this module, so none of it sits on the boot graph. */
export async function reachAfter(rows) {
  const { act, RT } = await import('./state.js');
  await act.registerPushToken({ ask: true });
  RT._lastPlan = null; act.syncNotifications();
  try {
    const [{ syncWakeAlarms }, { aheadRows }] = await Promise.all([import('./wake-alarms.js'), import('./commitment-data.js')]);
    // Merge the cached ahead rows (roll call v3): a bare `rows` omits mornings 2-14 days out that a
    // full app-open sync already armed, and the RECONCILE contract would sweep them off a narrower set.
    await syncWakeAlarms([...(rows || []), ...(aheadRows() || [])]);
  } catch { /* the next Home load arms it */ }
}

/**
 * Wire a rendered primer. `after(result)` runs once the phone has answered, so the caller can
 * register the push token, resync reminders and arm alarms (only where they were allowed
 * already: arming never asks). Never asks for alarms (roll call v3).
 */
export function wireNotifyPrimer(root, { after } = {}) {
  if (!root) return;
  root.addEventListener('click', async (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-np-later]')) {
      setLater();
      const card = t.closest('.np-card');
      if (card) card.remove();
      return;
    }
    const go = t.closest('[data-np-go]');
    if (!go || go.disabled) return;
    go.disabled = true;
    go.textContent = 'Asking…';
    // Only the question the card named. An older card with no flags asks notifications.
    const askN = go.getAttribute('data-np-notify') !== '' || !go.hasAttribute('data-np-notify');
    const perm = askN ? await notifyPermission(true) : await notifyPermission(false);
    const alarms = null;
    const card = go.closest('.np-card');
    if (card) card.remove();
    if (typeof after === 'function') { try { await after({ perm, alarms }); } catch { /* best effort */ } }
  });
}
