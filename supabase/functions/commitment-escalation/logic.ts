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
