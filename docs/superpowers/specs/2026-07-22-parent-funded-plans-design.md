# Parent-Funded Plans — Design Spec

**Date:** 2026-07-22
**Status:** Approved (brainstorm) — pending spec review before implementation planning
**Feature area:** Phase 3, feature 1 of 3 (parent-funded plans → premium reports → sponsor-funded access)
**Builds on:** OnStandard Pay (Stripe Connect, migrations `0119`/`0121`, `pay-offer-checkout` / `refund-payment` / `stripe-webhook`) and the existing parent/guardian infrastructure.

## 1. Summary

Let a **parent pay for a trainer's coaching package on behalf of their child.** It is the exact
client→trainer checkout we already built and verified, with the **parent as payer** and the **child
as beneficiary**. Parent-initiated (the parent browses their child's trainer's packages and pays
from their own dashboard). Supports one-time and recurring packages, with a parent-usable **cancel**
for recurring ones.

### Decisions locked in brainstorming
- **What's funded:** a coach/trainer's package (an `offers` row) — *not* the child's app premium.
  This reuses the Stripe Connect destination-charge rails and is IAP-exempt (a real coaching service).
- **Initiation:** parent-initiated only. No trainer-sent payment-request object in v1.
- **Recurring:** supported, with a parent-facing **Cancel** flow that also serves the plain
  client-pays flow (which has no cancel today).
- **Approach:** thin extension of the Pay rails — one nullable ledger column, one parent-facing
  discovery RPC, an extension to `pay-offer-checkout`, and one new cancel function. No new tables.

## 2. Existing building blocks (verified)

- `guardianships(athlete_id, guardian_id, relationship, status)` — parent (`guardian_id`) ↔ child
  (`athlete_id`); `status='active'` is the live link. Index on `guardian_id where status='active'`.
- `practice_clients(practice_id, client_id, status, …)` — child (`client_id`) ↔ trainer practice;
  `status='active'` is the live link.
- `practices(owner_id, stripe_connect_account_id, stripe_connect_status, …)` — `status='active'`
  means the trainer can accept payments. The `0121` `practices_guard_connect` trigger already stops
  anyone but the server from moving those columns.
- `offers(practice_id, name, blurb, price_cents, cadence, features, active, sort)` — the packages.
- `offer_payments(payer_id, practice_id, offer_id, stripe_*_id, amount_cents, application_fee_cents,
  status, …)` — the ledger; `0121` gives it a unique index on `stripe_charge_id` (idempotency).
- Edge functions: `pay-offer-checkout` (Checkout Session w/ destination charge + `managed_payments`
  opt-out), `refund-payment` (reverse_transfer + refund_application_fee), `stripe-webhook`
  (`handleOfferCheckout` records the ledger row from real Stripe values).
- Existing RPCs: `my_trainer_offers()` (client's own trainer's payable offers), `my_connect_status`,
  `my_practice_payments`.

## 3. Data model change

Two nullable columns on the ledger; no new tables, no touching the existing status check constraint:

```sql
alter table public.offer_payments
  add column beneficiary_athlete_id  uuid references profiles(id) on delete set null,
  add column subscription_cancelled_at timestamptz;
-- beneficiary_athlete_id: null = client bought for themselves (today's flow, unchanged);
--                         set  = a guardian funded this for that child.
-- subscription_cancelled_at: stamped on every row of a recurring offer's subscription once the
--   payer cancels (or Stripe reports it deleted). Per-charge `status` stays 'paid'/'refunded'/'failed'
--   — a past charge was genuinely paid; cancellation is a property of the SUBSCRIPTION, not a charge.
create index offer_payments_beneficiary_idx on public.offer_payments (beneficiary_athlete_id)
  where beneficiary_athlete_id is not null;
```

No new tables. The `status` check constraint from `0119` is intentionally left unchanged. Migration number = next free on the shared tree at build time (0121 is ours, the
concurrent Command Center session holds 0120/0122 — **verify the highest number just before
creating the file** and apply directly, not via `db push`, per the Pay-build lesson).

## 4. Backend

### 4.1 `my_funded_offers()` — parent discovery RPC
The parent version of `my_trainer_offers`. For the signed-in guardian: for each child with an
`active` guardianship, if that child is an `active` `practice_clients` member of a practice whose
`stripe_connect_status='active'`, return the child + trainer name + that practice's active, priced
offers. `SECURITY DEFINER`, gated on `auth.uid()` = `guardian_id`. Shape:
`{ child_id, child_name, practice_id, trainer_name, offers:[{offer_id,name,blurb,price_cents,cadence,features}] }[]`.

### 4.2 `pay-offer-checkout` — extended (backward compatible)
Accept optional `beneficiaryAthleteId`. When present:
1. Verify an **active guardianship** exists: `guardianships(athlete_id=beneficiary, guardian_id=caller, status='active')`.
2. Verify the **child is an active client** of the offer's practice:
   `practice_clients(practice_id=offer.practice_id, client_id=beneficiary, status='active')`.
3. Add `beneficiary_athlete_id` to the session + payment/subscription `metadata`.

When absent → today's exact behavior (buyer must be an active client themselves). All existing
checks (offer active+priced, Connect active, fee from `pay_platform_config`, `managed_payments`
opt-out) are unchanged.

### 4.3 `stripe-webhook` — record the beneficiary
`handleOfferCheckout` / `handleOfferRenewal` read `metadata.beneficiary_athlete_id` and pass it into
`recordOfferPayment`, which writes it to the new column. Idempotency and money values are unchanged.

### 4.4 `cancel-offer-subscription` — new edge function
Lets the **payer** (parent or client) cancel their own recurring offer subscription. Verifies the
caller is the `payer_id` on an `offer_payments` row carrying a `stripe_subscription_id` that isn't
already cancelled; calls Stripe `subscriptions.cancel`; optimistically stamps
`subscription_cancelled_at = now()` on **every** row for that `stripe_subscription_id`. A new
`stripe-webhook` case for `customer.subscription.deleted` sets the same stamp independently (so a
cancellation made anywhere still lands). CORS + rate-limit + `resolveUser` exactly like the other
Pay functions. (One-time purchases have no `stripe_subscription_id`, so they are never cancellable —
correct.)

### 4.5 `my_funded_plans(p_limit)` — parent's list
The parent's own funded plans for the dashboard: their `offer_payments` rows where
`payer_id=auth.uid()` and `beneficiary_athlete_id is not null`, joined to offer name + child name,
newest first. Recurring plans are grouped by `stripe_subscription_id` and reported as **Active** or
**Cancelled** from `subscription_cancelled_at`; one-time purchases show as a single paid line.

## 5. Surfaces (proto)

- **Parent dashboard → "Fund a plan":** pick child → that child's trainer's packages
  (`my_funded_offers`) → **Pay** (calls extended `pay-offer-checkout` with `beneficiaryAthleteId`,
  opens Stripe checkout via the existing `openExternal` bridge). Empty states: child has no active
  trainer, or the trainer hasn't finished payment setup.
- **Parent dashboard → "Funded plans":** `my_funded_plans` list with status; a **Cancel** button on
  recurring rows (calls `cancel-offer-subscription`, `window.confirm` guard, reload).
- **Trainer Grow → Payments:** each row labelled **"Parent-funded for [child]"** when
  `beneficiary_athlete_id` is set (extend `my_practice_payments` to return the beneficiary name).

## 6. Security & consent

Every money path server-verifies the **full chain under the service role**, never trusting client
input (same discipline as the Pay build): caller **is** the child's active guardian **and** child
**is** an active client of that exact practice **and** practice Connect is `active`. A guardian can
only ever fund for a child they actively guardian; a stranger passing another child's id is rejected
(403). The `0121` write-guard and the `stripe_charge_id` unique index continue to protect the shared
tables. Minors: the guardian *is* the consenting adult, so no additional consent gate beyond the
active-guardianship check.

## 7. Edge cases

- **Child un-links from the trainer mid-subscription:** the recurring charge keeps billing the
  parent (Stripe subscription is independent of the app link); the parent can Cancel. `my_funded_offers`
  stops offering *new* purchases once the link is inactive. (Acceptable v1 behavior; documented.)
- **Guardianship revoked after funding:** existing subscription is unaffected (parent still owns the
  Stripe subscription and can cancel); no *new* funding possible.
- **Parent with multiple children / a child eligible under one trainer:** `my_funded_offers` returns
  one group per (child, practice); the `beneficiary_athlete_id` column keeps payments unambiguous.
- **Refund of a parent-funded charge:** unchanged — the trainer's `refund-payment` path already
  handles it (reverse_transfer + refund_application_fee); the ledger row flips to `refunded`.
- **Double-billing / duplicate webhook:** already prevented by the `0121` idempotency index.

## 8. Testing

Same bar as the Pay build: unit-test the pure gating logic; then a full live end-to-end run against
the **Stripe test sandbox** — seed a guardian + child + trainer (active Connect) + active
`practice_clients` link, fund a one-time and a recurring offer as the parent, confirm the ledger row
carries the correct `beneficiary_athlete_id` and money values, cancel the recurring one and confirm
Stripe + ledger reflect it, refund one and confirm the flip. **Delete all test data afterward;
production stays pristine.** LIVE Stripe key never used for a mutation.

## 9. Out of scope (v1)

Trainer-sent payment requests; parent-funding the child's app premium (IAP); multiple funders per
plan; partial funding; proration/upgrade of a funded plan (cancel + re-fund covers it). Each is a
clean follow-up if wanted.
