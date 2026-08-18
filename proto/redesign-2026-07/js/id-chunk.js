/* Roster-id chunking (scale pass 2026-08-18). A `.in('col', ids)` filter is the only shape
   PostgREST/supabase-js expose for a plain select — `.rpc()` calls POST, but `.select()` is
   always GET, so every id in the array lands in the URL's query string (checked against the
   installed supabase-js@2.108.2 bundle: PostgrestQueryBuilder.select() hardcodes GET/HEAD).
   A 36-char UUID plus its comma is 37 bytes; past roughly 200 athletes on one query that
   crosses common 8KB proxy/URL limits and the request stops degrading gracefully — it 414s.
   No server-side RPC exists yet to replace these reads with a set-based team_id/practice_id
   join (team_roster/team_day_rollup do this for OTHER reads, not these), so chunking the ids
   into parallel requests is the fix that ships without new migrations. */

export const ID_CHUNK_SIZE = 60; // ~2.2KB of ids per chunk — generous headroom under 8KB

/** Split an id array into chunks of at most `size`. Empty/non-array input yields no chunks, so
 *  `chunkIds(x).map(...)` is always safe to Promise.all even when there's nothing to fetch. At
 *  any roster under `size` this returns exactly one chunk — byte-for-byte the same single
 *  request as before chunking existed. */
export function chunkIds(ids, size = ID_CHUNK_SIZE) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
