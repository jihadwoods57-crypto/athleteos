-- OnStandard — Command Center Phase 1A: truthful revenue. Replaces the 0111 placeholder MRR ($12/$8
-- guess) with an ESTIMATED SUBSCRIPTION VALUE computed from real plan prices, and adds a failed-payment
-- rollup. Return shape changes (mrr_estimate_usd -> estimated_subscription_value_usd), so DROP first.
--
-- IMPORTANT (see design spec §8): this is an ESTIMATE from plan prices × active subs — NOT collected
-- revenue. Collected / net / refunds require the payments ledger (Phase 1B, 0118-payments) and live
-- billing; those are labeled empty in the UI, never faked. Prices SYNC WITH src/core/pricing.ts. Cadence
-- is not stored on subscriptions, so a monthly-equivalent figure is a documented simplification (annual
-- plans are slightly overstated).

drop function if exists public.admin_revenue();
create function public.admin_revenue()
returns table (active_subs bigint, team_subs bigint, consumer_subs bigint, seats_used bigint, estimated_subscription_value_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select
      count(*) filter (where s.status = 'active')::bigint,
      count(*) filter (where s.status = 'active' and s.tier = 'team')::bigint,
      count(*) filter (where s.status = 'active' and s.tier = 'consumer')::bigint,
      coalesce(sum(s.seats_used) filter (where s.status = 'active' and s.tier = 'team'), 0)::bigint,
      round(coalesce(sum(
        case when s.status = 'active' then
          case s.plan_id
            when 'individual' then 14.99 when 'individual_plus' then 24.99 when 'family' then 39.99
            when 'pro_solo' then 99 when 'professional' then 179
            when 'org_starter' then 249 when 'org_growth' then 499 when 'org_performance' then 799
            else 0 end
        else 0 end), 0), 2)
    from subscriptions s;
end $$;
grant execute on function public.admin_revenue() to authenticated;

-- Failed-payment rollup over subscriptions.payment_failed_at (set by stripe-webhook invoice.payment_failed
-- + revenuecat BILLING_ISSUE). The per-charge dunning history arrives with the payments ledger (1B).
create or replace function public.admin_failed_payments(p_limit int default 200)
returns table (owner_id uuid, tier text, plan_id text, status text, payment_failed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select s.owner_id, s.tier::text, s.plan_id, s.status::text, s.payment_failed_at
    from subscriptions s
    where s.payment_failed_at is not null
    order by s.payment_failed_at desc
    limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function public.admin_failed_payments(int) to authenticated;
