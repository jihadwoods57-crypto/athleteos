// OnStandard — tester-claim Edge Function (Supabase / Deno).
//
// Server side of the per-tester demo-account handout (web/landing/tester.html, migration 0195):
// ten isolated coach+athlete+trainer+client sets, seeded by scripts/seed-tester-accounts.sql,
// self-claimed by testers instead of the founder hand-delivering credentials ten times. See
// docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md for the full design.
//
// Four actions, all POST:
//   claim   -> name + email. Returns the caller's existing set if that email already holds one,
//              otherwise atomically assigns the next free set via claim_next_tester_set (0195).
//   resume  -> device_token. Returns that set, so a page refresh never burns a new one.
//   recover -> email. Returns that email's set, or not_found. Covers "now I'm on my phone".
//   status  -> founder-only (TESTER_ADMIN_KEY). Who claimed what, when, and how many beta board
//              reports they've filed — the nudge list.
//
// AUTH — same model as beta-board: there is no Supabase session, the visitor is an anonymous
// browser holding a URL token, so this function is the entire wall:
//   * every action requires ?k= in the body matching TESTER_CLAIM_KEY (constant-time compare)
//   * status additionally requires TESTER_ADMIN_KEY
//   * all DB work runs through the service-role client, because 0195's tester_sets is RLS-on
//     with no policies and no anon/authenticated grants (deliberate — see that migration's header)
// verify_jwt MUST be pinned false in config.toml or the platform 401s before any of this runs.
//
// Every response returns ONLY the caller's own row. No action ever lists all ten sets except
// status, which is founder-only.
//
// One device_token per set: recover/re-claim from a new device overwrites it, so an older device's
// stored token stops resuming and falls back to typing name+email again. Accepted simplification
// for ten testers — see the design spec's Risks section.
//
// Deploy:
//   supabase secrets set TESTER_CLAIM_KEY=<token> TESTER_ADMIN_KEY=<token>
//   supabase functions deploy tester-claim --no-verify-jwt
// BETA_BOARD_KEY must already be set (shared with the beta-board function) — this function reads
// it to compose a ready-to-tap board link so a tester never juggles two separate tokenized URLs.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { clientIpFrom } from '../_shared/client-ip.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CLAIM_KEY = Deno.env.get('TESTER_CLAIM_KEY') ?? '';
const ADMIN_KEY = Deno.env.get('TESTER_ADMIN_KEY') ?? '';
const BOARD_KEY = Deno.env.get('BETA_BOARD_KEY') ?? '';
const BOARD_ORIGIN = Deno.env.get('TESTER_BOARD_ORIGIN') ?? 'https://onstandard.app';

// Own list, same rationale as beta-board: never reuse the shared ALLOWED_ORIGINS secret, so
// rotating it for an unrelated function can't silently change this one's CORS posture.
const DEFAULT_ORIGINS = ['https://onstandard.app', 'https://www.onstandard.app'];
const ALLOWED_ORIGINS = (() => {
  const raw = (Deno.env.get('TESTER_ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_ORIGINS;
})();
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

// Constant-time compare — see beta-board for why a plain === leaks a secret's prefix through timing.
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Best-effort per-IP window on claim/recover, so the endpoint can't be enumerated. resume is NOT
// gated here — it requires an unguessable device_token the caller already holds, so it isn't an
// enumeration vector.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > RL_MAX;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type SetRow = {
  set_no: number; password: string;
  email_coach: string; email_athlete: string; email_trainer: string; email_client: string;
  team_join_code: string | null; practice_join_code: string | null;
  device_token: string | null; claimed_name: string | null; claimed_email: string | null; claimed_at: string | null;
};

const SET_COLS = 'set_no,password,email_coach,email_athlete,email_trainer,email_client,team_join_code,practice_join_code,device_token,claimed_name,claimed_email,claimed_at';

function payload(row: SetRow, deviceToken: string) {
  return {
    ok: true,
    set_no: row.set_no,
    password: row.password,
    emails: { coach: row.email_coach, athlete: row.email_athlete, trainer: row.email_trainer, client: row.email_client },
    team_join_code: row.team_join_code,
    practice_join_code: row.practice_join_code,
    claimed_name: row.claimed_name,
    device_token: deviceToken,
    board_url: BOARD_KEY ? `${BOARD_ORIGIN}/beta.html?k=${encodeURIComponent(BOARD_KEY)}` : null,
  };
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Unconfigured is 503, never a throw at import — a missing secret must not 500 every request.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLAIM_KEY) return json({ error: 'unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // The wall. Every action.
  if (!safeEqual(str(body.k, 200), CLAIM_KEY)) return json({ error: 'forbidden' }, 403);

  const action = str(body.action, 20);
  const ip = clientIpFrom(request);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---------------------------------------------------------------- resume: refresh never burns a set
  if (action === 'resume') {
    const device = str(body.device_token, 100);
    if (!device) return json({ error: 'bad_request' }, 400);
    const { data } = await sb.from('tester_sets').select(SET_COLS).eq('device_token', device).maybeSingle();
    if (!data) return json({ error: 'not_found' }, 404);
    return json(payload(data as SetRow, device));
  }

  // ---------------------------------------------------------------- recover: "now I'm on my phone"
  if (action === 'recover') {
    if (rateLimited(ip)) return json({ error: 'slow_down' }, 429);
    const email = str(body.email, 200).toLowerCase();
    if (!email) return json({ error: 'bad_request' }, 400);
    const { data } = await sb.from('tester_sets').select(SET_COLS).eq('claimed_email', email).maybeSingle();
    if (!data) return json({ error: 'not_found' }, 404);
    const device = crypto.randomUUID();
    const { data: updated } = await sb.from('tester_sets').update({ device_token: device }).eq('set_no', (data as SetRow).set_no).select(SET_COLS).single();
    return json(payload((updated ?? data) as SetRow, device));
  }

  // ---------------------------------------------------------------- claim: assign or return existing
  if (action === 'claim') {
    if (rateLimited(ip)) return json({ error: 'slow_down' }, 429);
    const name = str(body.name, 60);
    const email = str(body.email, 200).toLowerCase();
    if (!name || !email || !email.includes('@')) return json({ error: 'bad_request' }, 400);
    const device = crypto.randomUUID();

    const { data: existing } = await sb.from('tester_sets').select(SET_COLS).eq('claimed_email', email).maybeSingle();
    if (existing) {
      const { data: updated } = await sb.from('tester_sets').update({ device_token: device, claimed_name: name }).eq('set_no', (existing as SetRow).set_no).select(SET_COLS).single();
      return json(payload((updated ?? existing) as SetRow, device));
    }

    const { data: claimed, error } = await sb.rpc('claim_next_tester_set', { p_name: name, p_email: email, p_device: device }).select(SET_COLS).single();
    if (error) return json({ error: 'unavailable' }, 503);
    const row = claimed as SetRow | null;
    if (!row || row.set_no == null) return json({ error: 'exhausted' }, 409);
    return json(payload(row, device));
  }

  // ---------------------------------------------------------------- status: founder-only
  if (action === 'status') {
    if (!ADMIN_KEY || !safeEqual(str(body.admin, 200), ADMIN_KEY)) return json({ error: 'forbidden' }, 403);
    const { data: sets } = await sb.from('tester_sets').select('set_no,claimed_name,claimed_email,claimed_at').order('set_no');
    const { data: posts } = await sb.from('beta_posts').select('tester_set').not('tester_set', 'is', null);
    const counts = new Map<number, number>();
    for (const p of posts ?? []) {
      const n = (p as { tester_set: number }).tester_set;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const rows = (sets ?? []).map((s) => ({ ...s, board_post_count: counts.get((s as { set_no: number }).set_no) ?? 0 }));
    return json({ ok: true, sets: rows });
  }

  return json({ error: 'bad_request' }, 400);
});
