// AthleteOS — clock/date helpers (pure TS leaf: imports nothing from core).
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
