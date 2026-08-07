/* Food Memory cache (0192) — same shape as recent-meals.js and for the same reason: the Plan
   hub, the analyze-meal request builder (state.js), and the meal screens all want the athlete's
   saved meals + places without each running their own fetch. One fetch per minute per user;
   consumers pass the roles module in so this file stays import-free (state.js importing a
   module that imports state.js back would be a cycle). */
let FM = { uid: null, items: null, places: null, at: 0 };

/** The cached memory for this user ({items, places}), or null when never loaded. */
export function foodMemory(uid) {
  return FM.uid === uid && Array.isArray(FM.items) ? { items: FM.items, places: FM.places || [] } : null;
}

/** Fetch-with-cache. Returns {items, places}; null when there's no user. Never throws. */
export async function warmFoodMemory(rolesMod, uid, force = false) {
  if (!uid) return null;
  if (!force && FM.uid === uid && FM.items && Date.now() - FM.at < 60000) return foodMemory(uid);
  const r = await rolesMod.fetchFoodMemory(uid).catch(() => null);
  if (r && !r.error) FM = { uid, items: r.items || [], places: r.places || [], at: Date.now() };
  return foodMemory(uid);
}

/** A write happened — next read refetches. (Optimistic patches can also edit FM.items in place.) */
export function invalidateFoodMemory() { FM.at = 0; }
