// OnStandard — record a lock-screen "I'm Up". Public (no JWT): the signed code IS the credential.
// Deploy: supabase functions deploy roll-call-ack --use-api --no-verify-jwt
//         supabase secrets set ROLLCALL_ACK_SECRET=<long random string>
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { verifyRollCallCode } from '../_shared/rollcall-code.ts';
import { evaluateFlag, type FlagRow } from '../_shared/feature-flags.ts';
import { httpStatusFor } from './logic.ts';

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
  try { code = String(((await req.json()) as { code?: unknown }).code ?? ''); } catch { /* empty */ }
  if (!code) return json({ ok: false, error: 'missing code' }, 400);

  const v = await verifyRollCallCode(SECRET, code, Date.now(), GRACE_MS);
  if (!v.ok) return json({ ok: false, error: v.reason }, httpStatusFor(v.reason));

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Kill switch — fail OPEN on a missing row (0141 convention).
  const { data: flag } = await svc
    .from('feature_flags').select('*').eq('name', 'rollcall_lockscreen').maybeSingle();
  if (flag && !evaluateFlag(flag as FlagRow, { userId: v.claims.athleteId })) {
    return json({ ok: false, error: 'flag_off' }, httpStatusFor('flag_off'));
  }

  const { data, error } = await svc.rpc('ack_commitment_by_token', {
    p_instance: v.claims.instanceId, p_athlete: v.claims.athleteId,
  });
  if (error) {
    // "no commitment for this athlete on this instance" -> the row is gone / not theirs.
    return json({ ok: false, error: 'no_row' }, httpStatusFor('no_row'));
  }
  return json({ ok: true, acknowledged_at: data });
});
