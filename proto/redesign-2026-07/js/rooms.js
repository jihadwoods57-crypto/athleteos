/* Position rooms — pure helpers (T-04 slice 1). No DOM, no network. The room OBJECT + CRUD live in
   roles.js/state.js; this is just the naming + suggestion logic the builder screen leans on. */

/** A stable machine key for a room from its display label: lowercase, non-alphanumerics → single
 *  dashes, trimmed, capped at 40 chars (matches the 0087 key check). Empty label → ''. */
export function slugifyRoomKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Rooms to suggest for a team: the distinct athlete positions already on the roster that don't yet
 *  have a room (by slug), each as { key, label }. Sport-agnostic — it reads the real positions on
 *  the roster rather than a hardcoded taxonomy, so it fits football, track, or anything else. Sorted
 *  and de-duplicated; blank positions are ignored. */
export function suggestedRooms(rosterPositions, existingRooms) {
  const have = new Set((Array.isArray(existingRooms) ? existingRooms : []).map((r) => r && r.key).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(rosterPositions) ? rosterPositions : [])) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const key = slugifyRoomKey(label);
    if (!key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
