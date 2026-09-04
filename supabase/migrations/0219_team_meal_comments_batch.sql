-- 0219: one set-based read for the inbox's roster-wide comment threads.
--
-- The coach Inbox fills its meal-thread buckets through fetchTeamMealComments, which today
-- chunks the roster into `.in('athlete_id', ...)` GETs of 60 ids each (id-chunk.js) because a
-- plain select is the only shape PostgREST exposes and past ~200 athletes one URL 414s. Each
-- chunk asks for its own top-1000 rows to keep the "newest 1000 across the roster" contract, so
-- a 240-client roster hauls up to 4x1000 rows over the wire to keep 1000. This is the LAST
-- roster read still paying that shape (0214 collapsed its sibling, the activity feed). An RPC
-- POSTs the ids in the body -- no URL ceiling, one round trip, and the database keeps only the
-- true top-`limit` before anything crosses the wire.
--
-- Row gate mirrors meal_comments_read AS OF 0069 exactly -- and 0069 is why this cannot simply
-- reuse 0214's `can_view(athlete_id)` gate: private coach notes (kind='note') are readable ONLY
-- by linked overseers who are NOT the athlete, because can_view includes is_self and 0068's
-- naive arm handed athletes every note written about them. A security-definer function that
-- forgot the note arm would reopen that exact leak to any athlete calling the RPC with their own
-- id. So: non-notes go to the athlete themself or any can_view viewer; notes go only to
-- can_view viewers who are not the athlete. can_view and is-self are computed once per DISTINCT
-- id (the ids CTE dedups before the gate, 0214's lesson: a duplicated id must not multiply rows
-- through the join or re-pay the gate per copy); the cheap kind arm runs per row. An id the
-- caller cannot view contributes no rows, indistinguishable from an athlete with no comments --
-- the same posture as the RLS-filtered chunked reads this replaces.
--
-- p_limit is clamped server-side to 1000 (the inbox's own ceiling, unchanged since 2026-08-17)
-- so a tampered client cannot turn this into a bulk export it could not already do row-by-row
-- through RLS.
--
-- GUARDRAIL: authored only; NOT applied to live. The client tries this RPC first and falls
-- back to the chunked reads on any error (a pre-0219 server errors with "function not found"),
-- so ordering against the OTA is safe in both directions; apply it to collapse the chunks.

create or replace function team_meal_comments_batch(p_athletes uuid[], p_since timestamptz,
                                                    p_limit int default 1000)
returns table (meal_id uuid, athlete_id uuid, role text, kind text, created_at timestamptz)
-- search_path pins pg_temp LAST (postgres otherwise searches the session temp schema first;
-- standard definer hardening, one step past 0214's `= public`).
language sql stable security definer set search_path = public, pg_temp as $$
  with ids as (
    select distinct a.athlete_id from unnest(p_athletes) as a(athlete_id)
  ),
  viewable as (
    select i.athlete_id,
           (i.athlete_id = auth.uid()) as is_self
    from ids i
    where can_view(i.athlete_id) or i.athlete_id = auth.uid()
  )
  select c.meal_id, c.athlete_id, c.role, c.kind, c.created_at
  from meal_comments c
  join viewable v on v.athlete_id = c.athlete_id
  where c.created_at >= p_since
    -- 0069's read policy: notes are for overseers only, never the athlete themself. The join
    -- already established (can_view OR is_self) for this id, so for a note row `not is_self`
    -- is the whole remaining test: a non-self reader could only have entered `viewable`
    -- through can_view, which is exactly 0069's note arm.
    and (coalesce(c.kind, 'message') <> 'note' or not v.is_self)
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke execute on function team_meal_comments_batch(uuid[], timestamptz, int) from public, anon;
grant  execute on function team_meal_comments_batch(uuid[], timestamptz, int) to authenticated;
