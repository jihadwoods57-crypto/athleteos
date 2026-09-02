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
  liveStartPayload, liveUpdatePayload, liveEndPayload, liveContentState,
  type LiveAttributes, type LivePhase, type LiveAlert,
} from './rollcall-live.ts';

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
};

type Target = { athlete_id: string; start_token: string | null; update_token: string | null };

/** First letter of the first two words, upper-cased. Mirrors the proto's initials() closely enough
 *  for a 30-point circle; the widget only ever shows it when no photo has been cached. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function attributesFor(card: LiveCard): LiveAttributes {
  return {
    instanceId: card.instance_id,
    title: card.title || 'Wake-Up Roll Call',
    coachName: card.coach_name || '',
    coachInitials: initialsOf(card.coach_name),
  };
}

/**
 * Push one phase to every athlete in the list who has an iPhone registered for it.
 *
 * `phase` decides which payload: no activity yet plus phase 'initial' starts one; an existing
 * activity is updated; 'answered' and 'missed' END it. Returns counts, never throws: a roll call
 * is not allowed to fail because Apple had a bad minute.
 */
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
}): Promise<{ started: number; updated: number; ended: number; revoked: number; skipped: number }> {
  const { svc, apns, card, athleteIds, phase, alert } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const out = { started: 0, updated: 0, ended: 0, revoked: 0, skipped: 0 };
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

  const attrs = attributesFor(card);
  const ending = phase === 'answered' || phase === 'missed';

  for (const t of targets) {
    const state = liveContentState(card, phase, opts.checkedInAt?.get(t.athlete_id) ?? null);

    // Which token, and therefore which event. An update token means the activity already exists.
    let token: string | null = t.update_token;
    let payload: Record<string, unknown>;
    if (token) {
      payload = ending ? liveEndPayload(state, nowMs) : liveUpdatePayload(state, nowMs, alert);
    } else if (phase === 'initial' && t.start_token) {
      // Only the OPEN push may start an activity. Starting one at REMINDER would put a card on the
      // lock screen of an athlete who has already been reminded once with nothing on it, and
      // starting one at LATE would be the app announcing itself at the worst possible moment.
      token = t.start_token;
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
