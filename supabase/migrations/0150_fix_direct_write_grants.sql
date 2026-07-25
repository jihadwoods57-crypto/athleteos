-- OnStandard — table privileges for direct client writes that fail today.
--
-- THIRD RECURRENCE of the class 0036 and 0098 each fixed. Root cause unchanged: 0013 revoked
-- 0005's `alter default privileges ... grant ... to authenticated`, so every table created AFTER
-- 0013 that the client writes DIRECTLY through PostgREST needs an explicit table grant. Without
-- it `authenticated` gets 42501 "permission denied for table" BEFORE RLS is ever evaluated — the
-- policies read as correct in review, the RLS suite passes (it asserts row visibility, not table
-- privilege), and the feature is simply broken on a device.
--
-- Every call site below swallows its error, so all four failures are SILENT in production.
-- src/core/directWriteGrants.test.ts now fails the build if a fourth recurrence is introduced.
--
-- ---------------------------------------------------------------- 1. team_rooms (0087) — LIVE BUG
-- js/roles.js:846 insert/update (create + rename a position room), :853 delete, :859 update
-- (assign a staff owner). Policies tr_staff_insert/update/delete shipped in 0087 without grants.
grant select, insert, update, delete on team_rooms to authenticated;

-- ---------------------------------------------------------------- 2. team_week_pattern (0100) — LIVE BUG
-- js/state.js:1040 upsert (coach saves the team's week pattern). Policies twp_staff_insert/update
-- shipped in 0100 without grants. No delete: no client delete path and no delete policy.
grant select, insert, update on team_week_pattern to authenticated;

-- ---------------------------------------------------------------- 3. device_tokens (0028) — LIVE BUG
-- js/state.js:1865 deletes THIS device's push token on sign-out. 0036 deliberately left
-- device_tokens grant-free because its only write path was the register_device_token RPC — but
-- the sign-out unregister is a direct delete, added later, and has been failing ever since.
--
-- Consequence is exactly what that code comment says it exists to prevent: the token survives
-- sign-out, so coach nudges for the signed-out account keep landing on the phone — a real
-- privacy leak between two people sharing a device.
--
-- Insert/update stay revoked: writes still go through register_device_token (SECURITY DEFINER),
-- so this grants the narrowest privilege that makes sign-out work. The dt_rw policy (0028:18,
-- `using (user_id = auth.uid())`) already confines the delete to the caller's own rows.
grant delete on device_tokens to authenticated;

-- ---------------------------------------------------------------- 4. commitment_locations (0138) — NOT YET ON PROD
-- js/commitment-data.js:218 inserts (a coach saving a geofence location), reached from
-- js/screens/coach-commitments.js:600. 0138 created the table with a cl_read SELECT policy and a
-- SELECT-only grant — there is no insert policy AND no insert grant, so saveLocation() can never
-- succeed and always returns null. Verified Commitments would have shipped with its
-- location-creation path dead.
--
-- The insert policy mirrors cl_read's authorization exactly (same helper, same arguments), so a
-- coach may create a location only for a team/practice they actually staff.
grant insert on commitment_locations to authenticated;

drop policy if exists cl_staff_insert on commitment_locations;
create policy cl_staff_insert on commitment_locations for insert
  with check (commitment_owner_is_staff(team_id, practice_id));

-- ----------------------------------------------------------------
-- Idempotent: re-granting is a no-op and the policy is drop-if-exists first, so this is safe to
-- re-run. RLS remains the row-level wall throughout; a grant alone authorizes no unpolicied row.
--
-- ROLLBACK (restores the broken-but-safe status quo — leaks nothing, since RLS still gates rows):
--   revoke insert, update, delete on team_rooms           from authenticated;
--   revoke insert, update         on team_week_pattern    from authenticated;
--   revoke delete                 on device_tokens        from authenticated;
--   revoke insert                 on commitment_locations from authenticated;
--   drop policy if exists cl_staff_insert on commitment_locations;
