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
//                                          -> OR (metadata.kind='offer_purchase', 0119) records
//                                          an OnStandard Pay offer purchase into offer_payments
//   * customer.subscription.updated     -> status/pause/cancel-at-period-end/plan changes
//   * customer.subscription.deleted     -> canceled, tier back to preview
//                                          -> OR (Task 3) stamps subscription_cancelled_at on every
//                                          offer_payments ledger row for that subscription
//   * invoice.payment_failed            -> past_due + payment_failed_at (dunning: the app
//                                          shows "card failed on <date>, update it"; access
//                                          continues through the grace window — isPro())
//   * invoice.paid                      -> recovery: clears the dunning flag
//                                          -> OR (0119) an offer-subscription renewal invoice
//                                          records a new offer_payments row
//   * charge.refunded                   -> (0119) marks the matching offer_payments row refunded
//
// Deploy (JWT OFF — Stripe has no Supabase JWT; the endpoint authenticates itself via the
// Stripe signature instead):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe: create a webhook to <project>/functions/v1/stripe-webhook for the six events
// above (Connect's own account.updated goes to the SEPARATE connect-webhook endpoint instead).
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
//
// LAZY construction is deliberate: `new Stripe('')` THROWS ("apiKey required"), so building the
// client at module top-level crashed the whole worker at import time when STRIPE_SECRET_KEY was
// unset — the platform then returned a generic WORKER_ERROR 500 and the handler's own config gate
// (below) never ran. Deferring construction until the gate has confirmed the key exists lets an
// unconfigured deploy load cleanly and answer 400/503 instead of crash-looping.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      // Pinned to the version the SDK (npm:stripe@^17) is built against — its types enforce this.
      apiVersion: '2025-02-24.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripe;
}
let _cryptoProvider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | null = null;
function cryptoProvider() {
  if (!_cryptoProvider) _cryptoProvider = Stripe.createSubtleCryptoProvider();
  return _cryptoProvider;
}

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

    await stripeClient().subscriptions.update(refSubId, { discounts: [{ coupon: REFERRAL_COUPON }] });
    await svc
      .from('referral_redemptions')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('referred_owner_id', referredId);
  } catch (e) {
    console.error('stripe-webhook: referral reward failed (redemption kept pending):', e);
  }
}

/**
 * OnStandard Pay (0119): record ONE real charge into offer_payments. `source` is either the
 * Checkout Session's PaymentIntent (one-time offer) or the resulting invoice's Charge (the first
 * or a renewal payment on a recurring offer) — both expose the REAL amount/fee Stripe actually
 * applied, never a value recomputed locally (avoids any drift from a fee change mid-flight).
 * Idempotent on stripe_charge_id so a Stripe webhook retry can never double-record one charge.
 */
async function recordOfferPayment(
  svc: ReturnType<typeof createClient>,
  fields: {
    practiceId: string; offerId: string | null; payerId: string | null; beneficiaryAthleteId: string | null;
    checkoutSessionId: string | null; paymentIntentId: string | null; subscriptionId: string | null;
    chargeId: string | null; amountCents: number; applicationFeeCents: number;
  },
): Promise<void> {
  // Idempotent on stripe_charge_id via the unique index added in 0121 — ON CONFLICT DO NOTHING, so
  // a duplicate OR concurrent Stripe delivery of the same event can never double-record one charge
  // (the old select-then-insert was a check-then-act race). NULL charge ids stay distinct, so a
  // charge-less row is never collapsed into another.
  const { error } = await svc.from('offer_payments').upsert({
    practice_id: fields.practiceId,
    offer_id: fields.offerId,
    payer_id: fields.payerId,
    beneficiary_athlete_id: fields.beneficiaryAthleteId,
    stripe_checkout_session_id: fields.checkoutSessionId,
    stripe_payment_intent_id: fields.paymentIntentId,
    stripe_subscription_id: fields.subscriptionId,
    stripe_charge_id: fields.chargeId,
    amount_cents: fields.amountCents,
    application_fee_cents: fields.applicationFeeCents,
    status: 'paid',
  }, { onConflict: 'stripe_charge_id', ignoreDuplicates: true });
  if (error) throw error;
}

/** A completed Checkout Session for an OnStandard Pay offer (metadata.kind='offer_purchase') —
 *  branches by mode to pull the REAL charged amount/fee off the resulting PaymentIntent (one-time)
 *  or the first invoice's Charge (recurring), then records it. */
async function handleOfferCheckout(svc: ReturnType<typeof createClient>, session: Stripe.Checkout.Session): Promise<void> {
  const practiceId = session.metadata?.practice_id ?? '';
  const offerId = session.metadata?.offer_id ?? null;
  const payerId = session.metadata?.payer_id ?? session.client_reference_id ?? null;
  const beneficiaryAthleteId = session.metadata?.beneficiary_athlete_id ?? null;
  if (!UUID_RE.test(practiceId)) {
    console.error('stripe-webhook: offer checkout with no valid practice_id', session.id);
    return;
  }

  if (session.mode === 'payment') {
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!piId) return;
    const pi = await stripeClient().paymentIntents.retrieve(piId);
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
    await recordOfferPayment(svc, {
      practiceId, offerId, payerId, beneficiaryAthleteId,
      checkoutSessionId: session.id, paymentIntentId: pi.id, subscriptionId: null, chargeId,
      amountCents: pi.amount, applicationFeeCents: pi.application_fee_amount ?? 0,
    });
  } else if (session.mode === 'subscription') {
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return;
    const sub = await stripeClient().subscriptions.retrieve(subId, { expand: ['latest_invoice.charge'] });
    const invoice = sub.latest_invoice as Stripe.Invoice | null;
    const charge = invoice?.charge as Stripe.Charge | null | undefined;
    await recordOfferPayment(svc, {
      practiceId, offerId, payerId, beneficiaryAthleteId,
      checkoutSessionId: session.id, paymentIntentId: null, subscriptionId: sub.id, chargeId: charge?.id ?? null,
      amountCents: invoice?.amount_paid ?? 0, applicationFeeCents: charge?.application_fee_amount ?? 0,
    });
  }
}

/** A renewal invoice (2nd+ payment) on an offer subscription. The FIRST invoice is already
 *  recorded by handleOfferCheckout via checkout.session.completed — only `subscription_cycle`
 *  (a real renewal), never `subscription_create`, reaches here. Returns false when `subId` isn't
 *  a known offer subscription at all (i.e. it belongs to something else, or nothing). */
async function handleOfferRenewal(svc: ReturnType<typeof createClient>, invoice: Stripe.Invoice, subId: string): Promise<boolean> {
  const { data: priorRow } = await svc.from('offer_payments')
    .select('practice_id, offer_id, payer_id, beneficiary_athlete_id').eq('stripe_subscription_id', subId).limit(1).maybeSingle();
  if (!priorRow) return false; // not an offer subscription at all
  if (invoice.billing_reason !== 'subscription_cycle') return true; // known, but not a NEW charge to record

  const chargeId = typeof invoice.charge === 'string' ? invoice.charge : invoice.charge?.id ?? null;
  let applicationFeeCents = 0;
  if (chargeId) {
    const charge = await stripeClient().charges.retrieve(chargeId);
    applicationFeeCents = charge.application_fee_amount ?? 0;
  }
  await recordOfferPayment(svc, {
    practiceId: priorRow.practice_id, offerId: priorRow.offer_id, payerId: priorRow.payer_id,
    beneficiaryAthleteId: priorRow.beneficiary_athlete_id ?? null,
    checkoutSessionId: null, paymentIntentId: null, subscriptionId: subId, chargeId,
    amountCents: invoice.amount_paid, applicationFeeCents,
  });
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Authenticate the request SHAPE first: a webhook call with no Stripe signature is a probe,
  // a scanner, or misdirected traffic — reject it 400. (A 500 here read as OUR crash and, when
  // it came from Stripe, triggered retry storms; 9/10 sibling fns already fail closed cleanly.)
  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing signature' }, 400);

  // Config gate AFTER the signature-presence check. A SIGNED event we can't verify because a
  // secret is unset is a transient server condition: 503 tells Stripe to retry with backoff
  // (the event is preserved for when billing is configured) rather than 500 (also retried but
  // reads as a crash) or 200 (which would silently DROP a real paid event). Billing is not yet
  // live on prod (no STRIPE_* secrets), so today this branch only tames probe traffic; it also
  // makes the endpoint correct the moment the secrets land.
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error('stripe-webhook: missing configuration');
    return json({ error: 'server not configured' }, 503);
  }

  // Verify the signature against the RAW body — this is the endpoint's only authentication.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider());
  } catch (e) {
    console.error('stripe-webhook: signature verification failed:', (e as Error).message);
    return json({ error: 'invalid signature' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // OnStandard Pay (0119): an offer purchase is a DIFFERENT concern from the platform's own
        // owner-subscription billing below — branch off first and never fall through into it.
        if (session.metadata?.kind === 'offer_purchase') {
          await handleOfferCheckout(svc, session);
          break;
        }

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
        const sub = await stripeClient().subscriptions.retrieve(subId);
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

        // OnStandard Pay: this sub id may instead (or additionally) belong to a recurring offer
        // subscription (parent/client cancelled, or Stripe terminated it) rather than a platform
        // plan — the update above only touches `subscriptions` and no-ops if it doesn't match.
        // Stamp every ledger row for that subscription so "Funded plans" shows it stopped. Past
        // paid charges keep status 'paid'.
        const { error: offerError } = await svc.from('offer_payments')
          .update({ subscription_cancelled_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id).is('subscription_cancelled_at', null);
        if (offerError) throw offerError;
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
          const { data: updated, error } = await svc
            .from('subscriptions')
            .update({ status: 'active', payment_failed_at: null, updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId)
            .select('owner_id');
          if (error) throw error;
          // OnStandard Pay (0119): no platform-subscription row matched — this may be a renewal on
          // an OFFER subscription (destination-charge), a different concern entirely.
          if (!updated || updated.length === 0) await handleOfferRenewal(svc, invoice, subId);
        }
        break;
      }

      case 'charge.refunded': {
        // OnStandard Pay (0119): mark the matching ledger row refunded. Never touches the platform
        // owner-subscription tables — a refunded offer charge has no bearing on app access.
        // Stripe fires charge.refunded on ANY refund including partial; the charge.refunded boolean
        // is only true once the FULL amount is returned. Our own refund-payment always refunds in
        // full, so gate on that — a PARTIAL refund issued straight from the Stripe Dashboard must
        // not flip a still-mostly-paid sale to 'refunded'.
        const charge = event.data.object as Stripe.Charge;
        if (charge.refunded === true) {
          const { error } = await svc.from('offer_payments').update({ status: 'refunded' }).eq('stripe_charge_id', charge.id);
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
