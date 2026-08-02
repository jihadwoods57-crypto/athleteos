// OnStandard — send-verify-email: the missing "email sender" half of custom email verification
// (2026-08-02). Mirrors guardian-request exactly (same shape, same safety properties): the
// signed-in caller invokes this, it calls request_email_verification() (records/rotates the
// token, throttled to one per 45s), reads the fresh token with the service role, and emails a
// verify link. Built because prod now runs mailer_autoconfirm=true — GoTrue itself sends nothing
// and stamps every signup confirmed on arrival — so this IS the entire confirmation mechanism.
//
// DEPLOY:
//   supabase secrets set RESEND_API_KEY=re_...              # already set for guardian-request
//   supabase secrets set VERIFY_EMAIL_FROM="OnStandard <support@onstandard.app>"
//   supabase functions deploy send-verify-email
//   # verify-email must also be deployed — it is what the emailed link points to.
//
// SAFE BEFORE THE KEY IS SET: with no RESEND_API_KEY the token is still recorded and the function
// returns { ok:true, emailed:false } — nothing breaks; adding the key lights up delivery.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('VERIFY_EMAIL_FROM') ?? 'OnStandard <support@onstandard.app>';
const VERIFY_BASE = Deno.env.get('EMAIL_VERIFY_URL') ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/verify-email` : '');

// CORS (mirror guardian-request / billing-portal): reflect an allowlisted browser Origin; a
// native app sends none.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}
const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'sign in required' }, 401, cors);

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await caller.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'sign in required' }, 401, cors);
  const uid = userData.user.id;

  // request_email_verification() throttles to one per 45s and RAISEs a human-readable message
  // ("Wait 32 seconds before requesting another verification email.") — surfaced verbatim, this
  // is our own text, not GoTrue's server prose, so it needs no client-side re-mapping.
  const { error: rpcErr } = await caller.rpc('request_email_verification');
  if (rpcErr) {
    const msg = rpcErr.message || '';
    if (/wait \d+ seconds/i.test(msg)) return json({ error: msg }, 429, cors);
    return json({ error: 'could not start verification' }, 500, cors);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: row, error: tokErr } = await svc.from('email_verifications')
    .select('token, email').eq('user_id', uid).maybeSingle();
  // Already-verified accounts hit the RPC's silent no-op above and leave no fresh row to read —
  // that is success, not a failure to report.
  if (tokErr) return json({ error: 'could not prepare verification' }, 500, cors);
  if (!row?.token) return json({ ok: true, emailed: false, reason: 'already verified' }, 200, cors);

  if (!RESEND_API_KEY || !VERIFY_BASE) return json({ ok: true, emailed: false, reason: 'email vendor not configured' }, 200, cors);
  const link = `${VERIFY_BASE}?token=${encodeURIComponent(row.token)}`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#0F172A;line-height:1.5">
    <div style="height:4px;background:linear-gradient(120deg,#34D399,#22D3EE,#3B82F6);border-radius:2px;margin-bottom:18px"></div>
    <p style="margin:0 0 18px"><img src="https://onstandard.app/assets/brand/email-mark.png" width="30" height="30" alt="" style="vertical-align:middle;border-radius:9px"> <span style="font-size:17px;font-weight:800;letter-spacing:-.3px;vertical-align:middle"><span style="color:#0F172A">On</span><span style="color:#2563EB">Standard</span></span></p>
    <p>Confirm this is really your email address so your account stays yours.</p>
    <p><a href="${esc(link)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;border-radius:12px;padding:12px 22px;font-weight:700">Verify my email</a></p>
    <p style="color:#64748B;font-size:13px">This link expires in 24 hours. If you didn't create an OnStandard account, you can ignore this email. Questions: support@onstandard.app</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [row.email], subject: 'Verify your email — OnStandard', html }),
    });
    if (!r.ok) { console.error('send-verify-email failed:', r.status); return json({ ok: true, emailed: false, reason: 'email send failed' }, 200, cors); }
  } catch (e) {
    console.error('send-verify-email error:', e);
    return json({ ok: true, emailed: false, reason: 'email send error' }, 200, cors);
  }
  return json({ ok: true, emailed: true }, 200, cors);
});
