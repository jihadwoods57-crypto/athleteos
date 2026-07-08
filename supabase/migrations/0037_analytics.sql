-- OnStandard — founder analytics (audit 2026-07-02, item 8)
--
-- THE GAP: there is no product analytics anywhere, so the founder cannot answer the one question
-- the whole "prove retention before sparkle" strategy depends on: "how many athletes logged today?"
-- This adds that answer with ZERO client changes and works RETROACTIVELY — it aggregates the `days`
-- and `meals` data already being collected. (Crash/error reporting is a separate concern that needs
-- the native SDK + an EAS build; tracked in the go-live doc, not here.)
--
-- SAFETY: every function returns COUNTS ONLY (no names, no PII) and is gated to a platform-admin
-- allowlist, so it is safe even if surfaced in-app later. Reads are one-directional aggregates over
-- existing tables; nothing is written.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. The founder applies it, then
-- seeds their own id into platform_admins ONCE (see the bottom), after which the RPCs answer from
-- the Supabase SQL editor / a service-role script immediately.

-- ---------------------------------------------------------------- platform-admin allowlist
-- Who may read platform-wide analytics. Deliberately a tiny explicit table (not a profile flag or
-- an org role) so platform-admin is unambiguous and can never be self-granted. RLS denies all
-- normal access; only the SECURITY DEFINER helpers below read it.
create table if not exists platform_admins (
  user_id  uuid primary key references profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
revoke all on table platform_admins from anon, authenticated;

-- Is the caller a platform admin? SECURITY DEFINER so it can read the deny-all allowlist. Internal
-- (called inside the admin RPCs) — no app role gets EXECUTE.
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
revoke execute on function is_platform_admin() from anon, authenticated;

-- ---------------------------------------------------------------- daily activity
-- One row per day for the last p_days. Three activity signals, weakest to strongest:
--   active_athletes  — a `days` row was touched that day (opened / synced anything)
--   scored_athletes  — that day's score was computed (real engagement with the loop)
--   meal_loggers     — a meal row exists for that day (the truest "photo-logged" signal)
-- plus the day's average score. Counts only. Gated to platform admins.
create or replace function admin_daily_activity(p_days int default 30)
returns table (
  day             date,
  active_athletes bigint,
  scored_athletes bigint,
  meal_loggers    bigint,
  avg_score       numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    with span as (
      select generate_series(current_date - (greatest(p_days, 1) - 1), current_date, interval '1 day')::date as d
    )
    select
      s.d,
      (select count(distinct dd.athlete_id) from days dd where dd.date = s.d),
      (select count(distinct dd.athlete_id) from days dd where dd.date = s.d and dd.score is not null),
      (select count(distinct m.athlete_id)  from meals m where m.day_date = s.d),
      (select round(avg(dd.score)::numeric, 1) from days dd where dd.date = s.d and dd.score is not null)
    from span s
    order by s.d desc;
end $$;
grant execute on function admin_daily_activity(int) to authenticated;

-- ---------------------------------------------------------------- headline overview
-- The at-a-glance numbers for "how are we doing right now." Counts only. Gated to platform admins.
create or replace function admin_overview()
returns table (
  total_athletes      bigint,
  active_today        bigint,
  meal_loggers_today  bigint,
  active_7d           bigint,
  new_athletes_7d     bigint,
  total_coaches       bigint,
  total_orgs          bigint,
  total_teams         bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select
      (select count(*) from profiles where primary_role = 'athlete'),
      (select count(distinct athlete_id) from days  where date = current_date),
      (select count(distinct athlete_id) from meals where day_date = current_date),
      (select count(distinct athlete_id) from days  where date >  current_date - 7),
      (select count(*) from profiles where primary_role = 'athlete' and created_at > now() - interval '7 days'),
      (select count(*) from profiles where primary_role = 'coach'),
      (select count(*) from orgs),
      (select count(*) from teams);
end $$;
grant execute on function admin_overview() to authenticated;

-- ================================================================ ONE-TIME SEED (run as service_role)
-- Add the founder so the RPCs answer. Find the id in Supabase → Auth → Users, then:
--   insert into platform_admins (user_id) values ('<founder-profile-uuid>');
-- Verify:  select * from admin_overview();   /   select * from admin_daily_activity(14);
