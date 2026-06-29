-- AthleteOS — Phase 2 accounts/settings: profiles.org_name
-- Additive migration. The OverseerProfile editor (coach/trainer/parent) lets a user
-- edit their org/team/practice name, which drives the dashboard title. The app already
-- stores it locally and db.updateProfile pushes the display name; this adds the column
-- so the org name syncs across the user's devices too. Nullable, no default — an
-- un-edited account reads NULL exactly as before.
--
-- No new RLS needed: the existing `profiles_self_write` policy (0002_rls.sql) already
-- scopes UPDATE on profiles to id = auth.uid(), so a user can only set their own
-- org_name, and `profiles_read` (connected) governs who can see it.
--
-- GUARDRAIL: authored + verified on a throwaway LOCAL postgres. NOT applied to the live
-- project by the crew — the founder applies it per-migration at go-live (D1).

alter table profiles add column if not exists org_name text;
