-- 0128 — Parent-funded plans: a guardian funds a trainer's package for their child.
-- Thin extension of OnStandard Pay (0119/0121). Two nullable ledger columns + parent RPCs.

-- ---- ledger columns -------------------------------------------------------------------------
alter table public.offer_payments
  add column if not exists beneficiary_athlete_id  uuid references profiles(id) on delete set null,
  add column if not exists subscription_cancelled_at timestamptz;
-- beneficiary null = client bought for themselves (unchanged). set = a guardian funded it for the child.
-- subscription_cancelled_at is stamped on EVERY row of a recurring offer's subscription when cancelled;
-- per-charge `status` stays paid/refunded/failed (a past charge was genuinely paid).
create index if not exists offer_payments_beneficiary_idx
  on public.offer_payments (beneficiary_athlete_id) where beneficiary_athlete_id is not null;

-- ---- parent discovery: my children's trainers' payable offers ------------------------------
-- Mirrors my_trainer_offers (0119) but walks guardianships -> the child's active practice_clients.
create or replace function public.my_funded_offers()
returns table (child_id uuid, child_name text, practice_id uuid, trainer_name text,
               offer_id uuid, name text, blurb text, price_cents int, cadence text, features text[])
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select g.athlete_id, cp.full_name, pr.id, own.full_name,
           o.id, o.name, o.blurb, o.price_cents, o.cadence, o.features
    from guardianships g
    join profiles cp on cp.id = g.athlete_id
    join practice_clients pc on pc.client_id = g.athlete_id and pc.status = 'active'
    join practices pr on pr.id = pc.practice_id and pr.stripe_connect_status = 'active'
    join profiles own on own.id = pr.owner_id
    join offers o on o.practice_id = pr.id and o.active
    where g.guardian_id = auth.uid() and g.status = 'active'
    order by cp.full_name, o.sort, o.created_at;
end $$;
grant execute on function public.my_funded_offers() to authenticated;

-- ---- parent's funded plans (dashboard list) ------------------------------------------------
create or replace function public.my_funded_plans(p_limit int default 50)
returns table (id uuid, offer_name text, child_name text, amount_cents int, cadence text,
               status text, stripe_subscription_id text, subscription_cancelled_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select op.id, o.name, cp.full_name, op.amount_cents, o.cadence,
           op.status, op.stripe_subscription_id, op.subscription_cancelled_at, op.created_at
    from offer_payments op
    left join offers o on o.id = op.offer_id
    left join profiles cp on cp.id = op.beneficiary_athlete_id
    where op.payer_id = auth.uid() and op.beneficiary_athlete_id is not null
    order by op.created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.my_funded_plans(int) to authenticated;

-- ---- trainer payments list, now carrying the beneficiary name ------------------------------
-- my_practice_payments returned `setof offer_payments`; adding a joined name needs an explicit
-- column list, so DROP + recreate (and re-grant — a dropped function loses its grants).
drop function if exists public.my_practice_payments(uuid, int);
create or replace function public.my_practice_payments(p_practice uuid, p_limit int default 30)
returns table (
  id uuid, practice_id uuid, offer_id uuid, payer_id uuid,
  stripe_checkout_session_id text, stripe_payment_intent_id text, stripe_subscription_id text, stripe_charge_id text,
  amount_cents int, application_fee_cents int, currency text, status text,
  beneficiary_athlete_id uuid, subscription_cancelled_at timestamptz, created_at timestamptz,
  beneficiary_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query
    select op.id, op.practice_id, op.offer_id, op.payer_id,
           op.stripe_checkout_session_id, op.stripe_payment_intent_id, op.stripe_subscription_id, op.stripe_charge_id,
           op.amount_cents, op.application_fee_cents, op.currency, op.status,
           op.beneficiary_athlete_id, op.subscription_cancelled_at, op.created_at,
           bp.full_name
    from offer_payments op
    left join profiles bp on bp.id = op.beneficiary_athlete_id
    where op.practice_id = p_practice
    order by op.created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.my_practice_payments(uuid, int) to authenticated;
