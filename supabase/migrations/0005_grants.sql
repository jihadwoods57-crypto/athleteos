-- AthleteOS — Phase 1 go-live: explicit privilege grants (Stage A hardening)
-- Additive migration. RLS (0002) decides WHICH ROWS a role may touch, but a role must
-- ALSO hold table-level privileges or every query fails with "permission denied for
-- table" (SQLSTATE 42501) before RLS is even consulted. A hosted Supabase project gets
-- these grants from the platform's default privileges; a fresh / self-hosted / LOCAL
-- apply does NOT, so make them explicit and portable. Row access stays fully governed
-- by the 0002 policies (anon has no auth.uid(), so anon is denied every row).
--
-- GUARDRAIL: authored only; applied to a throwaway LOCAL stack to verify the round-trip.
-- The founder applies it at go-live (flagged in docs/FOUNDER-DECISIONS.md alongside 0004).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- Future tables/functions in public inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
