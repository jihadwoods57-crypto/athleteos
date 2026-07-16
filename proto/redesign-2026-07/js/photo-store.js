/* Meal-photo resolution (spec §7): every surface that shows a meal must show ITS photo.
   In-session captures render from the staged data URL; after a reload the photo lives in the
   private meal-photos bucket, so surfaces resolve a signed URL through this one cache.
   Best-effort and repaint-once: a resolved batch triggers a single re-render; a failed
   resolution caches the failure for the session so lists never loop on a missing object. */

import { signedMealPhotoUrl } from './roles.js';

const TTL = 45 * 60 * 1000; // signed URLs live 60 min (roles.js) — refresh comfortably before expiry
const CACHE = {};           // path -> { url: string|null, at: ms }  (url null = confirmed missing)
const INFLIGHT = new Set();

export function todayMealPhotoPath(userId, dateISO, slot) {
  return userId ? `${userId}/${dateISO}/${slot}.jpg` : null;
}

/** Synchronous read for render passes: the cached signed URL, or null if not resolved yet. */
export function cachedMealPhoto(path) {
  if (!path) return null;
  const c = CACHE[path];
  if (!c) return null;
  if (c.url && Date.now() - c.at > TTL) { delete CACHE[path]; return null; }
  return c.url;
}

/** Resolve one path (memoized). Returns the url or null. */
export async function resolveMealPhoto(path) {
  if (!path) return null;
  const hit = cachedMealPhoto(path);
  if (hit) return hit;
  if (CACHE[path] && CACHE[path].url === null) return null; // confirmed missing this session
  const url = await signedMealPhotoUrl(path);
  CACHE[path] = { url: url || null, at: Date.now() };
  return url || null;
}

/** Warm a batch of paths, then repaint ONCE if anything new resolved. Screens call this from
 *  mount() with the photos their render pass couldn't fill synchronously. */
export function warmMealPhotos(paths) {
  const need = (paths || []).filter((p) => p && !CACHE[p] && !INFLIGHT.has(p));
  if (!need.length) return;
  need.forEach((p) => INFLIGHT.add(p));
  Promise.all(need.map((p) => resolveMealPhoto(p).catch(() => null)))
    .then((urls) => {
      need.forEach((p) => INFLIGHT.delete(p));
      if (urls.some(Boolean) && window.__render) window.__render();
    });
}
