-- AthleteOS — subscriptions (B2B per-seat: the coach/org pays per athlete)
-- Additive migration for the INERT entitlement seam. The app reads the signed-in
-- owner's row (queries.ts:fetchEntitlement) and falls back to the free-preview
-- entitlement when there's no row — so until a real plan exists, every account reads
-- "Free preview" exactly as today. Nothing here charges anyone; it's the durable row
-- a Stripe webhook (service_role Edge Function, wired at monetization time) writes.
--
-- Model: one row per OWNER (the coach/org profile). Athletes inherit access under
-- their coach's plan via team membership — resolving an athlete's entitlement from
-- their coach is a go-live RPC (not needed for the seam; athletes read preview until
-- then). `seats` is the purchased athlete count; `seats_used` the consumed count.
--
-- GUARDRAIL: authored + verified on a throwaway LOCAL postgres. NOT applied to the
-- live project by the crew — the founder applies it per-migration at go-live (D1),
-- and wires the Stripe customer/webhook before relying on it.

create table subscriptions (
  owner_id               uuid primary key references profiles(id) on delete cascade,
  tier                   text not null default 'preview'
                           check (tier in ('preview', 'team')),
  status                 text not null default 'preview'
                           check (status in ('preview', 'active', 'past_due', 'canceled')),
  seats                  integer,
  seats_used             integer,
  current_period_end     timestamptz,
  -- Stripe linkage (written by the webhook; never by the client).
  stripe_customer_id     text,
  stripe_subscription_id text,
  updated_at             timestamptz not null default now()
);
create trigger subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- RLS
-- The owner may READ their own subscription (to render the plan); ALL writes come
-- from the service_role Stripe webhook, never the client — a user must not be able to
-- grant themselves a paid plan.
alter table subscriptions enable row level security;
create policy subscriptions_read_own on subscriptions
  for select using (owner_id = auth.uid());

grant select on subscriptions to authenticated;
grant select, insert, update, delete on subscriptions to service_role;
