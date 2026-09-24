/* The one alarm question (roll call v3, 2026-09-24; spec section 1).

   An AlarmKit alarm needs the athlete's yes once, and no server can ask for it. So the athlete is
   asked ONCE per account, where it makes sense: right after joining a team (Connect), or at the
   next open for someone already on one (Home). "Not now" is remembered on the account
   (profiles.alarm_primer_at, 0247) and the question comes back only from the roll call card
   (force). Continue asks notifications first when they were never asked (the assignment push is
   how a new or changed roll call reaches the phone), then alarms.

   The device spike failed (Task 1): the APP sets each alarm when it opens, within a 14-day
   horizon. The copy says exactly that much and no more.

   One primer at a time: on Home this card and the notification primer (notify-permission.js)
   share a slot, this one first; neither is drawn while another overlay (the first-run tour, the
   AI consent sheet) is up, so nothing stacks. The next Home paint offers it.

   Continue and Not now only; never "Allow", never which answer to pick (5.1.1(iv)).
   LAZY: reached through import() only. */
import { icon } from './icons.js';
import { overlayOpen } from './overlay-guard.js';
import { alarmPermission, notifyPermission, notifyPrimerLater, mountRollcallPrimer } from './notify-permission.js';
import { primerState, setPrimer } from './rollcall-v3-data.js';
import { ROLLCALL_OFF } from './commitments.js';

export const AP_TITLE = 'Let your coach set your wake-up alarm';
export const AP_BODY = 'OnStandard sets a real alarm on this phone for each roll call your coach assigns. It rings through silent mode, and one tap checks you in. Your phone asks next.';

/** Pure: may the primer show now? `answered` null = the account's answer could not be read, which
 *  is never taken as "never asked". */
export function shouldOfferAlarmPrimer({ answered = false, state = null, onTeam = false, force = false } = {}) {
  if (!onTeam || !state || !state.supported) return false;
  if (state.authorization !== 'notDetermined') return false;
  return force || answered === false;
}

export function alarmPrimerHtml() {
  return `<section class="card pad np-card ap-card" role="region" aria-labelledby="ap-t">
    <h3 class="np-t" id="ap-t">${icon('sun', 16)} ${AP_TITLE}</h3>
    <p class="np-s">${AP_BODY}</p>
    <div class="np-acts">
      <button type="button" class="btn sm np-go" data-ap-go>Continue</button>
      <button type="button" class="btn ghost sm" data-ap-later>Not now</button>
    </div>
  </section>`;
}

/** The device's alarm state ({ supported, authorization, armed }), asking only with `ask`. */
export const alarmState = (ask = false) => alarmPermission(ask);

/** Continue: notifications first if never asked, then alarms. */
export async function askAlarms() {
  try {
    if ((await notifyPermission(false)) === 'undetermined' && (await notifyPermission(true)) === 'granted') {
      const { act } = await import('./state.js');
      await act.registerPushToken({ ask: true });
    }
  } catch { /* alarms are still asked */ }
  return alarmState(true);
}

/** Arm right away after a yes: the roll calls are already assigned. */
async function armNow() {
  try {
    const [W, CD] = await Promise.all([import('./wake-alarms.js'), import('./commitment-data.js')]);
    const ahead = await CD.loadMineAhead(true);
    await W.syncWakeAlarms([...(CD.VC.mine || []), ...(ahead || [])], Date.now(), { complete: CD.aheadComplete() });
  } catch { /* the next Home load arms it */ }
}

/** Draw the primer into `host` when it should show. Resolves true when it was drawn. */
export async function mountAlarmPrimer(host, { onTeam = false, force = false, after = null } = {}) {
  // Switched off (commitments.js): nothing to ring for, so never ask for alarms.
  if (ROLLCALL_OFF) return false;
  if (!host || host.querySelector('.np-card') || overlayOpen()) return false;
  const state = await alarmState(false);
  if (!state || !state.supported || state.authorization !== 'notDetermined') return false;
  const ps = force ? null : await primerState();
  const answered = ps === null ? null : !!ps.at;
  if (!shouldOfferAlarmPrimer({ answered, state, onTeam, force })) return false;
  if (!host.isConnected || host.querySelector('.np-card') || overlayOpen()) return false;
  const slot = document.createElement('div');
  slot.className = 'ap-slot';
  slot.innerHTML = alarmPrimerHtml();
  host.appendChild(slot);
  slot.addEventListener('click', async (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-ap-later]')) {
      void setPrimer('not_now');
      notifyPrimerLater();   // and no notification primer in its place today: one no is enough
      slot.remove();
      return;
    }
    const go = t.closest('[data-ap-go]');
    if (!go || go.disabled) return;
    go.disabled = true;
    go.textContent = 'Asking…';
    const st = await askAlarms();
    void setPrimer('continue');
    slot.remove();
    try { await (typeof after === 'function' ? after(st) : armNow()); } catch { /* best effort */ }
  });
  return true;
}

/** Home's primer slot: the alarm question first (athletes on a team), else the notification
 *  primer for an assigned roll call. Never both. */
export async function mountPrimers(slot, rows, onTeam) {
  if (ROLLCALL_OFF || overlayOpen()) return;
  const shown = await mountAlarmPrimer(slot, { onTeam });
  if (!shown) await mountRollcallPrimer(slot, rows);
}
