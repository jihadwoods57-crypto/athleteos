// OnStandard — connect-onboarding: mints (or resumes) a trainer's Stripe Express connected
// account and returns a Stripe-hosted onboarding link. Stripe collects 100% of the KYC/identity/
// bank-account information on its own hosted page — this function never sees or stores any of it,
// only the resulting account id + status.
//
// The client (trainer Grow tab) POSTs { practiceId } with the signed-in trainer's bearer token;
// this returns { url } — the app opens it externally, same pattern as billing-checkout.
//
// Deploy:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase functions deploy connect-onboarding
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Where the trainer lands after the hosted onboarding flow (refresh = link expired/back button,
// return = they finished the steps Stripe asked for — NOT the same as "fully verified", which
// only account.updated / connect-webhook can confirm).
const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ??
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

// CORS + rate limit: same discipline as billing-checkout.
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

async function resolveUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY || token === SUPABASE_ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  const user = await resolveUser(req);
  if (!user) return json({ error: 'sign in required' }, 401, cors);

  let body: { practiceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }
  const practiceId = typeof body.practiceId === 'string' ? body.practiceId : '';
  if (!UUID_RE.test(practiceId)) return json({ error: 'bad request' }, 400, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Ownership check under service role (bypasses RLS, so we verify explicitly) — never let a
  // trainer mint or re-link a Connect account for a practice they don't own.
  const { data: practice } = await svc.from('practices')
    .select('id, owner_id, stripe_connect_account_id, stripe_connect_status')
    .eq('id', practiceId).maybeSingle();
  if (!practice || practice.owner_id !== user.id) return json({ error: 'not authorized' }, 403, cors);

  try {
    let accountId = practice.stripe_connect_account_id as string | null;

    if (!accountId) {
      // Mint a new Express account. Express = Stripe hosts the onboarding UI + a limited dashboard
      // for the trainer; we never touch their identity/bank details, only the account id + status.
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email ?? undefined,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_type: 'individual',
        metadata: { practice_id: practiceId, owner_id: user.id },
      });
      accountId = account.id;
      const { error } = await svc.from('practices').update({
        stripe_connect_account_id: accountId,
        stripe_connect_status: 'pending',
        stripe_connect_updated_at: new Date().toISOString(),
      }).eq('id', practiceId);
      if (error) throw error;
    }

    // Account Link: a single-use, short-lived hosted URL for this onboarding/re-onboarding step.
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${RETURN_BASE}?state=connect_refresh`,
      return_url: `${RETURN_BASE}?state=connect_return`,
      type: 'account_onboarding',
    });

    return json({ url: link.url }, 200, cors);
  } catch (e) {
    console.error('connect-onboarding error:', e);
    return json({ error: 'onboarding unavailable' }, 502, cors);
  }
});
