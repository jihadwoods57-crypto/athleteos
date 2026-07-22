// OnStandard — pay-offer-checkout: creates a Stripe Checkout Session for a trainer's offer, using
// a DESTINATION CHARGE (Stripe's documented pattern for "a platform charging a fee to facilitate a
// transaction between two parties"). The platform is merchant-of-record; Stripe auto-splits the
// money to the trainer's connected account minus the platform fee — nothing about the split is
// computed or moved by our own code.
//
// The client (a connected client, signed in) POSTs { offerId } with their bearer token; this
// returns { url } — the app opens Stripe's hosted Checkout page. stripe-webhook records the
// resulting charge into offer_payments once Stripe confirms it.
//
// Deploy:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase functions deploy pay-offer-checkout
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

  let body: { offerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }
  const offerId = typeof body.offerId === 'string' ? body.offerId : '';
  if (!UUID_RE.test(offerId)) return json({ error: 'bad request' }, 400, cors);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Load the offer + its practice's Connect state under service role (bypasses RLS — we verify
  // the caller's standing explicitly below, same as every other Stripe-touching function).
  const { data: offer } = await svc.from('offers')
    .select('id, practice_id, name, price_cents, cadence, active').eq('id', offerId).maybeSingle();
  if (!offer || !offer.active) return json({ error: 'offer not available' }, 404, cors);
  if (offer.price_cents == null) return json({ error: 'this offer has no set price yet — contact the trainer' }, 400, cors);

  const { data: practice } = await svc.from('practices')
    .select('id, stripe_connect_account_id, stripe_connect_status').eq('id', offer.practice_id).maybeSingle();
  if (!practice || practice.stripe_connect_status !== 'active' || !practice.stripe_connect_account_id) {
    return json({ error: 'this trainer is not yet set up to accept payments' }, 400, cors);
  }

  // The buyer must be an ACTIVE client of this exact practice — never let a stranger buy a
  // stranger's offer just by guessing an id.
  const { data: link } = await svc.from('practice_clients')
    .select('status').eq('practice_id', offer.practice_id).eq('client_id', user.id).maybeSingle();
  if (!link || link.status !== 'active') return json({ error: 'connect with this trainer first' }, 403, cors);

  const { data: feeRow } = await svc.from('pay_platform_config').select('fee_percent').eq('id', true).maybeSingle();
  const feePercent = Number(feeRow?.fee_percent ?? 15);

  const metadata = {
    kind: 'offer_purchase',
    offer_id: offer.id,
    practice_id: offer.practice_id,
    payer_id: user.id,
  };

  // This platform account has Stripe "Managed Payments" enabled by default, which is incompatible
  // with Connect application fees (Stripe rejects application_fee_amount / application_fee_percent
  // otherwise). We are the merchant of record doing a destination charge, so we opt out per request
  // — Stripe then performs the platform-fee split as intended. Applies to BOTH one-time and
  // recurring; it's a harmless no-op on accounts where Managed Payments is off. Not yet in the SDK's
  // TypeScript types, so it's injected via a typed-loose spread.
  const managedPaymentsOptOut = { managed_payments: { enabled: false } } as Record<string, unknown>;

  try {
    const isRecurring = offer.cadence === 'month' || offer.cadence === 'week';
    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      ...managedPaymentsOptOut,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: offer.name },
          unit_amount: offer.price_cents,
          ...(isRecurring ? { recurring: { interval: offer.cadence === 'week' ? 'week' as const : 'month' as const } } : {}),
        },
        quantity: 1,
      }],
      metadata,
      ...(isRecurring
        ? {
            subscription_data: {
              application_fee_percent: feePercent,
              transfer_data: { destination: practice.stripe_connect_account_id },
              metadata,
            },
          }
        : {
            payment_intent_data: {
              application_fee_amount: Math.round(offer.price_cents * (feePercent / 100)),
              transfer_data: { destination: practice.stripe_connect_account_id },
              metadata,
            },
          }),
      success_url: `${RETURN_BASE}?state=pay_success`,
      cancel_url: `${RETURN_BASE}?state=pay_cancel`,
    });

    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('pay-offer-checkout error:', e);
    return json({ error: 'checkout unavailable' }, 502, cors);
  }
});
