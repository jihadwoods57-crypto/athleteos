// OnStandard — billing-checkout: creates a Stripe Checkout Session for a business plan.
//
// The client (Plans.tsx) POSTs { planId, cadence, referralCode? } with the signed-in user's
// bearer token; this returns { url } — the hosted Stripe Checkout page — and the app opens it
// in the browser. No card data ever touches the app. The session carries the buyer's profile
// id as client_reference_id, which is how stripe-webhook maps the payment to an owner.
//
// PRICES LIVE IN STRIPE, not here: each plan+cadence is a Stripe Price with lookup_key
// `<plan_id>_<cadence>` (pro_solo_monthly, professional_annual, ...). Founder setup is
// docs/go-live/STRIPE-SETUP.md. A price change is a dashboard edit, never a deploy.
//
// Referral loop: a valid referral code auto-applies the "1 free month" coupon
// (STRIPE_REFERRAL_COUPON_ID) to the NEW customer's checkout; the referrer's matching free
// month is granted by stripe-webhook when this checkout completes. Without a referral code,
// the checkout allows manually entered promotion codes instead (Stripe forbids both at once).
//
// Deploy:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_REFERRAL_COUPON_ID=...
//   supabase functions deploy billing-checkout
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { STRIPE_PLANS, isCadence, priceLookupKey } from '../_shared/plans.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const REFERRAL_COUPON = Deno.env.get('STRIPE_REFERRAL_COUPON_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Where the browser lands after Checkout. billing-return is a tiny public page that says
// "you're set, head back to the app" — overridable if a real web page exists later.
const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ??
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

// CORS + rate limit: same discipline as the AI functions (see analyze-meal).
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

/** The signed-in buyer, verified against Supabase auth (never a raw JWT decode). */
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

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (rateLimited(req)) return json({ error: 'rate limited, slow down' }, 429, cors);
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  const user = await resolveUser(req);
  if (!user) return json({ error: 'sign in required' }, 401, cors);

  let body: { planId?: unknown; cadence?: unknown; referralCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }
  const planId = typeof body.planId === 'string' ? body.planId : '';
  if (!(planId in STRIPE_PLANS)) return json({ error: 'unknown or non-Stripe plan' }, 400, cors);
  const cadence = isCadence(body.cadence) ? body.cadence : 'monthly';

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Referral: resolve the code to its owner. Invalid/self codes are IGNORED (checkout still
  // proceeds, honestly, without the discount) rather than blocking a paying customer.
  let referrerId: string | null = null;
  let referralCode: string | null = null;
  const rawCode = typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase() : '';
  if (rawCode && /^[A-Z0-9]{6,12}$/.test(rawCode) && REFERRAL_COUPON) {
    const { data } = await svc.from('referral_codes').select('owner_id, code').eq('code', rawCode).maybeSingle();
    if (data && data.owner_id !== user.id) {
      // One reward per referred owner, ever — if they already redeemed once, no second discount.
      const { data: prior } = await svc.from('referral_redemptions').select('referred_owner_id')
        .eq('referred_owner_id', user.id).maybeSingle();
      if (!prior) {
        referrerId = data.owner_id;
        referralCode = data.code;
      }
    }
  }

  try {
    // Look the price up by its lookup_key — the founder-created Price in Stripe.
    const prices = await stripe.prices.list({ lookup_keys: [priceLookupKey(planId, cadence)], limit: 1 });
    const price = prices.data[0];
    if (!price) {
      console.error(`billing-checkout: no Stripe price with lookup_key ${priceLookupKey(planId, cadence)}`);
      return json({ error: 'plan not available yet' }, 503, cors);
    }

    // Reuse the Stripe customer from a prior subscription so upgrades/reactivations keep
    // one billing history (and the portal shows everything in one place).
    const { data: subRow } = await svc.from('subscriptions')
      .select('stripe_customer_id').eq('owner_id', user.id).maybeSingle();
    const existingCustomer = subRow?.stripe_customer_id ?? null;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: user.id,
      ...(existingCustomer ? { customer: existingCustomer } : user.email ? { customer_email: user.email } : {}),
      line_items: [{ price: price.id, quantity: 1 }],
      // Stripe forbids discounts + allow_promotion_codes together: referral wins.
      ...(referrerId
        ? { discounts: [{ coupon: REFERRAL_COUPON }] }
        : { allow_promotion_codes: true }),
      subscription_data: {
        metadata: {
          owner_id: user.id,
          plan_id: planId,
          ...(referrerId ? { referrer_id: referrerId, referral_code: referralCode ?? '' } : {}),
        },
      },
      success_url: `${RETURN_BASE}?state=success`,
      cancel_url: `${RETURN_BASE}?state=cancel`,
    });

    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('billing-checkout error:', e);
    return json({ error: 'checkout unavailable' }, 502, cors);
  }
});
