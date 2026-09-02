// supabase/functions/commitment-reminders/logic.ts
// Pure half of the reminder push: WHO is speaking, and what the notification says.
// ZERO framework imports on purpose: loaded by both Deno (edge) and jest (babel).
//
// THE ONE RULE (Wake-Up Roll Call, 2026-09-01): the FIRST push of a roll call is the coach
// addressing the athlete, in the coach's own words. Every push after it is OnStandard enforcing
// the standard, in OnStandard's words. The athlete must always be able to tell which is which,
// so the coach's message is never paraphrased, shortened or wrapped in product copy, and product
// copy is never attributed to the coach.

export type ReminderRow = {
  athlete_id: string;
  instance_id: string;
  title: string;
  body: string;                 // the SQL's generic body ("N minutes left to respond.")
  offset_min: number;
  action_label: string | null;
  respond_by_at: string | null;
  // 0211
  type?: string | null;
  message?: string | null;      // the coach's morning message, verbatim (instance override wins)
  coach_name?: string | null;
  starts_at?: string | null;
  closes_at?: string | null;
  fires_at?: string | null;     // deadline - offset: when this rung was scheduled to fire
  timezone?: string | null;
};

export type PushCopy = { title: string; subtitle?: string; body: string; fromCoach: boolean };

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : NaN;
};

/** "6:00 AM" in the commitment's own zone. Falls back to UTC when the zone is unknown rather
 *  than throwing inside a push loop. */
export function clockIn(iso: string | null | undefined, tz: string | null | undefined): string {
  const t = ms(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit',
    }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  }
}

/** The rung that lands AT the scheduled time (offset == grace) is the roll call itself. Anything
 *  scheduled later than a minute after the start is a follow-up. A row without timing data
 *  (pre-0211 claim) is treated as a follow-up, which is the pre-0211 behaviour. */
export function isInitialPush(row: ReminderRow): boolean {
  const fires = ms(row.fires_at);
  const starts = ms(row.starts_at);
  if (!Number.isFinite(fires) || !Number.isFinite(starts)) return false;
  return fires <= starts + 60_000;
}

/** Whole minutes left before the deadline, floored at 1 so the copy never says "0 minutes". */
export function minutesLeft(row: ReminderRow, nowMs: number): number | null {
  const dl = ms(row.respond_by_at);
  if (!Number.isFinite(dl)) return null;
  return Math.max(1, Math.ceil((dl - nowMs) / 60_000));
}

/** Compose one push. */
export function composeReminderPush(row: ReminderRow, nowMs: number): PushCopy {
  const isRollCall = row.type === 'morning_roll_call';
  if (!isRollCall) {
    // Every other commitment type keeps its pre-0211 push, byte for byte.
    return { title: row.title, body: row.body, fromCoach: false };
  }

  const message = (row.message ?? '').trim();
  const when = clockIn(row.starts_at, row.timezone);
  const line = when ? `${row.title} · ${when}` : row.title;

  if (isInitialPush(row)) {
    if (message) {
      // The coach's voice. Title = the coach, subtitle = what this is, body = their words, whole.
      // iOS shows a few lines collapsed and the rest on expand; nothing here trims it.
      return { title: row.coach_name?.trim() || 'Your coach', subtitle: line, body: message, fromCoach: true };
    }
    // No message: still a roll call, addressed neutrally. Never invent words for the coach.
    const dl = clockIn(row.respond_by_at, row.timezone);
    return { title: row.title, subtitle: when || undefined,
      body: dl ? `Check in by ${dl}.` : 'Check in now.', fromCoach: false };
  }

  // Follow-up inside the grace period: OnStandard's words, plainly system-generated.
  const left = minutesLeft(row, nowMs);
  if (row.offset_min <= 0 || left == null) {
    return { title: 'Roll call is waiting', body: 'Last call. Your coach is waiting.', fromCoach: false };
  }
  return {
    title: 'Roll call is waiting',
    body: `You haven't checked in yet. ${left} minute${left === 1 ? '' : 's'} remaining.`,
    fromCoach: false,
  };
}

/** The signed code should outlive the deadline by the whole late window, so a lock-screen tap at
 *  6:40 on a 6:00 roll call records a LATE, not an "expired". Falls back to the deadline (the
 *  pre-0211 behaviour), then to now. */
export function codeDeadlineMs(row: { closes_at?: string | null; respond_by_at?: string | null }, nowMs: number): number {
  const c = ms(row.closes_at);
  if (Number.isFinite(c)) return c;
  const d = ms(row.respond_by_at);
  return Number.isFinite(d) ? d : nowMs;
}
