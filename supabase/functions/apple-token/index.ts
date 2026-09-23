// OnStandard — apple-token: keep what account deletion needs to revoke Sign in with Apple
// (review pass 2026-09-23, G-R4; see _shared/apple-siwa.mjs for the whole story).
//
// POST { authorizationCode } with the signed-in user's JWT, right after a Sign in with Apple. The
// code is exchanged at Apple for a refresh token, which is stored for this user in
// apple_siwa_tokens (0246, service role only). Best effort from the app's side: sign-in never
// waits on this and never fails because of it.
//
// Secrets: APPLE_SIWA_KEY_ID, APPLE_SIWA_P8, APPLE_TEAM_ID (+ optional APPLE_SIWA_CLIENT_ID).
// Missing ones are logged and the call answers { stored: false, reason: 'unconfigured' }.
//
// Deploy: supabase functions deploy apple-token
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { siwaConfig, exchangeCode } from '../_shared/apple-siwa.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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
const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ error: 'unconfigured' }, 503, cors);

  const auth = req.headers.get('authorization') ?? '';
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: me } = await caller.auth.getUser();
  const uid = me?.user?.id;
  if (!uid) return json({ error: 'unauthorized' }, 401, cors);

  let body: { authorizationCode?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const code = typeof body.authorizationCode === 'string' ? body.authorizationCode.trim() : '';
  if (!code || code.length > 2048) return json({ error: 'authorizationCode required' }, 400, cors);

  const cfg = siwaConfig((k: string) => Deno.env.get(k) ?? '');
  if (!cfg.ok) {
    console.warn(JSON.stringify({ evt: 'siwa_unconfigured', fn: 'apple-token', missing: cfg.missing }));
    return json({ stored: false, reason: 'unconfigured' }, 200, cors);
  }
  const out = await exchangeCode(cfg, code);
  if (!out.refreshToken) {
    console.warn(JSON.stringify({ evt: 'siwa_exchange_failed', fn: 'apple-token', error: out.error }));
    return json({ stored: false, reason: 'exchange_failed' }, 200, cors);
  }
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { error } = await svc.from('apple_siwa_tokens')
    .upsert({ user_id: uid, refresh_token: out.refreshToken, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.error(JSON.stringify({ evt: 'siwa_store_failed', fn: 'apple-token', error: error.message }));
    return json({ stored: false, reason: 'store_failed' }, 200, cors);
  }
  return json({ stored: true }, 200, cors);
});
