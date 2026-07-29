-- OnStandard — revoke INSERT / UPDATE / DELETE from `anon`.
--
-- FOUND ON PRODUCTION, NOT IN THE REPO. While applying 0151 the privilege audit showed prod and a
-- fresh local database disagree: on prod `anon` holds INSERT, UPDATE and DELETE on **52 public
-- tables** (including days, meals, athlete_profiles, checkins). A fresh local DB built from these
-- migrations gives `anon` only SELECT — so this came from the hosted project's own bootstrap
-- defaults, predating migration 0001, and no migration in this repo ever granted it.
--
-- That gap is why 0151 did not catch it: 0151 was written against what local showed.
--
-- SEVERITY — stated precisely, because the distinction matters:
--
--   NOT exploitable today. Verified empirically against production inside a rolled-back
--   transaction: `set local role anon; insert into days …` returns
--   "new row violates row-level security policy for table days". Every write policy on prod gates
--   on an identity helper (is_self / is_team_staff / is_write_staff / can_view / owns_* …), and
--   all of them resolve through auth.uid(), which is NULL for anon — so every comparison yields
--   NULL and the policy denies. A query for write policies that reference NO identity helper
--   returns zero rows.
--
--   Worth closing anyway, and more urgently than 0151's TRUNCATE grant. PostgREST does not expose
--   TRUNCATE, so that one needed a second bug to become reachable. It exposes INSERT, UPDATE and
--   DELETE fully. That leaves RLS-policy correctness on every table, forever, as the only thing
--   between the public anon key — which ships inside the app bundle — and writing to production.
--   One future policy written with a permissive `using (true)` becomes an open door rather than a
--   contained mistake. Removing the grant means such a policy fails closed.
--
-- SAFETY: anon keeps SELECT (49 tables — the intentional public reads: org directory, trainer
-- public pages, join-code previews). Unauthenticated write paths in this product all go through
-- SECURITY DEFINER RPCs (join redemption, guardian verify, trainer applications), which are
-- unaffected by table grants. No client code path can regress.

revoke insert, update, delete on all tables in schema public from anon;

-- Future tables must not re-acquire it from the platform default.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

-- ROLLBACK (restores the hosted default; only needed if some unauthenticated DIRECT table write is
-- discovered, which would itself be the real bug — the correct fix for that is a SECURITY DEFINER
-- RPC, not a blanket grant):
--   grant insert, update, delete on all tables in schema public to anon;
--   alter default privileges in schema public
--     grant insert, update, delete on tables to anon;
