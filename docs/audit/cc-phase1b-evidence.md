# Founder Command Center — Phase 1B verification evidence

**Date:** 2026-07-22 · **Branch:** `feat/founder-command-center` · **Plan:** [2026-07-22-founder-command-center-phase1b.md](../superpowers/plans/2026-07-22-founder-command-center-phase1b.md)

Phase 1B = the **reauthenticated, mutating, money-moving** half, built on the verified Phase 1A foundation and **reconciled with the concurrent OnStandard Pay work** (which merged onto the same branch as `0119`/`0121`).

## Result summary
- **RLS authz suite: 260 / 260** — from a **clean `supabase db reset`** applying every migration `0001…0127` in sequence (OnStandard Pay's `0119`/`0121` + Command Center `0120`,`0122–0127` all coexist). Baseline entering 1B was 229; +31 new Command-Center checks across 1A+1B.
- **`npm run verify`: green** — lint:xss clean, `tsc --noEmit` clean, jest passed (no `src/` changes), iOS bundle exported.
- **Front-end:** all section modules parse (`node --check`), lint:xss clean throughout.

## What shipped (commits on `feat/founder-command-center`)
| Slice | Migration | Contents | Verified |
|---|---|---|---|
| Reauth | `0120` | `admin_sensitive_grants` + `admin_open_sensitive_window` (fresh-`amr` server check) + `admin_has_sensitive_grant` + `admin_consume_grant` | RLS |
| User mutations | `0122` | `admin_role_change_preview`, `admin_correct_primary_role`, `admin_pause/reactivate_account` (each needs a live `user_mutation` grant) + `withReauth` modal in the Users action bar | RLS + static |
| View-as-User | `0123` | `admin_view_as` (read-only projected snapshot; reason-required, grant-gated, audited impersonation, minor name redacted; sticky banner + 5-min countdown) | RLS + static |
| Append-only audit | `0124` | `admin_audit_log` INSERT-only at the DB (UPDATE/DELETE blocked even for superuser) | RLS |
| Support | `0125` | `support_tickets` + `support_ticket_events`; validated + rate-limited intake; **safety = urgent, separate queue**; audited resolve/notes | RLS + static |
| Config | `0126` | `app_config` (typed/validated/versioned/audited) **separate from feature flags**; folds fee control + flags into the shell; writes behind `config` grant | RLS + static |
| Scoring | — | read-only inspector: weights per profile, evidence ceiling, rules, version signals, **contradiction catalog** with each guard | static |
| Payments | `0127` | surfaces OnStandard Pay **fee revenue** (reuses `offer_payments`) + subscription `payments` ledger + **single-use `financial` grant** (verified consumed-once + non-reusable) + provider-capability table | RLS + static |

## Founder corrections delivered
- **#1 server-verified reauth** — grant minted only on a fresh signed-JWT `amr` timestamp; empirically verified `amr`/`aal`/`session_id` are present; a token refresh doesn't update `amr`; **client can't self-grant** (stale-auth refused, scope-isolated). ✅
- **#7 narrow mutations + role preview** — action-specific RPCs (no broad endpoint); role change shows blast radius first. ✅
- **#9 append-only audit** — enforced at the DB. ✅
- **#4/#11 support + safety separation + minor protection** — safety auto-urgent + separate queue; minor reporter PII masked. ✅
- **#6 config vs flags** — typed `app_config` for operational settings, flags for availability. ✅
- **financial (single-use grants + provider caps)** — mechanism shipped + verified; see the deferral below. ✅ (mechanism)

## Deliberate deferral — financial provider-calling edge functions
The **mechanism** for financial actions is shipped + verified: single-use `financial` grant (consumed once), provider-capability gating (Stripe ≠ IAP), and the "billing not connected" UI state. The **provider-calling edge functions** (`admin-refund`/`admin-credit`/`admin-change-plan`/`admin-cancel`) are **deferred to live billing** — deliberately, because:
- they call the real Stripe API, so they can only be meaningfully tested against live/test billing;
- the local edge runtime is down and no `STRIPE_*`/`REVENUECAT_*` secrets are set;
- shipping **untested financial code** is exactly the risk the corrections guarded against.

They follow OnStandard Pay's `refund-payment` pattern + call `admin_consume_financial_grant`. Trainer→client **offer** refunds already work via OnStandard Pay (`refund-payment`).

## Known limitations (carried)
- Live browser render still env-blocked (MCP browser locked, no `playwright-core`); functional verification is RLS + `verify`; visual QC via the served copy (below).
- `admin_pause_account` sets a founder-facing `profiles.suspended_at` flag — hard enforcement (GoTrue ban) + `revoke-sessions`/`password-reset`/`resend-invite` are a GoTrue-admin edge fn (deferred).
- Scoring inspector is read-only; the live what-if simulator (reuse `breakdown-model.js`) is a follow-up.
- `admin_bootstrap.environment` is still hardcoded `production` (move to `app_config` is trivial now that config exists).

## QC (still live)
Real Command Center served at **http://127.0.0.1:8790** (`founder@local.test` / `Test1234!`), re-seeded post-gate: 5 demo users (incl. **Jordan, minor → masked email + guardian**, **Coach Rivera payment-failed**), Riverside High org + roster, 3 subs, and **2 support tickets incl. a safety report (urgent)**. New in 1B to click: Users → **Change role** (preview → reauth), **Pause**, **View as user** (reason → reauth → snapshot + countdown); **Support** (safety-first queue); **Configuration** (typed config + fee + flags); **Scoring**; **Payments** (fee revenue + billing-not-connected actions).

## Outstanding founder-ops to go live
- Seed `platform_admins`; apply `0120,0122–0127` (`supabase db push`); host `web/admin` per `DEPLOY.md`.
- To enable financial actions: set `STRIPE_*`/`REVENUECAT_*` secrets, deploy the (to-be-written) financial edge fns, and flip `billing_connected`.
- (Optional) enroll MFA to upgrade reauth from `aal1`→`aal2`.

**Gate status: GREEN — Phase 1B complete.**
