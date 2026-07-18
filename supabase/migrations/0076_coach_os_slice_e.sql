-- OnStandard — Coach OS Slice E: team analytics read RPCs (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md).
-- One slice, one migration (0055/0071 idiom). Forward-only, idempotent (create or replace only).
--
-- Two staff-only reads that power the Slice E team dashboard/insights. The CLIENT engine does the
-- shaping (padding empty days, judging trend significance); these functions only return the raw
-- per-athlete-per-day facts and per-intervention before/after windows.
--
-- SECURITY MODEL (0040 — THE model): is_team_staff(p_team) gate is the FIRST statement of each
-- function; both are `security definer set search_path = public`; 0035 made new functions
-- secure-by-default (no auto EXECUTE), so we grant `authenticated` explicitly and belt-and-braces
-- revoke the public/anon inheritance path. Athletes are NOT team staff → the gate rejects them
-- exactly like team_roster (0040).
--
-- TIMEZONE RULE (binding, from the plan): window boundaries come from p_from/p_to (caller-local);
-- days.date/meals.day_date are athlete-device-local dates; interventions.day is coach-device-local
-- — a documented ±1-day cross-timezone blur, acceptable at week granularity. NO current_date/now()
-- appears in any window logic here; every bucket boundary is derived from the caller's params.
--
-- checkin_done SOURCE DECISION: `days.checkin` is a jsonb blob written by the athlete's sync; a
-- submitted weekly check-in also lands as a `checkins` row keyed by `week text`. The `week` string
-- has no parseable canonical format reachable from the app (submitCheckin in src/lib/supabase/
-- queries.ts just upserts whatever key the caller built; no builder is reachable in src), so we do
-- NOT try to parse it. Instead we approximate "checked in for this day" two ways and OR them:
--   (1) days.checkin ->> 'submitted' is non-empty (the JSON source), and
--   (2) a checkins row whose submitted_at::date falls in [day-6, day] (the table source, a 7-day
--       trailing window that stands in for "this week" without decoding the week key).
--
-- jsonb GUARD: bad sync data could leave days.tasks as a non-array; jsonb_array_elements would then
-- error the whole rollup. We coerce a non-array to '[]' so one bad row can't blank the team. `done`
-- is compared as text ('true') rather than cast ::boolean, so a malformed value never raises.
--
-- PERFORMANCE: the correlated subqueries run per days-row over ≤62 days × active roster. Existing
-- indexes cover them: days_athlete_date (athlete_id,date), meals_athlete_day (athlete_id,day_date),
-- ci_team_day (team_id,day). No new index needed at this scale.

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
    (coalesce(d.checkin->>'submitted','') <> ''
      or exists (select 1 from checkins c
                 where c.athlete_id = d.athlete_id
                   and c.submitted_at::date between d.date - 6 and d.date)) as checkin_done,
    (d.current_weight is not null) as weight_logged
  from days d
  join team_members tm on tm.team_id = p_team and tm.athlete_id = d.athlete_id and tm.status = 'active'
  where d.date between p_from and p_to;
end $$;
revoke execute on function team_day_rollup(uuid, date, date) from public, anon;
grant  execute on function team_day_rollup(uuid, date, date) to authenticated;

create or replace function team_intervention_outcomes(p_team uuid, p_from date)
returns table (
  intervention_id uuid, athlete_id uuid, kind text, tier text, day date,
  score_before numeric, score_after numeric, days_before int, days_after int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_staff(p_team) then
    raise exception 'not authorized for this team';
  end if;
  return query
  select
    ci.id, ci.athlete_id, ci.kind, ci.tier, ci.day,
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select avg(d.score) from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day - 7 and ci.day - 1 and d.score is not null),
    (select count(*)::int from days d where d.athlete_id = ci.athlete_id
      and d.date between ci.day + 1 and ci.day + 7 and d.score is not null)
  from coach_interventions ci
  where ci.team_id = p_team and ci.day >= p_from;
end $$;
revoke execute on function team_intervention_outcomes(uuid, date) from public, anon;
grant  execute on function team_intervention_outcomes(uuid, date) to authenticated;
