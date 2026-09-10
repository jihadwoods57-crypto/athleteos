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
    ? `Last night's ${slot} came in at ${meal.quality}. Tonight's the rep that fixes it. What's the plan?`
    : `Last night's ${slot} was on the light side. Tonight's the one that evens it out. What's the plan?`;
}

/** Where the tap lands: the meal the message is ABOUT, which is where its context lives. */
export function routeForMeal(mealId: string): string {
  return `meal-view/${mealId}`;
}

/** Notification kind, carrying the meal id so the bell can route without a schema change. */
export function notificationKind(mealId: string): string {
  return `ai_followup:${mealId}`;
}

/** Where a COACH's tap lands: the meal thread as staff see it — distinct from the athlete's own
 *  route, used when an escalation needs to route staff rather than the athlete. */
export function routeForCoachMeal(mealId: string): string {
  return `coach-meal/${mealId}`;
}

/* ================================================================================
   THE DAY-GAP NUDGE (2026-09-10). The follow-up above looks BACK at yesterday's weak dinner.
   Nothing ever looked FORWARD at today: an athlete 40g short with dinner still open heard
   nothing until the day was already scored. The client computes this math on every meal screen
   (mealDayProgress); the cron only ever had the low-quality meal rows. This selector reads the
   athlete's own `days` row instead, which the client writes on every change:
     days.meals           { slot: true }           which slots are logged
     days.checkin.slotMacros[slot].protein         what each logged slot carried
     days.tasks           [{ id, done, dueAt }]    the required items and their local deadlines
   and the coach-set protein target from athlete_profiles.targets. The server derives NO timing:
   a slot is "still open" only because the client stamped a dueAt in the future (the same rule
   meal-miss-escalation holds to). Same discipline as the follow-up: one per athlete per day, a
   real gap only, never on a day the follow-up already spoke.
   ================================================================================ */

/** Under this many grams short, the evening does not need a message. */
export const DAY_GAP_MIN_G = 25;

/** The local hour band the nudge may land in: late enough that lunch is history, early enough
 *  that dinner is still a decision. */
export const DAY_GAP_WINDOW: [number, number] = [19, 20];

/** Which task ids are MEAL slots. Other required items (recovery, weight, cs:*) are not food. */
export const MEAL_SLOT_RE = /^(breakfast|lunch|dinner|snack|meal-\d+)$/;

export type DayRowForGap = {
  athlete_id: string;
  date: string;
  meals?: unknown;
  checkin?: unknown;
  tasks?: unknown;
};

export type DayGapNudge = {
  gap: number;
  target: number;
  soFar: number;
  /** The open meal slot due soonest: where the tap lands. */
  slot: string;
  openSlots: string[];
};

/** Meal slots still open: required (they carry a dueAt), not done, and due AFTER now. Soonest
 *  first. No dueAt means the client never said when it was due, so it is not "open", it is
 *  unknown, and unknown never earns a push. */
export function openMealSlots(tasks: unknown, nowMs: number): string[] {
  if (!Array.isArray(tasks)) return [];
  const out: Array<{ id: string; due: number }> = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as { id?: unknown; done?: unknown; dueAt?: unknown };
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    if (!id || !MEAL_SLOT_RE.test(id) || t.done === true) continue;
    if (typeof t.dueAt !== 'string') continue;
    const due = Date.parse(t.dueAt);
    if (!Number.isFinite(due) || due <= nowMs) continue;
    out.push({ id, due });
  }
  return out.sort((a, b) => a.due - b.due).map((o) => o.id);
}

/** Protein already logged today, from the slots the day row marks logged and the macros the
 *  client stamped for them. Mirrors the client's dayConsumed (scored slots only). */
export function proteinLoggedFromDay(day: DayRowForGap | null | undefined): number {
  if (!day) return 0;
  const meals = day.meals && typeof day.meals === 'object' ? day.meals as Record<string, unknown> : {};
  const checkin = day.checkin && typeof day.checkin === 'object' ? day.checkin as { slotMacros?: unknown } : {};
  const macros = checkin.slotMacros && typeof checkin.slotMacros === 'object'
    ? checkin.slotMacros as Record<string, { protein?: unknown }> : {};
  let total = 0;
  for (const slot of Object.keys(macros)) {
    if (!meals[slot]) continue;
    const p = Number(macros[slot]?.protein);
    if (Number.isFinite(p) && p > 0 && p <= 500) total += p;
  }
  return Math.round(total);
}

/**
 * Should THIS athlete hear about today's gap? The one decision, pure.
 *
 * Fires only when: a real coach-set target exists, the shortfall is past DAY_GAP_MIN_G, and at
 * least one meal slot is still open on the client's own clock. Everything else (window, once a
 * day, opt-out, the follow-up already having spoken) is the caller's, because it needs I/O.
 */
export function pickDayGapNudge(
  day: DayRowForGap | null | undefined,
  proteinTarget: unknown,
  nowMs: number,
  minGap = DAY_GAP_MIN_G,
): DayGapNudge | null {
  if (!day) return null;
  const target = Math.round(Number(proteinTarget));
  if (!Number.isFinite(target) || target <= 0 || target > 500) return null;
  const openSlots = openMealSlots(day.tasks, nowMs);
  if (!openSlots.length) return null;
  const soFar = proteinLoggedFromDay(day);
  const gap = target - soFar;
  if (gap <= minGap) return null;
  return { gap, target, soFar, slot: openSlots[0], openSlots };
}

/** "dinner" reads as itself; a coach slot id reads as "your next meal". */
export function slotNoun(slot: string): string {
  const s = String(slot || '').toLowerCase();
  return /^(breakfast|lunch|dinner|snack)$/.test(s) ? s : 'your next meal';
}

/** Keep at most `max` sentences. A nudge is two lines on a lock screen, not a paragraph. */
export function clampSentences(text: string, max = 2): string {
  const parts = String(text || '').trim().match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) || [];
  return parts.slice(0, max).map((s) => s.trim()).filter(Boolean).join(' ');
}

/** The deterministic message: exact numbers, two sentences, and good enough to ship alone. */
export function dayGapFallback(n: DayGapNudge): string {
  const noun = slotNoun(n.slot);
  const still = n.openSlots.length > 1 ? `${noun} and ${n.openSlots.length - 1} more` : noun;
  return `You're ${n.gap}g of protein short of today's ${n.target}g with ${still} still open. Bring ${noun} in around ${n.gap}g and the day closes out.`;
}

/** Does a model-written nudge keep the contract? The exact gap, no invented figure, at most two
 *  sentences, no em dash. Anything else falls back to the deterministic line. */
export function dayGapMessageOk(text: string, n: DayGapNudge): boolean {
  const t = String(text || '').trim();
  if (!t || t.includes('—')) return false;
  if (!new RegExp(`\\b${n.gap}\\s?g\\b`).test(t)) return false;
  const allowed = new Set([n.gap, n.target, n.soFar].map(String));
  for (const num of t.match(/\d+/g) || []) if (!allowed.has(num)) return false;
  return clampSentences(t, 2) === clampSentences(t, 99);
}

/** Where the tap lands: the camera for the slot that closes the gap. Same shape as the missed
 *  meal push (`camera/<slot>`), so the native deep-link validator already accepts it. */
export function routeForSlot(slot: string): string {
  return `camera/${slot}`;
}

/** Notification kind, carrying the slot so the bell can route without a schema change. */
export function dayGapKind(slot: string): string {
  return `ai_daygap:${slot}`;
}
