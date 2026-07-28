# Command Center — Admin Authentication Hardening — Design Spec

**Date:** 2026-07-22
**Status:** Approved (brainstorm) — pending spec review before implementation planning
**Feature area:** Founder Command Center (`web/admin`) — production-grade admin auth, *before* Phase 2.
**Builds on:** Supabase Auth (email/password, signed JWTs, refresh rotation), the platform-admin
allowlist (`platform_admins` / `is_platform_admin()`, `0037`/`0109`), the server-authoritative
`admin_bootstrap` (`0115`), the append-only `admin_audit_log` (`0109`/`0124`), the step-up re-auth
system (`admin_sensitive_grants` + `admin_open_sensitive_window` + `admin_recent_auth_epoch`, `0120`),
`send-push` + `device_tokens` (`0028`), and `profiles.timezone` (`0088`).

## 1. Summary

Harden sign-in to the **Founder Command Center** to production grade **without rebuilding what already
works**. ~60% exists (email/password, server-authoritative admin gate, step-up re-auth, append-only
audit, strict CSP/headers, refresh-token rotation, coarse per-IP throttle, TOTP *enabled* in prod).
This spec closes the real gaps: **MFA is not enforced, there is no account lockout, no sign-in event
log, no suspicious-activity detection/alerts, no in-UI password recovery, and no admin session
timeout.**

The Command Center is a **static browser client** talking to Supabase directly with the *publishable*
key. Therefore **every real protection is enforced server-side** (Postgres SECURITY DEFINER RPCs +
Supabase auth hooks + GoTrue), never in the JS. The browser only chooses which screen to show.

### Decisions locked in brainstorming
- **Who signs in:** solo founder — keep the **binary** `platform_admins` allowlist. Audit, events,
  and locks are keyed **per-actor** so a small admin team can be added later without rework. Granular
  admin roles are *designed-for, not built* (§10).
- **MFA:** **required** — TOTP, `aal2` enforced server-side. First-run enroll + per-login challenge in
  the Command Center. One-time **recovery codes** at enroll + a service-role break-glass backstop.
- **Alerts:** suspicious sign-ins fan out to **email + push**.
- **Lockout model:** **Option 1 — layered & admin-scoped.** MFA is the hard gate. Real-time lockout
  only on the MFA-code check (admin-only blast radius). Password-level lockout via **detect-and-react**
  → temporary GoTrue `ban_duration`. **No project-global password hook** (that path is Option 2,
  documented as a future toggle in §10).

### The security spine (one invariant)
> **No admin data or mutation crosses without `platform_admin` AND `aal2`, enforced in Postgres.**

Every admin data/mutation RPC calls one guard, `assert_admin_mfa()`. A stolen password plus a live
`aal1` session reads and changes **nothing**. `admin_bootstrap` is the *only* admin RPC callable at
`aal1` (it returns identity + capability flags so the client can route to enroll/challenge — it
exposes no platform data).

## 2. Existing building blocks (verified in-repo)

- `platform_admins(user_id, added_at)` — deny-all allowlist; seed is service-role-only, never
  self-grantable. `is_platform_admin()` = `exists(select 1 … where user_id = auth.uid())`, SECURITY
  DEFINER, `execute` revoked from `anon`/`authenticated` (called *inside* the admin RPCs).
- `admin_bootstrap()` (`0115`) — server-authoritative entry; returns `{is_admin, email, environment,
  capabilities, …}`, and **returns** (never raises) `is_admin:false` for a non-admin so the client
  renders a clean "access denied". Extended here (§3.1).
- `admin_audit_log(actor_id, action, target, before, after, created_at)` — append-only (`0124`),
  deny-all, written only by SECURITY DEFINER RPCs. Reused for auth events + lock/alert records.
- Step-up re-auth (`0120`): `admin_sensitive_grants`, `admin_recent_auth_epoch()` (reads
  `auth.jwt()->'amr'`), `admin_open_sensitive_window()`, `admin_has_sensitive_grant()`,
  `admin_consume_grant()`. **Unchanged** — money ops keep their single-use grant. MFA layers *under*
  this (you now must be `aal2` to even open a sensitive window).
- Client: `web/admin/` — `index.html` (login markup + CSP), `admin.js` (sign-in + `gate()` + shell
  mount), `api.js` (single shared client, publishable key only), `shell.js` (rail), `sections/*.js`,
  `_headers` (X-Frame-Options DENY, no-store, no-referrer, nosniff), `wrangler.jsonc` (Cloudflare).
- `send-push` edge function + `device_tokens` (`0028`) → push channel. `profiles.timezone` (`0088`)
  → off-hours detection. Existing cron pattern: `schedule_admin_brief(...)` + `weekly-digest`
  (`verify_jwt=false` + shared-secret) → reuse for the monitor.
- **Prod auth config** (per the warning block in `supabase/config.toml`): `mfa_totp_enroll/verify=true`,
  `enable_confirmations=true`, `site_url=https://onstandard.app`, `minimum_password_length=8`,
  `password_requirements=letters_digits`, refresh rotation + reuse interval on. **Prod auth changes go
  via the Management API PATCH — never `supabase config push`** (a push on 2026-07-22 regressed prod).

## 3. Backend

Migrations are numbered from the **next free number on the shared tree at build time** (latest today is
`0128`; a concurrent session may add more — **verify the highest number immediately before creating
each file** and apply directly, not via `db push`, per the shared-tree lesson). Working numbers below:
`0129`, `0130`.

### 3.1 `0129_admin_auth_gate.sql` — MFA/AAL2 enforcement
- `admin_is_aal2()` → `(auth.jwt()->>'aal') = 'aal2'`. SQL, STABLE, SECURITY DEFINER, execute revoked
  from app roles.
- `assert_admin_mfa()` → raises `not authorized` unless `is_platform_admin()`, then raises
  `mfa required` unless `admin_is_aal2()`. The single guard every admin data/mutation RPC calls.
- `admin_bootstrap()` **v2** (still callable at `aal1`): returns, in addition to today's fields —
  - `mfa_enrolled boolean` — authoritative, read from `auth.mfa_factors` for `auth.uid()` where
    `status='verified'` (not client-reported),
  - `aal text` — from `auth.jwt()->>'aal'`,
  - `access_granted boolean` = `is_admin AND aal='aal2' AND mfa_enrolled`,
  - `capabilities` gated on `access_granted` (all false until `aal2`).
- **Migrate existing admin RPCs** to require `aal2`: replace the inline `if not is_platform_admin()`
  guard with `assert_admin_mfa()` in every admin **read + mutation** RPC across `0111`/`0113`/`0115`–
  `0128` (users, orgs, revenue, ai, errors, audit, support, config, scoring, payments, flags,
  global-search). **Exceptions that stay `aal1`-callable:** `admin_bootstrap` only. Enroll/challenge
  use Supabase's *native* auth endpoints, not our RPCs, so no RPC needs to run at `aal1` for MFA setup.

### 3.2 `0130_admin_auth_throttle.sql` — throttle, events, recovery, hook
Tables (all deny-all; RPC/hook/service-role only):
- `admin_auth_throttle(user_id, kind, fail_count, window_start, locked_until)` — MFA-code failure
  counter + backoff state (`kind='mfa'`).
- `admin_login_events(id, user_id, event_type, ip inet, country, asn, user_agent, occurred_at,
  flags jsonb, alerted boolean)` — normalized, app-visible sign-in history (fed by the monitor).
- `admin_recovery_codes(id, user_id, code_hash, created_at, used_at)` — one-time MFA recovery codes,
  stored **hashed**.
- `admin_monitor_checkpoint(singleton, last_seen_at)` — the monitor's high-water mark over
  `auth.audit_log_entries`.

Functions:
- `hook_mfa_verification_attempt(event jsonb) returns jsonb` — the Supabase **MFA-verification-attempt
  auth hook**. On `event.valid=false`: increment `admin_auth_throttle`; at threshold (5 within 10 min)
  set `locked_until = now() + backoff` (1m → 5m → 30m) and return `{decision:'reject', message:…}`.
  While `now() < locked_until` → reject. On `valid=true` → reset + `{decision:'continue'}`.
  **Fail-open:** any unhandled error → `{decision:'continue'}` (a hook bug must never hard-lock the one
  admin; the monitor still catches sustained abuse). `grant execute to supabase_auth_admin`; revoke
  from `anon`/`authenticated`.
- `admin_generate_recovery_codes()` — requires `assert_admin_mfa()` (i.e. just-enrolled, `aal2`);
  generates **10** codes, stores hashes, returns plaintext **once**; audited (`recovery.codes_generated`).
- `admin_recent_logins(p_limit)` / `admin_active_locks()` — gated reads for the Security panel (§5).
- `admin_detect_login_anomalies(...)` — **pure** SQL detection over a candidate event + the account's
  history, returning a set of flags; isolated for unit testing (§8).

### 3.3 Edge functions (new)
- **`admin-auth-monitor`** (cron, `verify_jwt=false` + `x-monitor-key` secret, service role): reads new
  `auth.audit_log_entries` (login / failed-login / token events, with IP + timestamp) since the
  checkpoint for admin accounts; enriches IP → country/ASN via an IP-geo lookup
  (`IPINFO_TOKEN`; degrades to IP/ASN-only if absent); writes `admin_login_events`; runs
  `admin_detect_login_anomalies`. On a flagged event → append `admin_audit_log` + call `admin-alert`.
  On a **failed-attempt burst** only (default **≥10 failed attempts in 15 min**) → GoTrue Admin API
  `updateUserById(ban_duration)` (temporary, auto-expiring, that-account-only) + alert. Advances the
  checkpoint.
- **`admin-alert`** (`verify_jwt=false` + `x-alert-key`, service role): fans out **email** (Resend via
  `RESEND_API_KEY`, from `alerts@onstandard.app`; SMTP fallback) + **push** (reuse `send-push` /
  `device_tokens`). De-dupes repeated same-signal alerts within a window.
- **`admin-mfa-recover`** (`verify_jwt=true` — needs the user's `aal1` session): verifies the caller is
  a `platform_admin`, hashes the submitted code, matches an unused `admin_recovery_codes` row, marks it
  used, removes the user's TOTP factor(s) via the Admin API (so they can re-enroll fresh), audits
  (`recovery.used`), and alerts email+push. Recovery therefore still requires **two factors**: a valid
  password (for the `aal1` session) **and** a valid one-time code.
- **`admin-login-precheck`** *(optional)* (`verify_jwt=false`): verifies a Cloudflare **Turnstile**
  token server-side before the Command Center proceeds with sign-in. Defense-in-depth / bot-blunting,
  not a hard boundary (the hard boundaries are MFA + ban). Cuttable without affecting the spine.

`config.toml`: pin `verify_jwt` for the new functions (`admin-auth-monitor`, `admin-alert`,
`admin-login-precheck` → false; `admin-mfa-recover` → true), same discipline as `weekly-digest` /
`stripe-webhook`.

## 4. Auth flow (client, `web/admin`)

`admin.js` sign-in becomes a small state machine; `index.html` gains the sub-states:
1. **Password** → `signInWithPassword`. Friendly surfacing of `Too many attempts` / ban messages.
2. Read AAL via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` + `listFactors()`:
   - No verified factor → **Enroll** screen (`mfa.enroll` TOTP → QR + verify → on success call
     `admin_generate_recovery_codes()` and show the codes once).
   - Factor present, `current=aal1,next=aal2` → **Challenge** screen (`mfa.challengeAndVerify`), with a
     **"Use a recovery code"** path → `admin-mfa-recover`.
3. `gate()` calls `admin_bootstrap`; mounts the shell **only when `access_granted`** (else enroll /
   challenge / clean access-denied — reusing today's `showDenied`).
4. **Forgot password** link → `resetPasswordForEmail(email, {redirectTo: web/admin/reset.html})`;
   a minimal `reset.html` completes `updateUser({password})` from the recovery token.
5. **Session hardening (client-enforced, admin-only):** idle watcher (~30 min inactivity → `signOut`)
   + absolute cap (~12 h since login → full re-login). Project-wide `[auth.sessions]` is deliberately
   *not* used (it would time out consumers too).

## 5. Surfaces (Command Center)

- **New `sections/security.js`** (registered in `admin.js` SECTIONS + `shell.js` rail): recent sign-ins
  (`admin_recent_logins` — time, IP, country, flags), active locks (`admin_active_locks`), and alert
  history — so the log is something the founder can actually *see* and audit.
- Login/enroll/challenge/reset/locked states in `index.html` styled to the existing dark-premium
  blue→teal system (no new fonts/deps; CSP unchanged except any Turnstile origin if enabled).

## 6. Security & enforcement posture

- **Server-authoritative everywhere.** MFA cannot be skipped by calling the API directly — data RPCs
  demand `aal2`. Lockout (ban) is enforced by **GoTrue**, not the client. Only the publishable key
  ships to the browser.
- **Fail-safe matrix:** MFA hook → **fail-open** (never brick the admin; monitor backstops). Data-RPC
  guard → **fail-closed** (deny on doubt). Geo enrichment down → detection **degrades** (IP/ASN +
  burst + off-hours still fire).
- **Auto-ban is burst-only.** A single new-country/new-device *successful* login **alerts but never
  auto-bans** — so a legitimate trip notifies without locking the founder out. Only a
  failed-attempt burst triggers the temporary ban.
- Recovery stays two-factor (password + one-time code). Step-up re-auth (`0120`) is unchanged and now
  additionally requires `aal2`.

## 7. Edge cases

- **MFA-verification hook unavailable** on the plan/version → MFA-code lockout falls back to
  detect-and-react (monitor bans on repeated MFA failures too). Spine (MFA required) is unaffected.
- **Founder travels (legit new geo)** → alert only, no ban (per §6).
- **Lost authenticator** → recovery code → factor reset → re-enroll. **All codes used** → documented
  service-role break-glass (remove factor via Admin API), then re-enroll + regenerate codes.
- **Clock/timezone** → off-hours uses `profiles.timezone`; missing tz → off-hours signal skipped
  (other signals still fire).
- **Concurrent admin sessions / new device each login** → deduped by IP+UA fingerprint; "new device"
  ≈ new IP/UA (auth logs carry no stable device id — stated honestly).
- **First-ever admin with no MFA** → `access_granted=false` routes to Enroll; no data flows until
  `aal2`. Bootstrapping the very first admin remains the service-role `platform_admins` seed
  (unchanged) + first enroll.
- **`config push` regression** → all prod auth/hook changes via Management API PATCH; re-confirm
  `mfa_totp enroll/verify=true` (it was toggled off earlier today).

## 8. Testing

Local Docker/RLS harness (`supabase start` + docker-exec-psql) is available and used.
- **Unit (pure):** `admin_detect_login_anomalies` over fixture event sequences → expected flag sets
  (new-IP, new-country, impossible-travel, off-hours, failed-burst, failed-then-success); throttle
  backoff progression; `assert_admin_mfa()` across {non-admin, admin@aal1, admin@aal2}.
- **Integration (local stack):** enroll TOTP → verify `bootstrap.access_granted` flips true; call a
  data RPC at `aal1` → `mfa required`; drive MFA-code failures → hook rejects at threshold and resets
  on success; seed `auth.audit_log_entries` fixtures → monitor writes events, detects, bans on burst,
  and calls a **mocked** `admin-alert`; recovery-code round trip removes the factor + audits.
- **Manual (hosted):** founder does a real authenticator login, forgot-password round trip,
  recovery-code round trip, idle + absolute timeout.
- **No production writes with the live key.** Local + (if needed) a disposable Supabase project per the
  test-project pattern; teardown after.

## 9. Founder ops checklist (handed over at build end)

Apply `0129`/`0130` (direct, verify numbering) · deploy `admin-auth-monitor`, `admin-alert`,
`admin-mfa-recover` (+ optional `admin-login-precheck`) · **Management API PATCH** to enable
`hook_mfa_verification_attempt` and re-confirm `mfa_totp enroll/verify=true` · set secrets
(`RESEND_API_KEY`, `MONITOR_KEY`, `ALERT_KEY`, optional `IPINFO_TOKEN`, optional Turnstile keys) ·
schedule the monitor cron (reuse `schedule_admin_brief` pattern) · enroll your authenticator + save
recovery codes · confirm a push `device_token` exists for alerts. **Never `supabase config push`.**

## 10. Out of scope (v1)

Consumer/coach app MFA (this is the Command Center only); **passkeys/WebAuthn** (TOTP ships first);
SSO/SAML; **granular admin roles** (designed-for via per-actor keys, not built — solo founder);
hardware-key attestation; SIEM/log export; the **project-global password auth hook** (Option 2 — hard
real-time password blocking; documented as a future toggle, deliberately deferred for its consumer
blast radius). Each is a clean follow-up.
