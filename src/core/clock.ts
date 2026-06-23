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
