// OnStandard — guardian-consent verify endpoint (Supabase / Deno). The parent/guardian receives an
// email (sent by the chosen email sender from an Edge Function at request time) with a link to:
//     https://<project>.functions.supabase.co/guardian-verify?token=<token>
// Clicking it shows a confirm page; pressing "Approve" marks the matching guardian_consent_requests
// row 'verified'. That flips the minor's guardianStatus to 'verified' (read back by
// hydrateGuardianConsent / G2), which is the ONLY thing that lets a minor's real data sync
// (consent.ts realDataConsent fails closed until then).
//
// SECURITY:
//   - Uses the SERVICE_ROLE key (a secret, never in the app bundle) so it can set 'verified' —
//     which RLS forbids everyone else, including the athlete. This matches migration 0008's design
//     ("verified set ONLY by the service_role verify endpoint; a minor can never self-verify").
//   - Possession of the opaque token (delivered only to the guardian's email address) is the proof
//     of control of that mailbox — the lightweight parental-consent mechanism (the app bars
//     under-13 at signup, so COPPA's heavyweight VPC is out of scope; counsel blesses this flow).
//   - Two-step (GET shows a page, POST does the write) so an email client PREFETCHING the link can
//     never auto-approve. The write is idempotent: a second approval reads as already-approved.
//
// Deploy:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service role key>   (SUPABASE_URL is auto-injected)
//   supabase functions deploy guardian-verify --no-verify-jwt
// INERT until deployed AND the request_guardian_consent email step points its link here.
import { createClient } from 'npm:@supabase/supabase-js@^2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// The token is an opaque server-generated id: encode(gen_random_bytes(16),'hex') = 32 hex chars
// (migration 0008). Anything outside this charset is malformed/hostile and is rejected BEFORE it
// can be reflected into the page — the primary guard against reflected XSS via the token param.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

// Defense-in-depth: escape any value interpolated into HTML so a stray character can never break
// out of an attribute or open a tag, even if a future caller forgets to pre-validate.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(status: number, title: string, body: string, button?: { token: string }): Response {
  const action = button
    ? `<form method="POST"><input type="hidden" name="token" value="${esc(button.token)}"/>
         <button type="submit" style="margin-top:20px;background:#2563EB;color:#fff;border:0;border-radius:14px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer">Approve</button>
       </form>`
    : '';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>OnStandard</title></head>
    <body style="font-family:system-ui,-apple-system,sans-serif;background:#F8FAFC;color:#0F172A;margin:0;padding:48px 24px;text-align:center">
      <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:24px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,.06)">
        <div style="font-weight:800;font-size:20px;color:#2563EB;margin-bottom:8px">OnStandard</div>
        <h1 style="font-size:22px;margin:12px 0">${title}</h1>
        <p style="font-size:15px;color:#64748B;line-height:1.5">${body}</p>
        ${action}
      </div>
    </body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return page(500, 'Not configured', 'This approval endpoint is not set up yet.');

  // Read the token from the query (GET) or the form body (POST).
  const url = new URL(request.url);
  let token = url.searchParams.get('token') ?? '';
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    token = (form?.get('token')?.toString() ?? token).trim();
  }
  if (!token) return page(400, 'Invalid link', 'This approval link is missing its token.');
  // Reject a malformed token before it is ever reflected into the page or hits the DB.
  if (!TOKEN_RE.test(token)) return page(400, 'Invalid link', 'This approval link is malformed.');

  // GET: show the confirm page (no write — prevents email-prefetch auto-approval).
  if (request.method !== 'POST') {
    return page(200, 'Approve this account?', 'Press Approve to confirm you are this athlete’s parent or guardian and consent to their nutrition data being shared with their coach.', { token });
  }

  // POST: do the verification with the service role (bypasses RLS to set 'verified').
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('guardian_consent_requests')
    .update({ status: 'verified', verified_at: new Date().toISOString() })
    .eq('token', token)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) return page(500, 'Something went wrong', 'Please try again in a moment, or contact support.');
  if (data) return page(200, 'Approved', 'Thank you. Your athlete’s account is approved, and their data can now be shared with their coach. You can close this page.');

  // No pending row matched: either already approved (idempotent success) or an expired/used token.
  const { data: existing } = await supabase.from('guardian_consent_requests').select('status').eq('token', token).maybeSingle();
  if (existing?.status === 'verified') return page(200, 'Already approved', 'Thanks — this account is already approved. You can close this page.');
  return page(400, 'Link expired', 'This approval link is no longer valid. Ask your athlete to resend the approval request from the app.');
});
