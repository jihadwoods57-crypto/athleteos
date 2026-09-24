/* The athlete's next roll call (roll call v3, 2026-09-24; spec section 6): the Home card and the
   assignment screen's model. LAZY: home.js reaches it through import() only (lint:boot).

   ONE QUESTION the card answers: will THIS phone ring for THAT morning? The native state names the
   instance ids it holds (wakeAlarms state `ids`), so "Alarm set ✓" is never a guess. A tap on "Tap to
   fix" does the one thing that fixes it: asks (the Continue primer), opens Settings (refused), or arms
   now (allowed but not yet armed). */
import { icon } from './icons.js';
import { fmtMin } from './requirements.js';
import { weightsForAssigned } from './plan-style.js';
import { ROLLCALL_OFF } from './commitments.js';

/* Its own escape, not components.js's: components.js imports state.js, which this module (and its
   node:test suite) must not load. Same five characters. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const WAKEUP = 'morning_roll_call';
const T = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wake-ups still ahead: on, not excused, not answered; one per instance, soonest first. */
export function upcomingWakeups(rows, nowMs = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.type !== WAKEUP || !r.instance_id) continue;
    const id = String(r.instance_id);
    if (seen.has(id)) continue;
    if (r.instance_status === 'cancelled' || r.skipped === true || r.status === 'excused' || r.acknowledged_at) continue;
    if (!(T(r.starts_at) > nowMs)) continue;
    seen.add(id);
    out.push(r);
  }
  return out.sort((a, b) => T(a.starts_at) - T(b.starts_at));
}
export const nextWakeup = (rows, nowMs = Date.now()) => upcomingWakeups(rows, nowMs)[0] || null;

export function alarmLine(state, row) {
  if (!row) return null;
  if (row.alarm === false) return { kind: 'coach_off', text: 'Notification only', fix: null };
  if (!state) return null;
  if (!state.supported) return { kind: 'unsupported', text: 'Notification only', fix: null };
  const id = String(row.instance_id).toLowerCase();
  const armed = Array.isArray(state.ids)
    ? state.ids.map((x) => String(x).toLowerCase()).includes(id)
    : Number(state.armed) > 0;
  if (armed) return { kind: 'set', text: 'Alarm set ✓', fix: null };
  if (state.authorization === 'denied') return { kind: 'denied', text: 'Alarm not set · Tap to fix', fix: 'settings' };
  if (state.authorization === 'notDetermined') return { kind: 'ask', text: 'Alarm not set · Tap to fix', fix: 'ask' };
  return { kind: 'sync', text: 'Alarm not set · Tap to fix', fix: 'sync' };
}

/** "Tomorrow · 4:45 AM", on the phone's clock (the one the alarm rings on). */
export function whenLabel(row, nowMs = Date.now()) {
  const t = T(row && row.starts_at);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const now = new Date(nowMs);
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400000);
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : SHORT[d.getDay()];
  return `${day} · ${fmtMin(d.getHours() * 60 + d.getMinutes())}`;
}

/** 0 = Sunday. Mirrors supabase/functions/_shared/rollcall-notice.ts daysLabel. */
export function daysLabel(dows) {
  const d = [...new Set((Array.isArray(dows) ? dows : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (!d.length) return '';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (d.join() === '0,6') return 'Weekends';
  return [...d.filter((n) => n !== 0), ...d.filter((n) => n === 0)].map((n) => SHORT[n]).join(', ');
}

/** What a morning is worth, never overclaimed. The wake-up shares ONE night budget with a Recovery
 *  Standard and an arrival check (plan-style.js weightsForAssigned: 8 alone, 4 and 4 with sleep,
 *  8/3 each with both), and which of those a given morning carries is only known on that day. So
 *  the number is said only when the caller KNOWS the morning's other parts (`assigned`, e.g.
 *  { sleep: true }); with `null` the line names no number. */
export function pointsLine(assigned = null) {
  if (!assigned || typeof assigned !== 'object') return 'Up on time counts toward your day. Late counts half.';
  const pts = Math.round(weightsForAssigned('athlete', { ...assigned, wakeup: true }).wakeup * 100);
  return pts > 0 ? `Up on time counts +${pts} on your day. Late counts half.` : 'Up on time counts toward your day. Late counts half.';
}

/** Keyed on my_commitments' commitment_id (0247 added it; before that the real row had none, so
 *  every assignment screen read "No roll call ahead"). An empty id matches nothing: '' === '' used
 *  to match every row that lacked the field. */
export function assignedModel(rows, commitmentId, nowMs = Date.now()) {
  if (!commitmentId) return null;
  const mine = upcomingWakeups(rows, nowMs).filter((r) => r.commitment_id && String(r.commitment_id) === String(commitmentId));
  if (!mine.length) return null;
  const first = mine[0];
  return {
    commitmentId: String(commitmentId), next: first, upcoming: mine.slice(0, 5),
    title: String(first.title || 'Morning Roll Call'), coach: String(first.coach_name || ''),
    message: String(first.message || '').trim(),
    days: daysLabel(mine.map((r) => new Date(T(r.starts_at)).getDay())),
  };
}

/** Where the Home card goes. ALWAYS an id: the assignment screen for the roll call, or (a row with
 *  no commitment_id, an older server) that morning's team board, never a bare "rollcall-assigned/". */
export function nextCardRoute(row) {
  if (row && row.commitment_id) return `rollcall-assigned/${String(row.commitment_id)}`;
  return `rollcall-board/${String((row && row.instance_id) || '')}`;
}

export function nextCardHtml(row, line, nowMs = Date.now()) {
  if (!row) return '';
  const msg = String(row.message || '').trim();
  const title = String(row.title || 'Roll call');
  /* "Alarm set ✓" is a short status and sits at the row's end. "Tap to fix" is an action, so it
     gets its own full-width line under the words with a 44pt target, never a squeezed pill. */
  const pill = !line ? ''
    : line.fix
      ? `<button type="button" class="status-pill b rn-fix" data-rn-fix="${esc(line.fix)}">${esc(line.text)}</button>`
      : `<span class="status-pill ${line.kind === 'set' ? 'g' : 'muted'}">${esc(line.text)}</span>`;
  const sub = msg ? `“${esc(msg.slice(0, 140))}${msg.length > 140 ? '…' : ''}”`
    : esc(row.coach_name ? `${title} · ${row.coach_name}` : title);
  return `<div class="xrow-item rn-card${line && line.fix ? ' rn-wrap' : ''}" data-go="${esc(nextCardRoute(row))}">
    <div class="xico sm blue">${icon('sun', 16)}</div>
    <div class="xr"><div class="xa">${esc(whenLabel(row, nowMs))}</div>
    <div class="xb">${sub}</div></div>
    ${pill}
  </div>`;
}

async function armNow(rows) {
  try {
    const [CD, W] = await Promise.all([import('./commitment-data.js'), import('./wake-alarms.js')]);
    const ahead = await CD.loadMineAhead(true);
    await W.syncWakeAlarms([...(rows || []), ...(ahead || [])], Date.now(), { complete: CD.aheadComplete() });
  } catch { /* the next Home load arms it */ }
}

/** "Tap to fix". */
export async function fixAlarm(kind, { host = null, rows = [], after = null } = {}) {
  if (kind === 'settings') {
    // The app's own page in Settings, where the Alarms switch lives (bridge LOCATION_SETTINGS opens
    // Linking.openSettings(), which is the app's page, not a location page).
    try { const N = window.OnStandardNative; if (N && N.location && typeof N.location.settings === 'function') N.location.settings(); } catch { /* nothing to open */ }
    return;
  }
  if (kind === 'ask') {
    const AP = await import('./alarm-primer.js');
    await AP.mountAlarmPrimer(host, { onTeam: true, force: true, after: async () => { await armNow(rows); if (after) await after(); } });
    return;
  }
  await armNow(rows);
  if (after) await after();
}

/** Draw (or clear) the card in `host`. `hideIds`: instances Home already shows a card for today. */
export async function mountNextCard(host, { rows = [], hideIds = new Set(), nowMs = Date.now() } = {}) {
  if (!host) return;
  const old = host.querySelector('.rn-slot');
  // Switched off (commitments.js): no next roll call, whatever a cache still holds.
  const row = ROLLCALL_OFF ? null : nextWakeup(rows, nowMs);
  if (!row || hideIds.has(String(row.instance_id))) { if (old) old.remove(); return; }
  let state = null;
  try { const W = await import('./wake-alarms.js'); state = await W.wakeAlarmState(); } catch { state = null; }
  if (!host.isConnected) return;
  // Looked up again after the await: two mounts in flight (the cached paint and the one after the
  // ahead rows land) must share one slot, never draw two cards.
  const cur = host.querySelector('.rn-slot');
  const slot = cur || document.createElement('div');
  slot.className = 'rn-slot';
  slot.innerHTML = nextCardHtml(row, alarmLine(state, row), nowMs);
  if (!cur) host.appendChild(slot);
  void import('./rollcall-v3-data.js').then((D) => D.markRollcallSeen(row.commitment_id || null), () => {});
  const fix = slot.querySelector('[data-rn-fix]');
  if (fix) fix.addEventListener('click', (ev) => {
    ev.stopPropagation();
    void fixAlarm(fix.getAttribute('data-rn-fix'), { host: slot, rows, after: () => mountNextCard(host, { rows, hideIds, nowMs: Date.now() }) });
  });
}

/** Home's entry (home.js paintCommitments): `shown` is today's derived cards, whose mornings the
 *  next card leaves to them. The 14 days ahead are cached (loadMineAhead); on a cold start the card
 *  is drawn again once they land. */
export async function mountHomeNext(slot, shown = []) {
  const CD = await import('./commitment-data.js');
  const hideIds = new Set((shown || []).filter((d) => d && d.visible).map((d) => String(d.instance_id)));
  const draw = () => mountNextCard(slot, { rows: [...(CD.VC.mine || []), ...CD.aheadRows()], hideIds });
  const first = draw();
  if (!CD.aheadRows().length) await CD.loadMineAhead().then(draw, () => {});
  await first;
}
