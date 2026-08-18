/* Meal-photo resolution (spec §7): every surface that shows a meal must show ITS photo.
   In-session captures render from the staged data URL; after a reload the photo lives in the
   private meal-photos bucket, so surfaces resolve a signed URL through this one cache.
   Best-effort and repaint-once: a resolved batch triggers a single re-render; a failed
   resolution is cached BRIEFLY (NEG_TTL) so lists never loop on a missing object — but a miss
   must not be permanent. A photo can legitimately be missing for a minute and arrive later: the
   upload is now queued in the outbox and retried, so a session-permanent negative cache would
   leave the athlete staring at a blank frame for a photo that has since landed. */

import { signedMealPhotoUrl, signedMealPhotoUrls } from './roles.js';

const TTL = 45 * 60 * 1000; // signed URLs live 60 min (roles.js) — refresh comfortably before expiry
const NEG_TTL = 60 * 1000;  // a confirmed-missing object is re-checked after a minute, not never
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
  const age = Date.now() - c.at;
  if (c.url && age > TTL) { delete CACHE[path]; return null; }
  if (!c.url && age > NEG_TTL) { delete CACHE[path]; return null; }  // expire the miss, allow a retry
  return c.url;
}

/** Resolve one path (memoized). Returns the url or null. */
export async function resolveMealPhoto(path) {
  if (!path) return null;
  const hit = cachedMealPhoto(path);
  if (hit) return hit;
  const neg = CACHE[path];
  if (neg && neg.url === null && Date.now() - neg.at <= NEG_TTL) return null; // missing, re-check later
  const url = await signedMealPhotoUrl(path);
  CACHE[path] = { url: url || null, at: Date.now() };
  return url || null;
}

/** Warm a batch of paths, then repaint ONCE if anything new resolved. Screens call this from
 *  mount() with the photos their render pass couldn't fill synchronously. */
/** Drop a cached entry so the next resolve re-signs. The outbox calls this the moment an upload
 *  finally succeeds, so a frame that showed "no photo" fills in without waiting for NEG_TTL. */
export function invalidateMealPhoto(path) {
  if (!path) return;
  delete CACHE[path];
  if (typeof window !== 'undefined' && window.__render) window.__render();
}

export function warmMealPhotos(paths) {
  const need = (paths || []).filter((p) => p && !CACHE[p] && !INFLIGHT.has(p));
  if (!need.length) return;
  need.forEach((p) => INFLIGHT.add(p));
  // One createSignedUrls round trip for the whole surface. The per-path loop this replaces made
  // 50-70 parallel storage calls on a 14-day history mount — the signer takes a batch.
  signedMealPhotoUrls(need)
    .then((map) => {
      const at = Date.now();
      let resolved = false;
      for (const p of need) {
        const url = (map && map[p]) || null;   // absent = missing or transient: cached as a miss, re-checked after NEG_TTL
        CACHE[p] = { url, at };
        if (url) resolved = true;
      }
      if (resolved && typeof window !== 'undefined' && window.__render) window.__render();
    })
    .catch(() => { /* transient — nothing cached, the next repaint retries */ })
    .finally(() => { need.forEach((p) => INFLIGHT.delete(p)); });
}
