/* Recent same-athlete meals (14 days) — the shared cache behind REAL historical patterns
   ("You've hit your protein bar in 3 of your last 4 dinners"). One fetch per minute per user.

   Lives in its own module rather than inside screens/meal.js because state.js's _postMealOpener
   needs the same rows to send `patterns` with the opener — and state.js importing a screen
   (which imports state.js back) would be a cycle. Both consumers pass the roles module in, so
   this file stays import-free and safe to require from anywhere. */
let RECENT = { uid: null, rows: null, at: 0 };

/** The cached rows for this user (ascending by day/logged_at, ready for mealPatterns), or null. */
export function recentRows(uid) {
  return RECENT.uid === uid && Array.isArray(RECENT.rows) ? RECENT.rows : null;
}

/** Fetch-with-cache. Returns the rows (possibly stale-refreshed); null when there's no user. */
export async function warmRecent(rolesMod, uid) {
  if (!uid) return null;
  if (RECENT.uid === uid && RECENT.rows && Date.now() - RECENT.at < 60000) return RECENT.rows;
  const rows = await rolesMod.fetchRecentMeals(uid, rolesMod.daysAgoISO(14)).catch(() => null);
  if (rows === null) {
    // Failed fetch: keep last-known rows (stamped stale so the next call retries) rather than
    // caching a fabricated "no recent meals" for the freshness window.
    RECENT = { uid, rows: (RECENT.uid === uid && RECENT.rows) || [], at: 0 };
    return RECENT.rows;
  }
  RECENT = { uid, rows: rows.slice().reverse(), at: Date.now() }; // ascending for mealPatterns
  return RECENT.rows;
}
