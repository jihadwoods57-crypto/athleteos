-- OnStandard — Command Center Phase 1A: Users. Platform-wide user list (the enumeration gap) + an
-- extended, minor-aware athlete profile. Read-only. Minor contact PII is masked in the list; reading a
-- REAL minor's full profile writes an audit row ("audit access to minor records"). Uses
-- is_registered_minor (0013) — true only for an actual minor athlete — NOT is_minor (fail-closed, which
-- would flag every non-athlete as a minor). Same gated/EXECUTE-to-authenticated contract as 0111/0113.

create or replace function public.admin_list_users(
  p_search text default null, p_role text default null, p_status text default null,
  p_page int default 0, p_page_size int default 25
)
returns table (
  user_id uuid, full_name text, email text, primary_role text,
  is_minor boolean, has_guardian boolean, created_at timestamptz, last_active date,
  sub_tier text, sub_status text, payment_failed boolean, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_size int; v_off int;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_size := greatest(least(coalesce(p_page_size, 25), 100), 1);   -- capped: no unbounded/bulk export in 1A
  v_off  := greatest(coalesce(p_page, 0), 0) * v_size;
  return query
    with base as (
      select p.id, p.full_name, p.email, p.primary_role::text as role,
             is_registered_minor(p.id) as minor,
             exists (select 1 from guardianships g where g.athlete_id = p.id and g.status = 'active') as guardian,
             p.created_at,
             (select max(d.date) from days d where d.athlete_id = p.id) as last_active,
             s.tier::text as sub_tier, s.status::text as sub_status,
             (s.payment_failed_at is not null) as pay_failed
      from profiles p
      left join subscriptions s on s.owner_id = p.id
      where (p_search is null or p.full_name ilike '%'||p_search||'%'
             or p.email ilike '%'||p_search||'%' or p.id::text = p_search)
        and (p_role is null or p.primary_role::text = p_role)
        and (p_status is null or s.status::text = p_status)
    ), counted as (select count(*)::bigint as n from base)
    select b.id, b.full_name,
           case when b.minor then regexp_replace(coalesce(b.email, ''), '(^.).*(@.*$)', '\1***\2') else b.email end,
           b.role, b.minor, b.guardian, b.created_at, b.last_active,
           b.sub_tier, b.sub_status, b.pay_failed, c.n
    from base b, counted c
    order by b.created_at desc nulls last
    offset v_off limit v_size;
end $$;
grant execute on function public.admin_list_users(text, text, text, int, int) to authenticated;

-- Extended, minor-aware athlete profile. Return shape changes vs 0113 (adds is_minor/has_guardian/
-- payment_failed), so DROP first (create-or-replace can't change the return type). VOLATILE because
-- viewing a real minor's profile writes an audit row.
drop function if exists public.admin_athlete_profile(uuid);
create function public.admin_athlete_profile(p_user uuid)
returns table (
  athlete_id uuid, full_name text, email text, primary_role text, created_at timestamptz,
  last_active date, meals_total bigint, meals_7d bigint, ai_cost_30d numeric,
  sub_tier text, sub_status text, is_minor boolean, has_guardian boolean, payment_failed boolean
)
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if is_registered_minor(p_user) then
    insert into public.admin_audit_log (actor_id, action, target)
      values (auth.uid(), 'user.view_minor_profile', p_user::text);
  end if;
  return query
    select p.id, p.full_name, p.email, p.primary_role::text, p.created_at,
           (select max(d.date) from days d where d.athlete_id = p.id),
           (select count(*)::bigint from meals m where m.athlete_id = p.id),
           (select count(*)::bigint from meals m where m.athlete_id = p.id and m.day_date >= current_date - 6),
           (select round(coalesce(sum(c.cost_usd), 0), 4) from ai_call_costs c where c.user_id = p.id and c.created_at >= current_date - 29),
           s.tier::text, s.status::text,
           is_registered_minor(p.id),
           exists (select 1 from guardianships g where g.athlete_id = p.id and g.status = 'active'),
           (s.payment_failed_at is not null)
    from profiles p
    left join subscriptions s on s.owner_id = p.id
    where p.id = p_user;
end $$;
grant execute on function public.admin_athlete_profile(uuid) to authenticated;
