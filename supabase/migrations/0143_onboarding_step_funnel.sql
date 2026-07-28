-- OnStandard — per-screen onboarding drop-off (2026-07-23).
--
-- THE GAP: 0052 gave us admin_onboarding_funnel, but its stages are coarse (open → role →
-- goal → account). Between "picked a role" and "created an account" sit ~20-26 screens per
-- role flow, and nothing said WHICH one bled. The OB2 engine now emits `onboarding_step`
-- {route, step, ch} once per step view, so the drop-off is finally reconstructable.
--
-- READS ONLY. No table, no column, no write path — two security-definer functions over the
-- analytics_events rows 0052 already stores, gated by the same is_platform_admin() check
-- every other admin RPC uses. Privacy posture is unchanged: session_id is an anonymous
-- per-install token and props are counts/enums, so nothing here can surface a person.
--
-- APPLY: supabase db push   (or run this file against the linked project)

-- ---------------------------------------------------------------- per-step sessions
-- Distinct sessions that VIEWED each step of a flow, most-viewed first. `reached_pct` is
-- relative to the flow's own first screen, so it reads as a retention curve: the row where
-- it falls off a cliff is the screen to fix.
create or replace function admin_onboarding_steps(p_route text default null, p_days int default 14)
returns table (
  route       text,
  step        text,
  ch          int,
  sessions    bigint,   -- distinct anonymous sessions that saw this screen
  views       bigint,   -- total views (a session revisiting via Back counts again)
  reached_pct numeric,  -- sessions here ÷ sessions at this flow's entry screen
  first_seen  timestamptz  -- earliest view; orders steps WITHIN a tie tier by real flow position
)
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := current_date - (greatest(p_days, 1) - 1);
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
  with ev as (
    select
      e.props ->> 'route' as route,
      e.props ->> 'step'  as step,
      nullif(e.props ->> 'ch', '')::int as ch,
      e.session_id, e.created_at
    from analytics_events e
    where e.name = 'onboarding_step'
      and e.created_at >= since
      and e.props ? 'route' and e.props ? 'step'
      and (p_route is null or e.props ->> 'route' = p_route)
  ),
  per_step as (
    select ev.route, ev.step, max(ev.ch) as ch,
           count(distinct ev.session_id) as sessions,
           count(*) as views,
           min(ev.created_at) as first_seen
    from ev group by ev.route, ev.step
  ),
  -- the flow's entry screen = the step with the most distinct sessions (everyone sees it first)
  entry as (
    select p.route, max(p.sessions) as base from per_step p group by p.route
  )
  select p.route, p.step, p.ch, p.sessions, p.views,
         round(100.0 * p.sessions / nullif(e2.base, 0), 1) as reached_pct,
         p.first_seen
  from per_step p
  join entry e2 on e2.route = p.route
  -- sessions desc IS the funnel order (monotonic by construction). Steps that tie sit in the
  -- same tier, so break ties by chapter then by when the screen first appeared — that puts
  -- them in real flow order, which is what makes the drop-off pairs below name honest edges.
  order by p.route, p.sessions desc, p.ch nulls last, p.first_seen, p.step;
end $$;
grant execute on function admin_onboarding_steps(text, int) to authenticated;

-- ---------------------------------------------------------------- biggest bleeds
-- The single most useful view: consecutive screens ordered by how many sessions were lost
-- between them. Answers "where is onboarding breaking?" without reading the whole curve.
create or replace function admin_onboarding_dropoff(p_route text default null, p_days int default 14, p_limit int default 10)
returns table (
  route      text,
  from_step  text,
  to_step    text,
  from_ses   bigint,
  to_ses     bigint,
  lost       bigint,
  lost_pct   numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
  with s as (
    select t.route, t.step, t.sessions,
           -- mirror admin_onboarding_steps' ordering exactly, so consecutive rows are
           -- genuinely adjacent screens rather than alphabetical neighbours within a tier
           row_number() over (
             partition by t.route
             order by t.sessions desc, t.ch nulls last, t.first_seen, t.step
           ) as rn
    from admin_onboarding_steps(p_route, p_days) t
  )
  select a.route, a.step, b.step, a.sessions, b.sessions,
         (a.sessions - b.sessions) as lost,
         round(100.0 * (a.sessions - b.sessions) / nullif(a.sessions, 0), 1) as lost_pct
  from s a
  join s b on b.route = a.route and b.rn = a.rn + 1
  where a.sessions > b.sessions
  order by (a.sessions - b.sessions) desc
  limit greatest(p_limit, 1);
end $$;
grant execute on function admin_onboarding_dropoff(text, int, int) to authenticated;
