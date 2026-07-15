// OnStandard — cancel-subscription: tear down the signed-in owner's paid billing as part of
// ACCOUNT DELETION, so erasing an account never leaves a live Stripe subscription billing a
// deleted user, nor their payment PII sitting at Stripe (GDPR Art. 17 erasure completeness +
// US ROSCA / CA ARL "no charges after cancellation").
//
// THE GAP (compliance audit 2026-07-15): delete_account() (migration 0007) cascades every
// Postgres/Storage row the user owns, but it is pure SQL and cannot reach Stripe. The local
// `subscriptions` row is deleted while the Stripe customer + active subscription SURVIVE at
// Stripe — continued-billing and PII-retention risk. The client (useStore.deleteAccount) now
// invokes THIS function best-effort right before delete_account().
//
// WHAT IT DOES: resolves the caller from their JWT, looks up THEIR subscriptions row
// (owner_id = caller) via the service role, and if a Stripe customer exists, deletes that
// customer — which cancels every attached subscription AND removes the customer's stored
// payment/contact data at Stripe in one call. Idempotent + safe: an athlete (no billing
// account) is a clean no-op, and it only ever touches the CALLER's own customer.
//
// GUARDRAIL: authored only — NOT deployed by the audit. It mutates external billing state, so
// ENABLING it is a founder step: `supabase functions deploy cancel-subscription` (shares
// STRIPE_SECRET_KEY + SERVICE_ROLE). Until deployed, the client invoke fails and is swallowed,
// and account deletion still completes locally exactly as before.
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

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
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '10');
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  // No billing configured -> nothing to cancel; report ok so deletion is never blocked by billing.
  if (!STRIPE_SECRET_KEY) return json({ ok: true, canceled: false, reason: 'billing not configured' }, 200, cors);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  // Verified signed-in user only — we will only ever tear down THIS caller's own customer.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'sign in required' }, 401, cors);
  let userId: string;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return json({ error: 'sign in required' }, 401, cors);
    userId = data.user.id;
  } catch {
    return json({ error: 'sign in required' }, 401, cors);
  }

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: row } = await svc.from('subscriptions')
      .select('stripe_customer_id').eq('owner_id', userId).maybeSingle();
    const customer = row?.stripe_customer_id;
    // No billing account (e.g. an athlete, or a coach who never paid) -> clean no-op.
    if (!customer) return json({ ok: true, canceled: false, reason: 'no billing account' }, 200, cors);

    // Deleting the customer cancels every attached subscription AND removes the stored
    // payment/contact data at Stripe — the erasure-complete outcome in one idempotent call.
    await stripe.customers.del(customer);
    return json({ ok: true, canceled: true }, 200, cors);
  } catch (e) {
    // Log server-side; return a generic 502 so the caller can note it. Account deletion still
    // proceeds client-side — this is best-effort teardown, not a gate.
    console.error('cancel-subscription error:', e);
    return json({ error: 'billing teardown failed' }, 502, cors);
  }
});
