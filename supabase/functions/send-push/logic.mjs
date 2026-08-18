// send-push bulk-nudge logic — PURE (no Deno, no supabase, no clock), the admin-alert
// logic.mjs idiom, so the sanitation + aggregation that used to live as a client loop in
// coach-roster.js is covered by `npm run test:fn`.

/** Hard cap on one bulk call. A college roster tops out well under this; anything larger is
 *  a bug or abuse, and the caller is told what was dropped instead of silently truncated. */
export const BULK_CAP = 150;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIER_SET = new Set(['critical', 'below', 'due_soon']);

/** Normalize + validate the bulk payload. Returns { ok:false, error } or
 *  { ok:true, ids, dropped, title, body, book, bookId, reasons }.
 *  `reasons` is athleteId -> { reason_key, tier } with junk clamped away, so the
 *  interventions insert can never carry an invalid tier into the table CHECK. */
export function sanitizeBulkPayload(payload) {
  const p = payload || {};
  if (!Array.isArray(p.athlete_ids)) return { ok: false, error: 'athlete_ids must be an array' };
  const seen = new Set();
  const ids = [];
  for (const v of p.athlete_ids) {
    if (typeof v !== 'string' || !UUID_RE.test(v)) continue;
    const id = v.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const dropped = Math.max(0, ids.length - BULK_CAP);
  const kept = ids.slice(0, BULK_CAP);
  if (!kept.length) return { ok: false, error: 'no valid athlete ids' };
  const book = p.book === 'practice' ? 'practice' : 'team';
  const bookId = typeof p.book_id === 'string' && UUID_RE.test(p.book_id) ? p.book_id.toLowerCase() : null;
  if (!bookId) return { ok: false, error: 'book_id required' };
  const reasons = {};
  if (p.reasons && typeof p.reasons === 'object' && !Array.isArray(p.reasons)) {
    for (const id of kept) {
      const r = p.reasons[id];
      if (!r || typeof r !== 'object') continue;
      const reason_key = typeof r.reason_key === 'string' ? r.reason_key.slice(0, 80) : null;
      const tier = TIER_SET.has(r.tier) ? r.tier : null;
      if (reason_key || tier) reasons[id] = { reason_key, tier };
    }
  }
  return {
    ok: true, ids: kept, dropped,
    title: String(p.title ?? 'OnStandard').slice(0, 120),
    body: String(p.body ?? '').slice(0, 300),
    book, bookId, reasons,
  };
}

/** Per-athlete outcomes -> the aggregate the response carries and the roster summarizes.
 *  Vocabulary matches nudgeResultCopy's: pushed = a device heard it; devices 0 = in-app only. */
export function aggregateBulkResults(results) {
  let sent = 0, inboxOnly = 0, deduped = 0, suppressed = 0;
  for (const r of results || []) {
    if (!r) continue;
    if (r.deduped) { deduped++; continue; }
    if (r.suppressed) { suppressed++; continue; }
    sent++;
    if (!r.pushed) inboxOnly++;
  }
  return { sent, inboxOnly, deduped, suppressed };
}
