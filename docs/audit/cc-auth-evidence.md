# Command Center Admin Auth — Hardening Evidence

**Date:** 2026-07-22 · **Branch:** `feat/founder-command-center` · **Spec:** `docs/superpowers/specs/2026-07-22-command-center-admin-auth-design.md`
**Plans:** `docs/superpowers/plans/2026-07-22-command-center-admin-auth-core.md`, `…-monitoring.md`

Production-grade admin authentication for the Founder Command Center (`web/admin`), built as **hardening**
on the existing platform-admin gate + step-up reauth + append-only audit. Verified on the local Supabase
stack (Docker); **not yet applied to prod** — see the go-live runbook in `web/admin/DEPLOY.md`.

## What shipped

| Gap (spec) | Closed by | Where |
|---|---|---|
| MFA not enforced | `is_platform_admin()` now requires `aal2`; `assert_admin_mfa()`; bootstrap v2 | `0130_admin_auth_gate.sql` |
| No account lockout | MFA-code hook (fail-open, 5/10min → 1/5/30m) + ban-on-burst | `0131` + `admin-auth-monitor` |
| No sign-in event log | `admin_login_events` fed from `auth.audit_log_entries` | `0131` + `admin-auth-monitor` |
| No suspicious detection/alerts | `admin_detect_login_anomalies` → email(Resend)+push | `0131` + `admin-alert` |
| No in-UI password recovery | Forgot-password + `reset.html` | `web/admin/*` |
| No admin session timeout | idle 30m + absolute 12h (client-enforced) | `web/admin/session.mjs` |
| MFA recovery | 10 one-time hashed codes + break-glass factor reset | `0130` + `admin-mfa-recover` |

## The security spine (verified)

`is_platform_admin()` is redefined as **allowlisted AND aal2**. Verified (grep) that it is called ONLY
inside admin/analytics RPC bodies — **never** in an RLS policy and never in an app/consumer path — so a
password-only (`aal1`) session reads and mutates **nothing** admin, while athlete/coach/parent flows are
untouched. `admin_bootstrap` alone stays `aal1`-callable (returns routing flags only), so a password-only
session is routed to enroll/challenge instead of being locked out.

## Test results (local, `supabase start` + docker psql)

```
SQL — admin-auth gate      (admin_auth_test.sql)    : 21 checks, 0 failed
SQL — admin-auth monitor   (admin_monitor_test.sql) : 11 checks, 0 failed
SQL — authz regression     (rls_authz_test.sql)     : 260 / 260 passed  (updated to model aal2 sessions)
Node — client + fn logic   (5 *.test.mjs files)     : 24 tests, 0 failed
Client JS syntax           (node --check × 7 files) : all OK
DOM id cross-check         (admin.js ↔ index.html)  : all referenced ids present (denied built dynamically)
Integration — auth-log     (seed login → pull)      : pull_ok=true, ip=9.9.9.9, type=login
```

**Bug caught by integration testing:** `admin_pull_auth_events` had an ambiguous `user_id` (RETURNS TABLE
column vs `platform_admins.user_id`); fixed by qualifying `platform_admins pa`. Unit tests missed it (they
exercised the detector directly); the end-to-end auth-log read surfaced it.

## Not automated here (founder go-live steps)

- **Live TOTP round-trip** (enroll → scan with your authenticator → verify → shell): requires your real
  device; it's the first step of go-live. The client uses Supabase's documented v2 MFA API
  (`mfa.enroll/challenge/verify/listFactors/getAuthenticatorAssuranceLevel`).
- **Prod apply of `0130`/`0131`, function deploys, the Management-API PATCH to enable the MFA hook, and
  secrets** — all in `web/admin/DEPLOY.md`. `0130` is safe to apply before you enroll (bootstrap routes you
  to the enroll screen), **provided prod MFA TOTP enroll/verify is ON** (re-confirm via the Management API —
  a config-push regression on 2026-07-22 had toggled it off).

## Commits

`docs` specs+plans → `0130` gate → `admin-mfa-recover` → client flow → `0131` monitor → `admin-alert` +
`admin-auth-monitor` → Security panel. All on `feat/founder-command-center`.
