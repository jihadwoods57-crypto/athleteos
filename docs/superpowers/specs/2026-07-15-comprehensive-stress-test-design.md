# OnStandard Comprehensive Stress Test — Design

**Date:** 2026-07-15
**Author:** Claude (with founder jihadwoods57)
**Status:** Approved — execution in progress

## Objective

Put OnStandard under comprehensive pressure across load/concurrency, robustness/chaos,
security/role-integrity, and full-app soak, plus every cross-cutting concern (performance,
mobile responsiveness, a11y, auth/session, billing, notifications, uploads, AI reliability,
third-party outages, backup/recovery, observability, rate limiting, abuse, migration safety,
rollback readiness). For every role, every critical workflow, every permission boundary, and
every failure state: produce automated tests, reproducible test data, severity-ranked findings,
measurable pass/fail thresholds, recommended fixes, and a final release-readiness verdict.

**Mandate:** do not only plan — implement and run every *safe* test possible in the existing
environment without damaging production data.

## Safety Model — Test Rings

Prod project `ftwrvylzoyznhbzhgism` ("AthleteOS") has **no environment separation**: the app
`.env`, `supabase --linked`, and all `eas.json` build profiles point at it. Tests are therefore
partitioned into three rings by blast radius.

### Ring 0 — Local / static (zero risk, run first, always)
- `npm run typecheck`, `npm run test` (jest), `npm run bundle`
- `npm run test:rls` (pgTAP against a *local* `supabase start`, not prod)
- Proto Playwright smoke against locally-served `proto/redesign-2026-07/` with stubbed `window.sb`
- Static audits: RLS policy coverage, edge-function input validation, secret handling, migration lint

### Ring 1 — Disposable Supabase project (full aggression, torn down after)
Create `AthleteOS-TEST` (nano, us-east-2) per the [[athleteos-test-project]] pattern:
`supabase projects create` → `db push --include-all` → `functions deploy --use-api`. Swap `.env`
(backup `.env.prod.bak`), mint accounts via **service_role Admin API** (no email), drive real flows.
- **All load/concurrency** against edge functions + RPCs (k6-style concurrent Node drivers)
- **All chaos/robustness** (bad inputs, race conditions, offline, malformed payloads)
- **Destructive RLS probes** (attempt cross-role reads/writes with real forged JWTs)
- **Billing failure sim** (Stripe test-mode webhooks: failed payment, chargeback, subscription lapse)
- **Backup/recovery drill** (snapshot → mutate → PITR/restore verify)
- **Migration safety** (the from-scratch `db push` of all 63 migrations *is* the test; plus rollback)
- **Soak** (multi-hour coach+athletes+trainer simulated living-in-the-app run)
- Teardown: `supabase projects delete`; restore `.env`; re-link prod.

### Ring 2 — Prod (read-only + demo accounts only, strictly bounded)
- Low-volume (≤5 req) latency benchmarks on read RPCs — p50/p95 baseline, **no load generation**
- Demo-account (`*@onstandard.app`, `demo=true`, teardown-able) workflow smoke on the live proto
- Read-only cross-role RLS spot-checks with the 7 demo accounts
- **Never** generate load, never write outside demo-tagged rows, never fire real push to real users.

## Roles & Critical Workflows Under Test

Roles (from `user_role` enum + derived): **coach, athlete, trainer, parent, client** (= athlete +
general profile). Per [[demo-accounts-live]] the 7 demo accounts cover every role and linkage.

Critical workflows: signup/onboarding per role · daily log→score→coach→streak (the Living Number
loop) · meal photo analysis (`analyze-meal`) · meal chat (`meal-chat`) · plan generation
(`plan-generate`) · coach roster & goal-setting · trainer book & client management · parent/guardian
consent (minor) · team/practice create+join · billing checkout/portal/webhook · push delivery ·
weekly digest · directory/staff invites.

Permission boundaries: RLS on `days`/`meals`/`profiles`/`teams`/`practices`; authority rules
(who can set whose goals); minor-consent enforcement (0050/0051); viewer revocation; the
`days_score_evidence_ceiling` trigger; AI caps (0059/0060).

## Measurable Thresholds (pass/fail)

| Surface | Metric | Pass | Warn | Fail |
|---|---|---|---|---|
| Read RPCs (roster, book, day) | p95 latency | <400ms | <800ms | ≥800ms |
| Edge fns (analyze-meal, meal-chat) | p95 latency | <6s | <12s | ≥12s |
| Edge fns under 50 concurrent | error rate | <1% | <5% | ≥5% |
| RPC under 100 concurrent | error rate | <1% | <5% | ≥5% |
| RLS cross-role probe | leaks | 0 | — | ≥1 = P0 |
| Migration from-scratch push | failures | 0 | — | ≥1 |
| Chaos malformed inputs | uncaught 500s | 0 | <3 | crashes fn |
| Soak run (state drift) | score/streak corruption | 0 | — | ≥1 |
| Offline→online reconcile | lost writes | 0 | — | ≥1 |

Findings ranked **P0** (data leak / corruption / prod-down), **P1** (workflow-breaking under load),
**P2** (degraded UX / missing guardrail), **P3** (polish / observability gap).

## Phases

1. **Baseline gates** (Ring 0) — typecheck/jest/bundle/RLS-local; capture green baseline.
2. **Static audits** (Ring 0, parallel subagents) — RLS coverage, edge-fn validation, secrets,
   migration lint, a11y/responsive audit of proto.
3. **Stand up `AthleteOS-TEST`** (Ring 1) — create/push/deploy/seed. Migration-safety = did it push clean.
4. **Load & concurrency** (Ring 1) — concurrent drivers on each edge fn + hot RPCs; record thresholds.
5. **Chaos & robustness** (Ring 1) — malformed payloads, races, offline, oversized uploads, injection.
6. **Security & role-integrity** (Ring 1 destructive + Ring 2 read-only) — forged-JWT cross-role probes.
7. **Full-app soak** (Ring 1) — hours-long multi-role sim; assert no state drift/corruption.
8. **Cross-cutting** (Ring 1) — billing failures, notification delivery, uploads, AI reliability,
   third-party outage sim, backup/restore, observability, rate limit, abuse, rollback drill.
9. **Prod smoke** (Ring 2) — demo-account workflow walk + read-only latency baseline.
10. **Synthesis & verdict** — severity-ranked findings, fixes, release-readiness verdict; Artifact dashboard.
11. **Teardown** — delete `AthleteOS-TEST`; restore + re-link prod; confirm no demo residue.

## Deliverables

- `sim/stress/` — reproducible automated test drivers (load, chaos, soak, security), each runnable standalone.
- `sim/stress/data/` — reproducible seed (idempotent SQL + admin-API account minting).
- Findings report (Markdown in `docs/` + Artifact dashboard) with severity, thresholds hit, fixes.
- Final release-readiness verdict: GO / GO-WITH-FIXES / NO-GO with the P0/P1 list gating it.

## Reused Assets

- `sim/` Playwright + admin harness (`pw-lib.mjs`, `lib-admin.mjs`, existing probe-*.mjs).
- `supabase/tests/` pgTAP RLS suite (`rls_authz_test.sql`, `revoke_viewer_test.sql`).
- Proto smoke recipes and module-seam seeding from [[proto-webview-audit-and-smoke]].
- Admin-API account minting + demo teardown from [[demo-accounts-live]] / [[athleteos-test-project]].

## Out of Scope

- App Store / TestFlight submission testing (covered by `TESTFLIGHT.md` separately).
- Real-device native camera QA (noted open in memory; needs physical device).
- Any load or destructive write against prod.
