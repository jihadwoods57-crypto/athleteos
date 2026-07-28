-- OnStandard — Command Center Phase 1B: narrow, audited user mutations behind step-up reauth (0120) +
-- a role-change blast-radius preview. Action-SPECIFIC RPCs (no broad endpoint). Each mutation requires
-- is_platform_admin() AND a live 'user_mutation' sensitive grant. primary_role is a GLOBAL single value
-- (drives which app flow the user sees); staff roles are per-team. GoTrue-requiring actions (revoke
-- sessions / password reset / resend invite / hard ban) are a separate edge fn (deferred). Numbered 0122
-- (0119/0121 = OnStandard Pay, 0120 = cc_reauth).

alter table public.profiles add column if not exists suspended_at timestamptz;

-- require a live sensitive grant for a scope (raises 'reauth required' otherwise). The reusable gate
-- for every mutating RPC below.
create or replace function public.admin_require_grant(p_scope text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if not admin_has_sensitive_grant(p_scope) then raise exception 'reauth required'; end if;
end $$;
grant execute on function public.admin_require_grant(text) to authenticated;

-- Blast radius shown BEFORE a role change is confirmed (founder correction #7). Read-only.
create or replace function public.admin_role_change_preview(p_user uuid, p_new_role text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'user_id', p_user,
    'current_role', (select primary_role::text from profiles where id = p_user),
    'new_role', p_new_role,
    'app_flow_change', 'primary_role is global — changes which app flow the user sees on next launch',
    'team_memberships_as_athlete', (select count(*) from team_members where athlete_id = p_user and status = 'active'),
    'team_staff_roles', (select count(*) from team_staff where staff_id = p_user and status = 'active'),
    'guardianships_as_guardian', (select count(*) from guardianships where guardian_id = p_user and status = 'active'),
    'guardianships_as_athlete', (select count(*) from guardianships where athlete_id = p_user and status = 'active'),
    'subscription', (select jsonb_build_object('tier', tier, 'status', status) from subscriptions where owner_id = p_user)
  );
end $$;
grant execute on function public.admin_role_change_preview(uuid, text) to authenticated;

create or replace function public.admin_correct_primary_role(p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_before text;
begin
  perform admin_require_grant('user_mutation');
  if p_role not in ('athlete','parent','coach','trainer') then raise exception 'invalid role'; end if;
  select primary_role::text into v_before from profiles where id = p_user;
  update profiles set primary_role = p_role::user_role, updated_at = now() where id = p_user;
  insert into admin_audit_log (actor_id, action, target, before, after)
    values (auth.uid(), 'user.correct_role', p_user::text, jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));
end $$;
grant execute on function public.admin_correct_primary_role(uuid, text) to authenticated;

-- Founder-facing suspension flag. Hard enforcement (blocking access) is a follow-up (GoTrue ban via an
-- edge fn); this records + surfaces the state and is fully audited + reversible.
create or replace function public.admin_pause_account(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform admin_require_grant('user_mutation');
  update profiles set suspended_at = now(), updated_at = now() where id = p_user and suspended_at is null;
  insert into admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'user.pause', p_user::text, jsonb_build_object('suspended_at', now()));
end $$;
grant execute on function public.admin_pause_account(uuid) to authenticated;

create or replace function public.admin_reactivate_account(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform admin_require_grant('user_mutation');
  update profiles set suspended_at = null, updated_at = now() where id = p_user;
  insert into admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'user.reactivate', p_user::text, jsonb_build_object('reactivated_at', now()));
end $$;
grant execute on function public.admin_reactivate_account(uuid) to authenticated;

-- admin_list_users gains a `suspended` flag (return shape changes → drop+recreate). Same body as 0116.
drop function if exists public.admin_list_users(text, text, text, int, int);
create function public.admin_list_users(
  p_search text default null, p_role text default null, p_status text default null,
  p_page int default 0, p_page_size int default 25
)
returns table (
  user_id uuid, full_name text, email text, primary_role text,
  is_minor boolean, has_guardian boolean, suspended boolean, created_at timestamptz, last_active date,
  sub_tier text, sub_status text, payment_failed boolean, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_size int; v_off int;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_size := greatest(least(coalesce(p_page_size, 25), 100), 1);
  v_off  := greatest(coalesce(p_page, 0), 0) * v_size;
  return query
    with base as (
      select p.id, p.full_name, p.email, p.primary_role::text as role,
             is_registered_minor(p.id) as minor,
             exists (select 1 from guardianships g where g.athlete_id = p.id and g.status = 'active') as guardian,
             (p.suspended_at is not null) as susp,
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
           b.role, b.minor, b.guardian, b.susp, b.created_at, b.last_active,
           b.sub_tier, b.sub_status, b.pay_failed, c.n
    from base b, counted c
    order by b.created_at desc nulls last
    offset v_off limit v_size;
end $$;
grant execute on function public.admin_list_users(text, text, text, int, int) to authenticated;

-- capabilities now reflect that user mutations exist (each RPC still enforces its own grant server-side).
create or replace function public.admin_bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean; v_email text;
begin
  v_admin := is_platform_admin();
  if not v_admin then return jsonb_build_object('is_admin', false); end if;
  select email into v_email from profiles where id = auth.uid();
  return jsonb_build_object(
    'is_admin', true, 'email', v_email, 'environment', 'production', 'spec_version', 'phase-1b',
    'billing_connected', false, 'reauth_required', false, 'server_time', now(),
    'capabilities', jsonb_build_object(
      'read', true, 'mutate_users', true, 'impersonate', false,
      'financial', false, 'flags', true, 'config', false)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;
