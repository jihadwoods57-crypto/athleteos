-- OnStandard — practice rollups: the trainer mirror of 0076's team_day_rollup /
-- team_intervention_outcomes. Slice D of the trainer-parity program. Forward-only, idempotent.
--
-- WHY
-- Slice C (0136) gave a practice its own standing standard, assignments, interventions and
-- notes. Insights (coach-insights.js) is the one screen still hard-wired to `team_day_rollup`
-- / `team_intervention_outcomes`, both gated `is_team_staff(p_team)` with no practice branch.
-- These two mirror them exactly — same shape, same window rules, same jsonb guards — joining
-- practice_clients instead of team_members and coach_interventions.practice_id instead of
-- .team_id.
--
-- SECURITY MODEL: unchanged from 0076. is_practice_staff(p_practice) (0136) is the FIRST
-- statement of each function; both are security definer; explicit grant to authenticated with a
-- public/anon revoke, same belt-and-braces as every RPC since 0035.
--
-- NOT mirrored: the WEIGHT_LOGGED column reads d.current_weight directly (a security-definer
-- function body bypasses the 0103 column-grant split same as the team version does — nothing
-- practice-specific here, just noting the read is unchanged).
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies via
-- `supabase db push` then `npm run test:rls` (new probes ship in this commit).

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
    -- A practice roster carries no position (practice_roster hardcodes it null, 0114) — the
    -- column stays in the return shape so the SAME client rollup consumer (insights.js) works
    -- unmodified on either book; it is simply always null here.
    null::text as "position",
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
  join practice_clients pc on pc.practice_id = p_practice and pc.client_id = d.athlete_id and pc.status = 'active'
  where d.date between p_from and p_to;
end $$;
revoke execute on function practice_day_rollup(uuid, date, date) from public, anon;
grant  execute on function practice_day_rollup(uuid, date, date) to authenticated;

create or replace function practice_intervention_outcomes(p_practice uuid, p_from date)
returns table (
  intervention_id uuid, athlete_id uuid, kind text, tier text, day date,
  score_before numeric, score_after numeric, days_before int, days_after int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_practice_staff(p_practice) then
    raise exception 'not authorized for this practice';
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
  where ci.practice_id = p_practice and ci.day >= p_from;
end $$;
revoke execute on function practice_intervention_outcomes(uuid, date) from public, anon;
grant  execute on function practice_intervention_outcomes(uuid, date) to authenticated;
