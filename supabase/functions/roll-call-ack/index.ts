// OnStandard — record a lock-screen "I'm Up". Public (no JWT): the signed code IS the credential.
// Deploy: supabase functions deploy roll-call-ack --use-api --no-verify-jwt
//         supabase secrets set ROLLCALL_ACK_SECRET=<long random string>
//
// THREE ROUTES (2026-09-23):
//   { code, tapped_at }   the check-in. The code is a one-shot push code or a WINDOW code (the one
//                         the Live Activity and the alarm hold so the tap posts with the app closed).
//   { action: 'codes' }   the mint. Authorization: Bearer <the athlete's own session JWT>. Returns
//                         window codes for the caller's own wake-ups over the next 7 days, plus the
//                         URL to post them to, so the app can hand them to the native alarm.
//                         --no-verify-jwt stays: this route verifies the JWT itself (auth.getUser).
//   { action: 'refresh', instance_id }   Authorization: Bearer <the athlete's own session JWT>.
//                         An answer recorded WITHOUT a code (the app's drain, an in-app "I'm up",
//                         any older binary) sends no push, so the lock-screen card kept counting
//                         down until the close. This sends the same answered update and team
//                         fan-out a code ack does: the caller's own row only, and only once it has
//                         an answer. Once per card (claim_live_answered_update), never held back by
//                         a teammate's count update. Answers { ok, result } with result one of
//                         sent | already_answered | no_token | no_card | unavailable, so the phone
//                         knows whether to end its card itself.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0';
import { verifyRollCallCode, signWindowCode } from '../_shared/rollcall-code.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import {
  httpStatusFor, teamCountUpdates, mintableWindows, bearerOf, WINDOW_CODE_DAYS, TEAM_UPDATE_MIN_GAP_MS,
  refreshInstanceOf, refreshVerdict, wonAthleteIds,
  answeredClaimOf, fansOutTeam, runOwnCard, runTeamFanOut,
  type TeamTarget, type OwnCardResult,
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

/** The refresh: the answered card for an answer that came through ack_commitment. The athlete id
 *  comes from the verified JWT and nowhere else; the body only names the instance. */
async function refreshCard(req: Request, body: unknown): Promise<Response> {
  const jwt = bearerOf(req.headers.get('Authorization'));
  if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401);
  const instanceId = refreshInstanceOf(body);
  if (!instanceId) return json({ ok: false, error: 'missing instance' }, 400);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await svc.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (authErr || !uid) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!(await flagAllows(svc, uid))) return json({ ok: false, error: 'flag_off' }, httpStatusFor('flag_off'));

  const { data: row, error } = await svc
    .from('commitment_responses').select('acknowledged_at')
    .eq('instance_id', instanceId).eq('athlete_id', uid).maybeSingle();
  if (error) return json({ ok: false, error: 'db_error' }, httpStatusFor('db_error'));
  const verdict = refreshVerdict(row as { acknowledged_at: string | null } | null);
  if (verdict === 'no_row') return json({ ok: false, error: 'no_row' }, httpStatusFor('no_row'));
  if (verdict === 'not_acked') return json({ ok: false, error: 'not_acked' }, 409);

  const ackIso = String((row as { acknowledged_at: string }).acknowledged_at);
  const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));
  const apns = apnsCfg ? new ApnsClient(apnsCfg) : null;
  const card = apns ? await loadLiveCard(svc, instanceId) : null;
  // The own card is awaited: its result IS the answer. The team fan-out runs after the response.
  const result = await answeredOwnCard(svc, apns, card, instanceId, uid, ackIso);
  if (apns && card && fansOutTeam(result)) await afterResponse(teamFanOut(svc, apns, card, instanceId, uid));
  return json({ ok: true, result });
}

/** The athlete's OWN card turns answered (place, points, the team count) and STAYS until the
 *  close. Claimed once per card (claim_live_answered_update), independent of the team-count
 *  throttle: a teammate's count update carries this athlete's OLD phase, so if the answered
 *  transition waited on that stamp the card sat on I'M UP (Task 5 fix round 2). Never throws. */
async function answeredOwnCard(
  svc: SupabaseClient, apns: ApnsClient | null, card: Awaited<ReturnType<typeof loadLiveCard>>,
  instanceId: string, athleteId: string, ackIso: string,
): Promise<OwnCardResult> {
  // runOwnCard (logic.ts) owns the rule: a claimed card whose push reached no device, or threw on
  // the way, is released so a later refresh can send it.
  return await runOwnCard({ apns: !!apns, card: !!card }, {
    claim: async () => {
      const { data, error } = await svc.rpc('claim_live_answered_update', { p_instance: instanceId, p_athlete: athleteId });
      return answeredClaimOf(data, error);
    },
    push: async () => {
      // Built after the ack, so its timestamp is newer than any count push built from a board
      // read before the ack (runTeamFanOut stamps those with their read time).
      const builtAt = Date.now();
      const board = await loadTeamBoard(svc, instanceId);
      return await pushLiveActivity({
        svc, apns, card: card!, phase: 'answered',
        athleteIds: [athleteId],
        checkedInAt: new Map([[athleteId, ackIso]]),
        team: (id) => teamFields(board, id),
        nowMs: builtAt,
      });
    },
    release: async () => {
      await svc.rpc('release_live_answered_update', { p_instance: instanceId, p_athlete: athleteId });
    },
  });
}

/** Every teammate with a live card gets the new count, at most once a minute each, never the
 *  athlete who just checked in (they had theirs from answeredOwnCard). The APNs timestamp is the
 *  moment the board was READ (runTeamFanOut), so a stale count never overwrites a newer card. */
async function teamFanOut(
  svc: SupabaseClient, apns: ApnsClient, card: NonNullable<Awaited<ReturnType<typeof loadLiveCard>>>,
  instanceId: string, athleteId: string,
): Promise<void> {
  await runTeamFanOut({
    now: () => Date.now(),
    loadBoard: () => loadTeamBoard(svc, instanceId),
    loadTargets: async () => {
      const { data: tg } = await svc.rpc('rollcall_live_update_targets', { p_instance: instanceId });
      return (Array.isArray(tg) ? tg : []) as TeamTarget[];
    },
    plan: (board, targets, builtAt) => teamCountUpdates(instanceId, board, { targets, card, checkedIn: athleteId, nowMs: builtAt }),
    // The pure plan read last_update_at; the claim re-checks it atomically, so two check-ins in
    // the same second cannot both update one card. Only the athletes the claim returns are sent.
    claim: async (ids) => {
      const { data: won } = await svc.rpc('claim_live_team_updates', {
        p_instance: instanceId, p_athletes: ids, p_gap_sec: Math.round(TEAM_UPDATE_MIN_GAP_MS / 1000),
      });
      return wonAthleteIds(won);
    },
    send: (updates, builtAt) => sendLiveUpdates(svc, apns, updates, builtAt),
  });
}

/** Everything the lock screen does after a code check-in. Never throws, never costs the ack. The
 *  own card first; the team only when this answer was not already announced (a re-posted code
 *  used to push the athlete's card and the whole team's again on every post). */
async function liveAfterCheckIn(svc: SupabaseClient, instanceId: string, athleteId: string, ackIso: string): Promise<void> {
  const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));
  if (!apnsCfg) return;
  const apns = new ApnsClient(apnsCfg);
  const card = await loadLiveCard(svc, instanceId);
  if (!card) return;
  const result = await answeredOwnCard(svc, apns, card, instanceId, athleteId, ackIso);
  if (fansOutTeam(result)) await teamFanOut(svc, apns, card, instanceId, athleteId);
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
  let rawBody: unknown = null;
  try {
    const body = (await req.json()) as { code?: unknown; tapped_at?: unknown; action?: unknown };
    rawBody = body;
    action = typeof body.action === 'string' ? body.action : '';
    code = String(body.code ?? '');
    if (typeof body.tapped_at === 'string' && Number.isFinite(Date.parse(body.tapped_at))) tappedAt = new Date(Date.parse(body.tapped_at)).toISOString();
    else if (typeof body.tapped_at === 'number' && Number.isFinite(body.tapped_at)) tappedAt = new Date(body.tapped_at).toISOString();
  } catch { /* empty */ }
  if (action === 'codes') return mintCodes(req);
  if (action === 'refresh') return refreshCard(req, rawBody);
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
