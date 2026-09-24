// OnStandard: the roll call v3 assignment/change push, the pure half (2026-09-24).
// ZERO imports on purpose: loaded by Deno (edge) and jest (babel), like rollcall-code.ts.
//
// ONE PUSH PER ATHLETE PER ROLL CALL PER TICK. claim_rollcall_notices (0247) returns one row per
// morning that needs saying; groupNotices folds them so an athlete whose coach moved Thursday and
// cancelled Tuesday reads one banner, not two.
//
// THE BANNER NEVER CLAIMS WHAT THIS PHONE HAS NOT DONE. `body` is what every phone shows. `setBody`
// goes into data.rc.set and the Notification Service Extension swaps it in only when it armed every
// morning (targets/NotificationService). A phone without the extension, or a server with the
// rollcall_push_arming flag off, shows `body`: "Open OnStandard to set your alarm".
//
// THE DEVICE SPIKE FAILED (2026-09-24, docs/spike): AlarmKit authorization is per bundle and the
// NSE cannot obtain it. rollcall_push_arming stays OFF, so the schedule-carrying path below is kept
// working for later but is not the live default; the copy this module produces is the fallback
// copy ("Open OnStandard to set your alarm"), never a claim that an alarm is already armed.
//
// SETTLE CONTRACT (0247, claimed_at added on review, commit aeaac105): claim_rollcall_notices and
// rollcall_remind_rows_svc now return an extra last column, claimed_at. settleRowsOf must hand it
// straight back unchanged — settle_rollcall_notices only touches a row while claimed_at still
// matches notice_claimed_at to the millisecond — and must mark `sent: true` only for a row whose
// push actually went out; every other row settles with sent: false so it still reads "Hasn't been
// told" (settled is not told).

export type NoticeKind = 'assigned' | 'moved' | 'cancelled' | 'extend' | 'silent' | 'remind';

export type NoticeRow = {
  response_id: string; athlete_id: string; commitment_id: string; instance_id: string;
  kind: NoticeKind; starts_at: string; occurs_on: string; was_starts_at: string | null; off: boolean;
  claimed_at: string | null;
};

export type NoticeContext = {
  commitment_id: string; title: string | null; action_label: string | null;
  coach_id: string | null; coach_name: string | null;
  repeat_days: number[] | null; starts_min: number | null; timezone: string | null; alarm: boolean;
};

export type NoticeGroup = {
  athleteId: string; commitmentId: string; kind: Exclude<NoticeKind, 'silent'>;
  arm: NoticeRow[]; cancel: NoticeRow[]; moved: NoticeRow[]; silent: NoticeRow[];
};

export type NoticeCopy = {
  title: string; body: string; setBody: string;
  interruption: 'active' | 'passive'; sound: 'default' | null;
};

export type ArmItem = { i: string; at: number; c?: string };
export type ArmPayload = {
  v: 1; kind: string; title: string; label: string; url: string; arm: ArmItem[]; cancel: string[]; set: string;
};

/** A handful of mornings, nearest first: the extension arms these, the app open arms the rest. */
export const ARM_MAX_ITEMS = 8;
/** Expo caps a whole message at 4096 bytes; title, body and route share it with this. */
export const ARM_PAYLOAD_MAX_BYTES = 2600;
export const ARM_CANCEL_MAX = 14;

const RANK: Record<Exclude<NoticeKind, 'silent'>, number> = { remind: 5, assigned: 4, moved: 3, cancelled: 2, extend: 1 };
const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };

export function groupNotices(rows: NoticeRow[]): NoticeGroup[] {
  const by = new Map<string, NoticeGroup>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = `${r.athlete_id}:${r.commitment_id}`;
    let g = by.get(key);
    if (!g) {
      g = { athleteId: r.athlete_id, commitmentId: r.commitment_id, kind: 'extend', arm: [], cancel: [], moved: [], silent: [] };
      by.set(key, g);
    }
    if (r.kind === 'silent') { g.silent.push(r); continue; }
    if (r.off) g.cancel.push(r); else g.arm.push(r);
    if (r.kind === 'moved') g.moved.push(r);
    if (RANK[r.kind] > RANK[g.kind]) g.kind = r.kind;
  }
  const out = [...by.values()];
  for (const g of out) {
    g.arm.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
    g.cancel.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
    g.moved.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  }
  return out;
}

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 0 = Sunday, the commitments.repeat_days convention. */
export function daysLabel(days: number[] | null | undefined): string {
  const d = [...new Set((Array.isArray(days) ? days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (!d.length) return '';
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (d.join() === '0,6') return 'Weekends';
  // Monday first, the way a week reads.
  return [...d.filter((n) => n !== 0), ...d.filter((n) => n === 0)].map((n) => SHORT[n]).join(', ');
}

function fmt(iso: string, tz: string | null, opts: Intl.DateTimeFormatOptions): string {
  const t = ms(iso);
  if (!t) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', ...opts }).format(new Date(t)); }
  catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(t)); }
}
export const clockAt = (iso: string, tz: string | null) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
export const dayName = (iso: string, tz: string | null) => fmt(iso, tz, { weekday: 'long' });
export const dayShort = (iso: string, tz: string | null) => fmt(iso, tz, { weekday: 'short' });

/** Minutes past midnight as "4:45 AM". */
export function fmtMin(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return '';
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function noticeCopy(g: NoticeGroup, ctx: NoticeContext): NoticeCopy {
  const coach = (ctx.coach_name || '').trim() || 'Your coach';
  const tz = ctx.timezone;
  const alarm = ctx.alarm !== false;
  const next = g.arm[0] || null;
  const offLine = (rows: NoticeRow[]) =>
    rows.length === 1 ? `${dayName(rows[0].starts_at, tz)} is off.` : rows.length > 1 ? `${rows.length} mornings are off.` : '';
  const withAlarm = (base: string, ask: string, set: string) => ({
    body: alarm ? `${base} ${ask}` : base,
    setBody: alarm ? `${base} ${set}` : base,
  });

  if (g.kind === 'assigned') {
    const days = daysLabel(ctx.repeat_days);
    const time = fmtMin(ctx.starts_min) || (next ? clockAt(next.starts_at, tz) : '');
    const base = days && time ? `${days} at ${time}.` : time ? `At ${time}.` : 'Your coach set a morning roll call.';
    return { title: `${coach} put you on roll call`, ...withAlarm(base, 'Open OnStandard to set your alarm.', 'Alarm set ✓'), interruption: 'active', sound: 'default' };
  }
  if (g.kind === 'moved') {
    const lead = g.moved.length === 1
      ? `${dayName(g.moved[0].starts_at, tz)}’s roll call moved to ${clockAt(g.moved[0].starts_at, tz)}.`
      : `${g.moved.length} roll call times changed.`;
    const base = [lead, offLine(g.cancel)].filter(Boolean).join(' ');
    return { title: coach, ...withAlarm(base, 'Open OnStandard to update your alarm.', 'Alarm set ✓'), interruption: 'active', sound: 'default' };
  }
  if (g.kind === 'cancelled') {
    const base = g.cancel.length === 1
      ? `${dayName(g.cancel[0].starts_at, tz)}’s roll call is off.`
      : `${g.cancel.length} roll calls are off.`;
    return { title: coach, body: base, setBody: alarm ? `${base} Alarm removed.` : base, interruption: 'active', sound: 'default' };
  }
  if (g.kind === 'remind') {
    const when = next ? `${dayShort(next.starts_at, tz)} ${clockAt(next.starts_at, tz)}` : 'your next roll call';
    return {
      title: coach,
      body: `Your coach wants your alarm set for ${when}. Open OnStandard to set it.`,
      setBody: `Alarm set for ${when} ✓`,
      interruption: 'active', sound: 'default',
    };
  }
  // extend: new mornings came into range with no alarm on the phone yet. OnStandard speaking, quietly.
  return {
    title: (ctx.title || '').trim() || 'Roll call',
    body: 'Open OnStandard to set your next alarms.',
    setBody: 'Your next alarms are set ✓',
    interruption: 'passive', sound: null,
  };
}

/** Mirrors proto js/wake-alarms.js alarmTitle(): what the alarm says when it rings. */
export function alarmTitleOf(ctx: NoticeContext): string {
  return ((ctx.title || '').trim() || 'Wake up').slice(0, 80);
}
/** Mirrors proto js/wake-alarms.js alarmButtonLabel() and DEFAULT_BUTTON. */
export function alarmLabelOf(ctx: NoticeContext): string {
  return ((ctx.action_label || '').trim() || 'I’m Up').slice(0, 24);
}

export function armPayload(o: { kind: string; title: string; label: string; url: string; items: ArmItem[]; cancel: string[]; set: string }): ArmPayload {
  const items = [...(o.items || [])].sort((a, b) => a.at - b.at).slice(0, ARM_MAX_ITEMS);
  const p: ArmPayload = {
    v: 1, kind: o.kind, title: o.title, label: o.label, url: o.url,
    arm: items.map((x) => (x.c ? { i: x.i, at: Math.round(x.at), c: x.c } : { i: x.i, at: Math.round(x.at) })),
    cancel: (o.cancel || []).slice(0, ARM_CANCEL_MAX),
    set: o.set,
  };
  const size = () => new TextEncoder().encode(JSON.stringify(p)).length;
  while (p.arm.length > 1 && size() > ARM_PAYLOAD_MAX_BYTES) p.arm.pop();   // the far end waits for the app open
  return p;
}

export type SettleRow = {
  response_id: string; starts_at: string; off: boolean; claimed_at: string | null; sent: boolean; remind: boolean;
};

/**
 * Builds settle_rollcall_notices' p_rows. claimed_at rides back UNCHANGED from the claimed row
 * (settle only touches a row while claimed_at still matches notice_claimed_at to the millisecond).
 * `sent` is true only for a row named in `sentIds` — a push that was actually delivered for it —
 * and false otherwise, so a row with no delivered push settles without stamping notified_at
 * (settled is not told).
 * `remind` (Task 4 review) marks a row from rollcall_remind_rows_svc: settle then stamps only
 * notified_at (when sent) and never the claim's bookkeeping, so a remind cannot swallow a pending
 * move or cancellation the claim has yet to say.
 */
export function settleRowsOf(rows: NoticeRow[], sentIds?: Iterable<string>): SettleRow[] {
  const sent = new Set(sentIds || []);
  return (rows || []).map((r) => ({
    response_id: r.response_id,
    starts_at: r.starts_at,
    off: !!r.off,
    claimed_at: r.claimed_at ?? null,
    sent: sent.has(r.response_id),
    remind: r.kind === 'remind',
  }));
}

export const NOTICE_ROUTE = (commitmentId: string) => `rollcall-assigned/${commitmentId}`;
