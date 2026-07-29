/* One conversation across every meal — pure, no DOM, no clock.
 *
 * WHY. A meal thread reset at every plate. The athlete asked something on Tuesday's dinner and it
 * was gone by Wednesday's breakfast; the coach's point about guac had no relationship to the next
 * burrito bowl. That is not how a staff talks to an athlete — it is how a comment box works.
 *
 * The rows still live per meal (meal_comments.meal_id, and all the RLS that hangs off it). What
 * changes is the reading: messages from every meal are merged into one chronological stream, and
 * each meal enters it as a card — photo, name, time, score — so the thread doubles as a nutrition
 * log. "Same plate as Thursday?" becomes a sentence the athlete can actually write, because
 * Thursday is right there in the scroll.
 *
 * Ordering is by message time, never by meal time. A coach replying tonight to yesterday's lunch
 * belongs at the bottom where it was said, not buried under yesterday's divider — the stream is a
 * record of the conversation, and a conversation is ordered by when people spoke.
 */

/** Comments whose meal we do not have loaded still belong to the athlete and must not vanish. */
const EARLIER = '__earlier__';

const ms = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

/**
 * Merge meals + their messages into one stream.
 *
 * @param meals    [{ id, type, name, logged_at, day_date, quality, photo_path }]
 * @param comments meal_comments rows across those meals (already filtered to messages)
 * @param currentMealId the meal being viewed, if any — its divider is marked so the screen can
 *        anchor there instead of dumping the athlete at the bottom of a season.
 * @returns { items, anchorIndex } where items are
 *          { type:'divider', meal, current } | { type:'msg', comment }
 */
export function stitchNutritionChat({ meals, comments, currentMealId } = {}) {
  const mealList = (Array.isArray(meals) ? meals : []).filter((m) => m && m.id);
  const byId = new Map(mealList.map((m) => [m.id, m]));
  const msgs = (Array.isArray(comments) ? comments : []).filter((c) => c && c.meal_id);

  // Group by meal, keeping each group in message order.
  const groups = new Map();
  for (const c of msgs) {
    const key = byId.has(c.meal_id) ? c.meal_id : EARLIER;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const list of groups.values()) list.sort((a, b) => (ms(a.created_at) ?? 0) - (ms(b.created_at) ?? 0));

  // A meal enters the stream at its FIRST message when it has one — that is the moment it became
  // part of the conversation. A meal nobody has said anything about still appears, at its own
  // logged time, because the log itself is part of the record.
  const entries = [];
  for (const meal of mealList) {
    const list = groups.get(meal.id) || [];
    const at = list.length ? ms(list[0].created_at) : (ms(meal.logged_at) ?? ms(meal.day_date));
    entries.push({ at: at ?? 0, meal, list });
  }
  const orphans = groups.get(EARLIER) || [];
  if (orphans.length) entries.push({ at: ms(orphans[0].created_at) ?? 0, meal: null, list: orphans });

  entries.sort((a, b) => a.at - b.at);

  const items = [];
  let anchorIndex = -1;
  for (const e of entries) {
    const current = !!(currentMealId && e.meal && e.meal.id === currentMealId);
    if (current) anchorIndex = items.length;
    items.push({ type: 'divider', meal: e.meal, current });
    for (const c of e.list) items.push({ type: 'msg', comment: c, mealId: e.meal ? e.meal.id : null, current });
  }
  return { items, anchorIndex };
}

/** The meals a stitched stream should ask for: the ones with messages, plus recent logs. Used to
 *  keep the fetch honest — never request a window the screen is not going to show. */
export function mealIdsInThread(comments) {
  const out = [];
  const seen = new Set();
  for (const c of (Array.isArray(comments) ? comments : [])) {
    if (!c || !c.meal_id || seen.has(c.meal_id)) continue;
    seen.add(c.meal_id);
    out.push(c.meal_id);
  }
  return out;
}
