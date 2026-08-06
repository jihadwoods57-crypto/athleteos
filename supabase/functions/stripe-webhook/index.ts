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
//                                          an OnStandard Pay offer purchase into offer_payments,
//                                          and (0166) grants trainer-funded premium to the client
//                                          + their trainer — or, when the buyer has no account
//                                          yet (public trainer page), mints an offer_claims code
//                                          -> OR (metadata.kind='sponsor_seats', Task 4) records a
//                                          sponsorships row with a generated redemption code
//   * customer.subscription.updated     -> status/pause/cancel-at-period-end/plan changes
//   * customer.subscription.deleted     -> canceled, tier back to preview
//                                          -> OR (Task 3) stamps subscription_cancelled_at on every
//                                          offer_payments ledger row for that subscription
//   * invoice.payment_failed            -> past_due + payment_failed_at (dunning: the app
//                                          shows "card failed on <date>, update it"; access
//                                          continues through the grace window — isPro())
//   * invoice.paid                      -> recovery: clears the dunning flag
//                                          -> OR (0119) an offer-subscription renewal invoice
//                                          records a new offer_payments row, and (0166) pushes
//                                          that subscription's funded grants forward — the whole
//                                          "keep paying, keep access" mechanism, with no revoke
//                                          path anywhere: a dead card simply lets a grant expire
//   * charge.refunded                   -> (0119) marks the matching offer_payments row refunded,
//                                          and (0166) REVOKES the trainer-funded access that charge
//                                          bought — otherwise buy/refund/keep-the-app is a free ride
//   * charge.dispute.created            -> a chargeback is a refund taken by force: same revocation
//
// Deploy (JWT OFF — Stripe has no Supabase JWT; the endpoint authenticates itself via the
// Stripe signature instead):
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then in Stripe: create a webhook to <project>/functions/v1/stripe-webhook for the SEVEN events
// above (Connect's own account.updated goes to the SEPARATE connect-webhook endpoint instead).
// charge.dispute.created is new with 0166 — an existing endpoint will not be subscribed to it, and
// without it a chargeback silently keeps its premium.
//
// OWNER RESOLUTION: billing-checkout sets the paying owner's profile id as
// `client_reference_id` and mirrors it into subscription metadata. Renewals/cancellations
// resolve the owner from the row the first event wrote (by stripe ids). Events with no
// resolvable owner are acknowledged (200) and logged, never guessed.
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { STRIPE_PLANS, planIdFromLookupKey } from '../_shared/plans.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const REFERRAL_COUPON = Deno.env.get('STRIPE_REFERRAL_COUPON_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Claim-code delivery (0166). Optional: without the key the code is still minted and still shown on
// the success page — the email is redundancy, not the only copy. Sender name reuses the verified
// GUARDIAN_EMAIL_FROM so there is one sender identity to verify with the vendor, not two.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('GUARDIAN_EMAIL_FROM') ?? 'OnStandard <support@onstandard.app>';

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

// Trainer-funded access (0166) is maintained ENTIRELY from billing events: a grant is written when
// an offer subscription is paid and extended on every renewal, so a failed card runs dunning, the
// grant ages out, and access lapses on its own. There is deliberately no revoke path — if you find
// yourself writing one, the expiry maintenance below is what actually needs fixing.
//
// Matches GRACE_DAYS in src/core/subscription.ts / proto settings.js / the SQL predicate: a client
// keeps the app for a week past the period end while Stripe retries the card.
const FUNDED_GRACE_DAYS = 7;

/** period_end (unix seconds) + grace, as an ISO timestamp. Falls back to one month out when Stripe
 *  gives us no period end, so a paid client is never left un-granted by a missing field. */
function fundedExpiry(periodEndSeconds: number | null | undefined): string {
  const base = periodEndSeconds ? periodEndSeconds * 1000 : Date.now() + 30 * 86400000;
  return new Date(base + FUNDED_GRACE_DAYS * 86400000).toISOString();
}

/**
 * Grant (or extend) trainer-funded premium for one client, and for their trainer alongside them.
 * The owner grant is why a trainer running money through Pay never sees a paywall; it rides the
 * same subscription id so it lapses with the client's.
 *
 * `greatest(existing, new)` semantics live in the table's ON CONFLICT via a manual read-modify —
 * PostgREST upsert cannot express `greatest()`, so out-of-order Stripe deliveries (a renewal
 * arriving before the checkout it follows) must never SHORTEN a grant.
 */
async function grantTrainerFunded(
  svc: ReturnType<typeof createClient>,
  fields: { athleteId: string; practiceId: string; subscriptionId: string; offerId: string | null; expiresAt: string },
): Promise<void> {
  const { data: practice } = await svc.from('practices')
    .select('owner_id').eq('id', fields.practiceId).maybeSingle();
  if (!practice?.owner_id) {
    console.error('stripe-webhook: funded grant skipped, unknown practice', fields.practiceId);
    return;
  }

  // The trainer is granted too — but never a self-grant row if the trainer somehow bought their
  // own offer, which would otherwise collide on the (athlete, subscription) primary key.
  const rows = [{
    athlete_id: fields.athleteId, practice_id: fields.practiceId,
    stripe_subscription_id: fields.subscriptionId, offer_id: fields.offerId,
    is_owner_grant: false, expires_at: fields.expiresAt,
  }];
  if (practice.owner_id !== fields.athleteId) {
    rows.push({
      athlete_id: practice.owner_id, practice_id: fields.practiceId,
      stripe_subscription_id: fields.subscriptionId, offer_id: fields.offerId,
      is_owner_grant: true, expires_at: fields.expiresAt,
    });
  }

  for (const row of rows) {
    const { data: existing } = await svc.from('trainer_funded_access')
      .select('expires_at')
      .eq('athlete_id', row.athlete_id).eq('stripe_subscription_id', row.stripe_subscription_id)
      .maybeSingle();
    if (existing && new Date(existing.expires_at).getTime() >= new Date(row.expires_at).getTime()) continue;
    const { error } = await svc.from('trainer_funded_access')
      .upsert(row, { onConflict: 'athlete_id,stripe_subscription_id' });
    if (error) throw error;
  }
}

// Read-aloud code alphabet (no 0/O/1/I) — a trainer WILL read this to a client over the phone.
//
// CSPRNG, not Math.random(). A claim code is a bearer credential: redeeming one joins you to a
// practice and turns on Premium that someone else is paying for. The mint path is PUBLIC by
// design, so an attacker can buy a few offers, collect their own codes, recover V8's xorshift128+
// state from them, and predict the codes issued to other buyers on the same isolate. The unique
// index bounds COLLISIONS; it does nothing about PREDICTABILITY.
//
// The alphabet is 32 chars — a power of two — so `byte % 32` is unbiased with no rejection loop.
// 10 chars is 50 bits, still short enough to dictate over a phone.
function randomCode(len: number): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (const n of buf) s += A[n % A.length];
  return s;
}

/** Single-use, expiring, and bound to one Stripe subscription — but still unguessable. */
function offerClaimCode(): string {
  const s = randomCode(10);
  return `TR-${s.slice(0, 5)}-${s.slice(5)}`;
}

/**
 * A purchase from the PUBLIC trainer page has no account to grant — that is the whole point of the
 * pay-first funnel — so mint a claim code the buyer redeems after signing up (redeem_offer_code,
 * 0166, creates the practice link and both grants in one transaction).
 *
 * Idempotency and the collision retry follow handleSponsorSeats exactly: a duplicate Stripe
 * delivery must never mint a SECOND code for one payment (the buyer would have two codes and one
 * subscription), so the session id carries a unique index and a 23505 on it means "already done".
 */
async function mintOfferClaim(
  svc: ReturnType<typeof createClient>,
  fields: { practiceId: string; offerId: string | null; subscriptionId: string; sessionId: string; email: string | null },
): Promise<void> {
  const { data: existing } = await svc.from('offer_claims')
    .select('id').eq('stripe_checkout_session_id', fields.sessionId).maybeSingle();
  if (existing) return;

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = offerClaimCode();
    const { error } = await svc.from('offer_claims').insert({
      code,
      practice_id: fields.practiceId,
      offer_id: fields.offerId,
      stripe_subscription_id: fields.subscriptionId,
      stripe_checkout_session_id: fields.sessionId,
      payer_email: fields.email,
    });
    if (!error) { await emailOfferClaim(fields.email, code); return; }
    if (error.code !== '23505') throw error;
    // Same two-constraint disambiguation as sponsorships: a SESSION collision means a concurrent
    // delivery already minted this claim (done); a CODE collision means retry with a fresh code.
    const blob = `${error.message || ''} ${(error as { details?: string }).details || ''}`;
    if (blob.includes('stripe_checkout_session_id') || blob.includes('offer_claims_stripe_checkout_session_id_key')) return;
  }
  throw new Error('offer claim code generation failed after retries');
}

/**
 * Money came back, so access goes back. Expires every trainer-funded grant riding the refunded
 * charge's subscription — the client's and the trainer's owner grant together, since they share the
 * subscription id.
 *
 * Expiring (rather than deleting) keeps the audit trail and means recovery needs no special case:
 * if the client pays again, handleOfferRenewal pushes expires_at forward and they are back. The
 * trainer only loses premium if this was their LAST funded client; grants from other clients are
 * untouched because the update is scoped by subscription.
 */
async function revokeFundedForCharge(svc: ReturnType<typeof createClient>, chargeId: string): Promise<void> {
  const { data: row } = await svc.from('offer_payments')
    .select('stripe_subscription_id').eq('stripe_charge_id', chargeId).maybeSingle();
  const subId = row?.stripe_subscription_id;
  if (!subId) return;   // a one-time offer purchase never granted access — nothing to take back
  const now = new Date().toISOString();
  const { error } = await svc.from('trainer_funded_access')
    .update({ expires_at: now }).eq('stripe_subscription_id', subId).gt('expires_at', now);
  if (error) throw error;
  // An unredeemed claim for a refunded payment must never become redeemable premium later.
  await svc.from('offer_claims')
    .update({ expires_at: now }).eq('stripe_subscription_id', subId).eq('status', 'pending');
}

/**
 * Email the claim code to the buyer. This is a REAL backup, not a nicety: the code is the only
 * thing standing between someone who has already been charged and the thing they bought, and the
 * success page that shows it is one closed tab away from being gone forever.
 *
 * Best-effort by design (the guardian-request pattern): with no RESEND_API_KEY the claim is still
 * minted and still redeemable from the success page, and a send failure must never fail the webhook
 * — Stripe would retry the whole event and we would be re-processing a completed payment to fix an
 * email.
 */
async function emailOfferClaim(email: string | null, code: string): Promise<void> {
  if (!email || !RESEND_API_KEY) return;
  // `code` is generated from a fixed alphabet, never user input, so it is safe to interpolate.
  // Branded header (brand law, docs/brand/LOGO.md): hosted PNG mark + two-tone wordmark.
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#0F172A;line-height:1.5">
    <div style="height:4px;background:linear-gradient(120deg,#34D399,#22D3EE,#3B82F6);border-radius:2px;margin-bottom:18px"></div>
    <p style="margin:0 0 18px"><img src="https://onstandard.app/assets/brand/email-mark.png" width="30" height="30" alt="" style="vertical-align:middle;border-radius:9px"> <span style="font-size:17px;font-weight:800;letter-spacing:-.3px;vertical-align:middle"><span style="color:#0F172A">On</span><span style="color:#2563EB">Standard</span></span></p>
    <p>Your payment is confirmed — thanks for signing up with your trainer on OnStandard.</p>
    <p>Download the app, create your account, and enter this code to connect with them. Your OnStandard membership is included in what you already pay your trainer.</p>
    <p style="font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:800;letter-spacing:0.06em">${code}</p>
    <p style="color:#64748B;font-size:13px">This code works once. Questions: support@onstandard.app</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: 'Your OnStandard code', html }),
    });
    if (!r.ok) console.error('stripe-webhook: claim email failed', r.status);
  } catch (e) {
    console.error('stripe-webhook: claim email error', e);
  }
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

    // Trainer-funded premium (0166) — RECURRING ONLY, which `mode === 'subscription'` already
    // guarantees: pay-offer-checkout opens a subscription Checkout for month/week cadences and a
    // one-off payment for 'one-time'/'session'. That is the rule stated plainly — you are funded
    // while your subscription to your trainer is live — and it is why a $20 single session cannot
    // buy a month of app access.
    //
    // A parent-funded purchase grants the CHILD, not the payer: the athlete is who uses the app.
    const grantee = beneficiaryAthleteId || payerId;
    const expiresAt = fundedExpiry(sub.current_period_end);
    if (grantee) {
      await grantTrainerFunded(svc, { athleteId: grantee, practiceId, subscriptionId: sub.id, offerId, expiresAt });
    } else {
      // No account behind this payment — a stranger bought from the public trainer page. Mint a
      // claim code instead; redeem_offer_code turns it into the link + the grants after signup.
      await mintOfferClaim(svc, {
        practiceId, offerId, subscriptionId: sub.id, sessionId: session.id,
        email: session.customer_details?.email ?? session.customer_email ?? null,
      });
    }
  }
}

/** A completed marketplace hire (metadata.kind='marketplace_hire') — the inverse of an offer
 *  purchase: there the buyer was already a client; here the paid checkout IS what creates the
 *  relationship. Order matters — link first, so even if payment recording throws and Stripe
 *  retries, the client is attached and every later step is idempotent (payment upserts on
 *  charge id, agreement upserts on session id, grants never shorten). Renewals then ride the
 *  ordinary invoice.paid → handleOfferRenewal path because recordOfferPayment made this
 *  subscription a known offer subscription. */
async function handleMarketplaceHire(svc: ReturnType<typeof createClient>, session: Stripe.Checkout.Session): Promise<void> {
  const practiceId = session.metadata?.practice_id ?? '';
  const payerId = session.metadata?.payer_id ?? session.client_reference_id ?? '';
  const tier = session.metadata?.tier ?? '';
  if (!UUID_RE.test(practiceId) || !UUID_RE.test(payerId)) {
    console.error('stripe-webhook: marketplace hire with bad ids', session.id);
    return;
  }

  // 1. The relationship. Reactivate a lapsed link rather than duplicating it (same shape as
  //    redeem_offer_code, 0166) — the coach's roster, chat, and RLS visibility all key off this row.
  const { error: linkErr } = await svc.from('practice_clients')
    .upsert({ practice_id: practiceId, client_id: payerId, status: 'active' },
            { onConflict: 'practice_id,client_id' });
  if (linkErr) throw linkErr;

  // 2. Payment ledger + trainer-funded premium — identical mechanics to an offer purchase, and
  //    handleOfferCheckout reads only the metadata fields both kinds share.
  await handleOfferCheckout(svc, session);

  // 3. The agreement record (legal): what plan, what price, which agreement version, when.
  //    Idempotent on the checkout session id.
  const { data: offer } = await svc.from('offers')
    .select('price_cents').eq('id', session.metadata?.offer_id ?? '').maybeSingle();
  const { error: agreeErr } = await svc.from('coach_agreements').upsert({
    client_id: payerId,
    practice_id: practiceId,
    tier: ['essential', 'daily', 'high_touch'].includes(tier) ? tier : 'essential',
    price_cents: offer?.price_cents ?? session.amount_total ?? 0,
    agreement_version: session.metadata?.agreement_version ?? 'v1',
    stripe_checkout_session_id: session.id,
  }, { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true });
  if (agreeErr) throw agreeErr;
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

  // Push every grant on this subscription forward (0166). This single UPDATE is the entire
  // "keep paying, keep access" mechanism — it covers the client and the trainer's owner grant at
  // once, and it is a no-op for a claim nobody has redeemed yet, which is correct: an unredeemed
  // claim has no grants to extend and its own 90-day window is untouched.
  /* THE LINE ITEM'S period, not the invoice's. Stripe's own docs on Invoice.period_end: "End of the
     usage period during which invoice items were added to this invoice. This looks back one period
     for a subscription invoice. Use the line item period to get the service period." So on a
     renewal invoice, invoice.period_end is roughly NOW — the end of the period just billed — while
     the period this payment BUYS is on the line item.

     Reading it the wrong way round meant every renewal pushed the grant to now + 7 days of grace
     instead of to the end of the month just paid for: a client paying $200/mo lost the app about
     three weeks into every cycle, and the only visible symptom would have been "my clients keep
     getting locked out" with a perfectly healthy Stripe subscription behind it. */
  const servicePeriodEnd = invoice.lines?.data?.[0]?.period?.end ?? invoice.period_end ?? null;
  const renewedTo = fundedExpiry(servicePeriodEnd);
  const { error: grantErr } = await svc.from('trainer_funded_access')
    .update({ expires_at: renewedTo })
    .eq('stripe_subscription_id', subId)
    .lt('expires_at', renewedTo);   // never SHORTEN a grant on an out-of-order delivery
  if (grantErr) throw grantErr;
  return true;
}

// Short, unambiguous redemption code (no 0/O/1/I). Now CSPRNG-backed for the reason spelled out
// above randomCode(): a sponsor code is a bearer credential for premium access, and the unique
// index it used to lean on bounds collisions, not prediction. Format and length are unchanged, so
// every code already issued keeps working.
function sponsorCode(): string {
  const s = randomCode(8);
  return `SP-${s.slice(0, 4)}-${s.slice(4)}`;
}

async function handleSponsorSeats(svc: ReturnType<typeof createClient>, session: Stripe.Checkout.Session): Promise<void> {
  const sponsorId = session.metadata?.sponsor_id ?? session.client_reference_id ?? '';
  if (!UUID_RE.test(sponsorId)) { console.error('stripe-webhook: sponsor_seats with no sponsor_id', session.id); return; }
  // Idempotent — a Stripe retry must not create a second batch for the same checkout.
  const { data: existing } = await svc.from('sponsorships').select('id').eq('stripe_checkout_session_id', session.id).maybeSingle();
  if (existing) return;
  const seats = Math.max(1, Math.floor(Number(session.metadata?.seats ?? '1')) || 1);
  const label = (session.metadata?.label ?? '').toString().slice(0, 80);
  const months = Math.max(1, Math.floor(Number(Deno.env.get('SPONSOR_MONTHS') ?? '12')) || 12);
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  let amount: number | null = null;
  if (piId) { try { const pi = await stripeClient().paymentIntents.retrieve(piId); amount = pi.amount ?? null; } catch { /* best-effort */ } }
  // Insert with a fresh code; on the rare unique-code collision, retry a couple of times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await svc.from('sponsorships').insert({
      sponsor_id: sponsorId, sponsor_label: label, code: sponsorCode(), seats, months,
      stripe_checkout_session_id: session.id, stripe_payment_intent_id: piId, amount_cents: amount,
    });
    if (!error) return;
    // Distinguish the two unique constraints. supabase-js puts the CONSTRAINT NAME in .message and the
    // column in .details, so check both blobs: a session-id collision means a concurrent delivery already
    // inserted this batch (idempotent — return); a code collision means retry with a fresh code.
    if (error.code !== '23505') throw error;
    const blob = `${error.message || ''} ${(error as { details?: string }).details || ''}`;
    if (blob.includes('sponsorships_session_uq') || blob.includes('stripe_checkout_session_id')) return;
  }
  throw new Error('sponsor code generation failed after retries');
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

        // Coach Marketplace hire (0184): the ONE place a paid marketplace relationship is created.
        if (session.metadata?.kind === 'marketplace_hire') {
          await handleMarketplaceHire(svc, session);
          break;
        }

        if (session.metadata?.kind === 'sponsor_seats') {
          await handleSponsorSeats(svc, session);
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

        // FOUNDING 50 BECOMES CLAIMABLE. The 0161 ledger was built with a service-role-only claim
        // function that no code ever called, so the promise on four landing pages could apply to
        // nobody. The claim moment is HERE — a completed checkout, not a created session — because
        // "the first 50 coaches and facilities" has to mean the first 50 who actually subscribed,
        // not the first 50 who opened a checkout page and left. claim_founding_slot is idempotent
        // (re-claiming returns the existing slot) and enforces its own 50-cap, so a webhook retry
        // can never double-claim and customer #51 is simply told no. Locked at the CURRENT price
        // generation and this subscription's own plan overage rate ($10 pro, $15 org, STRIPE_PLANS)
        // — what "today's price" means, for THIS plan, on the day they claimed. A plan the map
        // doesn't know (e.g. Enterprise, sold outside self-serve) falls back to the pro rate rather
        // than guessing org pricing onto a custom deal. Best-effort: a failed claim must never 500
        // an otherwise-processed payment event (Stripe would retry the whole thing); it logs, and
        // the founder can grant manually.
        try {
          const claimPlanId = planIdOf(sub);
          const claimExtraSeatCents = claimPlanId ? STRIPE_PLANS[claimPlanId]?.extraSeatCents ?? 1000 : 1000;
          const { data: claim, error: claimErr } = await svc.rpc('claim_founding_slot', {
            p_user: ownerId,
            p_generation: Deno.env.get('PRICE_GENERATION') ?? '',
            p_extra_seat_cents: claimExtraSeatCents,
            p_note: `auto-claim on checkout ${session.id}`,
          });
          const row = Array.isArray(claim) ? claim[0] : claim;
          if (claimErr) console.error('stripe-webhook: founding claim errored', claimErr.message);
          else if (row?.ok) console.log(`stripe-webhook: founding slot ${row.slot_no} -> ${ownerId}`);
        } catch (e) {
          console.error('stripe-webhook: founding claim threw', String((e as Error)?.message ?? e));
        }

        // Give the new subscription an honest seats_used immediately rather than waiting for the
        // nightly overage run — the Plan & billing screen reads it on the coach's next open.
        try { await svc.rpc('stamp_seats_used'); } catch { /* the cron will catch it up */ }
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
        // OnStandard Pay (0119): mark the matching ledger row refunded. It does NOT touch the
        // platform owner-subscription tables — a refunded offer charge says nothing about the
        // coach's own plan. It does, since 0166, have to take back TRAINER-FUNDED access: the
        // offer charge is what grants that premium, so leaving it alone made "buy, refund, keep
        // the app" a repeatable free ride.
        //
        // Stripe fires charge.refunded on ANY refund including partial; the charge.refunded boolean
        // is only true once the FULL amount is returned. Our own refund-payment always refunds in
        // full, so gate on that — a PARTIAL refund issued straight from the Stripe Dashboard must
        // not flip a still-mostly-paid sale to 'refunded', nor cut off a client mid-month.
        const charge = event.data.object as Stripe.Charge;
        if (charge.refunded === true) {
          const { error } = await svc.from('offer_payments').update({ status: 'refunded' }).eq('stripe_charge_id', charge.id);
          if (error) throw error;
          await revokeFundedForCharge(svc, charge.id);
        }
        break;
      }

      case 'charge.dispute.created': {
        // A chargeback is a refund the customer took by force: the money is gone the moment the
        // dispute opens (Stripe pulls it immediately), so access has to go with it. Same handling
        // as a refund, and deliberately NOT waiting for dispute.closed — if we win the dispute the
        // next renewal invoice restores the grant on its own.
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        if (chargeId) {
          await svc.from('offer_payments').update({ status: 'refunded' }).eq('stripe_charge_id', chargeId);
          await revokeFundedForCharge(svc, chargeId);
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
