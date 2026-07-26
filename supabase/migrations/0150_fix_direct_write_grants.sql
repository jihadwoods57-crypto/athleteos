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

-- ---------------------------------------------------------------- 4. commitment_locations (0138)
-- MOVED OUT to 0153. Verified against live prod on 2026-07-26: commitment_locations does NOT
-- exist there, because 0138 (Verified Commitments) is authored-but-not-applied along with the
-- rest of 0133-0146. Granting on it here would abort this whole migration on prod and block the
-- three LIVE fixes above, which are the urgent ones.
--
-- 0153 carries that grant + policy instead. It still sorts after 0138, so a fresh database and a
-- future prod push both get it in the right order.

-- ----------------------------------------------------------------
-- Idempotent: re-granting is a no-op and the policy is drop-if-exists first, so this is safe to
-- re-run. RLS remains the row-level wall throughout; a grant alone authorizes no unpolicied row.
--
-- ROLLBACK (restores the broken-but-safe status quo — leaks nothing, since RLS still gates rows):
--   revoke insert, update, delete on team_rooms           from authenticated;
--   revoke insert, update         on team_week_pattern    from authenticated;
--   revoke delete                 on device_tokens        from authenticated;
