// OnStandard — record a lock-screen "I'm Up". Public (no JWT): the signed code IS the credential.
// Deploy: supabase functions deploy roll-call-ack --use-api --no-verify-jwt
//         supabase secrets set ROLLCALL_ACK_SECRET=<long random string>
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { verifyRollCallCode } from '../_shared/rollcall-code.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import { httpStatusFor } from './logic.ts';
import { ApnsClient, apnsFromEnv } from '../_shared/apns.ts';
import { pushLiveActivity, loadLiveCard } from '../_shared/rollcall-live-send.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('ROLLCALL_ACK_SECRET') ?? '';
const GRACE_MS = 10 * 60 * 1000;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !SECRET) return json({ ok: false, error: 'not configured' }, 500);

  let code = '';
  // The moment of the tap on the DEVICE clock, sent by the app (live or replayed from its offline
  // queue). Evidence only: the server's own receipt is the verdict's input. Unparseable = absent.
  let tappedAt: string | null = null;
  try {
    const body = (await req.json()) as { code?: unknown; tapped_at?: unknown };
    code = String(body.code ?? '');
    if (typeof body.tapped_at === 'string' && Number.isFinite(Date.parse(body.tapped_at))) tappedAt = new Date(Date.parse(body.tapped_at)).toISOString();
    else if (typeof body.tapped_at === 'number' && Number.isFinite(body.tapped_at)) tappedAt = new Date(body.tapped_at).toISOString();
  } catch { /* empty */ }
  if (!code) return json({ ok: false, error: 'missing code' }, 400);

  // 'athlete' is passed explicitly, not left to the default: this endpoint acks ONE athlete for
  // themselves, and a coach code (a strictly wider credential minted from the same secret) must be
  // refused here even though it verifies. Naming the kind at the call site keeps that deliberate.
  const v = await verifyRollCallCode(SECRET, code, Date.now(), GRACE_MS, 'athlete');
  if (!v.ok) return json({ ok: false, error: v.reason }, httpStatusFor(v.reason));

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Kill switch — fail OPEN on a missing row (0141 convention).
  const { data: flag } = await svc
    .from('feature_flags').select('*').eq('name', 'rollcall_lockscreen').maybeSingle();
  if (flag && !evaluateFlag(flag as FlagRow, { userId: v.claims.athleteId })) {
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
  // The Live Activity is still on the lock screen counting down. Close the loop on it immediately:
  // the card becomes the answered state and ends, so the athlete's own screen confirms the tap
  // rather than continuing to count toward a deadline they have already met. No alert — the
  // athlete is holding the phone, and lighting it up to tell them what they just did is noise.
  //
  // Deliberately AFTER the ack is recorded and never able to fail it: a Live Activity that cannot
  // be updated is a cosmetic problem, and the answer is already durable.
  try {
    const apnsCfg = apnsFromEnv((k) => Deno.env.get(k));
    if (apnsCfg) {
      const card = await loadLiveCard(svc, v.claims.instanceId);
      if (card) {
        const at = typeof data === 'string' ? data : new Date().toISOString();
        await pushLiveActivity({
          svc, apns: new ApnsClient(apnsCfg), card, phase: 'answered',
          athleteIds: [v.claims.athleteId],
          checkedInAt: new Map([[v.claims.athleteId, at]]),
        });
      }
    }
  } catch { /* never let the card cost us the ack */ }

  return json({ ok: true, acknowledged_at: data });
});
