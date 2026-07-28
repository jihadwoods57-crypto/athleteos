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

/** The label of the room an athlete is assigned to, or null when unassigned / the room is unknown.
 *  This is the position value the athlete's standard resolves against when they've been assigned a
 *  room — so an assigned athlete's day follows their ROOM, and an unassigned one (null) falls back
 *  to their raw position exactly as before. The whole parity guarantee of slice 2 rides on the null
 *  case: no assignment → no change. */
export function effectiveRoomLabel(roomId, rooms) {
  if (!roomId || !Array.isArray(rooms)) return null;
  const room = rooms.find((r) => r && r.id === roomId);
  return room && room.label ? room.label : null;
}

/** Group roster rows by their assigned room. Returns { byRoom: Map(roomId → rows[]), needs: rows[] }
 *  where `needs` are active athletes with no room (the Needs-Assignment queue). Rows whose roomId
 *  points at a deleted room fall into `needs` too (the room is gone → they need reassigning). */
export function groupRosterByRoom(rows, rooms) {
  const roomIds = new Set((Array.isArray(rooms) ? rooms : []).map((r) => r && r.id).filter(Boolean));
  const byRoom = new Map();
  const needs = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (row && row.roomId && roomIds.has(row.roomId)) {
      if (!byRoom.has(row.roomId)) byRoom.set(row.roomId, []);
      byRoom.get(row.roomId).push(row);
    } else {
      needs.push(row);
    }
  }
  return { byRoom, needs };
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
