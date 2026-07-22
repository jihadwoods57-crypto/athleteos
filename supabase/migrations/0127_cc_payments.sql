-- OnStandard — Command Center Phase 1B: Payments. RECONCILED with OnStandard Pay (0119/0121) — does NOT
-- duplicate it. OnStandard Pay's offer_payments = trainer→client Connect charges (platform takes a fee);
-- this surfaces that fee revenue to the founder (REUSE, don't rebuild) AND adds a platform-SUBSCRIPTION
-- ledger for the other money flow (Stripe subs + RevenueCat IAP), fed forward by the webhook when billing
-- goes live. Financial ACTIONS use a SINGLE-USE 'financial' grant (consumed on execution) — see the edge fns.

-- platform-subscription charge/refund ledger (empty until billing is live + subscription events captured).
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('stripe','revenuecat')),
  kind               text not null check (kind in ('charge','refund','dispute','fee','adjustment')),
  status             text not null,
  owner_id           uuid references profiles(id) on delete set null,
  amount_cents       bigint not null,
  fee_cents          bigint not null default 0,
  currency           text not null default 'usd',
  provider_object_id text,
  provider_event_id  text unique,                     -- idempotency / dup-prevention
  occurred_at        timestamptz not null default now(),
  recorded_at        timestamptz not null default now(),
  failure_code       text,
  failure_message    text,
  metadata           jsonb                             -- FILTERED (never the raw provider payload)
);
create index if not exists payments_owner on public.payments (owner_id, occurred_at desc);
alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;

-- founder view of OnStandard Pay (offer) payments — REUSES offer_payments (0119).
create or replace function public.admin_offer_payments(p_days int default 30, p_limit int default 100)
returns table (id uuid, practice_id uuid, payer_id uuid, amount_cents int, application_fee_cents int, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select o.id, o.practice_id, o.payer_id, o.amount_cents, o.application_fee_cents, o.status, o.created_at
    from offer_payments o
    where o.created_at >= current_date - (greatest(p_days, 1) - 1)
    order by o.created_at desc limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function public.admin_offer_payments(int, int) to authenticated;

-- OnStandard Pay fee revenue rollup — application_fee_cents is the platform's cut.
create or replace function public.admin_offer_fee_revenue(p_days int default 30)
returns table (paid_count bigint, gross_cents bigint, platform_fee_cents bigint, refunded_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select (count(*) filter (where o.status = 'paid'))::bigint,
           coalesce(sum(o.amount_cents) filter (where o.status = 'paid'), 0)::bigint,
           coalesce(sum(o.application_fee_cents) filter (where o.status = 'paid'), 0)::bigint,
           (count(*) filter (where o.status = 'refunded'))::bigint
    from offer_payments o
    where o.created_at >= current_date - (greatest(p_days, 1) - 1);
end $$;
grant execute on function public.admin_offer_fee_revenue(int) to authenticated;

-- subscription ledger view (empty until billing live + webhook captures subscription charges).
create or replace function public.admin_payments(p_days int default 30, p_limit int default 100)
returns setof public.payments language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.payments where occurred_at >= current_date - (greatest(p_days, 1) - 1)
    order by occurred_at desc limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function public.admin_payments(int, int) to authenticated;

-- Financial actions consume a SINGLE-USE 'financial' grant. The financial edge fns call this (as the
-- founder) BEFORE touching a provider API — it verifies + consumes atomically, so a grant is spent once.
create or replace function public.admin_consume_financial_grant()
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select id into v_id from public.admin_sensitive_grants
    where actor_id = auth.uid() and scope = 'financial' and expires_at > now() and single_use and consumed_at is null
    order by granted_at desc limit 1;
  if v_id is null then raise exception 'reauth required'; end if;
  update public.admin_sensitive_grants set consumed_at = now() where id = v_id;
  insert into admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'financial.grant_consumed', v_id::text, '{}'::jsonb);
end $$;
grant execute on function public.admin_consume_financial_grant() to authenticated;
