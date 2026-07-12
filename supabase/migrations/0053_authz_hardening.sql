-- OnStandard — authorization hardening (security audit 2026-07-12).
--
-- Forward-only, idempotent (drop-then-create / revoke). Applies on top of 0001–0052 and
-- SUPERSEDES the earlier definitions without rewriting history — same pattern as 0013/0038/0050.
--
-- Three broken-access-control fixes from the 2026-07-12 whole-codebase audit:
--
--   1. guardianships self-insert (CRITICAL). 0002's `g_manage FOR ALL ... WITH CHECK
--      (guardian_id = auth.uid())` let ANY authenticated user insert a row naming THEMSELVES the
--      guardian of ANY athlete — with no consent from that athlete. That single row flips
--      is_guardian_of → can_view (read an adult/unknown-age victim's private days/meals/checkins/
--      photos) AND is_guardian_link → messaging_authorized (open a message channel to a MINOR,
--      defeating the 0006/0013 child-safety gate; 0050 gates can_view + writes for minors but NOT
--      messaging). 0038 fixed the identical self-insert on team_members/practice_clients but missed
--      this table. No current client flow inserts guardianships — the consent flow uses
--      guardian_consent_requests + the service-role guardian-verify endpoint, and link creation is
--      "service_role/RPC only" (database.types.ts) — so removing the self-insert breaks nothing.
--      The guardian and the athlete may still REVOKE (update/delete) an existing link.
--
--   2. plan_assignments IDOR (HIGH). 0032's `plan_assignments_assigner_all ... WITH CHECK
--      (assigned_by = auth.uid())` never checked that the caller OWNS the plan or CAN_VIEW the
--      athlete. So any user could self-assign another coach's plan (then read its plan_json via
--      meal_plans_athlete_read) or dump their own plan onto a stranger's assignment list. The
--      feature is not wired into the client yet (docs/proto-native-app/PHASE6-P4-SCOPE.md flags
--      this exact gap), so hardening the policy breaks no live flow.
--
--   3. Defense-in-depth: make the WITH CHECK explicit on practices_update (0002 relied on the
--      Postgres USING-as-CHECK fallback — safe today, but the house style is an explicit CHECK so
--      an ownership reassignment is unambiguously barred). The meal-photos storage UPDATE policy
--      also relies on the same fallback and is likewise safe (the USING predicate is applied to the
--      new row); it is left to 0050 to avoid re-stating its minor-consent clause here.
--
-- GUARDRAIL: authored only; NOT applied to the live project by the crew. The founder applies it at
-- go-live per the runbook (supabase db reset on a throwaway stack → run supabase/tests/ incl. the
-- new section-3b probes in rls_authz_test.sql → supabase db push).

-- ---------------------------------------------------------------- 1. guardianships: no self-appoint
-- Creation is consent-driven only (the service_role verify endpoint, or a future consented RPC),
-- mirroring the 0038 treatment of the sibling link tables. The guardian keeps revoke (update/delete)
-- of a row they already hold; the athlete keeps the ability to end a guardianship over them.
drop policy if exists g_manage on guardianships;
create policy g_guardian_update on guardianships for update
  using (guardian_id = auth.uid()) with check (guardian_id = auth.uid());
create policy g_guardian_delete on guardianships for delete
  using (guardian_id = auth.uid());
create policy g_athlete_delete on guardianships for delete
  using (athlete_id = auth.uid());
-- Defense in depth (mirrors 0013's subscriptions/org_memberships revoke): even if a future policy
-- slips, `authenticated` holds NO INSERT privilege on this link table. service_role (the verify
-- endpoint) and SECURITY DEFINER RPCs are unaffected — neither runs as the `authenticated` role.
revoke insert on guardianships from authenticated;

-- ---------------------------------------------------------------- 2. plan_assignments: real authz
-- The assigner must (a) be the row's assigned_by, (b) OWN the plan being assigned, and (c) be allowed
-- to view the target athlete. Reproduces 0032's USING (the assigner reads/removes their own
-- assignments) and tightens ONLY the WITH CHECK (INSERT/UPDATE).
drop policy if exists plan_assignments_assigner_all on plan_assignments;
create policy plan_assignments_assigner_all on plan_assignments for all
  using (assigned_by = auth.uid())
  with check (
    assigned_by = auth.uid()
    and exists (select 1 from meal_plans p where p.id = plan_id and p.author_id = auth.uid())
    and can_view(athlete_id)
  );

-- ---------------------------------------------------------------- 3. explicit WITH CHECK (house style)
drop policy if exists practices_update on practices;
create policy practices_update on practices for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
