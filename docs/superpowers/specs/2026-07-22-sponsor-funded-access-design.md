# Sponsor-Funded Access — Design Spec

**Date:** 2026-07-22
**Status:** Approved by delegated authority (founder: "make all the smart decisions, finish end to end") — decisions recorded below.
**Feature area:** Phase 3, feature 3 of 3 (parent-funded plans ✅ → premium reports ✅ → **sponsor-funded access**)
**Builds on:** the platform billing pattern (`billing-checkout`, `stripe-webhook`, `_shared/plans.ts`), the entitlement model (`subscriptions`, `_shared/entitlement.ts`, premium reports), and the OnStandard Pay checkout scaffolding.

## 1. Summary

A **sponsor** (gym, booster club, school, brand — a signed-in user acting as sponsor) buys a batch of **premium seats** and gets a **redemption code**. Athletes redeem the code to unlock the **premium tier** (the same entitlement that unlocks premium reports and the Deep Dive) for the sponsored window. Platform revenue via Stripe (B2B, not IAP). Ties Phase 3 together: sponsor money → premium access → the reports we just built.

### Decisions (made under delegated authority)
- **Sponsor is a signed-in user** (v1) — no public web purchase page; the gym owner/coordinator has an account. (Public sponsor page is a clean follow-up.)
- **What's funded: platform premium seats** (not a specific trainer's packages). Platform revenue, Stripe ad-hoc `price_data` (seats × per-seat price for a fixed window), NOT a Connect destination charge.
- **Grant lives in a NEW `sponsored_access` table**, never by writing `subscriptions` (that's a PK-per-user, Stripe-managed table with a tight tier check). The entitlement check honors EITHER a paid subscription OR an active sponsored grant.
- **Redemption by code** — athlete enters a code in-app; atomic seat claim; one grant per athlete per sponsorship.
- Reuse the OnStandard Pay checkout scaffolding (CORS, rate-limit, resolveUser, `managed_payments` opt-out is NOT needed here — this is a normal platform charge, no Connect destination) and the `stripe-webhook` seam.

## 2. Existing building blocks

- `billing-checkout` / `stripe-webhook`: platform Stripe Checkout → `subscriptions` upsert keyed by `client_reference_id` (buyer profile id) + metadata. The webhook is the single service-role writer.
- `subscriptions(owner_id pk, tier, status, current_period_end)` — the athlete's own paid entitlement. `_shared/entitlement.ts isPremiumUnlocked(sub)` gates the premium features.
- OnStandard Pay: `pay-offer-checkout` (ad-hoc `price_data`, metadata `kind`), `stripe-webhook` offer handling (a template for a new `kind`).

## 3. Data model

Two new tables (migration = next free number at build time; **verify — 0129 is ours, concurrent session holds 0130/0131**; likely `0132`):

```sql
-- A sponsor's paid batch of premium seats.
create table public.sponsorships (
  id             uuid primary key default gen_random_uuid(),
  sponsor_id     uuid not null references profiles(id) on delete cascade,
  sponsor_label  text not null default '',            -- shown to redeemers ("Sponsored by <gym>")
  code           text not null unique,                -- short redemption code (uppercase, no ambiguous chars)
  seats          int  not null check (seats > 0),
  seats_claimed  int  not null default 0 check (seats_claimed >= 0),
  months         int  not null default 12 check (months > 0),  -- access window each redemption grants
  status         text not null default 'active' check (status in ('active','closed')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  amount_cents   int,
  created_at     timestamptz not null default now()
);
create index sponsorships_sponsor_idx on public.sponsorships (sponsor_id);

-- One athlete's claimed seat on a sponsorship.
create table public.sponsored_access (
  athlete_id     uuid not null references profiles(id) on delete cascade,
  sponsorship_id uuid not null references sponsorships(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  primary key (athlete_id, sponsorship_id)
);
create index sponsored_access_active_idx on public.sponsored_access (athlete_id, expires_at);

alter table public.sponsorships enable row level security;
alter table public.sponsored_access enable row level security;
-- Sponsor reads their own batches; a redeemer reads a batch only via the redeem RPC (SECURITY DEFINER).
create policy sponsorships_read_own on public.sponsorships for select using (sponsor_id = auth.uid());
-- Athlete reads their own grants.
create policy sponsored_access_read_own on public.sponsored_access for select using (athlete_id = auth.uid());
-- No client insert/update on either: the webhook (sponsorships) and the redeem RPC (sponsored_access +
-- seats_claimed) are the only writers, both service-role / SECURITY DEFINER.
```

## 4. Backend

### 4.1 `has_premium_access` — combined entitlement (SQL helper + edge helper)
Premium is unlocked by EITHER a paid subscription OR an active sponsored grant. Add a SQL function
`has_premium_access(p_user uuid) returns boolean` (SECURITY DEFINER): true if `isPremiumUnlocked`-equivalent
`subscriptions` row OR a `sponsored_access` row with `expires_at > now()`. The edge functions
(`deep-analysis`, `monthly-report`) call this RPC instead of only reading `subscriptions` — so a
sponsored athlete unlocks the reports too. (Keep the env-flag seam.)

### 4.2 `sponsor-checkout` (new edge function)
Signed-in sponsor POSTs `{ seats, label? }`. Validates `seats` in `[1, 500]`. Creates a Stripe Checkout
Session (`mode:'payment'`, ad-hoc `price_data` = per-seat premium price × `seats`, from a `SPONSOR_SEAT_PRICE_CENTS`
env, default e.g. 2000/seat/year), `client_reference_id = sponsor.id`, `metadata:{ kind:'sponsor_seats', sponsor_id, seats, label }`.
Returns `{ url }`. CORS/rate-limit/resolveUser like the Pay functions.

### 4.3 `stripe-webhook` — record the sponsorship
New branch on `session.metadata.kind === 'sponsor_seats'` in `checkout.session.completed`: create a
`sponsorships` row (generate a unique short `code`; `seats`, `months` from env `SPONSOR_MONTHS` default 12,
the real `amount` from the PaymentIntent, stripe ids). Idempotent on `stripe_checkout_session_id`.

### 4.4 `redeem_sponsor_code(p_code text)` — RPC (SECURITY DEFINER, atomic)
The signed-in athlete redeems. In one statement/transaction: find an `active` sponsorship by code with
`seats_claimed < seats`; if the athlete already has a grant on it → return that (idempotent); else
`insert sponsored_access` (`expires_at = now() + months`) and `update sponsorships set seats_claimed = seats_claimed + 1`
guarded by `seats_claimed < seats` (so concurrent redeems can't oversell). Returns `{ ok, label, expires_at }`
or an error reason (`invalid_code` / `full` / `already_redeemed`). `grant execute ... to authenticated`.

## 5. Surfaces (proto)

- **Sponsor:** a "Sponsor access" screen (reachable from Profile/settings) — enter seats → **Buy seats**
  (opens Stripe checkout via `openExternal`) → after purchase, see the sponsorship: the **code**, seats,
  and claimed count (`sponsorships_read_own`). Shareable code text.
- **Athlete:** a "Redeem a code" screen (Profile) — enter code → `redeem_sponsor_code` → success shows
  "Premium unlocked, sponsored by <label>, until <date>." Errors are plain.
- Both reuse the `roles.callFn`/RPC + `openExternal` patterns.

## 6. Security & consent

Every write is server-side: the webhook creates sponsorships (service role); `redeem_sponsor_code` is
SECURITY DEFINER and does the atomic seat claim (a client can't inflate seats or claim a full/closed batch;
concurrent redeems can't oversell via the `seats_claimed < seats` guard in the UPDATE). RLS: a sponsor sees
only their batches; an athlete sees only their grants; the code itself is the redemption capability (short,
unique, high-entropy enough to not guess in `[1,500]`-seat batches). No minor-specific consent needed (a
sponsored grant only unlocks premium features; it moves no personal data).

## 7. Edge cases

- Oversell race: two athletes redeem the last seat simultaneously → the guarded UPDATE lets exactly one win; the other gets `full`.
- Re-redeem: same athlete, same code → returns their existing grant (idempotent), no double claim.
- Expiry: `has_premium_access` checks `expires_at > now()`; an expired grant simply stops unlocking (no deletion needed).
- Sponsor closes / refund: `status='closed'` stops new redemptions; existing grants stand (v1 — refund handling of already-redeemed seats is out of scope).
- Duplicate webhook: idempotent on `stripe_checkout_session_id`.

## 8. Testing

- Unit: the code generator (format/uniqueness shape) and the redeem outcome mapping (pure parts).
- Live (Stripe test sandbox): sponsor buys seats → checkout → webhook creates the sponsorship + code; athlete redeems → grant + seats_claimed increments; `has_premium_access` now true → `monthly-report` returns 200 for that athlete (ties to premium reports); a 2nd athlete redeems the last seat, a 3rd gets `full`; re-redeem is idempotent; RLS isolates sponsor/athlete reads. Delete all test data; test account/subscriptions removed; LIVE key untouched.

## 9. Out of scope (v1)

Public (non-user) sponsor purchase web page; per-seat revocation/reassignment; sponsor dashboards/analytics;
refund reconciliation of redeemed seats; sponsor-funding a specific trainer's Connect packages (this v1 funds
PLATFORM premium); auto-renew of a sponsorship. Each is a clean follow-up.
