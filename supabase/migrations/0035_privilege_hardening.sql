-- OnStandard — least-privilege hardening (audit 2026-07-02, items 2 & 3)
--
-- Two independent tightenings, bundled because both are pure GRANT/REVOKE changes with no
-- schema or behavior change for legitimate callers:
--   A. A minor can no longer read their own guardian-consent TOKEN (so they can't self-verify).
--   B. notify() and the migration-only backfill are no longer callable by app users, and
--      future functions stop auto-inheriting EXECUTE for anon/authenticated.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here. Founder applies with
-- 0034/0036/0037 per docs/audit/2026-07-02-PHASE-0-GO-LIVE.md.

-- ================================================================ A. guardian-consent token
-- THE HOLE: 0008's gcr_read lets the athlete SELECT their own row, and 0005 granted table-wide
-- SELECT to authenticated — so the row's `token` (the capability the emailed verification link
-- carries) is readable by the minor themselves. Combined with the token-only guardian-verify
-- endpoint, a minor can read their token via PostgREST and POST it to self-approve the COPPA
-- consent gate that unlocks real-data sync + photo-to-AI.
--
-- THE FIX: drop the table-wide SELECT and re-grant SELECT on every column EXCEPT token. The
-- only app read is fetchGuardianRequests() -> `.select('status')` (queries.ts:114), which keeps
-- working; nothing in the client reads token. Writes already flow only through the definer RPC
-- request_guardian_consent + the service_role verify endpoint, so we also strip the latent
-- direct INSERT/UPDATE/DELETE grant (0008:72) that today is blocked only by the ABSENCE of a
-- write policy — the exact "one slipped policy away" pattern 0013 fixed elsewhere.
revoke select on guardian_consent_requests from anon, authenticated;
grant  select (id, athlete_id, guardian_email, status, requested_at, verified_at)
  on guardian_consent_requests to authenticated;
revoke insert, update, delete on guardian_consent_requests from anon, authenticated;
-- service_role (the verify endpoint) keeps full access via its own grants; unaffected.

-- ================================================================ B. function EXECUTE lockdown
-- THE HOLE: 0005 granted EXECUTE on ALL functions to anon+authenticated AND set a DEFAULT
-- PRIVILEGE so every future function inherits it. 0013 fixed the equivalent for table DML but
-- not for functions, so 0027's notify(target, kind, title, body) — a SECURITY DEFINER insert
-- helper meant only for triggers — is callable as POST /rest/v1/rpc/notify by any signed-in
-- user, letting them forge notifications (incl. phishing text) into ANY user's feed, minors
-- included. backfill_org_memberships_teams() (migration-only) is likewise exposed.
--
-- SCOPE NOTE (deliberately conservative — no live DB to test against): we revoke only the two
-- functions that are PROVABLY safe to lock (neither is called by client rpc() nor used in any
-- RLS policy; both run from triggers/migrations as SECURITY DEFINER, so revoking caller EXECUTE
-- changes nothing for them). We do NOT blanket-revoke, because many functions (is_self,
-- can_view, is_team_staff, owns_practice, is_minor, messaging_authorized, ...) are evaluated
-- INSIDE RLS policies, where the querying role MUST hold EXECUTE or every governed query fails.
-- Tightening those safely needs a throwaway DB to verify each policy still passes — tracked as
-- a follow-up in the go-live doc.
revoke execute on function notify(uuid, text, text, text)     from anon, authenticated;
revoke execute on function backfill_org_memberships_teams()   from anon, authenticated;

-- THE RECURRENCE FIX: stop new functions from auto-granting EXECUTE to app roles. This is
-- FUTURE-ONLY (it does not touch any existing function), so it breaks nothing today and makes
-- every function added from here on secure-by-default — a new client RPC must now grant EXECUTE
-- explicitly (see the new-migration checklist in the go-live doc). service_role keeps its
-- default so edge functions and triggers are unaffected.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
