/* What Home last showed, per user, so a cold launch paints it at once and the network only has to
   reconcile (cold launch, 2026-09-23). Parts: `photos` (path -> signed url + thumb), `past` (the
   past-day rails), `seen` and `reply` (the receipts under the ring). Keyed by user id and read
   back only for that id; the sign-out wipe drops every copy. Shown until the fetch it stands in for
   lands, never instead of it. */
const P = 'onstd-launch-';
let C = null, owner = null, timer = 0;

/** This user's cache (an empty one for anyone else). `uid` defaults to the current owner. */
export function launchCache(uid = owner) {
  if (!uid) return {};
  if (!C || C.uid !== uid) {
    try { C = JSON.parse(localStorage.getItem(P + uid) || 'null'); } catch { C = null; }
    if (!C || C.uid !== uid) C = { uid };
  }
  return C;
}

/** Whose cache photo-store reads and writes (Home sets it on every paint). */
export function launchOwner(uid) { owner = uid || null; }

/** Set one part and persist, coalesced so a burst of arrivals is one write. */
export function keepLaunch(part, val, uid = owner) {
  const c = launchCache(uid);
  if (!c.uid) return;
  c[part] = val;
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(P + c.uid, JSON.stringify(c)); } catch { /* quota: the next launch just waits for the network */ } }, 300);
}

/** Sign-out / account switch: nothing of the last user survives on this device. */
export function dropLaunch() {
  C = null; owner = null; clearTimeout(timer);
  try {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) ks.push(k); }
    ks.forEach((k) => localStorage.removeItem(k));
  } catch { /* no storage */ }
}
