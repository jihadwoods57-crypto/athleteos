-- 0054 — coach_set_goals must never report success while saving nothing (persona-sim finding F-N1).
--
-- The 0002 definition was `UPDATE athlete_profiles ... WHERE athlete_id = athlete`. If the athlete
-- has no athlete_profiles row yet (e.g. joined by code but hasn't finished the profile step), the
-- UPDATE matches 0 rows, raises no error, and returns void — so the coach UI reports "Saved to their
-- plan." while the targets never persist and the athlete never sees them. A silent-success is a trust
-- break: the app claims work it didn't do.
--
-- Fix: upsert. Create the row if it doesn't exist, otherwise update it — preserving the original
-- null-safe semantics (a null new_targets/new_season_goal leaves the existing value untouched). The
-- authorization check and SECURITY DEFINER boundary are unchanged.
create or replace function coach_set_goals(athlete uuid, new_targets jsonb, new_season_goal jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_team_coach_of(athlete) or is_trainer_of(athlete)) then
    raise exception 'not authorized to set goals for this athlete';
  end if;
  -- targets and season_goal are NOT NULL (default '{}'). On INSERT, coalesce a missing value to
  -- the empty default so a first-time set for an athlete with no row succeeds. On UPDATE, reference
  -- the raw args (not excluded) so passing only new_targets never clobbers an existing season_goal.
  insert into athlete_profiles as ap (athlete_id, targets, season_goal, updated_at)
  values (athlete, coalesce(new_targets, '{}'::jsonb), coalesce(new_season_goal, '{}'::jsonb), now())
  on conflict (athlete_id) do update
    set targets     = coalesce(new_targets, ap.targets),
        season_goal = coalesce(new_season_goal, ap.season_goal),
        updated_at  = now();
end; $$;
