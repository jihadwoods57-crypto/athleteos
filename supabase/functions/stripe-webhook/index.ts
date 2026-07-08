// OnStandard — stripe-webhook: the "first dollar" seam (audit 2026-07-02, item 9;
// extended for the full billing lifecycle in the 2026-07-04 revenue build).
//
// Turns a real Stripe payment into an entitlement. The coach/org pays via Checkout
// (billing-checkout); Stripe calls this endpoint; we verify the signature and upsert the
// owner's `subscriptions` row (0010 + 0042) with service_role — the ONLY writer of that
// table. The client only ever READS its own row (queries.ts:fetchEntitlement), so a user
// can never grant themselves a plan. Nothing about the athlete's data is touched; this is
// the ACCESS/billing half only.
//
// Lifecycle handled here:
//   * checkout.session.completed        -> plan becomes active (plan_id, seats, period end)
//                                          + referral reward for the referrer (0042)
//   * customer.subscription.updated     -> status/pause/cancel-at-period-end/plan changes
//   * customer.subscription.deleted     -> canceled, tier back to preview
//   * invoice.payment_failed            -> past_due + payment_failed_at (dunning: the app
//                                          shows "card failed on <date>, update it"; access
//                                          continues through the grace window — isPro())
//   * invoice.paid                      -> recovery: clears the dunning flag
//
// Deploy (JWT OFF — Stripe has no Supabase JWT; the endpoint authenticates itself via the
// Stripe signature instead):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe: create a webhook to <project>/functions/v1/stripe-webhook for the five
// events above.
//
// OWNER RESOLUTION: billing-checkout sets the paying owner's profile id as
// `client_reference_id` and mirrors it into subscription metadata. Renewals/cancellations
// resolve the owner from the row the first event wrote (by stripe ids). Events with no
// resolvable owner are acknowledged (200) and logged, never guessed.
import Stripe from 'npm:stripe@^17';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { STRIPE_PLANS, planIdFromLookupKey } from '../_shared/plans.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const REFERRAL_COUPON = Deno.env.get('STRIPE_REFERRAL_COUPON_ID') ?? '';
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

/** Map a Stripe subscription to our status enum. `pause_collection` set means the coach
 *  paused the plan (portal) — Stripe keeps status 'active' while paused, so check it first.
 *  Paused = keeps the row and the data, no paid access (isPro is false), easy resume. */
function mapStatus(sub: Stripe.Subscription): 'active' | 'past_due' | 'canceled' | 'paused' {
  if (sub.pause_collection) return 'paused';
  const s = sub.status;
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  return 'canceled'; // canceled, incomplete, incomplete_expired, paused(trial-lapse)
}

/** The plan id of a subscription: prefer our metadata (set by billing-checkout), fall back
 *  to the price lookup_key. Null when neither resolves (e.g. a price made outside the doc). */
function planIdOf(sub: Stripe.Subscription): string | null {
  const meta = sub.metadata?.plan_id;
  if (meta && meta in STRIPE_PLANS) return meta;
  return planIdFromLookupKey(sub.items?.data?.[0]?.price?.lookup_key);
}

/** Seats the plan grants: the catalog number for a known plan, else the line quantity. */
function seatsOf(sub: Stripe.Subscription): number | null {
  const plan = planIdOf(sub);
  if (plan && STRIPE_PLANS[plan].seats != null) return STRIPE_PLANS[plan].seats;
  const q = sub.items?.data?.[0]?.quantity;
  return typeof q === 'number' ? q : null;
}

/** current_period_end (unix seconds) → ISO, or null. */
function periodEnd(sub: Stripe.Subscription): string | null {
  return sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
}

/** The columns every subscription-shaped update writes. */
function subFields(sub: Stripe.Subscription) {
  return {
    status: mapStatus(sub),
    plan_id: planIdOf(sub),
    seats: seatsOf(sub),
    current_period_end: periodEnd(sub),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Referral reward (0042): when a checkout carrying referrer metadata completes, record the
 * redemption (idempotent — the PK on referred_owner_id means a Stripe retry can't double-pay)
 * and give the REFERRER their free month by applying the referral coupon to their own live
 * subscription. A referrer with no Stripe subscription yet stays 'pending' — the app shows
 * the earned month and it is applied when they subscribe. Never throws: a referral hiccup
 * must not fail the paying customer's webhook.
 */
async function rewardReferrer(
  svc: ReturnType<typeof createClient>,
  referrerId: string,
  referredId: string,
  code: string,
): Promise<void> {
  try {
    const { data: inserted } = await svc
      .from('referral_redemptions')
      .upsert(
        { referred_owner_id: referredId, referrer_owner_id: referrerId, code, status: 'pending' },
        { onConflict: 'referred_owner_id', ignoreDuplicates: true },
      )
      .select('referred_owner_id');
    if (!inserted || inserted.length === 0) return; // already recorded (retry) — never double-reward

    if (!REFERRAL_COUPON) return;
    const { data: refRow } = await svc
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('owner_id', referrerId)
      .maybeSingle();
    const refSubId = refRow?.stripe_subscription_id;
    if (!refSubId || refRow?.status === 'canceled') return; // stays pending until they hold a live plan

    await stripe.subscriptions.update(refSubId, { discounts: [{ coupon: REFERRAL_COUPON }] });
    await svc
      .from('referral_redemptions')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('referred_owner_id', referredId);
  } catch (e) {
    console.error('stripe-webhook: referral reward failed (redemption kept pending):', e);
  }
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
        // Pull the subscription for plan/seats/period end/status.
        const sub = await stripe.subscriptions.retrieve(subId);
        const { error } = await svc.from('subscriptions').upsert({
          owner_id: ownerId,
          tier: 'team',
          ...subFields(sub),
          payment_failed_at: null,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
        });
        if (error) throw error;

        // Referral loop: billing-checkout stamped the referrer into subscription metadata.
        const referrerId = sub.metadata?.referrer_id ?? '';
        if (UUID_RE.test(referrerId) && referrerId !== ownerId) {
          await rewardReferrer(svc, referrerId, ownerId, sub.metadata?.referral_code ?? '');
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Resolve the owner from the row the checkout wrote (never trust a mutable field here).
        const { error } = await svc
          .from('subscriptions')
          .update(subFields(sub))
          .eq('stripe_subscription_id', sub.id);
        if (error) throw error;
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const { error } = await svc
          .from('subscriptions')
          .update({
            status: 'canceled',
            tier: 'preview',
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        if (error) throw error;
        break;
      }

      case 'invoice.payment_failed': {
        // Dunning: flag the failure with its real date. Access rides the grace window
        // (isPro treats past_due as unlocked) while the app shows "update your card".
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          const { error } = await svc
            .from('subscriptions')
            .update({ status: 'past_due', payment_failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);
          if (error) throw error;
        }
        break;
      }

      case 'invoice.paid': {
        // Recovery: a paid invoice clears the dunning flag and restores 'active'.
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          const { error } = await svc
            .from('subscriptions')
            .update({ status: 'active', payment_failed_at: null, updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);
          if (error) throw error;
        }
        break;
      }

      default:
        // Acknowledge everything else so Stripe stops retrying; we only act on the five above.
        break;
    }
  } catch (e) {
    // A DB error should return 500 so Stripe RETRIES (the event isn't lost). Never leak detail.
    console.error(`stripe-webhook: handling ${event.type} failed:`, e);
    return json({ error: 'handler error' }, 500);
  }

  return json({ received: true });
});
