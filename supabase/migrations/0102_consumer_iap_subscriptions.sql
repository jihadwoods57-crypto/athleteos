-- OnStandard — consumer IAP subscriptions (2026-07-21).
--
-- 0010/0042 built the `subscriptions` seam for the B2B Stripe rail (a coach/org pays per
-- athlete, tier='team'). The CONSUMER rail (Individual / Individual+ / Family) is Apple/Google
-- IAP, aggregated through RevenueCat — a different writer (revenuecat-webhook) and a different
-- shape: one row per PAYING ATHLETE (owner_id = their own profile), no seats, linked by the
-- RevenueCat app_user_id + store instead of Stripe ids.
--
-- This migration only widens the existing table so that webhook can write consumer rows. It is
-- ADDITIVE + idempotent, changes NO existing row, and leaves RLS untouched (owner reads own row;
-- ALL writes are service_role — a user still cannot grant themselves a plan).
--
-- GUARDRAIL (same as 0010): NOT applied to the live project by the crew. The founder applies it
-- at consumer go-live, alongside deploying revenuecat-webhook and setting REVENUECAT_WEBHOOK_SECRET.

-- Widen the tier enum: 'consumer' is a paid individual/family plan (which one is in plan_id).
alter table subscriptions drop constraint if exists subscriptions_tier_check;
alter table subscriptions add constraint subscriptions_tier_check
  check (tier in ('preview', 'team', 'consumer'));

-- RevenueCat linkage (written ONLY by the webhook; the analogue of stripe_customer/subscription_id).
--   rc_app_user_id  — the RevenueCat App User ID, which the client sets to the profile UUID at login.
--   store           — which store billed it, for support + refund routing.
--   store_product_id— the exact store product identifier RevenueCat reported (audit trail).
alter table subscriptions add column if not exists rc_app_user_id  text;
alter table subscriptions add column if not exists store           text
  check (store is null or store in ('app_store', 'play_store'));
alter table subscriptions add column if not exists store_product_id text;

-- Look up a consumer row by its RevenueCat user when an event arrives (owner_id is the PK, but
-- the webhook resolves by rc_app_user_id defensively in case app_user_id ever differs from owner).
create index if not exists subscriptions_rc_app_user on subscriptions (rc_app_user_id)
  where rc_app_user_id is not null;
