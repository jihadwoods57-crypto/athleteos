/* "Your coach replied" (inbox audit item 6, 2026-09-10). PURE: no imports, no DOM, no fetch,
   no clock. The athlete side of the reply loop, as math over three self-scoped reads
   (roles.fetchMyReplyInputs) plus this device's own thread-open stamps (RT.mealViewedAt).

   A coach reply used to be visible in exactly one place: inside the meal screen it was posted
   on. The coach inbox printed "you replied" as if the loop had closed; nothing on the athlete's
   Home said anything had come back. This decides, per thread, whether a HUMAN on staff said
   something the athlete has not opened since, and phrases the one row Home shows for it. */

const HUMAN_STAFF = (c) => c && c.role && c.role !== 'athlete' && c.role !== 'ai';
const IS_MESSAGE = (c) => !c.kind || c.kind === 'message';
const ts = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

/** Which threads carry a staff message the athlete has not opened since.
 *
 *  "Opened since" is the LATEST of three stamps, any of which may be missing:
 *    - the server's meal_views row for this athlete on this meal (0229; survives a reinstall),
 *    - this device's own RT.mealViewedAt stamp (written before the server hears about it),
 *    - the athlete's own last message on the thread (you cannot answer what you did not read).
 *  Only message-kind rows from a non-athlete, non-AI author count: a reaction is an emoji, a
 *  private note never reaches the athlete (RLS), and the AI is not "your coach".
 *
 *  Returns one entry per thread, newest reply first:
 *  { mealId, type, dayDate, count, latestTs, latestText }. */
export function unreadCoachReplies({ comments, meals, views, localViewedAt } = {}) {
  const rows = Array.isArray(comments) ? comments : [];
  const mealById = {};
  for (const m of (Array.isArray(meals) ? meals : [])) if (m && m.id) mealById[m.id] = m;
  const openedAt = {};
  for (const v of (Array.isArray(views) ? views : [])) {
    if (!v || !v.meal_id) continue;
    openedAt[v.meal_id] = Math.max(openedAt[v.meal_id] || 0, ts(v.seen_at));
  }
  const local = (localViewedAt && typeof localViewedAt === 'object') ? localViewedAt : {};
  for (const id of Object.keys(local)) openedAt[id] = Math.max(openedAt[id] || 0, ts(local[id]));
  for (const c of rows) {
    if (!c || !c.meal_id || c.role !== 'athlete' || !IS_MESSAGE(c)) continue;
    openedAt[c.meal_id] = Math.max(openedAt[c.meal_id] || 0, ts(c.created_at));
  }

  const byMeal = {};
  for (const c of rows) {
    if (!c || !c.meal_id || !HUMAN_STAFF(c) || !IS_MESSAGE(c)) continue;
    const at = ts(c.created_at);
    if (at <= (openedAt[c.meal_id] || 0)) continue;
    const m = mealById[c.meal_id] || {};
    const e = byMeal[c.meal_id] || (byMeal[c.meal_id] = {
      mealId: c.meal_id, type: m.type || null, dayDate: m.day_date ? String(m.day_date) : null,
      count: 0, latestTs: 0, latestText: '',
    });
    e.count++;
    if (at >= e.latestTs) { e.latestTs = at; e.latestText = String(c.text || ''); }
  }
  return Object.values(byMeal).sort((a, b) => b.latestTs - a.latestTs);
}

/** The single Home row for a list of unread threads, or null when there is nothing to say.
 *  One thread names its slot ("Your coach replied on lunch"); several say how many, and the tap
 *  opens the newest. `noun` is the athlete's word for their operator (S.coach.noun: coach /
 *  trainer / dietitian), so a client never reads "coach" on a practice.
 *
 *  Route: today's slot meal opens the LIVE thread (meal-detail/<slot>, where the athlete can
 *  answer); anything else opens the past-meal read (meal-view/<id>), the same rule Home's own
 *  result cards and the coach_comment push already follow. */
export function replyRow(unread, { todayISO, mealKeys, noun = 'coach' } = {}) {
  const list = Array.isArray(unread) ? unread.filter((u) => u && u.mealId) : [];
  if (!list.length) return null;
  const first = list[0];
  const keys = Array.isArray(mealKeys) ? mealKeys : [];
  const isToday = !!todayISO && first.dayDate === String(todayISO) && !!first.type && keys.includes(first.type);
  const route = isToday ? `meal-detail/${first.type}` : `meal-view/${first.mealId}`;
  const slot = first.type ? String(first.type).toLowerCase() : 'meal';
  const total = list.reduce((n, u) => n + (u.count || 0), 0);
  const who = `Your ${noun}`;
  const title = list.length === 1
    ? `${who} replied on ${slot}`
    : `${who} replied on ${list.length} meals`;
  const sub = list.length === 1
    ? (first.count > 1 ? `${first.count} new messages. Tap to read.` : 'Tap to read and answer.')
    : `${total} new messages. Newest is ${slot}.`;
  return { title, sub, route, mealId: first.mealId, ts: first.latestTs, total, threads: list.length };
}
