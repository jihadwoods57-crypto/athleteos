-- OnStandard — runtime feature flags + kill-switch + allowlists (handoff Section 26).
--
-- Server-authoritative: evaluation happens in edge functions via _shared/feature-flags.ts.
-- These tables are RPC/service-role ONLY. Normal roles get NOTHING (no grant to authenticated),
-- so allowlist membership ("who is in beta") can never leak to a client. Every write is audited.

create table if not exists public.feature_flags (
  name             text primary key,
  description      text not null default '',
  default_on       boolean not null default false,
  kill_switch      boolean not null default false,
  enabled_user_ids uuid[]  not null default '{}',
  enabled_roles    text[]  not null default '{}',
  enabled_org_ids  uuid[]  not null default '{}',
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  target     text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created on public.admin_audit_log (created_at desc);

-- RPC/service-role only. No anon/authenticated read or write (intentionally ungranted — the
-- inverse of the usual grant gotcha; here ungranted IS the security boundary).
alter table public.feature_flags  enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on table public.feature_flags  from anon, authenticated;
revoke all on table public.admin_audit_log from anon, authenticated;

-- ---------------------------------------------------------------- admin read
create or replace function public.admin_list_flags()
returns setof public.feature_flags
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.feature_flags order by name;
end $$;
grant execute on function public.admin_list_flags() to authenticated;

-- ---------------------------------------------------------------- audited write
create or replace function public.admin_set_flag(
  p_name text,
  p_description text,
  p_default_on boolean,
  p_kill_switch boolean,
  p_enabled_user_ids uuid[],
  p_enabled_roles text[],
  p_enabled_org_ids uuid[]
) returns public.feature_flags
language plpgsql volatile security definer set search_path = public as $$
declare
  v_before jsonb;
  v_row public.feature_flags;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select to_jsonb(f) into v_before from public.feature_flags f where f.name = p_name;

  insert into public.feature_flags as f
    (name, description, default_on, kill_switch, enabled_user_ids, enabled_roles, enabled_org_ids, updated_by, updated_at)
  values
    (p_name, coalesce(p_description,''), coalesce(p_default_on,false), coalesce(p_kill_switch,false),
     coalesce(p_enabled_user_ids,'{}'), coalesce(p_enabled_roles,'{}'), coalesce(p_enabled_org_ids,'{}'),
     auth.uid(), now())
  on conflict (name) do update set
    description      = excluded.description,
    default_on       = excluded.default_on,
    kill_switch      = excluded.kill_switch,
    enabled_user_ids = excluded.enabled_user_ids,
    enabled_roles    = excluded.enabled_roles,
    enabled_org_ids  = excluded.enabled_org_ids,
    updated_by       = excluded.updated_by,
    updated_at       = now()
  returning * into v_row;

  insert into public.admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'feature_flag.set', p_name, v_before, to_jsonb(v_row));

  return v_row;
end $$;
grant execute on function public.admin_set_flag(text,text,boolean,boolean,uuid[],text[],uuid[]) to authenticated;

-- ---------------------------------------------------------------- seed: the 5 existing env flags
-- default_on = each flag's current production-effective value (all OFF today). Env stays the
-- compile-time fallback in features.ts; moving the source of truth here changes NO user behavior.
insert into public.feature_flags (name, description, default_on) values
  ('engines',        'Nutrition Intelligence + Accountability engine UI entry points', false),
  ('meal_plans',     'Structured prescribed meals + plan compliance', false),
  ('trust_pass',     'Coach-granted camera-free daily credit', false),
  ('streak_grace',   'One forgiven sub-threshold day per trailing 7', false),
  ('assistant_gate', 'Assistant Nutritionist paywall gate', false)
on conflict (name) do nothing;
