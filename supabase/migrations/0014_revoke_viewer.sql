-- OnStandard — revoke_viewer (security G1): a signed-in athlete severs a specific viewer's access.
--
-- The in-app "Remove viewer" control must ACTUALLY revoke access once the backend is live, not just
-- edit a local label. The client half (db.revokeViewer, gated behind isBackendLive) is already wired;
-- this is the server half it calls.
--
-- Access model in force (after 0012 cutover + 0013 hardening):
--   can_view(athlete) = can_view_via_memberships(athlete)   -- self + team coaches (backfilled into
--                                                            --   org_memberships, group-scoped to the team)
--                    OR is_trainer_of(athlete)               -- practice_clients (not yet backfilled)
--                    OR is_guardian_of(athlete);             -- guardianships (not yet backfilled)
-- All three predicates filter status = 'active', so flipping the athlete's matching subject-side row to
-- a non-active status drops exactly that viewer's can_view, nothing else. This only ever touches the
-- ACCESS half — never the athlete's profile or logged data (D1, the bright line).
--
-- COACH: a coach's view routes through the athlete's TEAM-side org_membership (role='athlete', group
-- scope). The membership model has one athlete-membership per (org, role, scope), so revoking 'coach'
-- deactivates that membership = the athlete leaves that team's oversight. In the one-team wedge this is
-- exactly "remove my coach"; richer per-coach granularity is option-2 in
-- docs/specs/2026-06-29-g1-revoke-viewer.md, added when multi-coach is real. The legacy team_members
-- row is deactivated too for consistency (post-0012 it no longer drives coach can_view).
--
-- NOTE: membership_status has no 'revoked' value (the earlier DRAFT used one, which would have errored);
-- the correct deactivating value is 'removed' (link_status) / 'removed' (membership_status), both of
-- which can_view's predicates exclude.
--
-- VALIDATED on a throwaway Postgres — see supabase/tests/revoke_viewer_test.sql (before/after can_view
-- for coach/trainer/guardian, no over-revocation, idempotent, athlete profile untouched).

create or replace function revoke_viewer(viewer_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'must be signed in'; end if;

  if viewer_kind = 'coach' then
    update org_memberships set status = 'removed', ended_at = now()
      where member_id = uid and role = 'athlete' and status = 'active';
    update team_members set status = 'removed'
      where athlete_id = uid and status = 'active';

  elsif viewer_kind in ('trainer', 'nutritionist') then
    update practice_clients set status = 'removed'
      where client_id = uid and status = 'active';

  elsif viewer_kind in ('parent', 'guardian') then
    update guardianships set status = 'removed'
      where athlete_id = uid and status = 'active';
  end if;
end $$;

grant execute on function revoke_viewer(text) to authenticated, service_role;
