-- OnStandard — Command Center Phase 2 auth: MONITORING (the watch). Builds on 0130 (the MFA gate).
--   * MFA-code lockout via the Supabase mfa_verification_attempt hook (admin-scoped, FAIL-OPEN).
--   * A trustworthy sign-in event log fed from Supabase's own auth.audit_log_entries.
--   * A pure anomaly detector (new ip/country/asn, off-hours, impossible travel).
--   * Gated reads for the Command Center Security panel.
-- Alerts (email+push) + the cron monitor + ban-on-burst live in edge functions (admin-alert,
-- admin-auth-monitor). See spec 2026-07-22, Plan 2.

-- safe inet cast — source IPs from the auth log can be empty/malformed; never abort a set query.
create or replace function public.safe_inet(t text) returns inet
language plpgsql immutable set search_path = public as $$
begin return nullif(t,'')::inet; exception when others then return null; end $$;
revoke execute on function public.safe_inet(text) from anon, authenticated;

-- ---------------------------------------------------------------- MFA-code lockout
create table if not exists public.admin_auth_throttle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fail_count int not null default 0,
  lock_level int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.admin_auth_throttle enable row level security;
revoke all on table public.admin_auth_throttle from anon, authenticated;

-- The Supabase MFA-verification hook. Only enrolled users (i.e. admins) ever reach MFA verification, so
-- blast radius is tiny. 5 bad codes in 10 min -> escalating lock (1m/5m/30m). FAIL-OPEN on any error so a
-- hook bug can never lock the sole admin out; the monitor is the backstop.
create or replace function public.hook_mfa_verification_attempt(event jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid; v_valid boolean; v_row admin_auth_throttle; v_mins int;
begin
  v_user := (event->>'user_id')::uuid;
  v_valid := coalesce((event->>'valid')::boolean, false);
  if v_user is null then return jsonb_build_object('decision','continue'); end if;

  select * into v_row from admin_auth_throttle where user_id = v_user for update;
  if not found then insert into admin_auth_throttle(user_id) values (v_user) returning * into v_row; end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('decision','reject','message','Too many attempts. Try again later.');
  end if;

  if v_valid then
    update admin_auth_throttle set fail_count=0, lock_level=0, window_start=now(), locked_until=null where user_id=v_user;
    return jsonb_build_object('decision','continue');
  end if;

  if v_row.window_start < now() - interval '10 minutes' then
    update admin_auth_throttle set fail_count=1, window_start=now(), locked_until=null where user_id=v_user;
    return jsonb_build_object('decision','continue');
  end if;

  update admin_auth_throttle set fail_count = fail_count + 1 where user_id=v_user returning * into v_row;
  if v_row.fail_count >= 5 then
    v_mins := case when v_row.lock_level = 0 then 1 when v_row.lock_level = 1 then 5 else 30 end;
    update admin_auth_throttle
      set locked_until = now() + make_interval(mins => v_mins), lock_level = lock_level + 1, fail_count = 0
      where user_id = v_user;
    return jsonb_build_object('decision','reject','message','Too many attempts. Locked for '||v_mins||' min.');
  end if;
  return jsonb_build_object('decision','continue');
exception when others then
  return jsonb_build_object('decision','continue');  -- FAIL-OPEN
end $$;
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_mfa_verification_attempt(jsonb) from anon, authenticated, public;
grant all on table public.admin_auth_throttle to supabase_auth_admin;

-- ---------------------------------------------------------------- sign-in event log + detector
create table if not exists public.admin_login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  ip inet, country text, asn text, user_agent text,
  occurred_at timestamptz not null,
  flags jsonb not null default '[]'::jsonb,
  alerted boolean not null default false,
  ext_id text unique
);
create index if not exists admin_login_events_user on public.admin_login_events (user_id, occurred_at desc);
alter table public.admin_login_events enable row level security;
revoke all on table public.admin_login_events from anon, authenticated;

create table if not exists public.admin_monitor_checkpoint (
  id boolean primary key default true, last_seen_at timestamptz not null default now(),
  constraint admin_monitor_singleton check (id)
);
insert into public.admin_monitor_checkpoint(id) values (true) on conflict do nothing;
alter table public.admin_monitor_checkpoint enable row level security;
revoke all on table public.admin_monitor_checkpoint from anon, authenticated;

-- Pure: which anomaly flags does this candidate sign-in carry vs the user's prior admin_login_events?
create or replace function public.admin_detect_login_anomalies(
  p_user uuid, p_ip inet, p_country text, p_asn text, p_occurred_at timestamptz, p_tz text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare f text[] := '{}'; v_last_country text; v_last_at timestamptz; v_hour int;
begin
  if p_ip is not null and not exists (select 1 from admin_login_events where user_id=p_user and ip=p_ip)
    then f := array_append(f,'new_ip'); end if;
  if p_country is not null and not exists (select 1 from admin_login_events where user_id=p_user and country=p_country)
    then f := array_append(f,'new_country'); end if;
  if p_asn is not null and not exists (select 1 from admin_login_events where user_id=p_user and asn=p_asn)
    then f := array_append(f,'new_asn'); end if;
  begin
    v_hour := extract(hour from (p_occurred_at at time zone coalesce(p_tz,'UTC')))::int;
    if v_hour >= 0 and v_hour < 6 then f := array_append(f,'off_hours'); end if;
  exception when others then null; end;
  select country, occurred_at into v_last_country, v_last_at
    from admin_login_events where user_id=p_user order by occurred_at desc limit 1;
  if v_last_country is not null and p_country is not null and v_last_country <> p_country
     and p_occurred_at - v_last_at < interval '1 hour' then f := array_append(f,'impossible_travel'); end if;
  return f;
end $$;
revoke execute on function public.admin_detect_login_anomalies(uuid,inet,text,text,timestamptz,text) from anon, authenticated;

-- Gated reads for the Security panel.
create or replace function public.admin_recent_logins(p_limit int default 50)
returns setof public.admin_login_events language plpgsql stable security definer set search_path = public as $$
begin perform assert_admin_mfa();
  return query select * from public.admin_login_events order by occurred_at desc limit greatest(least(p_limit,200),1);
end $$;
grant execute on function public.admin_recent_logins(int) to authenticated;

create or replace function public.admin_active_locks()
returns table(user_id uuid, locked_until timestamptz, lock_level int)
language plpgsql stable security definer set search_path = public as $$
begin perform assert_admin_mfa();
  return query select t.user_id, t.locked_until, t.lock_level from public.admin_auth_throttle t where t.locked_until > now();
end $$;
grant execute on function public.admin_active_locks() to authenticated;

-- Service-role read over the real auth event log for admin accounts (monitor uses this).
create or replace function public.admin_pull_auth_events(p_since timestamptz)
returns table(ext_id text, user_id uuid, event_type text, ip inet, occurred_at timestamptz, user_agent text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  return query
    select e.id::text,
           nullif(e.payload->>'actor_id','')::uuid,
           coalesce(e.payload->>'action','unknown'),
           safe_inet(e.ip_address),
           e.created_at,
           e.payload->'traits'->>'user_agent'
    from auth.audit_log_entries e
    where e.created_at > p_since
      and nullif(e.payload->>'actor_id','')::uuid in (select pa.user_id from platform_admins pa)
    order by e.created_at asc;
end $$;
revoke execute on function public.admin_pull_auth_events(timestamptz) from anon, authenticated;

-- ---------------------------------------------------------------- monitor write path (service_role)
-- The admin-auth-monitor edge function calls ONLY these SECURITY DEFINER RPCs (never raw tables), so the
-- deny-all posture holds and grants are explicit.
create or replace function public.admin_get_checkpoint()
returns timestamptz language sql stable security definer set search_path = public as $$
  select last_seen_at from admin_monitor_checkpoint where id;
$$;

create or replace function public.admin_advance_checkpoint(p_ts timestamptz)
returns void language plpgsql volatile security definer set search_path = public as $$
begin update admin_monitor_checkpoint set last_seen_at = greatest(last_seen_at, p_ts) where id; end $$;

create or replace function public.admin_ingest_login_event(
  p_ext_id text, p_user uuid, p_event_type text, p_ip inet, p_country text, p_asn text,
  p_user_agent text, p_occurred_at timestamptz, p_flags jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into admin_login_events(ext_id,user_id,event_type,ip,country,asn,user_agent,occurred_at,flags,alerted)
  values (p_ext_id,p_user,p_event_type,p_ip,p_country,p_asn,p_user_agent,p_occurred_at,
          coalesce(p_flags,'[]'::jsonb), jsonb_array_length(coalesce(p_flags,'[]'::jsonb)) > 0)
  on conflict (ext_id) do nothing;
end $$;

-- Recent failed-auth count for an admin (burst detection input). event_type list is defensive across
-- GoTrue action taxonomies.
create or replace function public.admin_recent_failures(p_user uuid, p_mins int)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from admin_login_events
  where user_id = p_user and occurred_at > now() - make_interval(mins => p_mins)
    and event_type in ('login_failed','user_invalid_password','mfa_challenge_failed');
$$;

-- Explicit service_role execute (the monitor's only DB surface).
revoke execute on function public.admin_get_checkpoint(), public.admin_advance_checkpoint(timestamptz),
  public.admin_ingest_login_event(text,uuid,text,inet,text,text,text,timestamptz,jsonb),
  public.admin_recent_failures(uuid,int) from anon, authenticated;
grant execute on function public.admin_get_checkpoint(), public.admin_advance_checkpoint(timestamptz),
  public.admin_ingest_login_event(text,uuid,text,inet,text,text,text,timestamptz,jsonb),
  public.admin_recent_failures(uuid,int),
  public.admin_pull_auth_events(timestamptz),
  public.admin_detect_login_anomalies(uuid,inet,text,text,timestamptz,text) to service_role;
