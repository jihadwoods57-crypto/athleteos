-- OnStandard — organization verification (badge-only, per founder call 2026-07-18). Surfaces
-- whether an org in the directory is a verified official institution vs one a user typed in, so
-- an athlete can tell a real school from a look-alike. This is a SIGNAL, not a gate: team
-- creation and code minting are unchanged. A stricter claim/approval flow can build on this later.
--
-- The badge is surfaced through the anonymous org-directory edge function (service-role, direct
-- column select), so the authenticated search_orgs/find_org RPCs are intentionally left untouched
-- (no return-type churn, no risk to the create-team dedup path).
--
-- GUARDRAIL: authored for founder review — apply with `supabase db push`, then `npm run test:rls`.

alter table orgs add column if not exists verification_status text not null default 'unverified'
  check (verification_status in ('unverified', 'pending', 'verified'));

-- The ~525 seeded official orgs (0057: NCAA D1 + pro leagues) are system-owned (created_by IS
-- NULL) and are the verified directory. User-created orgs stay 'unverified' until a future flow.
update orgs set verification_status = 'verified' where created_by is null;
