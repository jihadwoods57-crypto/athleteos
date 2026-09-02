// supabase/functions/roll-call-coach/logic.ts
// Pure half of the coach lock-screen actions. ZERO framework imports on purpose: loaded by both
// Deno (edge) and jest (babel), so the rules below are tested from one implementation.

/** The two things a coach can do to a roll-call digest without unlocking their phone, plus the
 *  in-app 'schedule': tell the roster that one day was moved or skipped (0216). */
export type CoachAction = 'seen' | 'nudge' | 'schedule';

export type CoachFailure =
  | 'malformed' | 'bad_sig' | 'bad_kind' | 'expired'   // credential
  | 'bad_action' | 'flag_off' | 'not_authorized'       // request
  | 'rate_limited' | 'no_instance' | 'db_error';       // outcome

/** Narrow an untrusted action string. Anything not exactly one of the two verbs is refused rather
 *  than defaulted — defaulting an unrecognised action to 'seen' would silently swallow a future
 *  client's new button, and defaulting it to 'nudge' would push to athletes on a typo. */
export function parseAction(raw: unknown): CoachAction | null {
  return raw === 'seen' || raw === 'nudge' || raw === 'schedule' ? raw : null;
}

/** An optional single target for the in-app "Ping" on one athlete's row (0211). Only a uuid
 *  passes; anything else is treated as "no target" rather than an error, because the roster-wide
 *  nudge is the safe default and a malformed id must never widen into it silently either — the
 *  caller sees `targeted` in the response and can tell one from fifty. */
export function parseAthlete(raw: unknown): string | null {
  return typeof raw === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw.toLowerCase() : null;
}

export function httpStatusForCoach(reason: CoachFailure): number {
  switch (reason) {
    case 'malformed':
    case 'bad_kind':
    case 'bad_sig': return 401;
    case 'expired': return 410;
    case 'bad_action': return 400;
    case 'flag_off':
    case 'not_authorized': return 403;
    // 429 and not 403: "you may not do this" and "not yet" are different facts, and the client
    // treats them differently — a rate-limited nudge is a success from the coach's point of view
    // (someone already sent it), so it must never be retried by the offline queue.
    case 'rate_limited': return 429;
    case 'no_instance': return 404;
    case 'db_error': return 500;
  }
}

/** Reasons the device should STOP retrying a queued action. A queued coach action is replayed on
 *  reconnect, and some failures are permanent: replaying them forever would keep a dead code in
 *  storage until the 50-item cap evicted it. Anything else (a 500, a dropped connection) is worth
 *  another try inside the code's own lifetime, which its deadline already bounds. */
export function isTerminal(reason: CoachFailure): boolean {
  return reason !== 'db_error';
}

/** The body of a nudge push. The coach's own words own the title (their commitment title), so this
 *  supplies only the sentence that says why the phone just buzzed a second time.
 *
 *  Two shapes, because "you have not answered and there is still time" and "the window has closed"
 *  are different messages to a 16-year-old, and sending the first after the deadline reads as a
 *  system that does not know what time it is. */
export function nudgeBody(deadlineMs: number | null, nowMs: number): string {
  if (deadlineMs != null && Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
    return 'Your coach is still waiting. Answer now.';
  }
  return 'Your coach is waiting on you. One tap answers it.';
}

/** The body of a schedule-change push (0216), in the coach's name. "tomorrow" when it is, the
 *  weekday otherwise, never a bare date: an athlete reads this at 9 PM deciding what alarm to
 *  set. The claim supplies the day's EFFECTIVE minute in the team's zone. */
export function scheduleNoticeBody(a: {
  title: string; skipped: boolean; startsMin: number | null; occursOn: string; todayISO: string;
}): string {
  const title = (a.title || '').trim() || 'Roll call';
  const day = dayWord(a.occursOn, a.todayISO);
  if (a.skipped) return `No ${title} ${day}.`;
  const at = a.startsMin == null ? '' : ` at ${fmt12(a.startsMin)}`;
  return `${title} is${at} ${day}.`;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayWord(occursOn: string, todayISO: string): string {
  const t = Date.parse(`${todayISO}T12:00:00Z`);
  const o = Date.parse(`${occursOn}T12:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(o)) return `on ${occursOn}`;
  const diff = Math.round((o - t) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `on ${DOW[new Date(o).getUTCDay()]}`;
}
function fmt12(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  const h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
