// OnStandard — delete-account: the Apple half of account deletion (review pass 2026-09-23, G-R4;
// Apple's account-deletion requirement for apps that offer Sign in with Apple, 5.1.1(v)).
//
// The app calls this FIRST when the person confirms deletion, then deletes the account exactly as
// it always has (the delete_account RPC, 0007/0079). This function:
//   1. finds the caller's stored Sign in with Apple refresh token (apple_siwa_tokens, 0246);
//   2. revokes it at https://appleid.apple.com/auth/revoke;
//   3. deletes the row.
// It NEVER blocks a deletion: no token, missing secrets, Apple down, all answer 200 with what
// happened, and the app goes on to delete. (The FK cascade removes the row anyway when the account
// goes.) A caller who signed in with email or Google has nothing to revoke.
//
// Secrets: APPLE_SIWA_KEY_ID, APPLE_SIWA_P8, APPLE_TEAM_ID (+ optional APPLE_SIWA_CLIENT_ID).
// Deploy: supabase functions deploy delete-account
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { siwaConfig, revokeToken } from '../_shared/apple-siwa.mjs';

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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ apple: 'unconfigured' }, 200, cors);

  const auth = req.headers.get('authorization') ?? '';
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: me } = await caller.auth.getUser();
  const uid = me?.user?.id;
  if (!uid) return json({ error: 'unauthorized' }, 401, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: row } = await svc.from('apple_siwa_tokens').select('refresh_token').eq('user_id', uid).maybeSingle();
  const token = row?.refresh_token ? String(row.refresh_token) : '';
  if (!token) return json({ apple: 'none' }, 200, cors);

  const cfg = siwaConfig((k: string) => Deno.env.get(k) ?? '');
  let apple = 'revoked';
  if (!cfg.ok) {
    console.warn(JSON.stringify({ evt: 'siwa_unconfigured', fn: 'delete-account', missing: cfg.missing }));
    apple = 'unconfigured';
  } else {
    const out = await revokeToken(cfg, token);
    if (!out.revoked) {
      console.error(JSON.stringify({ evt: 'siwa_revoke_failed', fn: 'delete-account', error: out.error }));
      apple = 'revoke_failed';
    }
  }
  // The row goes either way: the account is about to be deleted, and a token that could not be
  // revoked now is not one this system should keep.
  await svc.from('apple_siwa_tokens').delete().eq('user_id', uid);
  return json({ apple }, 200, cors);
});
