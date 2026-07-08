-- OnStandard — billing lifecycle (revenue build 2026-07-04).
--
-- Extends the 0010 subscriptions seam from "a row exists" to the full paid lifecycle the
-- client renders honestly:
--   * plan_id            — WHICH catalog plan was bought (pro_solo / professional / org_*).
--                          0010 only knew tier='team'; the price catalog (src/core/pricing.ts)
--                          needs the id to show the right name, seat limit, and terms.
--   * status 'paused'    — Stripe pause_collection: a coach who pauses keeps their row (and
--                          their data) without paid access. Pause-instead-of-cancel is a
--                          churn-recovery lever: a pause keeps the relationship, a cancel ends it.
--   * cancel_at_period_end — "canceling on <date>" is rendered differently from "canceled":
--                          access continues to period end and the UI can offer a save.
--   * payment_failed_at  — dunning: when the last invoice failed, so the client can show
--                          "your card failed on <date>, update it to keep access" with a real
--                          date instead of a vague warning. Cleared on recovery.
--
-- All columns are written ONLY by the stripe-webhook (service_role); RLS from 0010 is
-- unchanged (owner reads own row, client never writes). Additive + idempotent.

alter table subscriptions add column if not exists plan_id text;
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table subscriptions add column if not exists payment_failed_at timestamptz;

-- Widen the status enum to include 'paused'. Constraint name is the Postgres default for an
-- inline check on subscriptions.status.
alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('preview', 'active', 'past_due', 'canceled', 'paused'));

-- ---------------------------------------------------------------- referrals
-- The referral loop (give a month / get a month). Each profile owns a short share code;
-- a redemption row records who brought whom. The REWARD is granted in Stripe (promotion
-- code at checkout for the new customer; a coupon applied to the referrer's subscription
-- by the webhook when the referred subscription's first invoice is paid) — this table is
-- the durable record the app renders ("2 friends joined, 2 free months earned") and the
-- webhook's idempotency guard (one reward per referred owner, ever).
create table if not exists referral_codes (
  owner_id   uuid primary key references profiles(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

create table if not exists referral_redemptions (
  referred_owner_id uuid primary key references profiles(id) on delete cascade,
  referrer_owner_id uuid not null references profiles(id) on delete cascade,
  code              text not null,
  -- pending: referred checkout completed; rewarded: referrer's coupon applied.
  status            text not null default 'pending' check (status in ('pending', 'rewarded')),
  created_at        timestamptz not null default now(),
  rewarded_at       timestamptz,
  -- No self-referrals.
  constraint referral_not_self check (referred_owner_id <> referrer_owner_id)
);
create index if not exists referral_redemptions_referrer on referral_redemptions (referrer_owner_id);

alter table referral_codes enable row level security;
alter table referral_redemptions enable row level security;

-- A user reads/creates their OWN code (client-generated short code, unique-checked by the
-- db); nobody updates or deletes codes from the client.
create policy referral_codes_read_own on referral_codes
  for select using (owner_id = auth.uid());
create policy referral_codes_insert_own on referral_codes
  for insert with check (owner_id = auth.uid());

-- Referrers see who they brought (name resolution stays behind existing profile RLS);
-- redemptions are WRITTEN only by the webhook/checkout (service_role) so a user can
-- never fabricate a reward.
create policy referral_redemptions_read_own on referral_redemptions
  for select using (referrer_owner_id = auth.uid() or referred_owner_id = auth.uid());

grant select, insert on referral_codes to authenticated;
grant select on referral_redemptions to authenticated;
grant select, insert, update, delete on referral_codes, referral_redemptions to service_role;
