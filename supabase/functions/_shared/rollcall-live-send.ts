// OnStandard — the Live Activity send path: tokens in, APNs pushes out.
//
// Kept apart from rollcall-live.ts so THAT file stays pure and jest-testable. This one talks to the
// database and to Apple, and every function in it is written to be a NO-OP when anything is
// missing: no APNs key configured, no iPhone registered, a dead token. A Wake-Up Roll Call must
// work exactly as it did before this feature existed when none of it is available, because that is
// the state of every Android phone, every iPhone below 17.2, and every install until the founder
// has finished the Apple-portal setup.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { ApnsClient } from './apns.ts';
import {
  liveStartPayload, liveUpdatePayload, liveEndPayload, liveContentState, liveAnsweredUpdate, liveWindowMs, livePriority,
  type LiveAttributes, type LivePhase, type LiveAlert, type LiveTeam, type TeamBoard, type LiveContentState,
} from './rollcall-live.ts';
import { signWindowCode } from './rollcall-code.ts';

/** What the card needs to render, as rollcall_live_card returns it. */
export type LiveCard = {
  instance_id: string;
  title: string;
  coach_name: string;
  message: string;
  starts_at: string | null;
  respond_by_at: string | null;
  closes_at: string | null;
  timezone: string | null;
  /** The coach's own button words (0234 payload); null on a card read by an older RPC. */
  action_label?: string | null;
  /** 0242: the window's open (10 minutes before the start for a wake-up) and whether the roll
   *  call also asks for an arrival. Absent on a card read by an older RPC. */
  opens_at?: string | null;
  asks_arrival?: boolean | null;
};

type Target = { athlete_id: string; start_token: string | null; update_token: string | null };

/** First letter of the first two words, upper-cased. Mirrors the proto's initials() closely enough
 *  for a 30-point circle; the widget only ever shows it when no photo has been cached. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function attributesFor(card: LiveCard, ack?: { code?: string | null; url?: string | null }): LiveAttributes {
  return {
    instanceId: card.instance_id,
    title: card.title || 'Wake-Up Roll Call',
    coachName: card.coach_name || '',
    coachInitials: initialsOf(card.coach_name),
    ackCode: ack?.code || '',
    ackUrl: ack?.url || '',
    // ONE VOCABULARY: the card's button says what the alarm, the push and the app say. Omitted
    // (not null) when the coach never named one, so the widget's optional decodes to nil.
    ...(card.action_label && String(card.action_label).trim() ? { actionLabel: String(card.action_label).trim().slice(0, 24) } : {}),
  };
}

/**
 * Push one phase to every athlete in the list who has an iPhone registered for it.
 *
 * `phase` decides which payload: no activity yet plus phase 'initial' starts one (when allowStart);
 * an existing activity is updated; 'missed' ENDS it, and so does any phase with `end: true` (the
 * close). 'answered' is an update that keeps the card (2026-09-23). Returns counts, never throws:
 * a roll call is not allowed to fail because Apple had a bad minute.
 */
export type LivePushResult = {
  started: number; updated: number; ended: number; revoked: number; skipped: number;
  /**
   * The athletes whose card is now genuinely on screen, because Apple accepted this push for them.
   *
   * THIS IS WHAT SUPPRESSES THE SECOND CARD. The founder's call (2026-09-02): one roll call should
   * put ONE thing on the lock screen, not a Live Activity with a notification stacked under it
   * saying the same words. So the caller sends the notification only to devices NOT in this set.
   *
   * It is deliberately the set of pushes Apple ACCEPTED, not the set of athletes who own an
   * iPhone. Suppressing on intent rather than on outcome would mean an athlete whose card failed
   * to start gets nothing at all, which is the one failure this feature cannot have.
   */
  live: Set<string>;
};

export async function pushLiveActivity(opts: {
  svc: SupabaseClient;
  apns: ApnsClient | null;
  card: LiveCard;
  athleteIds: string[];
  phase: LivePhase;
  alert?: LiveAlert;
  /** Per-athlete ack time, for the 'answered' phase. */
  checkedInAt?: Map<string, string>;
  nowMs?: number;
  /** May this push START a card where none exists? Defaults to phase === 'initial'. The start-time
   *  rung passes false for an instance whose card the open already started (2026-09-23). */
  allowStart?: boolean;
  /** END the card in this phase instead of updating it. 'missed' always ends; 'answered' ends only
   *  at the close (the check-in itself keeps the card, 2026-09-23). */
  end?: boolean;
  /** The team fields per athlete (teamFields off rollcall_team_board_svc). Absent: 0 / 0 / null. */
  team?: (athleteId: string) => LiveTeam;
  /** Per-athlete WINDOW codes for the start attributes, and where the card posts them. */
  ackCodes?: Map<string, string>;
  ackUrl?: string;
}): Promise<LivePushResult> {
  const { svc, apns, card, athleteIds, phase, alert } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const out: LivePushResult = { started: 0, updated: 0, ended: 0, revoked: 0, skipped: 0, live: new Set<string>() };
  if (!apns || !athleteIds.length) return out;

  let targets: Target[] = [];
  try {
    const { data } = await svc.rpc('rollcall_live_targets', {
      p_instance: card.instance_id, p_athletes: athleteIds,
    });
    targets = (Array.isArray(data) ? data : []) as Target[];
  } catch {
    return out; // the table may not exist yet on an un-migrated stack; never break the push path
  }

  // 2026-09-23: 'answered' no longer ends the card. The athlete's own check-in UPDATES it (place,
  // points, the team count) and it stays until the close sweep ends it with `end: true`.
  const ending = phase === 'missed' || !!opts.end;
  const allowStart = opts.allowStart ?? phase === 'initial';

  for (const t of targets) {
    const state = liveContentState(card, phase, opts.checkedInAt?.get(t.athlete_id) ?? null, opts.team?.(t.athlete_id) ?? null);

    // Which token, and therefore which event. An update token means the activity already exists.
    let token: string | null = t.update_token;
    let payload: Record<string, unknown>;
    if (token) {
      payload = ending ? liveEndPayload(state, nowMs)
        : phase === 'answered' ? liveAnsweredUpdate(state, nowMs)
        : liveUpdatePayload(state, nowMs, alert);
    } else if (phase === 'initial' && allowStart && t.start_token) {
      // Only the OPEN push may start an activity. Starting one at REMINDER would put a card on the
      // lock screen of an athlete who has already been reminded once with nothing on it, and
      // starting one at LATE would be the app announcing itself at the worst possible moment.
      token = t.start_token;
      const attrs = attributesFor(card, { code: opts.ackCodes?.get(t.athlete_id), url: opts.ackUrl });
      payload = liveStartPayload(attrs, state, alert ?? {
        title: attrs.coachName || attrs.title, body: state.line || attrs.title, sound: 'default',
      }, nowMs);
    } else {
      out.skipped++;
      continue;
    }

    const res = await apns.send(token, payload, nowMs);
    if (res.ok) {
      if (ending) out.ended++;
      else if (t.update_token) out.updated++;
      else out.started++;
      // Only a card that is going UP suppresses the notification. An `end` push takes the card
      // AWAY, so an athlete whose activity just ended must still be reachable by notification.
      if (!ending) out.live.add(t.athlete_id);
    } else if (res.gone) {
      out.revoked++;
      try { await svc.rpc('revoke_live_activity_token', { p_token: token }); } catch { /* best effort */ }
    } else {
      out.skipped++;
    }
  }
  return out;
}

/** Read the card for one instance, or null when it has gone. */
export async function loadLiveCard(svc: SupabaseClient, instanceId: string): Promise<LiveCard | null> {
  try {
    const { data } = await svc.rpc('rollcall_live_card', { p_instance: instanceId });
    const row = (Array.isArray(data) ? data[0] : data) as LiveCard | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/** The team board with no caller check (rollcall_team_board_svc, 0242, service role only), or
 *  null when it cannot be read. A card without a team count is the old card, never a failure. */
export async function loadTeamBoard(svc: SupabaseClient, instanceId: string): Promise<TeamBoard | null> {
  try {
    const { data, error } = await svc.rpc('rollcall_team_board_svc', { p_instance: instanceId });
    if (error || !data || typeof data !== 'object') return null;
    return data as TeamBoard;
  } catch {
    return null;
  }
}

/** Where a card posts its check-in: the public roll-call-ack function. "" when unknown. */
export function ackUrlFor(supabaseUrl: string): string {
  return supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/roll-call-ack` : '';
}

/** One WINDOW code per athlete for this card's window (rollcall-code.ts signWindowCode), for the
 *  start attributes. Empty when the secret is unset or the card has no close. */
export async function windowCodesFor(
  secret: string, card: LiveCard, athleteIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const w = liveWindowMs(card);
  if (!secret || !w) return out;
  for (const id of new Set(athleteIds)) {
    out.set(id, await signWindowCode(secret, { instanceId: card.instance_id, athleteId: id, opensMs: w.opensMs, closesMs: w.closesMs }));
  }
  return out;
}

/** Send precomputed `update`s (the team-count fan-out, roll-call-ack teamCountUpdates) to update
 *  tokens. No alert, never a start, never throws; a dead token is revoked. Every one of these is a
 *  COUNT update for a teammate, so it goes at APNs priority 5 (livePriority, final review I3). */
export async function sendLiveUpdates(
  svc: SupabaseClient, apns: ApnsClient,
  updates: Array<{ token: string; state: LiveContentState }>, nowMs: number,
): Promise<{ updated: number; revoked: number; skipped: number }> {
  const out = { updated: 0, revoked: 0, skipped: 0 };
  for (const u of updates) {
    const payload = u.state.phase === 'answered' ? liveAnsweredUpdate(u.state, nowMs) : liveUpdatePayload(u.state, nowMs);
    try {
      const res = await apns.send(u.token, payload, nowMs, livePriority('team_count'));
      if (res.ok) out.updated++;
      else if (res.gone) {
        out.revoked++;
        try { await svc.rpc('revoke_live_activity_token', { p_token: u.token }); } catch { /* best effort */ }
      } else out.skipped++;
    } catch { out.skipped++; }
  }
  return out;
}
