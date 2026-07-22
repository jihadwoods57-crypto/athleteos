# Founder Command Center — Phase 1A verification evidence

**Date:** 2026-07-22 · **Branch:** `feat/founder-command-center` · **Spec:** [2026-07-22-founder-command-center-design.md](../superpowers/specs/2026-07-22-founder-command-center-design.md) · **Plan:** [2026-07-22-founder-command-center-phase1a.md](../superpowers/plans/2026-07-22-founder-command-center-phase1a.md)

Phase 1A = the **read-only operational foundation**. This note is the gate: it must be green + written before Phase 1B begins.

## Result summary
- **RLS authz suite: 229 / 229 passed** — from a **clean `supabase db reset`** (every migration `0001…0118` applied from files in sequence, then the full adversarial suite). Baseline was 212; +17 new Command-Center authz checks.
- **`npm run verify`: green** — `lint:xss` clean, `tsc --noEmit` clean, jest suite passed (unchanged — no `src/` changes), iOS bundle exported.
- **Front-end (static): green** — all 9 `web/admin` ES modules parse (`node --check`), `lint:xss` clean (textContent-only discipline intact), the Home extraction is a verbatim move with a complete `render→paint` rename and **zero stray/unimported references**.
- **Live browser render: NOT run — environment-blocked** (see Known limitations). All *functional* behavior is covered by the RLS suite + verify; the *visual* render is a founder step (recipe below).

## What shipped (commits on `feat/founder-command-center`)
| Task | Commit | Contents |
|---|---|---|
| 0 | `5803a4c` | `0115` `admin_bootstrap` / `admin_global_search` / `admin_audit_search`; CSP + frame-ancestors + noindex; `DEPLOY.md` |
| 1 | `4beb812` | extracted `api.js` + `ui.js` |
| 2 | `2a537ee` | `shell.js` (nav + hash router + global search + poll) + `sections/home.js` (relocated dashboard) + thin `admin.js` |
| 3–5 (SQL) | `dcd291d` | `0116` users, `0117` orgs, `0118` truthful revenue |
| 3–8 (UI) | `8d58449` | sections: users, orgs, revenue, ai, errors, audit |

## New gated RPCs (all `is_platform_admin()`-gated, EXECUTE→authenticated, deny-all tables)
`admin_bootstrap` (the only one that returns `{is_admin:false}` for non-admins), `admin_global_search`, `admin_audit_search`, `admin_list_users` (capped page size, minor email masked via `is_registered_minor`, guardian status), `admin_athlete_profile` (extended + **audits minor-record access**), `admin_list_orgs`, `admin_org_health`, `admin_revenue` (reworked → `estimated_subscription_value_usd`), `admin_failed_payments`.

## Truthfulness / labeling (spec §8, honored)
- Revenue KPI is **"estimated subscription value · from plan prices, not collected revenue."** Collected / net / refunds render a labeled empty state ("billing not live … Phase 1B") — never faked.
- Errors section prominently labels the **native-crash blind spot** (no Sentry; anonymous `app_error`).
- Org-level billing rollups labeled deferred (subscriptions are user-owned, not modeled at the org level).
- AI budgets/rate-limits labeled as Phase-1B typed config; emergency shutdown reuses the existing kill-switch.

## Minor protections (spec §4/§11, in Phase 1A)
Minor + guardian status surfaced and badged; minor contact PII masked in the list (server-side); **viewing a real minor's profile writes a `user.view_minor_profile` audit row**; list/profile use `is_registered_minor` (precise) not `is_minor` (fail-closed); result sizes capped (no bulk export).

## Known limitations / gaps (carried forward, honest)
- **Live browser render blocked in this environment:** the Playwright MCP browser profile is locked (no running chromium, no lock file, but the server refuses new sessions and `browser_close` also errors) and `playwright-core`/any chromium binary is unavailable. The founder should do the visual QC via the recipe below.
- Data gaps unchanged from the audit: no payments ledger yet (1B), retention is Phase 2 (events are anonymous — compute from `days`/`profiles`), no push-delivery telemetry, no native crash capture, no DB release table.
- `estimated_subscription_value_usd` is monthly-equivalent (subscriptions store no cadence — annual plans slightly overstated). Prices hardcoded in `0118` with a "SYNC WITH `src/core/pricing.ts`" comment; moves to typed config in 1B.

## Founder render recipe (do the visual QC yourself)
1. **Seed admin (blocks everything):** on prod, `insert into platform_admins(user_id) values ('<your-uuid>');` (find the UUID via `select id,email from profiles where email='…'`). See `web/admin/DEPLOY.md` §0.
2. Serve the static surface: from the repo root, `npx serve web/admin` (or `python -m http.server -d web/admin 8080`).
3. Open the served URL, sign in with your founder account → the shell renders (left nav: Home · Users · Organizations · Revenue · AI Operations · Bugs & Incidents · Audit Log), the env badge shows **production**, global search hits `admin_global_search`. A signed-in **non-admin** sees a clean "access denied" (not a broken shell).

## Outstanding founder-ops before Phase 1A is live on prod
- Seed `platform_admins` (above).
- Apply migrations `0115–0118` (`supabase db push`).
- Host `web/admin` per `DEPLOY.md` (+ `X-Frame-Options: DENY` / `Cache-Control: no-store` response headers).

**Gate status: GREEN — cleared to start Phase 1B.**
