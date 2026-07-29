-- OnStandard — revoke TRUNCATE / TRIGGER / REFERENCES from anon + authenticated.
--
-- FINDING: 62 of 85 public tables grant TRUNCATE, TRIGGER and REFERENCES to BOTH `anon` and
-- `authenticated`, including days, meals, profiles, athlete_profiles and teams. Confirmed against
-- a fresh local database with all migrations applied:
--
--   select count(distinct table_name) from information_schema.role_table_grants
--   where grantee='authenticated' and privilege_type='TRUNCATE' and table_schema='public';  -- 62
--
-- These come from the Supabase platform's own bootstrap default privileges, not from any
-- migration in this repo (0005 granted only select/insert/update/delete; the 23 tables without
-- them are the later deny-by-default ones that were never granted anything).
--
-- SEVERITY — stated honestly: this is defense-in-depth, not an open door. PostgREST exposes no
-- TRUNCATE verb and no DDL, so there is no known request today that reaches these privileges.
-- What makes them worth removing is the blast radius if anything ever does:
--   * TRUNCATE **bypasses RLS entirely**. Every row-level protection this codebase has invested
--     in is irrelevant to it — one statement empties a table.
--   * TRIGGER lets the grantee attach a trigger to a table it does not own, which is a classic
--     privilege-escalation primitive.
-- Any future SECURITY INVOKER function with dynamic SQL, or any PostgREST feature that widens
-- the verb surface, converts a latent over-grant into total data loss. Revoking costs nothing.
--
-- SAFETY: none of the three is used by the application. REFERENCES (creating FK constraints) and
-- TRIGGER (attaching triggers) are DDL performed by migrations, which run as the table owner, not
-- as anon/authenticated. This revoke therefore cannot affect any client code path.
--
-- Precedent: 0013 and 0147 are the same move — narrowing privileges that were handed out by a
-- default rather than by intent.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Future tables must not re-acquire them.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- ROLLBACK (restores the Supabase default; needed only if some future DDL path is found to run
-- as anon/authenticated, which would itself be the real bug):
--   grant truncate, trigger, references on all tables in schema public to anon, authenticated;
--   alter default privileges in schema public
--     grant truncate, trigger, references on tables to anon, authenticated;
