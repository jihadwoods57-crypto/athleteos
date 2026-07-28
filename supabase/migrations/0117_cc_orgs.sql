-- OnStandard — Command Center Phase 1A: Organizations. Platform-wide org list + a per-org health
-- rollup over the LIVE link tables (org_memberships is authored-not-live, so read teams/team_members/
-- team_staff). Read-only; cross-org isolated (each RPC aggregates only within the requested org).
-- Org-level BILLING is not modeled at the org level (subscriptions are user-owned), so subscription /
-- outstanding-payment / open-ticket rollups are deferred to Phase 1B/2 — omitted here, not faked.

create or replace function public.admin_list_orgs(p_search text default null, p_page int default 0, p_page_size int default 25)
returns table (org_id uuid, name text, type text, verification_status text, teams bigint, members bigint, staff bigint, created_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_size int; v_off int;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_size := greatest(least(coalesce(p_page_size, 25), 100), 1);
  v_off  := greatest(coalesce(p_page, 0), 0) * v_size;
  return query
    with base as (
      select o.id, o.name, o.type::text as type, o.verification_status as verification_status, o.created_at,
             (select count(*)::bigint from teams t where t.org_id = o.id) as teams,
             (select count(distinct tm.athlete_id)::bigint from team_members tm join teams t on t.id = tm.team_id
                where t.org_id = o.id and tm.status = 'active') as members,
             (select count(distinct ts.staff_id)::bigint from team_staff ts join teams t on t.id = ts.team_id
                where t.org_id = o.id and ts.status = 'active') as staff
      from orgs o
      where (p_search is null or o.name ilike '%'||p_search||'%')
    ), counted as (select count(*)::bigint as n from base)
    select b.id, b.name, b.type, b.verification_status, b.teams, b.members, b.staff, b.created_at, c.n
    from base b, counted c
    order by b.members desc, b.created_at desc nulls last
    offset v_off limit v_size;
end $$;
grant execute on function public.admin_list_orgs(text, int, int) to authenticated;

create or replace function public.admin_org_health(p_org uuid)
returns table (org_id uuid, name text, type text, verification_status text, teams bigint, members bigint, staff bigint, active_7d bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select o.id, o.name, o.type::text, o.verification_status,
           (select count(*)::bigint from teams t where t.org_id = o.id),
           (select count(distinct tm.athlete_id)::bigint from team_members tm join teams t on t.id = tm.team_id
              where t.org_id = o.id and tm.status = 'active'),
           (select count(distinct ts.staff_id)::bigint from team_staff ts join teams t on t.id = ts.team_id
              where t.org_id = o.id and ts.status = 'active'),
           (select count(distinct d.athlete_id)::bigint from days d
              join team_members tm on tm.athlete_id = d.athlete_id
              join teams t on t.id = tm.team_id
              where t.org_id = o.id and d.date >= current_date - 6),
           o.created_at
    from orgs o where o.id = p_org;
end $$;
grant execute on function public.admin_org_health(uuid) to authenticated;
