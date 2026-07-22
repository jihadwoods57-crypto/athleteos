-- OnStandard — Command Center v2 (handoff Section 17/18): turns the read-only founder dashboard into
-- a proactive, actionable decision system. Adds (1) a triage state store so attention items can be
-- resolved/snoozed with history, (2) a brief-snapshot store for "since your last visit" diffs + a
-- daily server-side heartbeat, (3) drill-down RPCs (top cost athletes + one athlete's profile),
-- (4) a safe audited founder action (tag-for-review), and (5) a pg_cron scheduler for the daily brief.
--
-- Security: every dashboard-facing RPC is is_platform_admin()-gated SECURITY DEFINER; both new tables
-- are RLS-on + revoked from anon/authenticated (RPC/service-role only). All state changes audit into
-- admin_audit_log (0109). Numbered 0113 (after 0112).

-- ================================================================ triage state
create table if not exists public.admin_attention_state (
  flag_key      text primary key,                 -- the stable rule key from attention.js (e.g. 'ai_cost')
  status        text not null default 'open' check (status in ('open','snoozed','resolved')),
  snoozed_until timestamptz,
  note          text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- ================================================================ brief snapshots
create table if not exists public.admin_brief_snapshots (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  source        text not null default 'manual',   -- 'manual' (dashboard load) | 'cron' (daily heartbeat)
  warn_count    int,
  note_count    int,
  active_today  int,
  cost_per_meal numeric,
  meals_today   int,
  subs          int,
  metrics       jsonb                              -- full bundle on manual snapshots; null on light cron rows
);
create index if not exists admin_brief_snapshots_created on public.admin_brief_snapshots (created_at desc);

alter table public.admin_attention_state enable row level security;
alter table public.admin_brief_snapshots enable row level security;
revoke all on table public.admin_attention_state from anon, authenticated;
revoke all on table public.admin_brief_snapshots from anon, authenticated;

-- ================================================================ drill-down: top cost athletes
-- "Who is behind the AI cost." Window AI dollars per athlete, most expensive first.
create or replace function public.admin_top_cost_athletes(p_days int default 14, p_limit int default 10)
returns table (user_id uuid, calls bigint, cost_usd numeric, last_call timestamptz, meals bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select c.user_id,
           count(*)::bigint as calls,
           round(coalesce(sum(c.cost_usd), 0), 4) as cost_usd,
           max(c.created_at) as last_call,
           (select count(*)::bigint from meals m
              where m.athlete_id = c.user_id and m.day_date >= current_date - (greatest(p_days,1) - 1)) as meals
    from ai_call_costs c
    where c.user_id is not null and c.created_at >= current_date - (greatest(p_days,1) - 1)
    group by c.user_id
    order by cost_usd desc nulls last
    limit greatest(least(p_limit, 100), 1);
end $$;
grant execute on function public.admin_top_cost_athletes(int, int) to authenticated;

-- ================================================================ drill-down: one athlete's profile
create or replace function public.admin_athlete_profile(p_user uuid)
returns table (
  athlete_id uuid, full_name text, email text, primary_role text, created_at timestamptz,
  last_active date, meals_total bigint, meals_7d bigint, ai_cost_30d numeric,
  sub_tier text, sub_status text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select p.id, p.full_name, p.email, p.primary_role::text, p.created_at,
           (select max(d.date) from days d where d.athlete_id = p.id) as last_active,
           (select count(*)::bigint from meals m where m.athlete_id = p.id) as meals_total,
           (select count(*)::bigint from meals m where m.athlete_id = p.id and m.day_date >= current_date - 6) as meals_7d,
           (select round(coalesce(sum(c.cost_usd), 0), 4) from ai_call_costs c
              where c.user_id = p.id and c.created_at >= current_date - 29) as ai_cost_30d,
           s.tier, s.status
    from profiles p
    left join subscriptions s on s.owner_id = p.id
    where p.id = p_user;
end $$;
grant execute on function public.admin_athlete_profile(uuid) to authenticated;

-- ================================================================ triage: read + write
create or replace function public.admin_list_attention_state()
returns setof public.admin_attention_state
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.admin_attention_state order by updated_at desc;
end $$;
grant execute on function public.admin_list_attention_state() to authenticated;

-- Resolve / snooze / reopen an attention item. Snooze uses p_snooze_days (0 = clear). Audited.
create or replace function public.admin_set_attention_state(
  p_flag_key text, p_status text, p_snooze_days int default 0, p_note text default null
) returns public.admin_attention_state
language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb; v_until timestamptz; v_row public.admin_attention_state;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','snoozed','resolved') then raise exception 'bad status'; end if;
  v_until := case when p_status = 'snoozed' then now() + make_interval(days => greatest(coalesce(p_snooze_days,1),1)) else null end;
  select to_jsonb(a) into v_before from public.admin_attention_state a where a.flag_key = p_flag_key;
  insert into public.admin_attention_state as a (flag_key, status, snoozed_until, note, updated_by, updated_at)
    values (p_flag_key, p_status, v_until, p_note, auth.uid(), now())
  on conflict (flag_key) do update set
    status = excluded.status, snoozed_until = excluded.snoozed_until,
    note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  insert into public.admin_audit_log (actor_id, action, target, before, after)
    values (auth.uid(), 'attention.' || p_status, p_flag_key, v_before, to_jsonb(v_row));
  return v_row;
end $$;
grant execute on function public.admin_set_attention_state(text, text, int, text) to authenticated;

-- ================================================================ safe founder action: tag for review
-- Reversible, non-destructive: records an intent to review an athlete. Pure audit-log entry (no state
-- change to the user), so it can never harm — exactly the "safe founder action" tier of the handoff.
create or replace function public.admin_tag_user_for_review(p_user uuid, p_note text default null)
returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  insert into public.admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'user.tag_review', p_user::text, jsonb_build_object('note', p_note))
    returning id into v_id;
  return v_id;
end $$;
grant execute on function public.admin_tag_user_for_review(uuid, text) to authenticated;

-- ================================================================ brief snapshots: save + list
create or replace function public.admin_save_brief_snapshot(
  p_warn int, p_note int, p_active int, p_cpm numeric, p_meals int, p_subs int, p_metrics jsonb default null
) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  insert into public.admin_brief_snapshots (source, warn_count, note_count, active_today, cost_per_meal, meals_today, subs, metrics)
    values ('manual', p_warn, p_note, p_active, p_cpm, p_meals, p_subs, p_metrics)
    returning id into v_id;
  return v_id;
end $$;
grant execute on function public.admin_save_brief_snapshot(int, int, int, numeric, int, int, jsonb) to authenticated;

create or replace function public.admin_list_brief_snapshots(p_limit int default 30)
returns setof public.admin_brief_snapshots
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query select * from public.admin_brief_snapshots order by created_at desc limit greatest(least(p_limit, 200), 1);
end $$;
grant execute on function public.admin_list_brief_snapshots(int) to authenticated;

-- ================================================================ daily brief cron (mirrors 0044)
-- Founder (or the deploy runbook) calls this ONCE with the admin-brief function URL + the shared key.
-- Idempotent re-run. Default: daily 12:00 UTC (~8am US Eastern).
create or replace function public.schedule_admin_brief(fn_url text, cron_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'admin-brief';
  perform cron.schedule(
    'admin-brief',
    '0 12 * * *',
    format(
      $job$ select net.http_post(url := %L, headers := jsonb_build_object('x-brief-key', %L, 'Content-Type', 'application/json'), body := '{}'::jsonb); $job$,
      fn_url, cron_key
    )
  );
end; $$;
revoke execute on function public.schedule_admin_brief(text, text) from public, anon, authenticated;
