// supabase/functions/roll-call-ack/logic.ts
// Pure status mapping for the roll-call-ack edge fn. ZERO framework imports on purpose: loaded
// by both Deno (edge) and jest (babel) — same rule tested from one implementation.
//
// 'bad_kind' is a COACH code presented to the athlete ack endpoint (or the reverse). It is an
// authentication failure, not a routing mistake, so it wears 401 alongside bad_sig — the caller
// holds a real, correctly-signed credential for a different door, and telling them apart in the
// response would be free reconnaissance.
import { liveContentState, teamFields, type LiveContentState, type LivePhase, type TeamBoard } from '../_shared/rollcall-live.ts';

export type AckFailure = 'malformed' | 'bad_sig' | 'bad_kind' | 'expired' | 'not_yet' | 'flag_off' | 'no_row' | 'db_error';

export function httpStatusFor(reason: AckFailure): number {
  switch (reason) {
    case 'malformed':
    case 'bad_kind':
    case 'bad_sig': return 401;
    // not_yet: a window code spent 15+ minutes before its roll call opens. A decided answer like
    // expired, so a queued tap is dropped rather than replayed into the window later.
    case 'not_yet':
    case 'expired': return 410;
    case 'flag_off': return 403;
    case 'no_row': return 404;
    case 'db_error': return 500;
  }
}

// ---------------------------------------------------------------- 2026-09-23: the team on every card

/** At most one team-count update per athlete per minute. A 60-athlete room waking inside two
 *  minutes would otherwise be 3,600 APNs pushes, and Apple budgets Live Activity updates per
 *  device: a card that is throttled by iOS stops moving for everyone. */
export const TEAM_UPDATE_MIN_GAP_MS = 60_000;

/** One live update token on this instance, as rollcall_live_update_targets (0242) returns it.
 *  `phase_hint` is the phase the card is in now (answered / late / reminder / initial), so a count
 *  update never flips an amber card back to blue. */
export type TeamTarget = {
  athlete_id: string; token: string; last_update_at: string | null; phase_hint?: string | null;
};

const PHASES: LivePhase[] = ['initial', 'reminder', 'late', 'answered', 'missed'];
const asPhase = (p: string | null | undefined): LivePhase =>
  (PHASES as string[]).includes(p ?? '') ? (p as LivePhase) : 'initial';

/**
 * The updates to send after one check-in: every teammate with a live card gets the new count.
 *   - never the athlete who just checked in (they get their own answered update, once);
 *   - at most one per athlete per TEAM_UPDATE_MIN_GAP_MS, read from `last_update_at`;
 *   - a teammate already up keeps their answered state, place and points;
 *   - a teammate not up keeps the phase their card is in.
 * Pure: the caller claims the chosen tokens (claim_live_team_updates, atomic) and sends.
 */
export function teamCountUpdates(
  instanceId: string,
  board: TeamBoard | null | undefined,
  ctx: {
    targets: TeamTarget[];
    card: { respond_by_at?: string | null; closes_at?: string | null; message?: string | null };
    checkedIn: string;
    nowMs: number;
    minGapMs?: number;
  },
): Array<{ athleteId: string; token: string; state: LiveContentState }> {
  if (!board || (board.instance_id && board.instance_id !== instanceId)) return [];
  const gap = ctx.minGapMs ?? TEAM_UPDATE_MIN_GAP_MS;
  const out: Array<{ athleteId: string; token: string; state: LiveContentState }> = [];
  const seen = new Set<string>();
  for (const t of ctx.targets) {
    if (!t.token || t.athlete_id === ctx.checkedIn || seen.has(t.athlete_id)) continue;
    const last = Date.parse(t.last_update_at ?? '');
    if (Number.isFinite(last) && ctx.nowMs - last < gap) continue;
    seen.add(t.athlete_id);
    const row = board.rows.find((r) => r.athlete_id === t.athlete_id);
    const answered = !!row?.acknowledged_at && row.verdict !== 'missed' && row.verdict !== 'excused';
    const phase: LivePhase = answered ? 'answered' : asPhase(t.phase_hint === 'answered' ? 'initial' : t.phase_hint);
    out.push({
      athleteId: t.athlete_id,
      token: t.token,
      state: liveContentState(ctx.card, phase, answered ? row!.acknowledged_at : null, teamFields(board, t.athlete_id)),
    });
  }
  return out;
}

/** How far ahead the phone holds window codes. */
export const WINDOW_CODE_DAYS = 7;

/** The windows to mint codes for: not yet closed, opening within WINDOW_CODE_DAYS. */
export function mintableWindows(
  rows: Array<{ instance_id: string; opens_at: string | null; closes_at: string | null }>,
  nowMs: number,
  days = WINDOW_CODE_DAYS,
): Array<{ instance_id: string; opensMs: number; closesMs: number }> {
  const horizon = nowMs + days * 24 * 60 * 60 * 1000;
  const out: Array<{ instance_id: string; opensMs: number; closesMs: number }> = [];
  for (const r of rows) {
    const opensMs = Date.parse(r.opens_at ?? '');
    const closesMs = Date.parse(r.closes_at ?? '');
    if (!r.instance_id || !Number.isFinite(opensMs) || !Number.isFinite(closesMs)) continue;
    if (closesMs <= nowMs || opensMs > horizon) continue;
    out.push({ instance_id: r.instance_id, opensMs, closesMs });
  }
  return out;
}

/** The bearer token of an Authorization header, or "". */
export function bearerOf(header: string | null | undefined): string {
  const m = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim());
  return m ? m[1] : '';
}

// ---------------------------------------------------------------- the refresh route (2026-09-23)
/* An answer that did NOT come through a window code (the app's drain of a tap whose own post
   failed, an in-app "I'm up", every older binary) records through ack_commitment, which sends no
   push. Without this the athlete's lock-screen card kept counting down at them until the close.
   `{ action: 'refresh', instance_id }` with the athlete's own session sends the same answered
   update and team fan-out a code ack does. */

/** What happened to the athlete's OWN card after an answer. The refresh route returns it and the
 *  phone decides from it whether to end its card itself (src/core/rollcall.ts):
 *    sent              the answered update went out
 *    already_answered  this card already had its answered update (a code ack, a re-post)
 *    no_token          the server holds no live update token for this athlete: no card it can reach
 *    no_card           the roll call has no live card (not a wake-up, or gone)
 *    unavailable       APNs is not configured, or the push reached nobody */
export type OwnCardResult = 'sent' | 'already_answered' | 'no_token' | 'no_card' | 'unavailable';

/** claim_live_answered_update's answer. 'unknown' (an RPC error: a stack without 0242's claim)
 *  sends anyway, the pre-claim behaviour, rather than go silent. */
export type AnsweredClaim = 'claimed' | 'already_answered' | 'no_token' | 'unknown';

export function answeredClaimOf(data: unknown, error: unknown): AnsweredClaim {
  if (error) return 'unknown';
  const v = Array.isArray(data)
    ? (typeof data[0] === 'string' ? data[0] : Object.values((data[0] ?? {}) as Record<string, unknown>)[0])
    : data;
  return v === 'claimed' || v === 'already_answered' || v === 'no_token' ? v : 'unknown';
}

/** The answer before any push, or null to go ahead and push. Reads no count throttle on purpose:
 *  a teammate's count update seconds earlier must never hold an answered transition back. */
export function ownCardBeforePush(s: { apns: boolean; card: boolean; claim: AnsweredClaim }): OwnCardResult | null {
  if (!s.apns) return 'unavailable';
  if (!s.card) return 'no_card';
  if (s.claim === 'already_answered' || s.claim === 'no_token') return s.claim;
  return null;
}

/** The answer after the push. A claim whose push reached nobody is released, so the next refresh
 *  can try again instead of reading 'already_answered' for an update no device received. */
export function ownCardAfterPush(claim: AnsweredClaim, pushed: { updated: number; revoked: number }):
  { result: OwnCardResult; release: boolean } {
  if (pushed.updated > 0) return { result: 'sent', release: false };
  return { result: pushed.revoked > 0 ? 'no_token' : 'unavailable', release: claim === 'claimed' };
}

/** Whether the teammates' counts move. Not for a repeat of an answer already announced (a
 *  re-posted code used to fan out every time), and not without a card to build them from. */
export function fansOutTeam(result: OwnCardResult): boolean {
  return result !== 'already_answered' && result !== 'no_card';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one instance a refresh names, or "" when it names nothing usable. */
export function refreshInstanceOf(body: unknown): string {
  const v = (body as { instance_id?: unknown } | null)?.instance_id;
  return typeof v === 'string' && UUID.test(v) ? v : '';
}

/** Whether the caller's own response row earns a refresh. Only a recorded answer does. */
export function refreshVerdict(row: { acknowledged_at: string | null } | null | undefined): 'ok' | 'not_acked' | 'no_row' {
  if (!row) return 'no_row';
  return row.acknowledged_at ? 'ok' : 'not_acked';
}

/** The athlete ids a claim_live_team_updates call returned (plain strings or one-column rows). */
export function wonAthleteIds(won: unknown): Set<string> {
  return new Set((Array.isArray(won) ? won : []).map((x: unknown) =>
    typeof x === 'string' ? x : String(Object.values((x ?? {}) as Record<string, unknown>)[0] ?? '')));
}
