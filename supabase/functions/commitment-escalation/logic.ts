// supabase/functions/commitment-escalation/logic.ts
// Pure copy for the escalation rungs. Factual, no guilt, no em dash.
// ZERO framework imports: loaded by both Deno (edge) and jest (babel).
import { copy, type PushCopy } from '../_shared/rollcall-copy.ts';
export { platformCopy } from '../_shared/rollcall-copy.ts';
export type { PushCopy };

/** The coach "who's up" digest (L3). */
export function digestBody(title: string, total: number, notUp: string[]): string {
  const up = total - notUp.length;
  if (notUp.length === 0) return `${title}: ${up}/${total} up. Everyone answered.`;
  const shown = notUp.slice(0, 5);
  const extra = notUp.length - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', ');
  return `${title}: ${up}/${total} up. ${notUp.length} didn't answer: ${names}.`;
}

/** Whole minutes past the deadline, rounded UP and floored at 1, mirroring SQL's
 *  `rollcall_late_min`. Null when there is no deadline to measure from, or when the deadline has
 *  not actually passed (a claim that raced the clock): the copy then omits the number rather than
 *  telling an athlete they are "0 min" or "-1 min" late. */
export function minutesLate(respondByAt: string | null | undefined, nowMs: number): number | null {
  const dl = Date.parse(respondByAt ?? '');
  if (!Number.isFinite(dl) || nowMs <= dl) return null;
  return Math.max(1, Math.ceil((nowMs - dl) / 60_000));
}

/** The athlete's post-grace push (L2). Wake-Up Roll Call, in OnStandard's voice, as the founder
 *  specified it in the second design pass (2026-09-02):
 *    iOS      "You're late · 3 min" / "Wake-Up Roll Call" / "Check in now. Your coach can see this."
 *    Android  "You're late · 3 min" / "Wake-Up Roll Call. Check in now, your coach can see this."
 *
 *  The MINUTES are in the title because lateness is the whole message and its size is the only
 *  thing that changes between one athlete and the next. `nowMs` is the send instant, and the
 *  escalation cron runs every minute, so the number is at most a minute stale by the time it lands.
 *
 *  Every other commitment type keeps its pre-0211 line, byte for byte. */
export function breakthroughCopy(
  type: string | null | undefined,
  title: string,
  respondByAt?: string | null,
  nowMs?: number,
): PushCopy {
  if (type === 'morning_roll_call') {
    const late = nowMs == null ? null : minutesLate(respondByAt, nowMs);
    const head = late == null ? "You're late" : `You're late · ${late} min`;
    return copy(head, title, 'Check in now. Your coach can see this.', {
      // Folding the roll call's name into an already-long title would push it past what Android
      // shows on one line, so on Android the name rides the body instead.
      androidTitle: head,
      androidBody: `${title} is still waiting. Check in now.`,
    });
  }
  return copy(title, null, 'The window is closing. Answer now.');
}

/** The button on the late push. A roll call is still answerable until it closes, so it carries a
 *  "CHECK IN NOW" rather than the on-time label; the device registers this label at launch. */
export const LATE_ACTION_LABEL = 'Check in now';

// ---------------------------------------------------------------- the closing summary (2026-09-23)
// One push to the coach when the window CLOSES, for every roll call (the digest above is opt-in and
// fires at the deadline). Built from rollcall_team_board_svc (0242), so it counts exactly what the
// board shows: `total` leaves excused athletes out, on time is on_standard only.

export type SummaryRow = {
  verdict: string; name?: string | null; acknowledged_at?: string | null;
  /** Preformatted clock for a late answer ("6:08"); computed from acknowledged_at when absent. */
  late_label?: string | null;
};
export type SummaryBoard = { total?: number; timezone?: string | null; rows: SummaryRow[] };

/** How many names a list spells out before "and N more". */
export const SUMMARY_NAMES_MAX = 4;

/** "6:08" (no AM/PM: the coach set the time and knows which half of the day it is). */
export function clockShort(iso: string | null | undefined, tz: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const fmt = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '';
    return h && m ? `${h}:${m}` : '';
  };
  try { return fmt(tz || 'UTC'); } catch { return fmt('UTC'); }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length > SUMMARY_NAMES_MAX) {
    return `${names.slice(0, SUMMARY_NAMES_MAX).join(', ')} and ${names.length - SUMMARY_NAMES_MAX} more`;
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function closingSummary(board: SummaryBoard): { title: string; body: string } {
  const rows = (board.rows ?? []).filter((r) => r.verdict !== 'excused');
  const total = Number.isFinite(Number(board.total)) && board.total != null ? Number(board.total) : rows.length;
  const onTime = rows.filter((r) => r.verdict === 'on_standard').length;

  // First names, unless two people on this roll call share one: then the full name, so the coach
  // never nudges the wrong Tommy.
  const first = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || 'An athlete';
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(first(r.name), (counts.get(first(r.name)) ?? 0) + 1);
  const who = (r: SummaryRow) => ((counts.get(first(r.name)) ?? 0) > 1 ? (r.name ?? '').trim() : first(r.name));
  const lateAt = (r: SummaryRow) => (r.late_label ?? '').trim() || clockShort(r.acknowledged_at, board.timezone);

  const parts: string[] = [];
  const late = rows.filter((r) => r.verdict === 'late');
  if (late.length === 1) {
    const at = lateAt(late[0]);
    parts.push(`${who(late[0])} was late${at ? ` (${at})` : ''}.`);
  } else if (late.length > 1) {
    parts.push(`${listNames(late.map((r) => { const at = lateAt(r); return at ? `${who(r)} (${at})` : who(r); }))} were late.`);
  }
  const review = rows.filter((r) => r.verdict === 'review');
  if (review.length) parts.push(`${listNames(review.map(who))} ${review.length === 1 ? 'needs' : 'need'} your review.`);
  const missed = rows.filter((r) => r.verdict === 'missed');
  if (missed.length) parts.push(`${listNames(missed.map(who))} missed. Tap to nudge them.`);
  if (!parts.length) parts.push('Everyone was up on time.');

  return { title: `Roll call closed: ${onTime} of ${total} on time`, body: parts.join(' ') };
}

/** The summary's tap target: the board, opened on the misses. A PATH, never a query string
 *  (ruling R2, 2026-09-23): deep links in this app are path segments. */
export function summaryRoute(instanceId: string): string {
  return `rollcall-board/${instanceId}/missed`;
}
