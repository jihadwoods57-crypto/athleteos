-- OnStandard — Command Center Phase 1B: read-only "View as User". A server-PROJECTED snapshot of what a
-- user sees (role, subscription, today's score, recent days, meal count) — NO session assumption, NO
-- write path. Requires is_platform_admin() AND a live 'view_as' grant AND a non-empty reason; every view
-- is audited as impersonation (with reason + target + optional ticket). Minor NAME is redacted (contact
-- PII); the functional snapshot stays visible (that's the point of view-as) and access is logged.

create or replace function public.admin_view_as(p_user uuid, p_reason text, p_ticket_id bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_minor boolean; v jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if not admin_has_sensitive_grant('view_as') then raise exception 'reauth required'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required'; end if;
  v_minor := is_registered_minor(p_user);
  insert into public.admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'user.view_as', p_user::text,
      jsonb_build_object('impersonation', true, 'reason', p_reason, 'ticket_id', p_ticket_id, 'minor', v_minor));
  select jsonb_build_object(
    'user_id', p_user,
    'is_minor', v_minor,
    'name', case when v_minor then null else (select full_name from profiles where id = p_user) end,
    'role', (select primary_role::text from profiles where id = p_user),
    'subscription', (select jsonb_build_object('tier', tier, 'status', status) from subscriptions where owner_id = p_user),
    'today', (select jsonb_build_object('date', d.date, 'score', d.score, 'grade', d.grade)
              from days d where d.athlete_id = p_user order by d.date desc limit 1),
    'recent_scores', (select coalesce(jsonb_agg(jsonb_build_object('date', d2.date, 'score', d2.score, 'grade', d2.grade) order by d2.date desc), '[]'::jsonb)
                      from (select date, score, grade from days where athlete_id = p_user order by date desc limit 7) d2),
    'meals_7d', (select count(*) from meals m where m.athlete_id = p_user and m.day_date >= current_date - 6)
  ) into v;
  return v;
end $$;
grant execute on function public.admin_view_as(uuid, text, bigint) to authenticated;

-- capabilities: impersonation now exists (still enforced server-side by the view_as grant).
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
      'read', true, 'mutate_users', true, 'impersonate', true,
      'financial', false, 'flags', true, 'config', false)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;
