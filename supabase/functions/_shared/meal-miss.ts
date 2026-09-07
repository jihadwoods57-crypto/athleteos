// WHAT THE ATHLETE DIDN'T DO — the absence half of accountability.
//
// THE GAP THIS CLOSES. Every notification the product emits is triggered by COMPLIANCE:
// meal_logged, meal_review, meal_action. Miss lunch and nothing fires, to anyone, until a coach
// digest the next morning. Accountability is entirely about what happens when you don't, so the
// system had the one thing it is named for pointed the wrong way round.
//
// The escalation ladder for absence already existed and was good — commitment-escalation claims
// missed deadlines, pushes the athlete, digests the coach, has a kill switch, never fires a rung
// twice. It was wired to COMMITMENTS, of which the live database holds exactly one, while meals
// (78 logged) had no absence path at all. This module points that same shape at the meal standard.
//
// WHY THE SERVER DOES NOT COMPUTE THE DEADLINE. One line runs through this codebase: "the
// athlete's local clock is the only honest source, the server never derives timing" (analyze-meal,
// coach.js, state.js). A second deadline engine here would drift from the client's — the
// two-authorities bug that made the meal thread quote 23g of protein under a card reading 29g.
// So the client writes `dueAt` (a UTC instant, computed on its own clock) into days.tasks, and
// this module only ever COMPARES. No slot names, no windows, no coach-standard rules.

export type DayTask = { id?: unknown; done?: unknown; dueAt?: unknown };

export type MissedTask = { id: string; dueAt: string; minutesLate: number };

/** How long after a deadline we wait before calling it missed. An athlete eating at their desk
 *  five minutes past the window does not need a push about it, and a notification that fires the
 *  instant a clock ticks over reads as surveillance rather than support. */
export const GRACE_MIN = 30;

/**
 * Requirements whose deadline has passed (plus grace) and which are still not done.
 *
 * Deliberately conservative in every direction:
 *  - No `dueAt` means we do not know when it was due, so it is NOT missed. An older client that
 *    has not shipped the field yet simply produces no misses, which is the correct failure: a
 *    false "you missed breakfast" is far more expensive than a quiet one we never send.
 *  - An unparseable or absurd `dueAt` is ignored the same way.
 *  - A task already done is never missed, however late it was.
 *  - `horizonMin` bounds how far back we will look, so a cron that has been down for a day cannot
 *    wake up and push an athlete about six meals they have already moved on from.
 */
export function missedTasks(
  tasks: unknown,
  nowMs: number,
  opts: { graceMin?: number; horizonMin?: number } = {},
): MissedTask[] {
  if (!Array.isArray(tasks)) return [];
  const grace = Number.isFinite(opts.graceMin) ? Number(opts.graceMin) : GRACE_MIN;
  const horizon = Number.isFinite(opts.horizonMin) ? Number(opts.horizonMin) : 6 * 60;
  const out: MissedTask[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as DayTask;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    if (!id || t.done === true) continue;
    if (typeof t.dueAt !== 'string') continue;
    const due = Date.parse(t.dueAt);
    if (!Number.isFinite(due)) continue;
    const minutesLate = Math.round((nowMs - due) / 60000);
    if (minutesLate < grace) continue;      // not yet missed (or not yet past grace)
    if (minutesLate > horizon) continue;    // too old to be worth anyone's attention
    out.push({ id, dueAt: t.dueAt, minutesLate });
  }
  // Oldest first: if an athlete somehow has two, the one they let go longest is the one to name.
  return out.sort((a, b) => b.minutesLate - a.minutesLate);
}

/**
 * The athlete-facing line. Named, specific, and never a scolding — the founder's standing note on
 * this voice is that logging late still counts and hiding it does not, so a miss is an invitation
 * to close the day, not a verdict on it.
 *
 * `remaining` is how many required items are still open AFTER this one, which is what makes the
 * message actionable rather than final.
 */
export function missBody(title: string, minutesLate: number, remaining: number): string {
  const late = minutesLate >= 120
    ? `${Math.round(minutesLate / 60)} hours past`
    : `${minutesLate} minutes past`;
  const tail = remaining > 0
    ? ` You still have ${remaining} to go today.`
    : ' It still counts if you log it.';
  return `${title} is ${late} its window.${tail}`;
}

/** One line for the coach digest. Deliberately a COUNT plus names, never a per-miss push: a coach
 *  with a roster would be unreachable within a week otherwise. */
export function coachDigestBody(names: string[], total: number): string {
  const shown = names.slice(0, 3);
  if (total === 0) return '';
  if (total === 1) return `${shown[0]} missed a requirement today.`;
  if (total <= 3) return `${shown.join(', ')} missed requirements today.`;
  return `${shown.join(', ')} and ${total - shown.length} more missed requirements today.`;
}
