/* OnStandard — profile pictures (0206).
   One deterministic public object per user: avatars/<uid>/avatar.jpg. Any surface that knows a
   user id can show their face; a user without one 404s and the surface keeps its initials. No
   profiles column, no signed URLs, no per-surface fetch plumbing — that is the entire design.

   HOW A SURFACE OPTS IN: render initials as usual, and put `data-avatar-uid="<uid>"` on the
   circle element (wrapping the initials text in `<span data-avatar-fallback>` if the element
   also carries children that must survive, like avatarHead's chevron badge). The router calls
   hydrateAvatars() after every screen render; screens that paint async slots call it on the
   slot themselves. When the probe confirms a photo exists, the element gets a cover
   background-image and the fallback initials are hidden by CSS.

   The probe result is cached per (uid, version) for the session, so a roster of 40 rows costs
   at most 40 image fetches once — repaints are free. RT.avatarVer bumps the version for the
   OWN user after an upload, which busts both this cache and the CDN's. */

const PATH = (uid) => `${uid}/avatar.jpg`;

/* uid:ver -> Promise<string|null> resolving to a paint-ready URL, or null when no photo. */
const CACHE = new Map();

export function avatarPublicUrl(uid) {
  const c = window.sb;
  if (!c || !uid) return null;
  try {
    const { data } = c.storage.from('avatars').getPublicUrl(PATH(uid));
    return (data && data.publicUrl) || null;
  } catch { return null; }
}

function probe(url) {
  return new Promise((resolve) => {
    try {
      const im = new Image();
      im.onload = () => resolve(true);
      im.onerror = () => resolve(false);
      im.src = url;
    } catch { resolve(false); }
  });
}

/** Resolves to the URL to paint, or null. Memoized per (uid, ver) for the session. */
export function avatarReady(uid, ver) {
  const key = `${uid}:${ver || ''}`;
  if (!CACHE.has(key)) {
    const base = avatarPublicUrl(uid);
    const url = base ? (ver ? `${base}?v=${encodeURIComponent(ver)}` : base) : null;
    CACHE.set(key, url ? probe(url).then((ok) => (ok ? url : null)) : Promise.resolve(null));
  }
  return CACHE.get(key);
}

/** Forget everything cached for a uid — call after an upload or removal so the next hydrate
 *  re-probes instead of replaying the stale verdict. */
export function bustAvatar(uid) {
  for (const k of [...CACHE.keys()]) if (k.startsWith(`${uid}:`)) CACHE.delete(k);
}

/** Upgrade every `[data-avatar-uid]` under root from initials to the real photo, where one
 *  exists. Safe to call repeatedly; elements that left the DOM are skipped at resolve time. */
export function hydrateAvatars(root) {
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  scope.querySelectorAll('[data-avatar-uid]').forEach((el) => {
    const uid = el.getAttribute('data-avatar-uid');
    if (!uid) return;
    avatarReady(uid, el.getAttribute('data-avatar-ver') || '').then((url) => {
      if (!url || !el.isConnected) return;
      el.style.backgroundImage = `url('${url}')`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.classList.add('has-photo');
    });
  });
}
