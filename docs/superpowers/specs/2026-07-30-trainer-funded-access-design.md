# Trainer-funded access — "Powered by OnStandard"

Design, 2026-07-30. Approach A of three considered.

## The problem

Independent trainers — the coach archetype we're winning first — are billed three times by the
current model:

1. A team-tier seat subscription for their roster (0163: billed on *active* athletes).
2. 15% of every dollar their client pays them, through OnStandard Pay (0119).
3. Their client pays a third, separate bill if they want Premium.

Three bills, one household. A trainer with 20 clients at $200/mo hands over $600/mo and gets back
seats worth roughly $100. The rational move is Venmo, and that is what they do.

Separately, the acquisition funnel cannot close. The public trainer page (0114) collects an
*application*; it cannot collect a *payment*, because `pay-offer-checkout` requires an already-active
`practice_clients` link (index.ts:130-133). The hottest moment in the funnel is the one moment we
cannot take money.

## The flip

**A client billed through OnStandard Pay gets Premium included, funded by the trainer's 15% — and
funded clients drop out of the trainer's seat bill.**

One bill per household. The trainer's incentive inverts: every client they move onto Pay is free to
them and makes their package look more premium. The economics favour us, not just the trainer: 15%
of a $200/mo package is $30/mo from one client, where a seat is a few dollars. We are trading a
small line item for a larger one, and gaining a retained user per client.

The 15% is still steep against Stripe's 2.9%, and we should expect pushback. The gap is closed by
things Venmo cannot do: auto-recurring billing, dunning, and **app access tied to payment status**.
That is the pitch — Pay is not a payment processor, it is the thing that stops you chasing money.
The honest line for a trainer: *raise your package $25, include the app, net the same, stop invoicing
people.*

## Architecture

Everything reuses an existing precedent rather than inventing a mechanism.

**Entitlement.** `has_premium_access` (0163) is one predicate with two arms: your own subscription,
or `sponsored_access` (0132). Trainer-funded is a third arm of identical shape. Every screen that
already respects Premium respects this for free.

**Access falls out of billing.** `trainer_funded_access.expires_at` is pushed forward by the webhook
on each successful invoice. A failed card runs dunning, `expires_at` passes, access lapses. There is
no revocation code path, because there does not need to be one — and this automatic lapse is exactly
the enforcement a trainer cannot build themselves.

**Only recurring offers fund access.** `offers.cadence` allows `month`, `week`, `one-time`,
`session`. Only the first two grant Premium; a $20 single session buying a month of app access is a
hole. The rule states in one sentence: *funded while your subscription to your trainer is live.*

**The trainer rides too.** When a client's grant is written, an owner grant is written alongside it.
A trainer with at least one live funded client is Premium. No fourth predicate arm.

**Client copies are unchanged.** `isPro` (src/core/subscription.ts) and `isPaid` (proto settings.js)
model the *subscription* arm only; extra sources are detected by calling `has_premium_access` and
labelled from the result (settings.js:344-354). Trainer-funded therefore needs no change to the paid
predicate in any runtime — it needs a **source** so the label can read `Premium · via your trainer`
instead of `Premium · sponsored`. The grace constant stays pinned at 7 days across all three.

## Components

**Migration 0166.**
- `trainer_funded_access` (athlete_id, practice_id, stripe_subscription_id, expires_at, is_owner_grant)
  — deny-all, athlete reads own, owner reads via `owns_practice()`, writes service-role only.
- `offer_claims` — a pre-account public purchase mints a `TR-XXXX-XXXX` code to be redeemed in-app.
- `has_premium_access` gains the third arm; grace semantics untouched.
- `active_athlete_count` excludes athletes funded by *that owner's own* practices. Without this the
  trainer pays 15% and a seat for the same person — the double-dip we are deleting. This function
  decides real charges, so it gets its own test.
- `redeem_offer_code(p_code)` — guarded-update redemption in the shape of `redeem_sponsor_code`.
- `my_premium_source()` — returns `subscription | trainer | sponsor | none` for the billing label.
- `my_funded_clients(p_practice)` — the trainer's funded roster readout.

**stripe-webhook.** `handleOfferCheckout` grants on a recurring offer purchase; `handleOfferRenewal`
extends on each `subscription_cycle`; a purchase with no known payer mints an `offer_claims` row
instead, reusing the `handleSponsorSeats` idempotency and code-collision retry.

**public-offer-checkout (new, anon).** Takes `{ slug, offerIndex }` against the published page,
resolves the practice and Connect status server-side, and creates the same destination charge. Never
accepts a raw practice or offer id from the public.

**Surfaces.** Public trainer page gets a real buy button on priced offers with an active Connect
account. The client sees "Includes OnStandard Premium" and, after purchase, `Premium · via your
trainer`. The trainer gets a "Bring your clients" share composer and a funded-roster readout.

## Testing

The SQL predicate and the seat count are behaviour-tested against real Postgres (local `supabase
start` + the docker-exec-psql RLS suite): grant, lapse at `expires_at`, the seat exclusion in both
directions (my funded client excluded, another owner's funded client still counted), redemption
idempotency and wrong-code, and RLS (no client writes anywhere, no cross-athlete reads).

The parity suite keeps pinning the grace constant across the three runtimes and gains coverage that
the source label is derived from the server, not guessed locally.

End-to-end in Stripe test mode: public page → checkout → claim code → redeem → link and Premium; a
`subscription_cycle` invoice advances `expires_at`; a failed renewal lapses access after grace.

## Deliberately not built

- Tiered take rate (15 → 10 → 5%). `fee_percent` is already admin-tunable; a later pricing call.
- Referral revenue share, and a trainer marketplace — the latter needs athlete demand first.
- Repricing tiers, or deciding what free-vs-paid means for athletes. Both remain founder decisions.
- Team-coach (non-monetizing) incentives; the parent-funded and sponsor-funded rails serve them.
