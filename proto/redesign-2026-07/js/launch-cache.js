/* What Home last showed, per user, so a cold launch paints it at once and the network only has to
   reconcile (cold launch, 2026-09-23). Parts: `photos` (path -> signed url + thumb), `past` (the
   past-day rails), `seen` and `reply` (the receipts under the ring). Keyed by user id and read
   back only for that id; the sign-out wipe drops every copy. Shown until the fetch it stands in for
   lands, never instead of it.

   Writes are accepted only for the OWNER (the user Home last painted for). A fetch that started
   for user A and lands after A signed out, or after B signed in, is refused here as well as by its
   caller, so nothing of A's can be written back once A is gone. */
const P = 'onstd-launch-';
let C = null, owner = null;
const timers = new Map();   // uid -> pending write; one per user, so B's write never cancels A's
const dropHooks = [];

/** This user's cache (an empty one for anyone else). `uid` defaults to the current owner. */
export function launchCache(uid = owner) {
  if (!uid) return {};
  if (!C || C.uid !== uid) {
    try { C = JSON.parse(localStorage.getItem(P + uid) || 'null'); } catch { C = null; }
    if (!C || C.uid !== uid) C = { uid };
  }
  return C;
}

/** Whose cache is live (Home sets it on every paint). */
export function launchOwner(uid) { owner = uid || null; }
export function currentLaunchOwner() { return owner; }

/** Set one part and persist, coalesced per user so a burst of arrivals is one write. Refused for
 *  anyone but the owner. Returns whether it was accepted. */
export function keepLaunch(part, val, uid = owner) {
  if (!uid || uid !== owner) return false;
  const c = launchCache(uid);
  c[part] = val;
  clearTimeout(timers.get(uid));
  timers.set(uid, setTimeout(() => {
    timers.delete(uid);
    if (uid !== owner) return;   // signed out (or switched) inside the coalescing window
    try { localStorage.setItem(P + uid, JSON.stringify(c)); } catch { /* quota: the next launch just waits for the network */ }
  }, 300));
  return true;
}

/** Run `fn` whenever the cache is dropped (photo-store clears its in-memory signed URLs). */
export function onLaunchDrop(fn) { dropHooks.push(fn); }

/** Sign-out / account switch: nothing of the last user survives on this device. */
export function dropLaunch() {
  C = null; owner = null;
  timers.forEach((t) => clearTimeout(t)); timers.clear();
  try {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) ks.push(k); }
    ks.forEach((k) => localStorage.removeItem(k));
  } catch { /* no storage */ }
  dropHooks.forEach((fn) => { try { fn(); } catch { /* a hook never blocks a wipe */ } });
}
