// The proactive follow-up — pure logic. I/O lives in ../ai-followup/index.ts.
//
// WHAT THIS IS. Today the AI only ever speaks when spoken to: it reads a plate, answers a
// question, and goes quiet. A nutritionist who actually worked with an athlete would come back the
// next day about the thing that mattered — "last night's dinner read 48; tonight's the rep that
// fixes it." That single beat is the difference between a tool and a relationship.
//
// WHAT IT IS NOT. It is not a notification stream. Exactly ONE follow-up per athlete per day, in
// their own late-afternoon window, only when there is a genuine reason. The moment this becomes
// noise it gets muted, and then the one message that mattered is muted too — so every rule below
// is about NOT sending.

export type MealRow = {
  id: string;
  athlete_id: string;
  type: string | null;
  quality: number | null;
  day_date: string;
  detected?: unknown;
  note?: string | null;
};

/** Below this, the evening is worth a word the next day. */
export const LOW_QUALITY = 55;

/**
 * Is it the right hour for THIS athlete? Sent in their own local afternoon (default 15:00-19:00),
 * so the message lands while the evening can still be changed — a follow-up about tonight's dinner
 * that arrives after dinner is just a scolding.
 *
 * A null/unusable timezone SKIPS the athlete. Guessing would mean pushing at 3 AM for someone,
 * which is the fastest way to lose notification permission entirely.
 */
export function inLocalWindow(nowUtc: Date, tz: string | null | undefined, startH = 15, endH = 19): boolean {
  if (!tz) return false;
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false,
    }).format(nowUtc);
    const h = Number(hourStr);
    if (!Number.isFinite(h)) return false;
    return h >= startH && h < endH;
  } catch {
    return false;   // an invalid IANA name is a skip, never a guess
  }
}

/** The athlete's own calendar date, for the once-per-day claim key. */
export function localDateISO(nowUtc: Date, tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(nowUtc);   // en-CA gives YYYY-MM-DD
  } catch {
    return null;
  }
}

/**
 * Pick the ONE meal worth following up on, or null.
 *
 * Evening meals only: a low-quality breakfast is already three meals in the past by the time this
 * runs, and the athlete cannot act on it today. Dinner is the one they can still change tonight.
 */
export function pickFollowUpMeal(rows: MealRow[]): MealRow | null {
  const candidates = (rows || []).filter((m) => {
    if (!m || !m.id) return false;
    const t = String(m.type || '').toLowerCase();
    if (t !== 'dinner' && t !== 'snack') return false;
    return typeof m.quality === 'number' && m.quality <= LOW_QUALITY;
  });
  if (!candidates.length) return null;
  // Worst first — if a night had two weak meals, speak about the weaker one.
  candidates.sort((a, b) => (a.quality ?? 999) - (b.quality ?? 999));
  return candidates[0];
}

/**
 * The message when the model is unavailable (spend gate, outage, a bad response).
 *
 * Deterministic, and deliberately good enough to ship on its own: the beat matters more than the
 * prose, and a follow-up that silently doesn't happen because an API had a bad minute is worse
 * than a plain one that does. `numbers: false` respects an Intuitive athlete, who is not tracking
 * figures by choice.
 */
export function fallbackFollowUp(meal: MealRow, numbers = true): string {
  const slot = String(meal.type || 'dinner').toLowerCase();
  return numbers && typeof meal.quality === 'number'
    ? `Last night's ${slot} came in at ${meal.quality}. Tonight's the rep that fixes it — what's the plan?`
    : `Last night's ${slot} was on the light side. Tonight's the one that evens it out — what's the plan?`;
}

/** Where the tap lands: the meal the message is ABOUT, which is where its context lives. */
export function routeForMeal(mealId: string): string {
  return `meal-view/${mealId}`;
}

/** Notification kind, carrying the meal id so the bell can route without a schema change. */
export function notificationKind(mealId: string): string {
  return `ai_followup:${mealId}`;
}
