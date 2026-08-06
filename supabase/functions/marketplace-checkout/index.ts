// OnStandard — marketplace-checkout: a client HIRES a marketplace coach. Same destination-charge
// shape as pay-offer-checkout, with the preconditions inverted: there the buyer must ALREADY be a
// client of the practice; here they must NOT be — the webhook's marketplace_hire branch creates
// the practice_clients link once Stripe confirms the first payment.
//
// Server-authoritative gates (never trust the proto):
//   - marketplace_enabled switch is on
//   - listing exists, published, not suspended, seats free (soft cap — async webhook may overshoot
//     by one; accepted for v1, admin sees utilization)
//   - the offer is one of the listing's TIER offers and its price sits inside the admin bounds
//   - the buyer is an adult (fail-closed: unknown age = minor = no)
//   - the buyer is not already an active client of this practice
//
// POSTs { offerId } with a bearer token; returns { url } for Stripe's hosted Checkout.
// Deploy: supabase functions deploy marketplace-checkout
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { clientIpFrom } from '../_shared/client-ip.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ??
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

// Lazy construction — same crash-at-import gotcha as pay-offer-checkout.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripe;
}

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
  const ip = clientIpFrom(req);
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

  // ---- the switch --------------------------------------------------------------------------
  const { data: cfg } = await svc.from('app_config').select('key, value')
    .in('key', ['marketplace_enabled', 'marketplace_tier_bounds', 'marketplace_agreement_version']);
  const cfgMap = new Map((cfg ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  if (cfgMap.get('marketplace_enabled') !== true) return json({ error: 'marketplace unavailable' }, 503, cors);

  // ---- adults only (fail-closed: no recorded age = no) -------------------------------------
  const { data: ap } = await svc.from('athlete_profiles').select('base_age').eq('athlete_id', user.id).maybeSingle();
  if ((ap?.base_age ?? 0) < 18) return json({ error: 'marketplace coaching is for adults' }, 403, cors);

  // ---- the tier offer + its listing --------------------------------------------------------
  const { data: offer } = await svc.from('offers')
    .select('id, practice_id, name, price_cents, cadence, active, tier').eq('id', offerId).maybeSingle();
  if (!offer || !offer.active || !offer.tier || offer.cadence !== 'month' || offer.price_cents == null) {
    return json({ error: 'plan not available' }, 404, cors);
  }

  const { data: listing } = await svc.from('coach_listings')
    .select('practice_id, published, suspended, capacity').eq('practice_id', offer.practice_id).maybeSingle();
  if (!listing || !listing.published || listing.suspended) return json({ error: 'coach not available' }, 404, cors);

  // Price must sit inside the CURRENT admin bounds — a stale out-of-bounds offer cannot be bought.
  const bounds = (cfgMap.get('marketplace_tier_bounds') ?? {}) as Record<string, { min_cents?: number; max_cents?: number }>;
  const b = bounds[offer.tier] ?? {};
  if (offer.price_cents < (b.min_cents ?? 0) || offer.price_cents > (b.max_cents ?? Number.MAX_SAFE_INTEGER)) {
    return json({ error: 'plan pricing is being updated — try again shortly' }, 409, cors);
  }

  // Soft capacity check (webhook is async; slight overshoot accepted for v1).
  const { count: activeClients } = await svc.from('practice_clients')
    .select('client_id', { count: 'exact', head: true })
    .eq('practice_id', offer.practice_id).eq('status', 'active');
  if ((activeClients ?? 0) >= listing.capacity) return json({ error: 'this coach is at capacity' }, 409, cors);

  // Already an active client of this exact practice → nothing to hire.
  const { data: link } = await svc.from('practice_clients')
    .select('status').eq('practice_id', offer.practice_id).eq('client_id', user.id).maybeSingle();
  if (link?.status === 'active') return json({ error: 'you already work with this coach' }, 409, cors);

  const { data: practice } = await svc.from('practices')
    .select('id, stripe_connect_account_id, stripe_connect_status').eq('id', offer.practice_id).maybeSingle();
  if (!practice || practice.stripe_connect_status !== 'active' || !practice.stripe_connect_account_id) {
    return json({ error: 'this coach is not yet set up to accept payments' }, 400, cors);
  }

  const { data: feeRow } = await svc.from('pay_platform_config').select('fee_percent').eq('id', true).maybeSingle();
  const feePercent = Number(feeRow?.fee_percent ?? 15);

  const metadata = {
    kind: 'marketplace_hire',
    offer_id: offer.id,
    practice_id: offer.practice_id,
    payer_id: user.id,
    tier: offer.tier,
    agreement_version: String(cfgMap.get('marketplace_agreement_version') ?? 'v1'),
  };

  // Managed Payments opt-out — same reason as pay-offer-checkout (application fees are rejected
  // without it); typed-loose because it's not in the SDK's types yet.
  const managedPaymentsOptOut = { managed_payments: { enabled: false } } as Record<string, unknown>;

  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'subscription',
      ...managedPaymentsOptOut,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: offer.name },
          unit_amount: offer.price_cents,
          recurring: { interval: 'month' as const },
        },
        quantity: 1,
      }],
      metadata,
      subscription_data: {
        application_fee_percent: feePercent,
        transfer_data: { destination: practice.stripe_connect_account_id },
        metadata,
      },
      success_url: `${RETURN_BASE}?state=pay_success`,
      cancel_url: `${RETURN_BASE}?state=pay_cancel`,
    });

    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('marketplace-checkout error:', e);
    return json({ error: 'checkout unavailable' }, 502, cors);
  }
});
