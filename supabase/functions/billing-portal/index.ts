// OnStandard — billing-portal: opens the signed-in owner's Stripe Billing Portal session.
//
// "Manage / cancel / pause / update card" all live in Stripe's hosted portal — one tap from
// the app, no phone call, which is exactly what the compliant cancellation copy promises.
// This creates a PER-CUSTOMER portal session (scoped, expiring) — strictly better than the
// static portal link seam: the customer lands already signed in to THEIR billing.
//
// The portal's capabilities (cancel, pause, plan switch, payment method) are configured once
// in the Stripe dashboard (docs/go-live/STRIPE-SETUP.md) — including PAUSE, the
// churn-recovery option the cancel flow offers before the relationship ends.
//
// Deploy: supabase functions deploy billing-portal   (shares STRIPE_SECRET_KEY)
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ??
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

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
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  // Verified signed-in user only — the portal session exposes THEIR billing.
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
    if (!customer) return json({ error: 'no billing account yet' }, 404, cors);

    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${RETURN_BASE}?state=done`,
    });
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('billing-portal error:', e);
    return json({ error: 'portal unavailable' }, 502, cors);
  }
});
