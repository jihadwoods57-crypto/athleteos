/* The coach's roll call screen, its pure rules (roll call v3, 2026-09-24; spec section 7).
   Imported by js/screens/rollcall-hub.js only (lazy), and by nothing on the boot graph.

   EACH ATHLETE'S STEP is read off 0247's rollcall_arming row, never guessed:
     excused   the coach excused them for this morning
     armed     the phone reported the alarm for this morning (alarm_armed_at). Wins over everything
               but excused: a phone that will ring needs nothing from the coach
     no_push   no device token, or the athlete switched notifications off (can_push, which folds
               profiles.notifications_opt_out). Remind cannot reach them; the coach has to say it
     seen      opened the app or the assignment since it went out (seen_at), and no alarm yet.
               Since the device spike failed (2026-09-24) the phone sets the alarm only when the
               athlete opens OnStandard, so this is a real, fixable state
     unseen    the assignment push went out (notified_at) and they have not opened it
     untold    no push has gone out to them yet: the minute cron or the coach's notify has not
               reached them. Never shown as "Hasn't opened it", which would blame the athlete */
import { fmtMin } from './requirements.js';
import { DAYS_SHORT, DAYS_LONG } from './fmt-date.js';

export const STEP_LABEL = {
  armed: 'Alarm set ✓', seen: 'Seen, alarm not set', unseen: 'Hasn’t opened it', untold: 'Hasn’t been told',
  no_push: 'Notifications off', excused: 'Excused',
};
const ORDER = { no_push: 0, untold: 1, unseen: 2, seen: 3, armed: 4, excused: 5 };

/** One athlete's step before the window (0247 rollcall_arming row). */
export function athleteStep(r) {
  if (!r) return 'untold';
  if (r.status === 'excused') return 'excused';
  if (r.alarm_armed_at) return 'armed';
  if (r.can_push === false) return 'no_push';
  if (r.seen_at) return 'seen';
  if (r.notified_at) return 'unseen';
  return 'untold';
}

/** The list the coach reads: who needs something first, then the set, then the excused. */
export function stepRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({ ...r, step: athleteStep(r) }))
    .sort((a, b) => ORDER[a.step] - ORDER[b.step] || String(a.name || '').localeCompare(String(b.name || '')));
}

/** total and armed leave the excused out (as the score does). `reachable` is how many of the not
 *  set a push can reach: the ones Remind actually helps. */
export function armingCounts(rows) {
  const on = (Array.isArray(rows) ? rows : []).filter((r) => r && r.status !== 'excused');
  const armed = on.filter((r) => r.alarm_armed_at).length;
  const reachable = on.filter((r) => !r.alarm_armed_at && r.can_push !== false).length;
  return { total: on.length, armed, notSet: on.length - armed, reachable };
}

/** Results stay up this long after the close, then the screen turns to the next morning. */
export const AFTER_HOURS = 8;

/** Which body the screen shows now. A roll call open right now always wins; then the one that
 *  closed in the last AFTER_HOURS; then the next one to open. `next` is always the next to open. */
export function hubPhase(upcoming, nowMs = Date.now()) {
  const t = (iso) => { const x = Date.parse(iso || ''); return Number.isFinite(x) ? x : NaN; };
  const opens = (r) => { const o = t(r.opens_at); return Number.isFinite(o) ? o : t(r.starts_at); };
  const on = (Array.isArray(upcoming) ? upcoming : [])
    .filter((r) => r && r.instance_id && r.instance_status !== 'cancelled' && !r.skipped);
  const next = on.filter((r) => opens(r) > nowMs).sort((a, b) => t(a.starts_at) - t(b.starts_at))[0] || null;
  const open = on.find((r) => opens(r) <= nowMs && nowMs < t(r.closes_at));
  if (open) return { phase: 'live', instance: open, next };
  const closed = on.filter((r) => t(r.closes_at) <= nowMs && nowMs - t(r.closes_at) < AFTER_HOURS * 3600000)
    .sort((a, b) => t(b.closes_at) - t(a.closes_at))[0];
  if (closed) return { phase: 'after', instance: closed, next };
  if (next) return { phase: 'before', instance: next, next };
  return { phase: 'none', instance: null, next: null };
}

/** The one action before the window. One athlete is named, as the founder's mockup did. */
export function remindLabel(n, onlyName = '') {
  const first = String(onlyName || '').trim().split(/\s+/)[0];
  return n === 1 && first ? `Remind ${first} to set it` : `Remind the ${n} not set`;
}
export const nudgeLabel = (n) => `Nudge the ${n} not up`;

/** "Thu 4:45 AM" on the roll call's own clock (occurs_on and starts_min come from the server in
 *  the roll call's zone, rollcall_upcoming). */
export function morningLabel(inst) {
  if (!inst || !inst.occurs_on) return '';
  const dow = new Date(`${inst.occurs_on}T12:00:00`).getDay();
  return `${DAYS_SHORT[dow]}${typeof inst.starts_min === 'number' ? ` ${fmtMin(inst.starts_min)}` : ''}`;
}

/** "5 of 6 alarms set", from rollcall_upcoming's counts (0247). '' on an older server. */
export function alarmsLabel(inst) {
  return inst && typeof inst.armed === 'number' && Number(inst.total) > 0 ? `${inst.armed} of ${inst.total} alarms set` : '';
}

/** The quick actions' words for a day: "this morning", "tomorrow", or the weekday. */
export function dayWord(inst, todayIso) {
  if (!inst || !inst.occurs_on) return '';
  if (inst.occurs_on === todayIso) return typeof inst.starts_min === 'number' && inst.starts_min >= 720 ? 'today' : 'this morning';
  const a = Date.parse(`${todayIso}T12:00:00Z`), b = Date.parse(`${inst.occurs_on}T12:00:00Z`);
  if (Math.round((b - a) / 86400000) === 1) return 'tomorrow';
  return DAYS_LONG[new Date(`${inst.occurs_on}T12:00:00`).getDay()];
}

/** The morning Move and Cancel act on: the soonest one that has not started and is not cancelled,
 *  inside the day sheet's reach (`lastIso`, the last day the sheet can open). Beyond it, null: a
 *  row the sheet cannot open is a row that does nothing. */
export function movable(rows, nowMs = Date.now(), lastIso = '') {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.instance_id && !r.skipped && r.instance_status !== 'cancelled'
    && Date.parse(r.starts_at || '') > nowMs && (!lastIso || String(r.occurs_on || '') <= lastIso))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
}

/** The last two hours before the window opens: "Hasn't opened it" and "Seen, alarm not set" turn
 *  amber then (design ruling 2026-09-24). Before that they are facts, not warnings. */
export const SOON_MS = 2 * 3600000;
export function isSoon(inst, nowMs = Date.now()) {
  const o = Date.parse((inst && (inst.opens_at || inst.starts_at)) || '');
  return Number.isFinite(o) && o > nowMs && o - nowMs <= SOON_MS;
}

/** "6:30" on the roll call's own clock (the team's zone, not the coach's phone). */
export function clockIn(iso, tz) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined })
      .format(new Date(t)).replace(/\s?[AP]M$/i, '');
  } catch { return ''; }
}

/** Repaint now, or once every open sheet has closed: a full repaint under an open day sheet (the
 *  router's __screenCleanup closes it) would snatch Move or Cancel from under the coach's thumb.
 *  One replay however many repaints were asked for meanwhile. `Observer` is MutationObserver. */
export function repaintWhenFree(doc, repaint, Observer, state = repaintWhenFree) {
  const open = () => !!(doc && doc.querySelector('.sheet-scrim'));
  if (!open()) { repaint(); return 'now'; }
  if (state.waiting) return 'queued';
  if (!Observer || !doc.body) return 'dropped';
  state.waiting = true;
  const mo = new Observer(() => {
    if (open()) return;
    mo.disconnect(); state.waiting = false; repaint();
  });
  mo.observe(doc.body, { childList: true, subtree: true });
  return 'deferred';
}
