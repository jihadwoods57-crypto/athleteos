-- OnStandard — Command Center Phase 1A: authoritative bootstrap + global search + audit search.
--
-- Extends the shipped web/admin surface (0037/0111/0113) into a multi-section shell. Same contract as
-- the existing admin RPCs: SECURITY DEFINER, is_platform_admin()-gated, EXECUTE to authenticated, over
-- deny-all tables. One deliberate exception: admin_bootstrap RETURNS (not raises) for a non-admin, so
-- the client can render a clean "access denied" instead of a broken shell. Read-only (Phase 1A).

-- ---------------------------------------------------------------- authoritative bootstrap
-- The single source of truth the shell renders from: authorization (server-side), environment, version,
-- reauth/billing state, and the capability map. capabilities are all read/false in 1A; mutations,
-- impersonation, financial, and config land in Phase 1B.
create or replace function public.admin_bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean; v_email text;
begin
  v_admin := is_platform_admin();
  if not v_admin then return jsonb_build_object('is_admin', false); end if;
  select email into v_email from profiles where id = auth.uid();
  return jsonb_build_object(
    'is_admin', true,
    'email', v_email,
    'environment', 'production',      -- SYNC: staging/dev override via app_config (Phase 1B)
    'spec_version', 'phase-1a',
    'billing_connected', false,       -- wired in Phase 1B (payments)
    'reauth_required', false,         -- step-up reauth lands in Phase 1B
    'server_time', now(),
    'capabilities', jsonb_build_object(
      'read', true, 'mutate_users', false, 'impersonate', false,
      'financial', false, 'flags', true, 'config', false)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;

-- ---------------------------------------------------------------- global search
-- Phase 1A supports users + audit; each section adds its own kind (orgs, tickets, payments) later.
-- Returns nothing under 2 chars so an empty box never scans the whole table.
create or replace function public.admin_global_search(p_q text, p_limit int default 8)
returns table (kind text, id text, label text, sub text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_q is null or length(trim(p_q)) < 2 then return; end if;
  return query
    (select 'user'::text, p.id::text,
            coalesce(nullif(p.full_name, ''), p.email, p.id::text),
            p.primary_role::text
     from profiles p
     where p.full_name ilike '%'||p_q||'%' or p.email ilike '%'||p_q||'%' or p.id::text = p_q
     limit greatest(least(p_limit, 20), 1))
    union all
    (select 'audit'::text, a.id::text, a.action, coalesce(a.target, '')
     from admin_audit_log a
     where a.action ilike '%'||p_q||'%' or a.target ilike '%'||p_q||'%'
     order by a.created_at desc
     limit greatest(least(p_limit, 20), 1));
end $$;
grant execute on function public.admin_global_search(text, int) to authenticated;

-- ---------------------------------------------------------------- audit search
-- The Audit Log section's data source — extends admin_recent_audit (0111) with action/actor filters
-- and returns the before/after jsonb so a founder can inspect exactly what changed.
create or replace function public.admin_audit_search(p_action text default null, p_actor uuid default null, p_limit int default 100)
returns table (id bigint, created_at timestamptz, action text, target text, actor_id uuid, before jsonb, after jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select a.id, a.created_at, a.action, a.target, a.actor_id, a.before, a.after
    from admin_audit_log a
    where (p_action is null or a.action ilike '%'||p_action||'%')
      and (p_actor is null or a.actor_id = p_actor)
    order by a.created_at desc
    limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function public.admin_audit_search(text, uuid, int) to authenticated;
