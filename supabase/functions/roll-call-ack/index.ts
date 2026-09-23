// OnStandard — record a lock-screen "I'm Up". Public (no JWT): the signed code IS the credential.
// Deploy: supabase functions deploy roll-call-ack --use-api --no-verify-jwt
//         supabase secrets set ROLLCALL_ACK_SECRET=<long random string>
//
// TWO ROUTES (2026-09-23):
//   { code, tapped_at }   the check-in. The code is a one-shot push code or a WINDOW code (the one
//                         the Live Activity and the alarm hold so the tap posts with the app closed).
//   { action: 'codes' }   the mint. Authorization: Bearer <the athlete's own session JWT>. Returns
//                         window codes for the caller's own wake-ups over the next 7 days, plus the
//                         URL to post them to, so the app can hand them to the native alarm.
//                         --no-verify-jwt stays: this route verifies the JWT itself (auth.getUser).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { verifyRollCallCode, signWindowCode } from '../_shared/rollcall-code.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import {
  httpStatusFor, teamCountUpdates, mintableWindows, bearerOf, WINDOW_CODE_DAYS, TEAM_UPDATE_MIN_GAP_MS,
  type TeamTarget,
} from './logic.ts';
import { ApnsClient, apnsFromEnv } from '../_shared/apns.ts';
import { pushLiveActivity, loadLiveCard, loadTeamBoard, sendLiveUpdates, ackUrlFor } from '../_shared/rollcall-live-send.ts';
import { teamFields } from '../_shared/rollcall-live.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('ROLLCALL_ACK_SECRET') ?? '';
const GRACE_MS = 10 * 60 * 1000;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** Kill switch — fail OPEN on a missing row (0141 convention). */
async function flagAllows(svc: SupabaseClient, userId: string): Promise<boolean> {
  const { data: flag } = await svc
    .from('feature_flags').select('*').eq('name', 'rollcall_lockscreen').maybeSingle();
  return !(flag && !evaluateFlag(flag as FlagRow, { userId }));
}

/** The mint (ruling R1): window codes for the caller's OWN wake-ups. The user id comes from the
 *  verified JWT and nowhere else; the body names no athlete and no instance. */
async function mintCodes(req: Request): Promise<Response> {
  const jwt = bearerOf(req.headers.get('Authorization'));
  if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await svc.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (authErr || !uid) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!(await flagAllows(svc, uid))) return json({ ok: false, error: 'flag_off' }, httpStatusFor('flag_off'));

  const { data: rows, error } = await svc.rpc('rollcall_window_rows_svc', { p_athlete: uid, p_days: WINDOW_CODE_DAYS });
  if (error) return json({ ok: false, error: 'db_error' }, httpStatusFor('db_error'));
  const nowMs = Date.now();
  const windows = mintableWindows(
    (Array.isArray(rows) ? rows : []) as Array<{ instance_id: string; opens_at: string | null; closes_at: string | null }>, nowMs,
  );
  const codes: Array<{ instance_id: string; code: string; opens_at: string; closes_at: string }> = [];
  for (const w of windows) {
    codes.push({
      instance_id: w.instance_id,
      code: await signWindowCode(SECRET, { instanceId: w.instance_id, athleteId: uid, opensMs: w.opensMs, closesMs: w.closesMs }),
      opens_at: new Date(w.opensMs).toISOString(),
      closes_at: new Date(w.closesMs).toISOString(),
    });
  }
  return json({ ok: true, ack_url: ackUrlFor(SUPABASE_URL), codes });
}

/** Everything the lock screen does after a check-in. Never throws, never costs the ack.
 *   1. The athlete's own card UPDATES to answered (place, points, the team count) and STAYS until
 *      the close, instead of ending. No alert: they are holding the phone.
 *   2. Every teammate with a live card gets the new count, at most once a minute each, never the
 *      athlete who just checked in (they had theirs in step 1). */
async function liveAfterCheckIn(svc: SupabaseClient, instanceId: string, athleteId: string, ackIso: string): Promise<void> {
  const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));
  if (!apnsCfg) return;
  const apns = new ApnsClient(apnsCfg);
  const card = await loadLiveCard(svc, instanceId);
  if (!card) return;
  const board = await loadTeamBoard(svc, instanceId);
  const nowMs = Date.now();

  await pushLiveActivity({
    svc, apns, card, phase: 'answered',
    athleteIds: [athleteId],
    checkedInAt: new Map([[athleteId, ackIso]]),
    team: (id) => teamFields(board, id),
    nowMs,
  });
  // Stamp their card so a teammate's check-in a second later does not update it again at once.
  try { await svc.rpc('claim_live_team_updates', { p_instance: instanceId, p_athletes: [athleteId], p_gap_sec: 0 }); } catch { /* best effort */ }

  if (!board) return;
  const { data: tg } = await svc.rpc('rollcall_live_update_targets', { p_instance: instanceId });
  const planned = teamCountUpdates(instanceId, board, {
    targets: (Array.isArray(tg) ? tg : []) as TeamTarget[], card, checkedIn: athleteId, nowMs,
  });
  if (!planned.length) return;
  // The pure plan read last_update_at; the claim re-checks it atomically, so two check-ins in the
  // same second cannot both update one card. Only the athletes the claim returns are sent.
  const { data: won } = await svc.rpc('claim_live_team_updates', {
    p_instance: instanceId, p_athletes: planned.map((u) => u.athleteId),
    p_gap_sec: Math.round(TEAM_UPDATE_MIN_GAP_MS / 1000),
  });
  const wonSet = new Set((Array.isArray(won) ? won : []).map((x: unknown) =>
    typeof x === 'string' ? x : String(Object.values((x ?? {}) as Record<string, unknown>)[0] ?? '')));
  await sendLiveUpdates(svc, apns, planned.filter((u) => wonSet.has(u.athleteId)), nowMs);
}

/** Run after the response when the runtime allows it (Supabase EdgeRuntime.waitUntil), so a
 *  60-athlete fan-out never holds the lock-screen tap's HTTP answer open. Awaited otherwise. */
async function afterResponse(p: Promise<void>): Promise<void> {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const safe = p.catch(() => { /* never let the card cost us the ack */ });
  if (rt?.waitUntil) { rt.waitUntil(safe); return; }
  await safe;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !SECRET) return json({ ok: false, error: 'not configured' }, 500);

  let code = '';
  // The moment of the tap on the DEVICE clock, sent by the app (live or replayed from its offline
  // queue). Evidence only: the server's own receipt is the verdict's input. Unparseable = absent.
  let tappedAt: string | null = null;
  let action = '';
  try {
    const body = (await req.json()) as { code?: unknown; tapped_at?: unknown; action?: unknown };
    action = typeof body.action === 'string' ? body.action : '';
    code = String(body.code ?? '');
    if (typeof body.tapped_at === 'string' && Number.isFinite(Date.parse(body.tapped_at))) tappedAt = new Date(Date.parse(body.tapped_at)).toISOString();
    else if (typeof body.tapped_at === 'number' && Number.isFinite(body.tapped_at)) tappedAt = new Date(body.tapped_at).toISOString();
  } catch { /* empty */ }
  if (action === 'codes') return mintCodes(req);
  if (!code) return json({ ok: false, error: 'missing code' }, 400);

  // 'athlete' is passed explicitly, not left to the default: this endpoint acks ONE athlete for
  // themselves, and a coach code (a strictly wider credential minted from the same secret) must be
  // refused here even though it verifies. Naming the kind at the call site keeps that deliberate.
  const v = await verifyRollCallCode(SECRET, code, Date.now(), GRACE_MS, 'athlete');
  if (!v.ok) return json({ ok: false, error: v.reason }, httpStatusFor(v.reason));

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Kill switch — fail OPEN on a missing row (0141 convention).
  if (!(await flagAllows(svc, v.claims.athleteId))) {
    return json({ ok: false, error: 'flag_off' }, httpStatusFor('flag_off'));
  }

  // The code's mint time bounds the device claim: a phone cannot have tapped a notification that
  // did not exist yet. The RPC applies the bound, records both stamps, and opens a review when the
  // receipt crossed a boundary the evidence did not (0212).
  const { data, error } = await svc.rpc('ack_commitment_by_token', {
    p_instance: v.claims.instanceId, p_athlete: v.claims.athleteId,
    p_tapped_at: tappedAt, p_code_iat: new Date(v.claims.iatMs).toISOString(),
  });
  if (error) {
    // The RPC raises "no commitment for this athlete on this instance" when the row is gone / not
    // theirs (a 404). Any other error is a real DB failure and must surface as 500, not be masked.
    const msg = error.message ?? '';
    // Window refusals (0211/0212) are decided answers: 410 so the device drops the queued tap.
    if (/closed|not open yet|cancelled/i.test(msg)) return json({ ok: false, error: 'closed' }, 410);
    const reason = /no commitment/i.test(msg) ? 'no_row' : 'db_error';
    return json({ ok: false, error: reason }, httpStatusFor(reason));
  }
  // The Live Activity: the athlete's own card turns answered and STAYS (it used to end here); the
  // team's counts move. Deliberately AFTER the ack is recorded and never able to fail it: a Live
  // Activity that cannot be updated is a cosmetic problem, and the answer is already durable.
  const at = typeof data === 'string' ? data : new Date().toISOString();
  await afterResponse(liveAfterCheckIn(svc, v.claims.instanceId, v.claims.athleteId, at));

  return json({ ok: true, acknowledged_at: data });
});
