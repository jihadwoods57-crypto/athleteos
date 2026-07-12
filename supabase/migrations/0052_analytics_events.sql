-- OnStandard — anonymous activation/funnel events (instrumentation, 2026-07-11).
--
-- COMPLEMENTS 0037: 0037 answers "how many athletes logged today?" retroactively over days/meals,
-- but only sees AUTHENTICATED users already in the loop. It cannot see the FUNNEL — how many
-- started onboarding vs finished, where they dropped, how often meal analysis FAILED, how many
-- under-13s hit the age gate. This table captures those anonymous, client-only signals, written
-- by the `analytics-ingest` edge function (service role).
--
-- PRIVACY: rows are keyed to an anonymous per-install session id, NEVER a user id/email. The
-- client redacts props to counts/enums only, and the ingest function re-validates server-side
-- (defense in depth) — so a row structurally cannot carry PII or health data.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here, and the client seam is
-- INERT until the founder deploys analytics-ingest + sets EXPO_PUBLIC_ANALYTICS_URL. See
-- docs/audit/2026-07-11-instrumentation.md.

create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  session_id  text not null,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,                         -- client clock (informational; may be skewed)
  created_at  timestamptz not null default now()   -- server receipt time (the trustworthy one)
);
create index if not exists analytics_events_name_created on analytics_events (name, created_at);
create index if not exists analytics_events_session on analytics_events (session_id);

-- Normal roles get NOTHING: the ingest function writes via service_role (bypasses RLS), and
-- platform admins read only through the gated RPCs below. No anon/authenticated read or write.
alter table analytics_events enable row level security;
revoke all on table analytics_events from anon, authenticated;

-- ---------------------------------------------------------------- gated reads (reuse 0037's admin gate)
-- Per-event daily counts over the window. Counts only. Platform-admin gated.
create or replace function admin_event_counts(p_days int default 14)
returns table (name text, day date, sessions bigint, events bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select e.name, e.created_at::date as day,
           count(distinct e.session_id) as sessions, count(*) as events
    from analytics_events e
    where e.created_at >= current_date - (greatest(p_days, 1) - 1)
    group by e.name, e.created_at::date
    order by day desc, events desc;
end $$;
grant execute on function admin_event_counts(int) to authenticated;

-- The onboarding funnel as distinct-session stage counts + the two invisible drops (age gate,
-- meal-analysis failures). This is the number 0037 can't produce. Platform-admin gated.
create or replace function admin_onboarding_funnel(p_days int default 14)
returns table (
  opens         bigint,  -- distinct sessions that opened the app
  roles_picked  bigint,  -- ...that picked a role
  goals_picked  bigint,  -- ...that chose a goal
  completed     bigint,  -- ...that created an account
  age_blocked   bigint,  -- distinct sessions turned away by the 13+ gate
  meal_fails    bigint   -- distinct sessions that hit a meal-analysis failure
)
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := current_date - (greatest(p_days, 1) - 1);
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'app_open'),
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'onboarding_role'),
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'goal_selected'),
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'onboarding_completed'),
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'age_blocked'),
      (select count(distinct session_id) from analytics_events where created_at >= since and name = 'meal_analysis_failed');
end $$;
grant execute on function admin_onboarding_funnel(int) to authenticated;
