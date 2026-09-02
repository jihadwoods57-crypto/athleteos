-- 0214: one set-based read for the roster activity feed (the dietitian queue's fetch).
--
-- The nutrition board (coach-home's queue + fueling table) reads recent meals for the whole
-- roster through fetchTeamActivity, which today chunks the roster into `.in('athlete_id', ...)`
-- GETs of 60 ids each (id-chunk.js) because a plain select is the only shape PostgREST exposes
-- and past ~200 athletes one URL 414s. Each chunk asks for its own top-`limit` rows, so a
-- 240-client roster hauls up to 4x`limit` rows over the wire to keep `limit`. An RPC POSTs the
-- ids in the body -- no URL ceiling, one round trip, and the database keeps only the true
-- top-`limit` before anything crosses the wire.
--
-- Row gate mirrors meals_read (0002:99) exactly: can_view(athlete_id), which since 0081 already
-- folds in is_self, membership scoping, and the minor-consent wall. The ids CTE dedups BEFORE
-- the gate, so can_view runs once per distinct athlete (not once per meal row, and not once per
-- array element -- the adversarial review caught that a duplicated id would otherwise multiply
-- every one of that athlete's meal rows through the join AND re-pay the gate per copy). An id
-- the caller cannot view contributes no rows, indistinguishable from an athlete who logged
-- nothing -- the same posture as 0205's batch RPC and as the RLS-filtered chunked reads this
-- replaces.
--
-- p_limit is clamped server-side to 400 (the board's own ceiling) so a tampered client cannot
-- turn this into a bulk export it could not already do row-by-row through RLS.
--
-- GUARDRAIL: authored only; NOT applied to live. The client tries this RPC first and falls
-- back to the chunked reads on any error (a pre-0214 server errors with "function not found"),
-- so ordering against the OTA is safe in both directions; apply it to collapse the chunks.

create or replace function team_activity_batch(p_athletes uuid[], p_since date, p_limit int default 400)
returns table (id uuid, athlete_id uuid, day_date date, type text, photo_path text,
               name text, protein int, kcal int, quality int, logged_at timestamptz)
language sql stable security definer set search_path = public as $$
  with ids as (
    select distinct a.athlete_id from unnest(p_athletes) as a(athlete_id)
  ),
  viewable as (
    select i.athlete_id from ids i where can_view(i.athlete_id)
  )
  select m.id, m.athlete_id, m.day_date, m.type, m.photo_path,
         m.name, m.protein, m.kcal, m.quality, m.logged_at
  from meals m
  join viewable v on v.athlete_id = m.athlete_id
  where m.day_date >= p_since
  order by m.logged_at desc
  limit least(greatest(coalesce(p_limit, 400), 1), 400);
$$;
revoke execute on function team_activity_batch(uuid[], date, int) from public, anon;
grant  execute on function team_activity_batch(uuid[], date, int) to authenticated;
