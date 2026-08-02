// OnStandard — email verification confirm endpoint (2026-08-02). The address owner receives an
// email (sent by send-verify-email) with a link to:
//     https://<project>.functions.supabase.co/verify-email?token=<token>
// Clicking it shows a confirm page; pressing "Verify" calls verify_email_token(token), which sets
// profiles.email_verified = true. Modeled directly on guardian-verify (same shape, same safety
// properties) — see that file's comment for the full reasoning; the short version:
//
//   - Uses the SERVICE_ROLE key so it can call verify_email_token, which is granted to
//     service_role ONLY (0176) — a signed-in user cannot verify by guessing/brute-forcing a token
//     even against their own account, because they cannot call the function at all.
//   - Possession of the opaque token (delivered only to that mailbox) is the proof of control.
//   - Two-step (GET shows a page, POST does the write) so an email client PREFETCHING the link
//     can never auto-verify. The write is idempotent: a second click reads as already-verified.
//
// Deploy:
//   supabase functions deploy verify-email --no-verify-jwt
// INERT until deployed AND send-verify-email points its link here (EMAIL_VERIFY_URL).
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { clientIpFrom } from '../_shared/client-ip.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// The token is an opaque server-generated id: encode(gen_random_bytes(16),'hex') = 32 hex chars
// (0176, same shape as guardian consent's token). Reject anything outside this charset BEFORE it
// can be reflected into the page — the primary guard against reflected XSS via the token param.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

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
         <button type="submit" style="margin-top:20px;background:#2563EB;color:#fff;border:0;border-radius:14px;padding:15px 26px;font-size:16px;font-weight:700;cursor:pointer">Verify my email</button>
       </form>`
    : '';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>OnStandard</title></head>
    <body style="font-family:system-ui,-apple-system,sans-serif;background:#F8FAFC;color:#0F172A;margin:0;padding:48px 24px;text-align:center">
      <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:24px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,.06)">
        <div style="margin-bottom:8px">
          <!-- Performance Dial, on-light flat variant (brand law, docs/brand/LOGO.md) -->
          <svg width="44" height="44" viewBox="0 0 100 100" fill="none" style="vertical-align:middle" aria-hidden="true">
            <defs><linearGradient id="veDial" x1="26" y1="82" x2="58" y2="18" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#34D399"/><stop offset="50%" stop-color="#22D3EE"/><stop offset="100%" stop-color="#3B82F6"/>
            </linearGradient></defs>
            <path d="M33 81.4 A34 34 0 1 1 67 81.4" stroke="#DCE7FB" stroke-width="12" stroke-linecap="round"/>
            <path d="M33 81.4 A34 34 0 0 1 50 18" stroke="url(#veDial)" stroke-width="12" stroke-linecap="round"/>
            <circle cx="50" cy="18" r="10.5" fill="#FFFFFF" stroke="#DBEAFE" stroke-width="1.5"/>
            <circle cx="50" cy="18" r="6" fill="#2563EB"/>
          </svg>
          <div style="font-weight:800;font-size:20px;letter-spacing:-.3px;margin-top:6px"><span style="color:#0F172A">On</span><span style="color:#2563EB">Standard</span></div>
        </div>
        <h1 style="font-size:22px;margin:12px 0">${title}</h1>
        <p style="font-size:15px;color:#64748B;line-height:1.5">${body}</p>
        ${action}
      </div>
    </body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Best-effort per-IP rate limit on the write path (mirrors guardian-verify). In-memory +
// per-isolate (resets on cold start).
const RL_MAX = Number(Deno.env.get('EMAIL_VERIFY_RATE_PER_MIN') ?? '10');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = clientIpFrom(req);
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

Deno.serve(async (request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return page(500, 'Not configured', 'This verification endpoint is not set up yet.');

  const url = new URL(request.url);
  let token = url.searchParams.get('token') ?? '';
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    token = (form?.get('token')?.toString() ?? token).trim();
  }
  if (!token) return page(400, 'Invalid link', 'This verification link is missing its token.');
  if (!TOKEN_RE.test(token)) return page(400, 'Invalid link', 'This verification link is malformed.');

  // GET: show the confirm page (no write — prevents email-prefetch auto-verification).
  if (request.method !== 'POST') {
    return page(200, 'Verify this email?', 'Press Verify to confirm this is really your email address.', { token });
  }

  if (rateLimited(request)) return page(429, 'Too many attempts', 'Please wait a moment and try again.');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc('verify_email_token', { p_token: token });
  if (error) return page(500, 'Something went wrong', 'Please try again in a moment, or contact support.');

  if (data === 'ok') return page(200, 'Email verified', 'Thanks — your email is confirmed. You can close this page and return to the app.');
  if (data === 'already') return page(200, 'Already verified', 'This email is already confirmed. You can close this page.');
  // 'expired' covers both a genuinely expired token and one whose profile email changed since —
  // both are honestly "no longer valid", and the app's Resend button gets them a fresh one.
  return page(400, 'Link expired', 'This verification link is no longer valid. Open the app and tap Resend to get a new one.');
});
