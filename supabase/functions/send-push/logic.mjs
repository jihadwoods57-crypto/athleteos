// send-push bulk-nudge logic — PURE (no Deno, no supabase, no clock), the admin-alert
// logic.mjs idiom, so the sanitation + aggregation that used to live as a client loop in
// coach-roster.js is covered by `npm run test:fn`.

import { pushSkipReason } from '../_shared/quiet-hours.mjs';

/** Hard cap on one bulk call. A college roster tops out well under this; anything larger is
 *  a bug or abuse, and the caller is told what was dropped instead of silently truncated. */
export const BULK_CAP = 150;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIER_SET = new Set(['critical', 'below', 'due_soon']);

/** Normalize + validate the bulk payload. Returns { ok:false, error } or
 *  { ok:true, ids, dropped, title, body, book, bookId, reasons }.
 *  `reasons` is athleteId -> { reason_key, tier } with junk clamped away, so the
 *  interventions insert can never carry an invalid tier into the table CHECK.
 *  @param {any} payload
 *  @returns {{ ok: false, error: string } | { ok: true, ids: string[], dropped: number, title: string, body: string,
 *    book: 'team' | 'practice', bookId: string, reasons: Record<string, { reason_key: string | null, tier: string | null }> }} */
export function sanitizeBulkPayload(payload) {
  const p = payload || {};
  if (!Array.isArray(p.athlete_ids)) return { ok: false, error: 'athlete_ids must be an array' };
  const seen = new Set();
  /** @type {string[]} */
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
  /** @type {Record<string, { reason_key: string | null, tier: string | null }>} */
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

/** Roll call kinds an athlete's app reports to their coaches (to_coach mode). */
export const ROLLCALL_KINDS = new Set(['rollcall_answered']);

/** True when this to_coach report is about the roll call and the roll call is switched off
 *  (feature_flags.verified_commitments.kill_switch, founder 2026-09-24). An answer to a push sent
 *  before the switch is still recorded server-side; the coach is just not pushed about a feature
 *  that no longer exists in their app. `flag` is the feature_flags row or null (no row = on). */
export function rollcallReportSilenced(baseKind, flag) {
  return ROLLCALL_KINDS.has(String(baseKind || '')) && !!(flag && flag.kill_switch === true);
}

/* ---------------- lessons and team challenges (0256, goals and eating plan phase D) ----------------
   A new assignment or challenge is announced ONCE: 0256 claim_teach_push stamps the row and hands
   back the audience, and this decides who of that audience gets the bell row and who the push. */


export const TEACH_KINDS = new Set(['lesson', 'challenge']);

/** The request's { kind, id }, or null when it is not a well-formed teach push. */
export function sanitizeTeachPush(tp) {
  if (!tp || typeof tp !== 'object') return null;
  const kind = TEACH_KINDS.has(tp.kind) ? tp.kind : null;
  const id = typeof tp.id === 'string' && UUID_RE.test(tp.id) ? tp.id.toLowerCase() : null;
  return kind && id ? { kind, id } : null;
}

/** The claim's audience, clean: uuids only, each once, at most 500. */
export function claimAudience(claim) {
  const raw = claim && Array.isArray(claim.athlete_ids) ? claim.athlete_ids : [];
  return [...new Set(raw.filter((v) => typeof v === 'string' && UUID_RE.test(v)).map((v) => v.toLowerCase()))].slice(0, 500);
}

/** The bell row's kind: `lesson:<lessonId>` (the bell links the lesson) or `challenge`. */
export function teachBellKind(claim) {
  if (claim && claim.kind === 'lesson' && typeof claim.ref === 'string' && /^[a-z0-9-]{6,64}$/.test(claim.ref)) return `lesson:${claim.ref}`;
  return claim && claim.kind === 'lesson' ? 'lesson' : 'challenge';
}

/**
 * Who hears about it. A bell row for everyone in the audience except an athlete who blocked the
 * coach (0244, the announcement rule). A push only for those who also have pushes on (the master
 * switch and the team-standard switch, 0067/0221) and are outside their quiet hours now. Quiet
 * hours do NOT defer it: the push is once, and the bell row carries it.
 */
export function planTeachPush({ athleteIds, profiles, blocked, nowMs }) {
  const byId = new Map((Array.isArray(profiles) ? profiles : []).map((p) => [String(p.id).toLowerCase(), p]));
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked || []);
  const bell = (athleteIds || []).filter((id) => !blockedSet.has(id));
  const push = bell.filter((id) => pushSkipReason(byId.get(id) || null, nowMs) === null);
  return { bell, push };
}
