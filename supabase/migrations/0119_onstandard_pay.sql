-- OnStandard Pay (handoff Section 10.4) — real in-app payments. A trainer connects a Stripe
-- Express account (Stripe hosts 100% of KYC/identity/bank-account collection); a connected client
-- pays for an offer via Stripe Checkout using a DESTINATION CHARGE (Stripe's documented pattern for
-- "a platform charging a fee to facilitate a transaction between two parties" — the platform is
-- merchant-of-record, money auto-splits to the trainer minus the platform fee). Money never touches
-- our servers directly; Stripe moves it. This migration adds the schema only — the Stripe-touching
-- work (minting accounts, creating Checkout Sessions) lives in companion edge functions.
--
-- Security: identical discipline to every RPC this session — SECURITY DEFINER, is_platform_admin()
-- or owns_practice()/payer-self gated, deny-all tables, audited mutations. Numbered 0119 — a
-- CONCURRENT session is independently building a Founder Command Center (migrations 0115-0118,
-- "cc_*") that plans its own general admin payments ledger later; this migration's tables are named
-- offer_payments/pay_platform_config specifically to avoid any collision with that work.

-- ================================================================ practices: Connect account state
alter table public.practices add column if not exists stripe_connect_account_id text;
alter table public.practices add column if not exists stripe_connect_status text not null default 'none'
  check (stripe_connect_status in ('none', 'pending', 'active', 'restricted'));
alter table public.practices add column if not exists stripe_connect_updated_at timestamptz;
-- One Connect account per practice; prevents ever double-minting for the same trainer.
create unique index if not exists practices_stripe_connect_account_uq
  on public.practices (stripe_connect_account_id) where stripe_connect_account_id is not null;

-- ================================================================ platform fee (singleton, admin-tunable)
-- A single global fee for v1 (per-tier discounts are a later, explicit decision). Boolean PK is the
-- standard "exactly one row" pattern. Never hardcoded in application code — read fresh at checkout time.
create table if not exists public.pay_platform_config (
  id         boolean primary key default true check (id),
  fee_percent numeric not null default 15 check (fee_percent >= 0 and fee_percent <= 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.pay_platform_config (id, fee_percent) values (true, 15) on conflict (id) do nothing;
alter table public.pay_platform_config enable row level security;
revoke all on table public.pay_platform_config from anon, authenticated;

create or replace function public.admin_get_platform_fee()
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select fee_percent into v from pay_platform_config where id = true;
  return v;
end $$;
grant execute on function public.admin_get_platform_fee() to authenticated;

create or replace function public.admin_set_platform_fee(p_fee_percent numeric)
returns numeric language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_fee_percent < 0 or p_fee_percent > 100 then raise exception 'fee must be 0-100'; end if;
  select to_jsonb(c) into v_before from pay_platform_config c where id = true;
  update pay_platform_config set fee_percent = p_fee_percent, updated_by = auth.uid(), updated_at = now() where id = true;
  insert into admin_audit_log (actor_id, action, target, before, after)
    values (auth.uid(), 'platform_fee.set', 'pay_platform_config', v_before, jsonb_build_object('fee_percent', p_fee_percent));
  return p_fee_percent;
end $$;
grant execute on function public.admin_set_platform_fee(numeric) to authenticated;

-- ================================================================ offer_payments ledger
-- One row per REAL Stripe charge (a one-time payment, or a subscription's initial/renewal invoice) —
-- ledger semantics, not "one row per offer subscribed to". Deny-all; readable via RLS by the trainer
-- (owns_practice) and the payer (their own rows); writable ONLY by service role (webhooks).
create table if not exists public.offer_payments (
  id                     uuid primary key default gen_random_uuid(),
  practice_id            uuid not null references practices(id) on delete cascade,
  offer_id               uuid references offers(id) on delete set null,
  payer_id               uuid references profiles(id) on delete set null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  stripe_subscription_id     text,
  stripe_charge_id           text,
  amount_cents           int not null,
  application_fee_cents  int not null default 0,
  currency               text not null default 'usd',
  status                 text not null default 'paid' check (status in ('paid', 'refunded', 'failed')),
  created_at             timestamptz not null default now()
);
create index if not exists offer_payments_practice on public.offer_payments (practice_id, created_at desc);
create index if not exists offer_payments_payer on public.offer_payments (payer_id, created_at desc);
create index if not exists offer_payments_sub on public.offer_payments (stripe_subscription_id);

alter table public.offer_payments enable row level security;
revoke all on table public.offer_payments from anon, authenticated;
grant select, update on public.offer_payments to authenticated;  -- NO insert — only via service-role webhooks

drop policy if exists offer_payments_owner_read on public.offer_payments;
create policy offer_payments_owner_read on public.offer_payments for select using (owns_practice(practice_id));
drop policy if exists offer_payments_payer_read on public.offer_payments;
create policy offer_payments_payer_read on public.offer_payments for select using (payer_id = auth.uid());
-- Trainers may only ever flip a payment toward 'refunded' via the audited refund-payment edge fn
-- (service role), never a direct client update — so no update policy is granted here at all.

-- ================================================================ client-facing: an active client's trainer's payable offers
-- Gated on a REAL active practice_clients link (the same trust boundary is_trainer_of uses) — not
-- the public anon path. Only returns offers when the trainer's Connect account is 'active' (can
-- actually receive money) — an unconnected trainer's offers are invisible to "pay now" here (they
-- still show on the public lead-gen page, which never charges).
create or replace function public.my_trainer_offers()
returns table (offer_id uuid, name text, blurb text, price_cents int, cadence text, features text[], practice_id uuid, trainer_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select o.id, o.name, o.blurb, o.price_cents, o.cadence, o.features, o.practice_id, p.full_name
    from practice_clients pc
    join practices pr on pr.id = pc.practice_id
    join profiles p on p.id = pr.owner_id
    join offers o on o.practice_id = pc.practice_id
    where pc.client_id = auth.uid() and pc.status = 'active'
      and pr.stripe_connect_status = 'active' and o.active
    order by o.sort, o.created_at;
end $$;
grant execute on function public.my_trainer_offers() to authenticated;

-- ================================================================ trainer-facing: read own Connect status + offer_payments
create or replace function public.my_connect_status(p_practice uuid)
returns table (status text, account_id text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query select stripe_connect_status, stripe_connect_account_id, stripe_connect_updated_at
    from practices where id = p_practice;
end $$;
grant execute on function public.my_connect_status(uuid) to authenticated;

create or replace function public.my_practice_payments(p_practice uuid, p_limit int default 30)
returns setof public.offer_payments
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query select * from offer_payments where practice_id = p_practice order by created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.my_practice_payments(uuid, int) to authenticated;
