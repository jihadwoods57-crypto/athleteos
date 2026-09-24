/* Meal-photo resolution (spec §7): every surface that shows a meal must show ITS photo.
   In-session captures render from the staged data URL; after a reload the photo lives in the
   private meal-photos bucket, so surfaces resolve a signed URL through this one cache.
   Best-effort and repaint-once: a resolved batch triggers a single re-render; a failed
   resolution is cached BRIEFLY (NEG_TTL) so lists never loop on a missing object — but a miss
   must not be permanent. A photo can legitimately be missing for a minute and arrive later: the
   upload is now queued in the outbox and retried, so a session-permanent negative cache would
   leave the athlete staring at a blank frame for a photo that has since landed. */

import { signedMealPhotoUrl, signedMealPhotoUrls } from './roles.js';
import { launchCache, keepLaunch, currentLaunchOwner, onLaunchDrop } from './launch-cache.js';

const TTL = 45 * 60 * 1000; // signed URLs live 60 min (roles.js) — refresh comfortably before expiry
const NEG_TTL = 60 * 1000;  // a confirmed-missing object is re-checked after a minute, not never
const CACHE = {};           // path -> { url: string|null, at: ms }  (url null = confirmed missing)
const INFLIGHT = new Set();
const THUMBED = new Set();  // paths whose thumbnail was asked for this session (made, in flight, or failed): never re-queued
// Signed out: the last account's signed URLs and thumbnail bookkeeping go with its launch cache.
onLaunchDrop(() => { for (const k of Object.keys(CACHE)) delete CACHE[k]; THUMBED.clear(); });

export function todayMealPhotoPath(userId, dateISO, slot) {
  return userId ? `${userId}/${dateISO}/${slot}.jpg` : null;
}

/** Synchronous read for render passes: the cached signed URL, or null if not resolved yet. */
export function cachedMealPhoto(path) {
  if (!path) return null;
  let c = CACHE[path];
  // A cold launch starts from what Home last resolved (launch-cache.js): the same signed URL is a
  // disk-cache hit in the WebView, so the picture is there on the first frame instead of a round
  // trip later. It ages exactly like one signed this session (`at` is when it was signed).
  if (!c) { const k = kept(path); if (!k || !k.u) return null; c = CACHE[path] = { url: k.u, at: k.at }; }
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
  keepPhoto(path, null);
  if (typeof window !== 'undefined' && window.__render) window.__render();
}

/** True when the store has been told this object does not exist (the no-photo glyph is honest). */
export function photoMissing(path) { const c = path && CACHE[path]; return !!c && c.url === null; }

/** A small stand-in for the photo (launch-cache.js), painted under it until the real one arrives. */
export function cachedMealThumb(path) { const k = path && kept(path); return (k && k.th) || null; }
const kept = (path) => (launchCache().photos || {})[path];
/** Merge (or, with null, forget) one path's kept entry; the newest 16 survive. `uid` is whose
 *  request this was: a result that lands after that user is gone is dropped (launch-cache also
 *  refuses it), so one account's photo never lands in another's cache. */
function keepPhoto(path, patch, uid = currentLaunchOwner()) {
  if (!uid || uid !== currentLaunchOwner()) return;
  const all = { ...(launchCache(uid).photos || {}) };
  if (!patch && !all[path]) return;
  if (patch) all[path] = { ...all[path], ...patch }; else delete all[path];
  Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(16).forEach((k) => delete all[k]);
  keepLaunch('photos', all, uid);
}
/* Downloaded and decoded before the repaint that shows it, so a card goes from its placeholder
   straight to the picture and never through an empty frame. Capped: a slow photo never holds the
   rest of the screen. */
const decoded = (url) => (typeof Image !== 'function' ? Promise.resolve() : Promise.race([
  new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = url; }),
  new Promise((res) => setTimeout(res, 4000))]));

/** `keep` (Home only): remember what resolved for the next cold launch, with a thumbnail, and
 *  repaint only once the new pictures are decoded. Resolves true when anything new resolved. */
export function warmMealPhotos(paths, keep = false) {
  const uid = currentLaunchOwner();
  const want = (paths || []).filter(Boolean);
  want.forEach(cachedMealPhoto);   // loads kept entries, expires stale ones
  if (keep) thumbs(want.filter((p) => CACHE[p] && CACHE[p].url && !cachedMealThumb(p)), uid);
  const need = want.filter((p) => !CACHE[p] && !INFLIGHT.has(p));
  if (!need.length) return Promise.resolve(false);
  need.forEach((p) => INFLIGHT.add(p));
  // One createSignedUrls round trip for the whole surface. The per-path loop this replaces made
  // 50-70 parallel storage calls on a 14-day history mount — the signer takes a batch.
  return signedMealPhotoUrls(need)
    .then(async (map) => {
      const at = Date.now();
      const got = need.filter((p) => map && map[p]);
      // Home's photos are published only once decoded: a URL in CACHE is painted by ANY repaint,
      // and one that has not loaded yet paints as an empty card until it does.
      if (keep) await Promise.all(got.map((p) => decoded(map[p])));
      if (uid !== currentLaunchOwner()) return false;   // signed out / switched while this was in flight
      for (const p of need) CACHE[p] = { url: (map && map[p]) || null, at };   // absent = missing or transient: a miss, re-checked after NEG_TTL
      if (keep) {
        got.forEach((p) => keepPhoto(p, { u: CACHE[p].url, at }, uid));
        thumbs(got, uid);
      }
      if (got.length && typeof window !== 'undefined' && window.__render) window.__render();
      return got.length > 0;
    })
    .catch(() => false /* transient — nothing cached, the next repaint retries */)
    .finally(() => { need.forEach((p) => INFLIGHT.delete(p)); });
}
function thumbs(paths, uid) {
  const todo = paths.filter((p) => !THUMBED.has(p));
  if (!todo.length || typeof document === 'undefined') return;
  todo.forEach((p) => THUMBED.add(p));
  import('./photo-thumb.js').then((m) => m.makeThumbs(todo.map((p) => [p, CACHE[p].url]), (p, th) => keepPhoto(p, { th, at: CACHE[p] ? CACHE[p].at : 0 }, uid)), () => {});
}
