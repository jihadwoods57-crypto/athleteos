// supabase/functions/commitment-reminders/logic.ts
// Pure half of the reminder push: WHO is speaking, and what the notification says.
// ZERO framework imports on purpose: loaded by both Deno (edge) and jest (babel).
//
// THE ONE RULE (Wake-Up Roll Call): the FIRST push of a roll call is the coach addressing the
// athlete, in the coach's own words. Every push after it is OnStandard enforcing the standard, in
// OnStandard's words. The athlete must always be able to tell which is which, so the coach's message
// is never paraphrased or wrapped in product copy, and product copy is never attributed to the coach.
//
// The three lock-screen states, as the founder specified them (2026-09-02):
//   INITIAL   "Coach D'Onofrio · Wake-Up Roll Call" / the message          [I'M UP]
//   REMINDER  "Wake-Up Roll Call" / "You haven't checked in yet. 2 minutes remaining."  [I'M UP]
//   LATE      "You're Late" / "Wake-Up Roll Call is still waiting on you."  [CHECK IN NOW]   (escalation fn)
// Titles carry both names on one line so Android, which has no subtitle, reads the same as iOS.

export type ReminderRow = {
  athlete_id: string;
  instance_id: string;
  title: string;
  body: string;                 // the SQL's generic body ("N minutes left to respond.")
  offset_min: number;
  action_label: string | null;
  respond_by_at: string | null;
  type?: string | null;
  message?: string | null;      // the coach's morning message, verbatim (instance override wins)
  coach_name?: string | null;
  starts_at?: string | null;
  closes_at?: string | null;
  fires_at?: string | null;     // deadline - offset: when this rung was scheduled to fire
  timezone?: string | null;
};

export type PushCopy = { title: string; body: string; fromCoach: boolean; truncated: boolean };

/** Expo caps one push message at 4096 bytes total. Title, route, code and category share it, so the
 *  body gets this much and no more. The full message always lives in the app and the bell row. */
export const PUSH_BODY_MAX_BYTES = 1200;

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
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
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

/** Cap a message for the push BODY only, by UTF-8 bytes, on a word boundary, with an ellipsis.
 *  Never splits a multibyte character. Returns the text and whether anything was cut. */
export function pushBody(message: string, maxBytes: number = PUSH_BODY_MAX_BYTES): { text: string; truncated: boolean } {
  const enc = new TextEncoder();
  if (enc.encode(message).length <= maxBytes) return { text: message, truncated: false };
  const ell = '…';
  const budget = maxBytes - enc.encode(ell).length;
  // Walk code points so a 4-byte emoji is never cut in half.
  let out = '';
  let bytes = 0;
  for (const ch of message) {
    const b = enc.encode(ch).length;
    if (bytes + b > budget) break;
    out += ch; bytes += b;
  }
  // Prefer a word boundary when one exists in the last quarter of what fits.
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > out.length * 0.75) out = out.slice(0, lastSpace);
  return { text: out.trimEnd() + ell, truncated: true };
}

/** Compose one push. */
export function composeReminderPush(row: ReminderRow, nowMs: number): PushCopy {
  const isRollCall = row.type === 'morning_roll_call';
  if (!isRollCall) {
    // Every other commitment type keeps its pre-0211 push, byte for byte.
    return { title: row.title, body: row.body, fromCoach: false, truncated: false };
  }

  const message = (row.message ?? '').trim();
  const title = row.title || 'Wake-Up Roll Call';

  if (isInitialPush(row)) {
    if (message) {
      // The coach's voice. "Coach D'Onofrio · Wake-Up Roll Call" then their words, whole (capped for
      // the push only; the app and the bell row keep every character).
      const coach = row.coach_name?.trim() || 'Your coach';
      const b = pushBody(message);
      return { title: `${coach} · ${title}`, body: b.text, fromCoach: true, truncated: b.truncated };
    }
    // No message: still a roll call, addressed neutrally. Never invented words in the coach's name.
    const dl = clockIn(row.respond_by_at, row.timezone);
    return { title, body: dl ? `Check in by ${dl}.` : 'Check in now.', fromCoach: false, truncated: false };
  }

  // Follow-up inside the grace period: OnStandard's words, plainly system-generated.
  const left = minutesLeft(row, nowMs);
  if (row.offset_min <= 0 || left == null) {
    return { title, body: 'Last call. Your coach is waiting.', fromCoach: false, truncated: false };
  }
  return {
    title,
    body: `You haven't checked in yet. ${left} minute${left === 1 ? '' : 's'} remaining.`,
    fromCoach: false, truncated: false,
  };
}

/** The signed code should outlive the deadline by the whole late window, so a lock-screen tap at
 *  6:20 on a 6:00 roll call records a LATE, not an "expired". Falls back to the deadline (the
 *  pre-0211 behaviour), then to now. */
export function codeDeadlineMs(row: { closes_at?: string | null; respond_by_at?: string | null }, nowMs: number): number {
  const c = ms(row.closes_at);
  if (Number.isFinite(c)) return c;
  const d = ms(row.respond_by_at);
  return Number.isFinite(d) ? d : nowMs;
}
