// OnStandard — public-offer-checkout: lets a PROSPECT buy a trainer's offer before they have an
// account. This is the missing half of the acquisition funnel.
//
// The public trainer page (0114) could collect an application but never a payment: pay-offer-checkout
// requires an already-active practice_clients link, so a stranger had to apply, wait for the trainer,
// join by code, sign up, and only THEN pay. The hottest moment in the funnel was the one moment we
// could not take money. This endpoint closes that: pay first, and the payment itself creates the
// relationship (stripe-webhook mints an offer_claims code; redeem_offer_code turns it into the
// practice link + trainer-funded premium in one transaction).
//
// Same money mechanics as pay-offer-checkout — a DESTINATION CHARGE where the platform is merchant
// of record and Stripe auto-splits to the trainer minus the platform fee. Nothing about the split is
// computed here.
//
// Deploy (JWT OFF — the buyer is anonymous by definition; there is no Supabase session yet):
//   supabase functions deploy public-offer-checkout --no-verify-jwt
//
// Two actions on one endpoint (one deploy, one CORS surface):
//   POST { slug, offerIndex }  -> { url }   open Stripe Checkout
//   POST { action:'claim', sessionId } -> { code } | { pending:true }   the success page's lookup
import Stripe from 'npm:stripe@^17';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { clientIpFrom } from '../_shared/client-ip.ts';
import { flagOn } from '../_shared/feature-flags.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const RETURN_BASE = Deno.env.get('BILLING_RETURN_URL') ??
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/billing-return` : '');

// Lazy construction — `new Stripe('')` throws at module load, which crashes the worker at import
// time and turns the 'billing not configured' 503 below into an unexplained 500. Same discipline as
// every other Stripe-touching function here.
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

// This endpoint is called from the PUBLIC marketing page, which lives on a different origin than
// the Supabase project, so it needs real CORS — unlike pay-offer-checkout, which is called from the
// app. ALLOWED_ORIGINS must include the landing domain (https://onstandard.app).
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

// Tighter than the authenticated sibling (10/min): this endpoint is unauthenticated and creates
// Stripe objects, so it is the more attractive thing to hammer.
const RL_MAX = Number(Deno.env.get('PUBLIC_RATE_LIMIT_PER_MIN') ?? '6');
/* The claim lookup gets its OWN, far looser budget, and it must.
 *
 * billing-return polls this endpoint up to 10 times at 1.5s intervals precisely because the webhook
 * that mints the code races Stripe's redirect. Against a shared 6/min bucket, attempt 7 onward came
 * back 429 — so the buyer whose webhook took more than nine seconds (the exact case the polling
 * exists for) was told "still processing", and a refresh inside the same minute failed immediately
 * too. Someone who had just been charged could not reach the code they paid for.
 *
 * It is safe to be generous here: this action creates nothing, writes nothing, and is keyed by an
 * unguessable Stripe session id that only its own buyer ever receives. The budget exists to bound a
 * flood, not to ration a legitimate poll.
 */
const RL_CLAIM_MAX = Number(Deno.env.get('PUBLIC_CLAIM_RATE_LIMIT_PER_MIN') ?? '40');
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request, bucket: 'create' | 'claim'): boolean {
  const ip = clientIpFrom(req);
  const key = `${bucket}:${ip}`;
  const max = bucket === 'claim' ? RL_CLAIM_MAX : RL_MAX;
  const now = Date.now();
  const e = rlHits.get(key);
  if (!e || now > e.resetAt) { rlHits.set(key, { count: 1, resetAt: now + 60_000 }); return false; }
  e.count++;
  return e.count > max;
}

const json = (obj: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The opaque slug shape minted by publish_trainer_page (0114). Matching it here keeps malformed
// input from ever reaching a query.
const SLUG_RE = /^[a-f0-9]{8,64}$/;
const SESSION_RE = /^cs_[A-Za-z0-9_]+$/;

/** The success page's lookup: exchange the Stripe session id for the minted claim code.
 *
 *  The session id is the capability — it is opaque, single-purpose, and only ever handed to the
 *  buyer via Stripe's own redirect, which is the same trust model as Stripe's hosted receipt page.
 *  Only ever returns a PENDING claim's code: once redeemed, this returns nothing, so a leaked URL
 *  in someone's history cannot re-reveal a code that is already in use. */
async function claimForSession(sessionId: string, cors: Record<string, string>): Promise<Response> {
  const svc = createClient(SUPABASE_URL!, SERVICE_ROLE!);
  const { data } = await svc.from('offer_claims')
    .select('code, status').eq('stripe_checkout_session_id', sessionId).maybeSingle();
  if (!data) return json({ pending: true }, 200, cors);       // webhook has not landed yet — poll
  if (data.status !== 'pending') return json({ claimed: true }, 200, cors);
  return json({ code: data.code }, 200, cors);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500, cors);

  let body: { slug?: unknown; offerIndex?: unknown; action?: unknown; sessionId?: unknown; expectPriceCents?: unknown; expectName?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400, cors);
  }

  // The claim lookup is DELIBERATELY not behind the kill switch. Someone who has already been
  // charged must always be able to retrieve their code — flipping the switch has to stop new sales,
  // never strand a completed one.
  if (body.action === 'claim') {
    if (rateLimited(req, 'claim')) return json({ error: 'rate limited, slow down' }, 429, cors);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!SESSION_RE.test(sessionId)) return json({ error: 'bad request' }, 400, cors);
    return await claimForSession(sessionId, cors);
  }

  if (rateLimited(req, 'create')) return json({ error: 'rate limited, slow down' }, 429, cors);
  if (!STRIPE_SECRET_KEY) return json({ error: 'billing not configured' }, 503, cors);

  // Kill switch. There is no signed-in user here, so the flag is evaluated with an empty context —
  // meaning only default_on and kill_switch apply, which is exactly the global on/off we want.
  // flagOn fails CLOSED, so a flags-table outage stops sales rather than taking money we might not
  // be able to honour.
  const svcFlag = createClient(SUPABASE_URL, SERVICE_ROLE);
  if (!(await flagOn(svcFlag, 'trainer_funded_v1', {}))) {
    return json({ error: 'online checkout is temporarily unavailable — please apply instead' }, 503, cors);
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG_RE.test(slug)) return json({ error: 'bad request' }, 400, cors);
  const offerIndex = Number(body.offerIndex);
  if (!Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex > 50) {
    return json({ error: 'bad request' }, 400, cors);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve slug -> practice -> offer entirely SERVER-SIDE. The public never sends a practice id or
  // an offer id: it sends the position of the card it clicked, in the same order public_trainer_page
  // renders (sort, created_at). That keeps internal ids off the marketing page and makes it
  // impossible to point this endpoint at an unpublished practice's offer by guessing a uuid.
  const { data: page } = await svc.from('trainer_public_pages')
    .select('practice_id, published').eq('public_slug', slug).maybeSingle();
  if (!page || !page.published) return json({ error: 'not available' }, 404, cors);

  const { data: offers } = await svc.from('offers')
    .select('id, name, price_cents, cadence')
    .eq('practice_id', page.practice_id).eq('active', true)
    .order('sort', { ascending: true }).order('created_at', { ascending: true });
  const offer = offers?.[offerIndex];
  if (!offer) return json({ error: 'not available' }, 404, cors);
  if (offer.price_cents == null) {
    return json({ error: 'this offer has no set price — use Apply instead' }, 400, cors);
  }

  // Position is a POSITION, not an identity: if the trainer reorders, renames, deactivates or
  // reprices a package between page load and click, index N is no longer the card the buyer read.
  // Stripe's confirm screen would show the real price so nobody is charged an unseen amount, but
  // they'd still be buying the wrong thing. The page echoes back what it displayed and we refuse
  // the sale on any disagreement — the buyer reloads and sees the truth.
  const expectPrice = Number(body.expectPriceCents);
  const expectName = typeof body.expectName === 'string' ? body.expectName : null;
  const drifted = (Number.isFinite(expectPrice) && expectPrice !== offer.price_cents)
    || (expectName !== null && expectName !== offer.name);
  if (drifted) {
    return json({ error: 'this trainer just changed their packages — please refresh and try again' }, 409, cors);
  }

  // RECURRING ONLY on the public path. A funded grant lasts as long as a live subscription, so a
  // one-time or per-session purchase has no period to fund and would leave the buyer holding a
  // claim code that grants nothing. Those offers keep the Apply flow.
  const isRecurring = offer.cadence === 'month' || offer.cadence === 'week';
  if (!isRecurring) return json({ error: 'this offer is not available to buy online' }, 400, cors);

  const { data: practice } = await svc.from('practices')
    .select('stripe_connect_account_id, stripe_connect_status').eq('id', page.practice_id).maybeSingle();
  if (!practice || practice.stripe_connect_status !== 'active' || !practice.stripe_connect_account_id) {
    return json({ error: 'this trainer is not yet set up to accept payments' }, 400, cors);
  }

  const { data: feeRow } = await svc.from('pay_platform_config').select('fee_percent').eq('id', true).maybeSingle();
  const feePercent = Number(feeRow?.fee_percent ?? 15);

  // No payer_id — that is the signal stripe-webhook uses to mint a claim code instead of granting
  // access directly. Everything else matches an in-app offer purchase exactly.
  const metadata = {
    kind: 'offer_purchase',
    offer_id: offer.id,
    practice_id: page.practice_id,
    source: 'public_page',
  };

  // Managed Payments is incompatible with Connect application fees; opt out per request so Stripe
  // performs the platform-fee split. Harmless no-op where Managed Payments is off. Not in the SDK
  // types yet, hence the loose spread.
  const managedPaymentsOptOut = { managed_payments: { enabled: false } } as Record<string, unknown>;

  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'subscription',
      ...managedPaymentsOptOut,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: offer.name },
          unit_amount: offer.price_cents,
          recurring: { interval: offer.cadence === 'week' ? 'week' as const : 'month' as const },
        },
        quantity: 1,
      }],
      metadata,
      subscription_data: {
        application_fee_percent: feePercent,
        transfer_data: { destination: practice.stripe_connect_account_id },
        metadata,
      },
      // The session id comes back on the return URL so the success page can show the claim code.
      success_url: `${RETURN_BASE}?state=claim&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${RETURN_BASE}?state=cancel`,
    });

    return json({ url: session.url }, 200, cors);
  } catch (e) {
    console.error('public-offer-checkout error:', e);
    return json({ error: 'checkout unavailable' }, 502, cors);
  }
});
