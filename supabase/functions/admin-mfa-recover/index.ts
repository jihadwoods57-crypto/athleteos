// OnStandard — admin-mfa-recover: break-glass MFA recovery for the Command Center.
//
// Two factors still required: the caller's aal1 session (proves the PASSWORD; verify_jwt=true) AND a
// valid one-time recovery code. On success we remove the caller's TOTP factor(s) so they can re-enroll
// a fresh authenticator, and audit it. The alert (email+push) is added by Plan 2 (admin-alert).
//
// Deploy:
//   supabase functions deploy admin-mfa-recover
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { parseRecoverBody } from './logic.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ALERT_KEY = Deno.env.get('ALERT_KEY') ?? '';
const FUNCTIONS_BASE = Deno.env.get('FUNCTIONS_BASE') ?? `${SUPABASE_URL}/functions/v1`;

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++;
  return e.count > 8;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (rateLimited(req)) return json(429, { error: 'rate limited' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json(500, { error: 'misconfigured' });

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return json(401, { error: 'unauthenticated' });

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json(401, { error: 'unauthenticated' });

  // caller must be on the platform-admin allowlist (checked at aal1 — recovery precedes MFA)
  const { data: allowed, error: aErr } = await asUser.rpc('admin_self_is_allowlisted');
  if (aErr || allowed !== true) return json(403, { error: 'not authorized' });

  const parsed = parseRecoverBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return json(400, { error: parsed.error });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: ok, error: vErr } = await svc.rpc('admin_verify_recovery_code', { p_user: u.user.id, p_code: parsed.code });
  if (vErr) return json(500, { error: 'verify failed' });
  if (ok !== true) return json(403, { error: 'invalid or used code' });

  // remove the user's TOTP factors so they re-enroll fresh
  try {
    const { data: fl } = await svc.auth.admin.mfa.listFactors({ userId: u.user.id });
    for (const f of fl?.factors ?? []) {
      await svc.auth.admin.mfa.deleteFactor({ userId: u.user.id, id: f.id });
    }
  } catch (_e) { /* best-effort; the code is already consumed */ }

  await svc.from('admin_audit_log').insert({ actor_id: u.user.id, action: 'recovery.used', target: u.user.id });

  // fire-and-forget alert (Plan 2 admin-alert). No-op if ALERT_KEY unset.
  if (ALERT_KEY) {
    try {
      await fetch(`${FUNCTIONS_BASE}/admin-alert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-alert-key': ALERT_KEY },
        body: JSON.stringify({
          kind: 'recovery_used', subject: 'Command Center recovery code used',
          body: 'A recovery code was used to reset two-factor authentication on your admin account. Your authenticator app has been unlinked — set up a new one the next time you sign in.',
          details: [{ label: 'Account', value: u.user.email ?? u.user.id }],
          actionUrl: 'https://onstandard-admin.gelatinous-twin.workers.dev/',
        }),
      });
    } catch (_e) { /* alerting is best-effort */ }
  }

  return json(200, { ok: true });
});
