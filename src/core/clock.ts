// OnStandard — clock/date helpers (pure TS leaf: imports nothing from core).
// Lives apart from dayRollover/defaultState so both can depend on it without
// forming an import cycle (defaultState needs the stamp; dayRollover needs both).

/** Local-date ISO stamp (YYYY-MM-DD). Uses LOCAL parts, never toISOString/UTC, so
 *  it never shifts a day near midnight in negative-UTC zones. `now` injectable for tests. */
export function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local-date stamp `n` days before `now` (YYYY-MM-DD), for bounded history windows
 *  (e.g. "meals in the last 7 days"). Uses local parts like todayStamp; `now` injectable. */
export function daysAgoStamp(n: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  return todayStamp(d);
}

/** Whole calendar days from stamp `a` to stamp `b` (both YYYY-MM-DD; b - a).
 *  Parsed at local noon so DST shifts can never produce an off-by-one. Non-parsable
 *  input yields NaN, which every caller must treat as "no valid distance". */
export function daysBetweenStamps(a: string, b: string): number {
  const parse = (s: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
    if (!m) return NaN;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  };
  return Math.round((parse(b) - parse(a)) / 86_400_000);
}

/** Shift a YYYY-MM-DD stamp by whole days (negative = back). Non-parsable input
 *  returns the input unchanged so a corrupt date can never fabricate a real one. */
export function shiftStamp(stamp: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp ?? '');
  if (!m) return stamp;
  return todayStamp(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
}

/** True when `fromStamp` falls within the trailing week ending at `toStamp`
 *  (0–6 whole days ago). The shared window behind the WEEKLY check-in credit:
 *  scoring, reminders, and the Home banner must all agree on "done this week". */
export function withinTrailingWeek(fromStamp: string, toStamp: string): boolean {
  const d = daysBetweenStamps(fromStamp, toStamp);
  return Number.isFinite(d) && d >= 0 && d <= 6;
}

/**
 * Time-of-day greeting for the Home header. Uses the LOCAL hour so it tracks the
 * athlete's clock: morning < 12:00, afternoon 12:00–16:59, evening from 17:00.
 * `now` is injectable for tests. Replaces the hardcoded "Good morning," that
 * showed at every hour of the day.
 */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
