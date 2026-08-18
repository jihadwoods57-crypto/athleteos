-- 0204: the team nutritionist may see weight.
--
-- Founder ruling 2026-08-18: the staff role 'nutritionist' joins the weight-visible set.
-- Weight trend is the primary underfueling / RED-S signal for a dietitian; the 0103 matrix
-- granted it to S&C and the athletic trainer while denying the one professional whose work
-- runs on it. Everything else about 0103 stands: the predicate is still the single wall,
-- the column-split grants are untouched, and athlete_plan_meta / weight_series / the
-- coach_set_goals write guard all pick this change up for free because they call the
-- predicate rather than carrying their own role list.
--
-- Client mirror: WEIGHT_VIEW_ROLES in proto/redesign-2026-07/js/staff-access.js must list
-- the same roles (it fails CLOSED while loading; this function is the real wall).
--
-- GUARDRAIL: authored only; NOT applied to live. Apply BEFORE the client OTA that widens
-- the client-side map, or the client shows a weight pane the server still redacts.

create or replace function can_view_weight(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete)
      or ( can_view(athlete)
           and ( is_trainer_of(athlete)
                 or exists (
                     select 1
                     from team_members m
                     join team_staff s on s.team_id = m.team_id
                     where m.athlete_id = athlete and m.status = 'active'
                       and s.staff_id = auth.uid() and s.status = 'active'
                       and s.role in ('head_coach', 'athletic_trainer', 's_and_c', 'nutritionist')) ) );
$$;
revoke execute on function can_view_weight(uuid) from public, anon;
grant  execute on function can_view_weight(uuid) to authenticated;
