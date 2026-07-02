// OnStandard — stripe-webhook: the "first dollar" seam (audit 2026-07-02, item 9).
//
// Turns a real Stripe payment into an entitlement. The coach/org pays per seat via a Stripe
// Payment Link (or Checkout); Stripe calls this endpoint; we verify the signature and upsert the
// owner's `subscriptions` row (0010) with service_role — the ONLY writer of that table. The client
// only ever READS its own row (queries.ts:fetchEntitlement), so a user can never grant themselves
// a plan. Nothing about the athlete's data is touched; this is the ACCESS/billing half only.
//
// Deploy (JWT OFF — Stripe has no Supabase JWT; the endpoint authenticates itself via the Stripe
// signature instead):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe: create a webhook to <project>/functions/v1/stripe-webhook for events
//   checkout.session.completed, customer.subscription.updated, customer.subscription.deleted.
//
// OWNER RESOLUTION: the Payment Link / Checkout MUST carry the paying coach's profile id as
// `client_reference_id` (append `?client_reference_id=<ownerId>` to the Payment Link URL, or set it
// when creating a Checkout Session). That is how a payment maps to an owner. Renewals/cancellations
// then resolve the owner from the row this first event wrote (by stripe ids). Sessions with no
// resolvable owner are acknowledged (200) and logged, never guessed.
import Stripe from 'npm:stripe@^17';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Deno/edge has no Node crypto, so the SDK must use fetch + SubtleCrypto (the async verify path).
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Pinned to the version the SDK (npm:stripe@^17) is built against — its types enforce this.
  apiVersion: '2025-02-24.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map a Stripe subscription status to our subscriptions.status enum ('active'|'past_due'|'canceled'). */
function mapStatus(s: string): 'active' | 'past_due' | 'canceled' {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  return 'canceled'; // canceled, incomplete, incomplete_expired, paused
}

/** The purchased seat count (first line item quantity), or null if not present. */
function seatsOf(sub: Stripe.Subscription): number | null {
  const q = sub.items?.data?.[0]?.quantity;
  return typeof q === 'number' ? q : null;
}

/** current_period_end (unix seconds) → ISO, or null. */
function periodEnd(sub: Stripe.Subscription): string | null {
  return sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('stripe-webhook: missing configuration');
    return json({ error: 'server not configured' }, 500);
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing signature' }, 400);

  // Verify the signature against the RAW body — this is the endpoint's only authentication.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error('stripe-webhook: signature verification failed:', (e as Error).message);
    return json({ error: 'invalid signature' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const ownerId = session.client_reference_id ?? '';
        if (!UUID_RE.test(ownerId)) {
          // No resolvable owner: acknowledge so Stripe doesn't retry forever, but do not guess.
          console.error('stripe-webhook: checkout.session.completed with no valid client_reference_id', session.id);
          return json({ received: true, note: 'no owner reference' });
        }
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        if (!subId) {
          console.error('stripe-webhook: checkout session has no subscription', session.id);
          return json({ received: true, note: 'no subscription on session' });
        }
        // Pull the subscription for seats + period end + status.
        const sub = await stripe.subscriptions.retrieve(subId);
        const { error } = await svc.from('subscriptions').upsert({
          owner_id: ownerId,
          tier: 'team',
          status: mapStatus(sub.status),
          seats: seatsOf(sub),
          current_period_end: periodEnd(sub),
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Resolve the owner from the row the checkout wrote (never trust a mutable field here).
        const { error } = await svc
          .from('subscriptions')
          .update({
            status: mapStatus(sub.status),
            seats: seatsOf(sub),
            current_period_end: periodEnd(sub),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (error) throw error;
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const { error } = await svc
          .from('subscriptions')
          .update({ status: 'canceled', tier: 'preview', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        if (error) throw error;
        break;
      }

      default:
        // Acknowledge everything else so Stripe stops retrying; we only act on the three above.
        break;
    }
  } catch (e) {
    // A DB error should return 500 so Stripe RETRIES (the event isn't lost). Never leak detail.
    console.error(`stripe-webhook: handling ${event.type} failed:`, e);
    return json({ error: 'handler error' }, 500);
  }

  return json({ received: true });
});
