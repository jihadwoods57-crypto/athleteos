-- OnStandard — checkin_done: tonight only, correct boolean test. Forward-only, idempotent.
--
-- WHY
-- team_day_rollup (0076, redefined 0078) and practice_day_rollup (0137) all define
-- checkin_done with the same predicate:
--
--   (coalesce(d.checkin->>'submitted','') <> ''
--     or exists (select 1 from checkins c
--                where c.athlete_id = d.athlete_id
--                  and c.submitted_at::date between d.date - 6 and d.date)) as checkin_done,
--
-- Two defects, both server-side, both consumed by insights.js's avgCheckinPct (the coach's
-- Weekly Brief "check-in rate"):
--
--   1. The `exists (... between d.date - 6 and d.date)` arm is the retired weekly check-in's
--      7-day carry. Score v2 dropped the client-side carry (there is no weekly check-in left in
--      the product — the nightly recovery check-in is the only check-in). This branch is what
--      created the divergence: pre-v2 the client carried too, so client and server agreed. v2
--      left the server carry in place.
--
--   2. `coalesce(d.checkin->>'submitted','') <> ''` is true whenever the JSON KEY EXISTS,
--      regardless of its value — `'false' <> ''` is true. The proto always writes
--      `submitted: DAY.ciSubmitted` (day.js:809), so the key is always present once a day
--      object exists. Verified on live prod: a 2026-08-06 row with submitted = "false" and
--      score = 10 evaluates checkin_done = true today.
--
-- FIX: checkin_done = (d.checkin->>'submitted') = 'true' — tonight only, no carry, a real
-- boolean-value test instead of a presence test. No other column in either function changes.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied here. Founder applies via
-- `supabase db push`, then re-runs the VERIFICATION query below against prod to confirm the
-- count matches what was recorded before applying.

create or replace function team_day_rollup(p_team uuid, p_from date, p_to date)
returns table (
  athlete_id uuid, day date, "position" text, score int,
  meals_logged int, tasks_done text[], checkin_done boolean, weight_logged boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'window must be 0-62 days';
  end if;
  return query
  select
    d.athlete_id,
    d.date as day,
    tm.position,
    d.score,
    coalesce((select count(*)::int from meals m
              where m.athlete_id = d.athlete_id and m.day_date = d.date), 0) as meals_logged,
    coalesce((select array_agg(t->>'id')
              from jsonb_array_elements(
                     case when jsonb_typeof(d.tasks) = 'array' then d.tasks else '[]'::jsonb end) t
              where (t->>'done') = 'true'), '{}') as tasks_done,
    ((d.checkin->>'submitted') = 'true') as checkin_done,
    (d.current_weight is not null) as weight_logged
  from days d
  join team_members tm on tm.team_id = p_team and tm.athlete_id = d.athlete_id and tm.status = 'active'
  where d.date between p_from and p_to
    and not staff_scope_blocks(d.athlete_id)
  ;
end $$;
revoke execute on function team_day_rollup(uuid, date, date) from public, anon;
grant  execute on function team_day_rollup(uuid, date, date) to authenticated;

create or replace function practice_day_rollup(p_practice uuid, p_from date, p_to date)
returns table (
  athlete_id uuid, day date, "position" text, score int,
  meals_logged int, tasks_done text[], checkin_done boolean, weight_logged boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_practice_staff(p_practice) then
    raise exception 'not authorized for this practice';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'window must be 0-62 days';
  end if;
  return query
  select
    d.athlete_id,
    d.date as day,
    null::text as "position",
    d.score,
    coalesce((select count(*)::int from meals m
              where m.athlete_id = d.athlete_id and m.day_date = d.date), 0) as meals_logged,
    coalesce((select array_agg(t->>'id')
              from jsonb_array_elements(
                     case when jsonb_typeof(d.tasks) = 'array' then d.tasks else '[]'::jsonb end) t
              where (t->>'done') = 'true'), '{}') as tasks_done,
    ((d.checkin->>'submitted') = 'true') as checkin_done,
    (d.current_weight is not null) as weight_logged
  from days d
  join practice_clients pc on pc.practice_id = p_practice and pc.client_id = d.athlete_id and pc.status = 'active'
  where d.date between p_from and p_to;
end $$;
revoke execute on function practice_day_rollup(uuid, date, date) from public, anon;
grant  execute on function practice_day_rollup(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- VERIFICATION — read-only, run BEFORE applying.
--
-- How many live `days` rows would flip checkin_done classification (old predicate vs new)?
-- This does not touch checkin_done as returned by the RPCs (those only exist per-call); it
-- evaluates the same predicate directly against `days` + `checkins` so it can be run without
-- calling either function.
--
--   select count(*) as would_change
--   from days d
--   where (
--     (coalesce(d.checkin->>'submitted','') <> ''
--       or exists (select 1 from checkins c
--                  where c.athlete_id = d.athlete_id
--                    and c.submitted_at::date between d.date - 6 and d.date))
--   ) <> ((d.checkin->>'submitted') = 'true');
--
-- Run on 2026-08-09 against linked prod: see
-- .superpowers/sdd/2026-08-09-score-breakdown-v2/final-fix-report.md for the recorded count.
-- ---------------------------------------------------------------------------------------------
