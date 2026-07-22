-- OnStandard — Command Center Phase 1B: typed, validated, versioned, audited CONFIG — SEPARATE from
-- feature flags (correction #6). Feature flags (0109) = availability / rollout / variant / kill-switch.
-- app_config = budgets, limits, thresholds, operational settings. Every set is type-validated, bumps a
-- version, is audited, and requires a live 'config' sensitive grant (step-up reauth).

create table if not exists public.app_config (
  key         text primary key,
  value       jsonb not null,
  value_type  text not null check (value_type in ('number','string','boolean','json')),
  description text not null default '',
  version     int not null default 1,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on table public.app_config from anon, authenticated;

insert into public.app_config (key, value, value_type, description) values
  ('ai_daily_budget_usd',         '25'::jsonb, 'number', 'Soft daily AI-spend budget (alert threshold)'),
  ('ai_meal_rate_limit_per_hour', '30'::jsonb, 'number', 'Per-user meal-analysis rate limit'),
  ('attention_cost_spike_pct',    '130'::jsonb,'number', 'Cost/meal spike threshold vs 7d avg (%)'),
  ('trial_length_days',           '7'::jsonb,  'number', 'Consumer trial length (days)')
on conflict (key) do nothing;

create or replace function public.admin_get_config()
returns setof public.app_config language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.app_config order by key;
end $$;
grant execute on function public.admin_get_config() to authenticated;

create or replace function public.admin_set_config(p_key text, p_value jsonb)
returns public.app_config language plpgsql volatile security definer set search_path = public as $$
declare v_row public.app_config; v_before jsonb;
begin
  perform admin_require_grant('config');
  select * into v_row from public.app_config where key = p_key;
  if v_row.key is null then raise exception 'unknown config key: %', p_key; end if;
  if v_row.value_type = 'number'  and jsonb_typeof(p_value) <> 'number'  then raise exception 'expected a number';  end if;
  if v_row.value_type = 'string'  and jsonb_typeof(p_value) <> 'string'  then raise exception 'expected a string';  end if;
  if v_row.value_type = 'boolean' and jsonb_typeof(p_value) <> 'boolean' then raise exception 'expected a boolean'; end if;
  v_before := to_jsonb(v_row);
  update public.app_config set value = p_value, version = version + 1, updated_by = auth.uid(), updated_at = now()
    where key = p_key returning * into v_row;
  insert into admin_audit_log (actor_id, action, target, before, after)
    values (auth.uid(), 'config.set', p_key, v_before, to_jsonb(v_row));
  return v_row;
end $$;
grant execute on function public.admin_set_config(text, jsonb) to authenticated;

-- capabilities: typed config now exists.
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
      'financial', false, 'flags', true, 'config', true)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;
