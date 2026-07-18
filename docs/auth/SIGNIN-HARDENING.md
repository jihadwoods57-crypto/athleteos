# Sign-in hardening — audit, Phase 1 (shipped), and roadmap

_Branch: `compliance-fixes` · Phase 1 commit: `ee88bd0` · Author: founder spec + implementation pass 2026-07-18_

The founder's directive: the sign-in system should **feel effortless on the surface but be serious underneath** (OnStandard holds athlete PII, meal photos, performance data, and minors' data). This doc maps the full spec to reality (three-layer audit), records what Phase 1 shipped, and lays out the remaining phases with exact steps + ownership.

> **Source-of-truth caveat:** `supabase/config.toml` in the repo is the **local CLI** config (127.0.0.1 URLs). The hosted Supabase **dashboard is authoritative** for email confirmation, rate limits, and the Apple provider. Items marked _(dashboard)_ can only be verified/changed there.

## Audit: spec → status

| Area | Status | Where |
|---|---|---|
| Email/password sign-in | ✅ live | `signin.js`, `state.js signIn` → `signInWithPassword` |
| iOS Keychain token storage (chunked, XSS allow-list) | ✅ live | `secure-storage.js`, `bridge.ts:52-64,104-129` |
| Persistent + auto-refresh sessions | ✅ live | `supabase.js:22-29` |
| One-account role routing via RLS (`primary_role`) | ✅ live | `state.js:215-217,998-1003,1620-1633`; `0002_rls.sql` |
| Anti-enumeration sign-in copy + neutral reset | ✅ live | `friendlyAuth`, `reset.js` |
| Email confirmation enabled | ✅ live _(dashboard)_ | `config.toml:230`; `showConfirmPending` |
| Team access via code/approval (not school-select) | ✅ live | `join_team`/`request_join_team`, `onboarding.js:275-360` |
| **Continue with Apple** | 🟠 wired, native stub | `ob-account.js` + `signin.js`; `src/lib/auth/apple.ts` stub; provider off `config.toml:326` |
| **Face ID app-unlock + "Use Face ID next time?"** | 🟠 wired, native stub | `ProtoApp.tsx:59-67,184-193`, `bio-optin.js`; `src/lib/auth/biometrics.ts` stub |
| Client field mechanics (lowercase, autofill, on-blur, eye, Caps-Lock) | ✅ Phase 1 | see below |
| Password-creation hardening (12+, block common/app/email) | ✅ Phase 1 | `ob-helpers.js`, `ob-account.js` |
| Rate limiting | 🟡 Supabase built-in only | `config.toml:200-214` (30/5min/IP); no custom lockout/alerts |
| In-app password-reset completion | ❌ missing | opens hosted `/reset` web page; no `associatedDomains` |
| Device/session management UI | ❌ missing | — |
| Parent access (separate/invite/data-scoped) | ❌ stub | `coach.js:2097-2116`; guardianships unwired `0053` |
| Expiring/one-time team & practice codes | ❌ reusable, no TTL | `0001:58`, `0026` |
| Coach/trainer credential verification | ❌ missing | anyone can select "Coach" |
| Multi-role "Switch workspace" switcher | ❌ missing | one `primary_role`/account |

## Phase 1 — SHIPPED (commit `ee88bd0`, `npm run verify` green)

Reshaped **sign-in** + **reset** under a self-contained `.si` namespace (welcome-screen system: blue→teal CTA, compact glowing lockup, labeled icon fields), real Supabase auth preserved. Client mechanics added:
- Email lowercased + trimmed on submit; `autocomplete=username` / `current-password` (iOS + password-manager autofill); on-blur format validation (inline); offline preflight.
- Password eye toggle on sign-in; Caps-Lock warning; paste allowed; never cleared on failure; loading + double-submit guard.
- `friendlyAuth`: added account-disabled/banned + provider-conflict branches; softened sign-up "already registered" (anti-enumeration).
- `weakPasswordReason()` rejects common passwords / app name / email-derived; strength floor 12; `maxlength=64`; guidance copy.
- "Continue with Apple" wired into sign-in as the real gated flow (shows only when native offers it).

## Roadmap — remaining phases (ownership + exact steps)

### Phase 2 — Activate Apple + Face ID  _(needs founder: Apple Developer + Supabase dashboard + device)_
1. `npm install expo-apple-authentication expo-local-authentication`
2. Un-stub `src/lib/auth/apple.ts` (uncomment the `AppleAuthentication.signInAsync` block) and `src/lib/auth/biometrics.ts` (real `LocalAuthentication`).
3. Add the modules to `app.json` plugins; add the **Sign in with Apple** capability + provisioning in the Apple Developer account.
4. Enable the **Apple provider** in the Supabase dashboard (`config.toml:326` is `enabled = false` locally).
5. Rebuild with EAS and test on a real device — Apple button appears, `signInWithIdToken` works, and the `bio-optin` "Use Face ID next time?" offer shows for returning users.
   > _Deferred deliberately: the post-sign-in Face-ID offer routing was NOT wired in Phase 1 because biometrics is inert until this phase — wire it here so it's testable._

### Phase 3 — In-app password reset  _(needs founder: hosted `/reset` page + dashboard redirect)_
- Add `associatedDomains: ["applinks:onstandard.app"]` to `app.json`; add a recovery branch to the `Linking` handler in `ProtoApp.tsx` (currently invite-code only).
- Handle the `PASSWORD_RECOVERY` auth event; build an in-app set-password screen (`sb.auth.updateUser`); after success, `signOut({ scope: 'global' })` other sessions and route to sign-in with a success toast.
- Configure the recovery redirect + link expiry in the Supabase dashboard (default `otp_expiry=3600`).

### Phase 4 — Backend hardening  _(mostly edge functions + dashboard)_
- Custom progressive throttling / lockout + suspicious-login alerts (Supabase edge fn; current = built-in per-IP only).
- Device/session management UI in Settings (list + revoke sessions).
- Re-auth prompts for sensitive changes (email/password/delete/export).
- Stricter email-verification gating for privileged roles (coach/trainer/staff).

### Phase 5 — Access-control  _(migrations DRAFTED — authored, NOT applied)_
- **Team/practice-code expiry — DRAFTED:** `supabase/migrations/0080_join_code_expiry.sql`. Additive + opt-in: nullable `join_code_expires_at` (NULL = grandfathered), `join_team`/`join_practice` reject expired, new `set_*_code_expiry(days)` RPCs. Nothing changes until a coach sets an expiry.
- **Parent scoped access — DRAFTED:** `supabase/migrations/0081_guardian_scoped_access.sql` + RLS probes updated (`supabase/tests/rls_authz_test.sql`) + **parent scores client shipped** (commit `ae7347b`, inert until 0081 is applied). Fail-closed: guardian removed from `can_view`; reads score/grade/day ONLY via `guardian_children` / `guardian_child_days`; single-use, expiring `guardian_invites`; minor-consent gate preserved.
- **To activate parent access:** review 0080 + 0081 → `npm run test:rls` (ideally on a throwaway project first — this gates MINORS' data) → `supabase db push` → then build the two small invite-entry screens (athlete "invite a parent" → `create_guardian_invite`; parent "enter code" → `accept_guardian_invite` — the `state.js` functions already exist).
- **Still open:** coach/trainer credential verification; multi-role "Switch workspace" switcher.

> ⚠️ Per repo memory, `supabase db query --linked` runs against **live prod**. 0080/0081 are authored-only (repo convention); the founder applies them at go-live after `test:rls` — the crew never touches the production DB.
