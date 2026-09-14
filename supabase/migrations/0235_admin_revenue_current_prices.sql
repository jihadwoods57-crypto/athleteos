-- OnStandard — the Command Center's revenue number was computed from prices we do not charge.
--
-- 0118 hardcoded the consumer prices and its own header said "Prices SYNC WITH src/core/pricing.ts".
-- They did not. Consumer pricing moved on 2026-07-30 and the function was never touched, so for six
-- weeks the founder's own MRR tile read:
--
--     individual        counted $14.99   actually charges  $9.99   (+50%)
--     individual_plus   counted $24.99   actually charges $14.99   (+67%)
--     family            counted $39.99   actually charges $18.99   (+111%)
--
-- Every consumer subscription was inflated by half to double. The pro and org rows were correct and
-- are unchanged. This is the number a pricing or spend decision gets made against, so it is worth
-- more than a comment telling the next person to keep it in sync.
--
-- CADENCE IS NOW READ, NOT ASSUMED. 0118 noted that cadence "is not stored on subscriptions, so a
-- monthly-equivalent figure is a documented simplification (annual plans are slightly overstated)".
-- Slightly is not the word: annual runs a 30% discount, so charging the monthly price against an
-- annual sub overstates it by ~43%. Cadence is in fact recoverable — `store_product_id` is minted as
-- `onstandard_<plan>_<monthly|annual>` (pricing.js productId / revenuecat.ts CONSUMER_PRODUCTS) — so
-- an annual sub is now valued at its annual price / 12. A row with no store_product_id (every Stripe
-- plan; RevenueCat rows written before the column existed) still falls back to the monthly price,
-- which is the old behaviour and remains the documented simplification for those.
--
-- Still an ESTIMATE from plan prices x active subs, NOT collected revenue. That distinction is 0118's
-- and it stands.

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
          case when right(coalesce(s.store_product_id, ''), 7) = '_annual' then
            -- Annual: the yearly price spread over twelve months.
            case s.plan_id
              when 'individual' then 84/12.0 when 'individual_plus' then 126/12.0 when 'family' then 156/12.0
              when 'pro_solo' then 990/12.0 when 'professional' then 1790/12.0
              when 'org_starter' then 2490/12.0 when 'org_growth' then 4990/12.0 when 'org_performance' then 7990/12.0
              else 0 end
          else
            -- Monthly, and the fallback for any row whose cadence we cannot read.
            case s.plan_id
              when 'individual' then 9.99 when 'individual_plus' then 14.99 when 'family' then 18.99
              when 'pro_solo' then 99 when 'professional' then 179
              when 'org_starter' then 249 when 'org_growth' then 499 when 'org_performance' then 799
              else 0 end
          end
        else 0 end), 0), 2)
    from subscriptions s;
end $$;
grant execute on function public.admin_revenue() to authenticated;

comment on function public.admin_revenue() is
  'Estimated subscription value from plan prices x active subs (NOT collected revenue). Prices mirror '
  'src/core/pricing.ts PLAN_CATALOG; src/core/pricing.test.ts pins them. Annual cadence is read from '
  'store_product_id and valued at annual/12.';
