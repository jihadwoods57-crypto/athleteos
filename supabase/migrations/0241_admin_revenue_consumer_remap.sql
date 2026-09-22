-- OnStandard — the Command Center's revenue number, re-footed on the 2026-09-21 consumer re-map.
--
-- 0235 fixed this function once already, for exactly this reason: it hardcodes consumer prices, and
-- consumer prices moved without it. They moved again on 2026-09-21 (founder ruling; design in
-- docs/superpowers/specs/2026-09-21-subscription-remap-design.md §7), so the MRR tile would now read:
--
--     individual         counted  $9.99   actually charges $19.99   (-50%)
--     individual annual  counted  $84/12  actually charges $199.99/12
--     family             counted $18.99   actually charges $24.99   (-24%)
--
-- Understating is no better than 0235's overstating. This is the number a pricing or spend decision
-- gets made against.
--
-- INDIVIDUAL PLUS IS RETIRED. Its two `when` branches are dropped from both cadence arms rather than
-- repriced: the plan is gone from src/core/pricing.ts and its store products stop existing. A
-- grandfathered row could still carry plan_id 'individual_plus' (nobody has ever paid, so today there
-- are none), and such a row now falls to the `else 0` arm. That is deliberate and it is the honest
-- answer: we do not know what a plan we no longer sell would be billed at, and inventing a figure is
-- how 0118 got here. The ENTITLEMENT is unaffected — subscriptions.tier drives access, not plan_id,
-- and supabase/functions/_shared/revenuecat.ts maps any surviving plus product id to 'individual' on
-- the next webhook event, at which point the row prices itself correctly.
--
-- Everything else 0235 established is unchanged and deliberately re-stated below: cadence is READ
-- from store_product_id (`onstandard_<plan>_<monthly|annual>`) and an annual sub is valued at its
-- annual price / 12; a row with no store_product_id falls back to the monthly price. The pro and org
-- prices are untouched by this ruling. Still an ESTIMATE from plan prices x active subs, NOT
-- collected revenue.
--
-- Forward-only and idempotent: drop + create, no data touched.

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
              when 'individual' then 199.99/12.0 when 'family' then 249.99/12.0
              when 'pro_solo' then 990/12.0 when 'professional' then 1790/12.0
              when 'org_starter' then 2490/12.0 when 'org_growth' then 4990/12.0 when 'org_performance' then 7990/12.0
              else 0 end
          else
            -- Monthly, and the fallback for any row whose cadence we cannot read.
            case s.plan_id
              when 'individual' then 19.99 when 'family' then 24.99
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
  'src/core/pricing.ts PLAN_CATALOG as of the 2026-09-21 consumer re-map; src/core/pricing.test.ts pins '
  'them. Annual cadence is read from store_product_id and valued at annual/12. The retired '
  'individual_plus plan is priced at 0 on purpose: we do not sell it and will not invent a figure.';
