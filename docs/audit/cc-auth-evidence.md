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

## Go-live — DONE on production (2026-07-22, same session)

Everything except your physical authenticator enrollment has been applied to the live
`ftwrvylzoyznhbzhgism` (AthleteOS) project and verified against real data:

1. **Confirmed safe before touching anything:** prod `mfa_totp_enroll_enabled`/`mfa_totp_verify_enabled`
   were already `true` (not regressed) — applying the gate could not lock you out.
2. **`0130`/`0131` applied directly** (`db query --linked -f`, not `db push`). Verified against your real
   UUID: `is_platform_admin()` → `false`@aal1 / `true`@aal2; `admin_bootstrap()` → `is_admin:true,
   mfa_enrolled:false, access_granted:false` (correctly withheld pending your enrollment).
3. **All 3 edge functions deployed** (`admin-mfa-recover`, `admin-alert`, `admin-auth-monitor`).
4. **Secrets set:** `ALERT_KEY`, `MONITOR_KEY`, `ADMIN_ALERT_EMAIL=jihadwoods57@gmail.com`.
   **`RESEND_API_KEY` was NOT set** — no Resend account/key was available this session, so email alerts
   currently no-op (`admin-alert` degrades gracefully); push still works once a `device_token` exists for
   your account.
5. **MFA-verification-attempt hook — BLOCKED, not a bug:** the Management API returned
   `402 Payment Required: "HOOK_MFA_VERIFICATION_ATTEMPT cannot be configured for this organization"` — this
   specific Supabase auth hook isn't available on the current plan/org tier. **The MFA requirement itself
   (the actual invariant) is completely unaffected** — this only removes the *instant* GoTrue-side MFA-code
   lockout. The documented fallback (§7 of the design spec: "MFA-verification hook unavailable → detect-
   and-react (monitor bans on repeated MFA failures too)") is exactly what's deployed and running.
6. **Monitor cron scheduled** (`cron.job` id 3, `* * * * *`) and **proven live**: 3 consecutive runs
   returned real `200 {"processed":0,"banned":0}` via `net._http_response` (0 processed = no new admin
   logins since the checkpoint, not an error).
7. **Client re-hosted** to the real production URL, `https://onstandard-admin.gelatinous-twin.workers.dev`
   — confirmed serving the new auth flow (`access_granted`/`nextScreen`/`startSessionWatch` in `admin.js`;
   `#challenge #enroll #recovery #forgot` etc. in the real HTML at `/`). Excluded `*.test.mjs` from the
   asset upload (`.assetsignore`) after noticing they'd been served as static files (harmless — no
   secrets — but cleaned up).
8. **Fixed a real gap found during verification:** Supabase's redirect allowlist (`uri_allow_list`) only
   contained `onstandard.app` — the Command Center's actual origin was missing, so "Forgot password"
   would have silently failed. Patched to add
   `https://onstandard-admin.gelatinous-twin.workers.dev{,/reset.html}`, preserving the existing entries.

**What's left — requires your physical device, not automatable:**
- Sign in at `https://onstandard-admin.gelatinous-twin.workers.dev` → you'll land on **Enroll** → scan the
  QR with your authenticator app → verify → **save the 10 recovery codes shown** (once).
- Optional: get a Resend API key and `supabase secrets set RESEND_API_KEY=...` to turn email alerts on
  (push already works once you have a `device_token`).
- Optional: if you upgrade the Supabase org tier and want the instant MFA-code hook, re-run the PATCH in
  `web/admin/DEPLOY.md` step 4 — everything else is already wired to support it.

## Commits

`docs` specs+plans → `0130` gate → `admin-mfa-recover` → client flow → `0131` monitor → `admin-alert` +
`admin-auth-monitor` → Security panel → `.assetsignore` fix. All on `feat/founder-command-center`.
Production apply done live in-session (see "Go-live" above) — not a separate deferred step.
