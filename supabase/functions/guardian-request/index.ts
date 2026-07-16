// OnStandard — guardian-request: records a minor's guardian-consent request AND emails the
// guardian the verification link. This is the missing "email sender" half of the COPPA / GDPR-K
// verifiable-parental-consent flow: migration 0008 records the row + opaque token, guardian-verify
// confirms the click, and THIS function is what actually delivers the link to the guardian.
//
// Flow: the signed-in minor athlete's app calls this with the guardian's email. We (1) verify the
// caller, (2) record/rotate the pending request via the existing request_guardian_consent RPC
// (auth.uid() inside the RPC = the minor, so it can only request for themselves), (3) read the
// fresh token with the service role, (4) email the guardian a link to guardian-verify. The minor's
// real data stays on-device until the guardian clicks it (consent.ts fails closed until
// guardianStatus = 'verified').
//
// DEPLOY (founder, go-live):
//   supabase secrets set RESEND_API_KEY=re_...                                   # your email vendor
//   supabase secrets set GUARDIAN_EMAIL_FROM="OnStandard <support@onstandard.app>"  # a VERIFIED sender
//   supabase functions deploy guardian-request
//   # guardian-verify must also be deployed (it is what the emailed link points to).
//
// SAFE BEFORE THE KEY IS SET: with no RESEND_API_KEY the request is still recorded and the function
// returns { ok:true, emailed:false } — nothing breaks; adding the key lights up delivery. NOTE: an
// email vendor is a NEW SUBPROCESSOR — list it in privacy policy §7 and sign its DPA before relying
// on it (it receives the guardian's email address).
import { createClient } from 'npm:@supabase/supabase-js@^2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('GUARDIAN_EMAIL_FROM') ?? 'OnStandard <support@onstandard.app>';
// Where guardian-verify lives (override if you serve it on a custom domain).
const VERIFY_BASE = Deno.env.get('GUARDIAN_VERIFY_URL') ?? (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/guardian-verify` : '');

// CORS (mirror billing-portal): reflect an allowlisted browser Origin; a native app sends none.
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

  // Verified signed-in minor only (functions.invoke forwards their JWT).
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'sign in required' }, 401, cors);

  let body: { guardian_email?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400, cors); }
  const email = (body.guardian_email ?? '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid guardian email' }, 400, cors);

  // 1) Resolve the caller and record/rotate the pending request via the existing RPC (auth.uid()
  //    inside the RPC is the minor; it validates the email + rotates the token).
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userErr } = await caller.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'sign in required' }, 401, cors);
  const uid = userData.user.id;
  const { error: rpcErr } = await caller.rpc('request_guardian_consent', { guardian_email: email });
  if (rpcErr) return json({ error: 'could not record request' }, 500, cors);

  // 2) Read the fresh token with the service role (do not depend on the minor's read scope).
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: row, error: tokErr } = await svc.from('guardian_consent_requests')
    .select('token').eq('athlete_id', uid).eq('guardian_email', email).maybeSingle();
  if (tokErr || !row?.token) return json({ error: 'could not prepare verification' }, 500, cors);

  // 3) Email the guardian the verify link — only if an email vendor is configured. Without one the
  //    request is still recorded (emailed:false); the founder can wire the key later without a redeploy.
  if (!RESEND_API_KEY || !VERIFY_BASE) return json({ ok: true, emailed: false, reason: 'email vendor not configured' }, 200, cors);
  const link = `${VERIFY_BASE}?token=${encodeURIComponent(row.token)}`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#0F172A;line-height:1.5">
    <p>An OnStandard athlete listed you as their parent or guardian. Before any of their nutrition data can be shared with their coach, we need your approval.</p>
    <p><a href="${esc(link)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;border-radius:12px;padding:12px 22px;font-weight:700">Review &amp; approve</a></p>
    <p style="color:#64748B;font-size:13px">If you did not expect this, you can ignore this email — nothing is shared until you approve. Questions: support@onstandard.app</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: 'Approve your athlete on OnStandard', html }),
    });
    if (!r.ok) { console.error('guardian-request email failed:', r.status); return json({ ok: true, emailed: false, reason: 'email send failed' }, 200, cors); }
  } catch (e) {
    console.error('guardian-request email error:', e);
    return json({ ok: true, emailed: false, reason: 'email send error' }, 200, cors);
  }
  return json({ ok: true, emailed: true }, 200, cors);
});
