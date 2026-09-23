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
 *     notifications and then, where the phone has alarms and the coach wants one, alarms;
 *   - on the Notifications settings screen, for every role.
 * Its button says Continue, never Allow, and it never says which answer to pick.
 *
 * Pure markup + a thin bridge wrapper, no import from state.js (state.js imports this module).
 */
import { icon } from './icons.js';

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

function laterSet() { try { return localStorage.getItem(LATER_KEY) === '1'; } catch { return false; } }
function setLater() { try { localStorage.setItem(LATER_KEY, '1'); } catch { /* no storage */ } }

/**
 * The primer card. '' unless the system question has not been answered yet (PERM 'undetermined')
 * and the person has not tapped Not now here before. Pure over its inputs.
 * @param {{ perm?: string|null, context?: 'rollcall'|'settings', later?: boolean }} o
 */
export function notifyPrimerHtml({ perm = PERM, context = 'rollcall', later = laterSet() } = {}) {
  if (perm !== 'undetermined') return '';
  if (later && context !== 'settings') return '';
  const t = context === 'rollcall' ? 'Get the roll call on your lock screen' : 'Turn on reminders';
  const s = context === 'rollcall'
    ? 'OnStandard can put your coach’s roll call on your lock screen, so one tap checks you in, and ring an alarm when your coach sets a wake-up. Your phone asks next.'
    : 'OnStandard sends the reminders you choose here, your coach’s roll calls and messages from your team. Your phone asks next.';
  return `<section class="card pad np-card" role="region" aria-labelledby="np-t">
    <h3 class="np-t" id="np-t">${icon('bell', 16)} ${t}</h3>
    <p class="np-s">${s}</p>
    <div class="np-acts">
      <button type="button" class="btn sm np-go" data-np-go>Continue</button>
      ${context === 'settings' ? '' : '<button type="button" class="btn ghost sm" data-np-later>Not now</button>'}
    </div>
  </section>`;
}

/**
 * Wire a rendered primer. `after(result)` runs once the phone has answered, so the caller can
 * register the push token, resync reminders and arm alarms. `withAlarms` asks for alarms right
 * after a yes to notifications (the roll call primer).
 */
export function wireNotifyPrimer(root, { after, withAlarms = false } = {}) {
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
    const perm = await notifyPermission(true);
    let alarms = null;
    if (withAlarms && perm === 'granted') alarms = await alarmPermission(true);
    const card = go.closest('.np-card');
    if (card) card.remove();
    if (typeof after === 'function') { try { await after({ perm, alarms }); } catch { /* best effort */ } }
  });
}
