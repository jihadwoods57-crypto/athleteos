# OnStandard Founder Command Center — Design Spec

**Date:** 2026-07-22
**Branch (proposed):** `feat/founder-command-center`
**Status:** Design — awaiting founder review
**Supersedes/extends:** [`2026-07-21-admin-command-center-design.md`](2026-07-21-admin-command-center-design.md) (v1) and the shipped Command Center v2 (commit `cab24b5`)

> This is an **expansion of a live product, not a greenfield build.** A founder-only Command Center already shipped and deployed to prod (`ftwrvylzoyznhbzhgism`) on 2026-07-22. The dominant risk is *rebuilding* what exists. Every section below is written against that reality.

---

## Founder decisions (locked 2026-07-22)

1. **Impersonation** → read-only "view as" (server-projected snapshot; no session assumption).
2. **Reauth/MFA** → step-up reauth on sensitive actions, **verified server-side from the session's recent-authentication signals** (the client cannot self-grant); no full MFA enrollment flow yet (aal2 becomes the strongest signal once MFA is enrolled — Phase 2).
3. **Write-actions** → safe reversible set **+ financial** (refunds / credits / plan changes). *Consequence:* Phase 1 must also lay a real Payments foundation, because there is no ledger and billing isn't live on prod. Financial actions call the real provider APIs, are **provider-capability-gated** (Stripe ≠ IAP — see §3), use **single-use** reauth grants, are confirm-guarded + audited, and show a **"billing not connected"** state (never a fake success) until the founder sets billing secrets. *"Credit" = a Stripe customer-balance adjustment applied to future invoices (Stripe rail only).*
4. **Support** → minimal `support_tickets` + a ticket-events history table + in-app contact capture + founder queue, with **safety reports separated** from normal support (defer SLA/threading/assignment).

---

## 1. Audit — what already supports this

### Reuse verbatim (already built, live, tested)
| Area | What exists | Evidence |
|---|---|---|
| **Auth boundary** | `platform_admins` allowlist + `is_platform_admin()` SECURITY DEFINER gate. Un-self-grantable. Every admin RPC opens with `if not is_platform_admin() then raise exception 'not authorized'`. Client `gate()` only checks a session exists — server is authoritative. | `0037_analytics.sql`; `web/admin/admin.js` gate() |
| **Dashboard shell** | Static, zero-build HTML+ESM at `web/admin/`. Dark-premium blue→teal, briefing hero, "since last visit" movers, triage queue, 8 sparkline cards, drill-down modals, deterministic "Ask the business". Loads supabase-js from esm.sh, Fira from Google Fonts. | `web/admin/index.html`, `admin.js` |
| **Decision engine** | `web/admin/attention.js` — **pure, no-LLM, 13 jest tests** (`adminAttentionV2.test.ts`): `evaluateFlags/briefing/movers/zscore/forecast`. Reused by the cron. | `web/admin/attention.js` |
| **Component vocabulary** | `h()` (textContent-only, XSS-safe), `sparkline()`, `card()`, `row()`, `tbl()`, `deltaOf()`, `openModal()/toast()`; CSS classes `.hero/.attn/.chip/.big.sig/.card/.grid/.btn.pri`; token set (see §6). | `admin.js`, `index.html` |
| **AI observability** | `ai_calls` + time-versioned `ai_model_prices` + views (`ai_cost_per_meal`, `ai_cost_daily`); RPCs `admin_ai_cost`, `admin_ai_cost_by_fn`, `admin_ai_verify`, `admin_system_health`, `admin_meal_quality_metrics`. `recordAiCall()` seam in all 6 paid fns. | `0105/0106/0107/0111`, `_shared/ai-telemetry.ts` |
| **Feature flags + kill-switch** | Server table + evaluator + RN store + founder panel. Audited via `admin_set_flag`. | `0109`, `flags/index.ts`, `flagsStore.ts`, `flags.js` |
| **Audit log** | `admin_audit_log` — canonical ledger (actor + action + target + before/after jsonb). Surfaced by `admin_recent_audit`. | `0109` |
| **Triage / snapshots** | `admin_attention_state` (resolve/snooze/reopen, audited) + `admin_brief_snapshots` + `schedule_admin_brief` pg_cron (`0 12 * * *`) + `admin-brief` edge fn heartbeat. | `0113`, `admin-brief` |
| **Drill-down template** | `admin_top_cost_athletes` → `admin_athlete_profile` → `admin_tag_user_for_review` (safe, reversible, audit-only). | `0113` |
| **Onboarding funnel** | `admin_onboarding_funnel` over anonymous `analytics_events`. | `0052` |
| **Subscriptions model** | Single `subscriptions` table unifies Stripe (team) + IAP (consumer) rails, full lifecycle columns; entitlement model `src/core/subscription.ts` (pure). Real prices in `src/core/pricing.ts`. | `0010/0042/0102` |
| **Scoring engine** | Deterministic formula, pure & Node-importable (`scoring.ts computeDerived`, `proto day.js computeComponents/scoreFor`), parity-locked. `breakdown-model.js` = working what-if simulator; `dayFromHistoryRow` = historical adapter; evidence-ceiling trigger `0041`. | `src/core/scoring.ts`, `proto day.js` |

### Existing gated RPC catalog (all `is_platform_admin()`-gated — reuse, don't re-query tables)
`admin_overview`, `admin_daily_activity`, `admin_ai_cost(+_by_fn)`, `admin_ai_verify`, `admin_revenue`, `admin_system_health`, `admin_meal_quality_metrics`, `admin_onboarding_funnel`, `admin_event_counts`, `admin_recent_audit`, `admin_list/set_attention_state`, `admin_list/save_brief_snapshot`, `admin_top_cost_athletes`, `admin_athlete_profile`, `admin_tag_user_for_review`, `admin_list_flags/admin_set_flag`.

### Partial (extend, don't replace)
Action Center (add rules + write-actions), Users (drill-down exists, **no list/search**), Organizations (counts only), Revenue (counts exact, **MRR is placeholder**), Scoring (engine exists, **no inspector**), Product Usage, Growth, Bugs, Security, Account Health, Compliance.

### Must build net-new
Safe impersonation, Support, **Payments ledger**, Retention/cohorts, Standards admin, Notification-health, Reports.

### 🚨 #1 blocker (ops, not code)
`platform_admins` is **EMPTY in prod**. Until the founder's UUID is inserted (service-role/SQL editor), the *entire* Command Center returns "not authorized." No in-app recovery path. **This must be the first step of any deploy/demo.**

---

## 2. Information architecture

**Keep the single static `web/admin` surface.** Evolve it from 2 standalone pages (`index.html` + un-styled `flags.html`) into a **left-nav shell** with a persistent top bar (global search, environment badge, founder identity, reauth state) and a section container. Zero-build, vanilla ESM, no framework — the shipped architecture decision stays (a React rebuild is explicitly rejected).

Route: served as the founder surface (aliasable to `/owner` at the host). 23 sections in 8 rails:

- **Overview** — Home · Action Center
- **People** — Users · Organizations · Account Health
- **Product** — Onboarding · Product Usage · Standards · Scoring
- **Money & AI** — Revenue · Payments · AI Operations
- **Growth** — Growth · Retention · Reports
- **Ops** — Notifications · Support · Bugs & Incidents · Releases
- **Trust** — Safety & Compliance · Security · Audit Log · Configuration

**Progressive disclosure everywhere:** rail → section (table / queue / KPI row) → entity side-panel (drill-down) → action (with confirm + reauth). No wall of identical cards; hierarchy, tables, trend charts, actionable queues, side panels, filters, drill-downs.

**Phase 1 builds these sections:** Home, Action Center, Users, Organizations, Revenue, Payments, AI Operations, Support, Scoring, Bugs & Incidents (error monitoring), Audit Log, Configuration (feature flags + settings + env). The rest render as **clearly-labeled "Coming in Phase 2/3"** placeholders so the shell is complete but nothing fakes data.

---

## 3. Database & backend changes (Phase 1)

**Conventions (non-negotiable, from the shipped contract):** every new RPC is SECURITY DEFINER, `EXECUTE`-granted to `authenticated`, gates in-body on `is_platform_admin()`, reads/writes **deny-all** tables, and audits mutations to `admin_audit_log`. No new admin-identity mechanism. No client-side table access. **Sensitive/financial RPCs additionally require a valid server-verified sensitive grant (§4); reads that touch minor records redact per §4.**

| Migration | Adds |
|---|---|
| `0115_cc_users.sql` | `admin_list_users(search, role, status, page, page_size)` — the enumeration gap (joins `profiles` + `subscriptions` + activity); **`page_size` capped, no unbounded/bulk export in Phase 1**; returns **minor + guardian status** and redacts minor-sensitive fields. Extend `admin_athlete_profile` (sessions, consent flags, payment-failed, notification opt-out, recent errors; minor/guardian status). **Narrow, action-specific** audited mutations (no single broad endpoint): `admin_correct_primary_role`, `admin_resend_invite`, `admin_reset_onboarding`, `admin_pause_account`, `admin_reactivate_account`, `admin_revoke_sessions`, `admin_start_password_reset` (+ existing `admin_tag_user_for_review`). Plus `admin_role_change_preview(user_id, new_role)` → the blast radius (affected permissions, org/team memberships, app routing/flow, subscriptions, staff assignments) shown **before** any role change is confirmed. Reads the **4 legacy link tables**, not `org_memberships` (empty in prod). |
| `0116_cc_orgs.sql` | `admin_list_orgs(search, page)` and `admin_org_health(org_id)` — per-org rollup (staff, members, subscription, engagement, outstanding payments) over `orgs/teams/team_members/team_staff/practices/practice_clients/guardianships`. **Cross-org isolation enforced; results capped.** |
| `0117_reauth_view_as.sql` | `admin_sensitive_grants(id, actor_id, session_id, scope, single_use, granted_at, expires_at, consumed_at)` (deny-all) + `admin_open_sensitive_window(scope)` — **mints a grant only after the server verifies recent authentication** (§4); grant binds actor + `session_id` + action scope + short expiry; financial scopes are single-use. `admin_has_sensitive_grant(scope)` + `admin_consume_grant(id)`. `admin_view_as(user_id, reason, ticket_id?)` — **read-only** projected snapshot (reuses `admin_athlete_profile` projection); **reason required**, records target + ticket link + start + expiry + each viewed surface; audited `impersonation=true`; minor records redacted. |
| `0118_payments.sql` | Reconciliation-grade `payments` ledger (deny-all): `id`, `provider (stripe\|revenuecat)`, `kind (charge\|refund\|dispute\|fee\|adjustment)`, `status`, `owner_id`, `org_id`, `subscription_id`, `amount_cents`, `fee_cents`, `currency`, `provider_object_id`, `provider_event_id **UNIQUE**`, `occurred_at`, `recorded_at`, `failure_code`, `failure_message`, `metadata jsonb` (**filtered — never the raw unfiltered provider payload**). `UNIQUE(provider_event_id)` = idempotency/dup-prevention; `occurred_at` (provider time) drives ordering. `admin_payments(filters)`, `admin_failed_payments()`. `admin_revenue` reworked to return **separated** metrics (see §8): `estimated_subscription_value_usd`, `collected_revenue_usd`, `refunds_usd`, `net_revenue_usd`. |
| `0119_support.sql` | `support_tickets(id, user_id, category [question\|bug\|billing\|safety], priority, status, subject, created_at, resolved_at, resolver_id)` (deny-all + owner-insert) + `support_ticket_events(id, ticket_id, actor_id, kind [created\|note\|status_change\|assigned\|resolved], body, created_at)` — **preserves resolution notes + full history**. `create_support_ticket(category, subject, body)` — authenticated, **validated + rate-limited + abuse-guarded**. **`category='safety'` (esp. minors) routes to a distinct higher-priority queue, audited, visually separated.** `admin_support_queue(status, category)`, `admin_add_ticket_event(...)`, `admin_resolve_ticket(id, note)`. |
| `0120_app_config.sql` | **Typed, validated, versioned, audited configuration — separate from feature flags.** `app_config(key, value jsonb, value_type, version, updated_by, updated_at)` (deny-all) + `admin_get_config`/`admin_set_config` (validates value against the key's type/range, bumps version, audits before/after). Holds **budgets, rate limits, thresholds, operational settings** — never feature availability. |
| `0121_audit_append_only.sql` | Enforce `admin_audit_log` **append-only at the DB level**: revoke UPDATE/DELETE from all roles + a `BEFORE UPDATE OR DELETE` trigger that raises (even under service_role). INSERT-only ledger. |

**Provider capabilities (Stripe ≠ RevenueCat/IAP)** — the UI shows an action only where the rail supports it (surfaced via `admin_bootstrap`, §4):

| Action | Stripe (team/org) | RevenueCat · App Store · Play (consumer IAP) |
|---|---|---|
| **Refund** | Yes (API) | **No** — refunds are issued by Apple/Google; we can only *reflect* them. Show "refunds handled by the store." |
| **Credit** | Yes — customer-balance adjustment on future invoices | **No credit concept** — action hidden |
| **Plan change** | Yes (API) | Store-managed — deep-link/instruct, not a direct API call |
| **Cancel** | Yes (API) | Reflected via store/RevenueCat; no direct server cancel |

**Edge-function changes (additive):**
- Expand `stripe-webhook`: `charge.refunded`, `charge.dispute.created/closed`, fee capture → `payments`. **Signature verification (already present) required; idempotent upsert on `provider_event_id` (retry-safe); order by `occurred_at`.**
- Expand `revenuecat-webhook`: refund/cancellation *reflection* → `payments`. Shared-secret verification required; same idempotency/dedupe/order rules.
- Provider-scoped founder actions (`is_platform_admin()` + **single-use** grant + capability check): `admin-refund`, `admin-credit`, `admin-change-plan`, `admin-cancel`. Return "billing not connected" when secrets unset.
- User mutations stay in-RPC (auth-only); only actions needing a provider/GoTrue-admin call (e.g. revoke-sessions) use an edge fn.

**Scoring:** no server recompute (explicitly rejected — drifts, mis-scores). Reuse the pure engine (`breakdown-model.js`, `dayFromHistoryRow`, `resolveRequirementSet` for as-of-date standard reconstruction). Optional read-only `scoring_version` label from `PROTO_VERSION` + weight-constant hash (no schema change).

**Role model (confirmed from audit):** `profiles.primary_role` is a single **global** value (`user_role`: athlete\|parent\|coach\|trainer) that drives app flow/routing; **staff roles are per-team** (`staff_role`, `team_staff`); the unified **multi-role `org_memberships` model is authored-not-live** (empty in prod). "Role correction" therefore edits the global `primary_role` and/or a per-team `staff_role` — `admin_role_change_preview` makes the exact blast radius explicit before confirming.

---

## 4. Security & permissions model

- **Boundary stays** `platform_admins` + `is_platform_admin()` (server-side, un-self-grantable). No client-side permission checks anywhere.
- **Authoritative bootstrap.** `admin_bootstrap()` is the single source of truth the shell renders from: authorization (is_admin), environment (prod/staging/dev), app/spec version, current reauth/grant state, **billing-connection status per rail**, and available capabilities (provider caps, flags, config surface). The client never guesses these.
- **Server-verified step-up reauth.** Sensitive actions (impersonation, flag/kill-switch write, each user mutation, each financial action) require a grant from `admin_open_sensitive_window(scope)`. The grant is minted **only after the server verifies recent authentication** — from the session JWT's `amr` method timestamps (password/otp), and MFA assurance (`aal2`) once enrolled — so a normal authenticated client **cannot self-grant**. Grants bind to actor + `session_id` + action scope + short expiry; **financial grants are single-use** (consumed on execution). Every mint and use is audited. Missing/expired/wrong-scope grant → `reauth required`.
- **Read-only impersonation ("View as User").** `admin_view_as` returns a projected snapshot only — no session assumption, no write path. **Reason required** (+ optional support-ticket link); **permanent banner** with expiry countdown; **auto-expires** with the grant; every viewed surface audited with `impersonation=true`; minor records redacted.
- **Minor protections (Phase 1 minimum).** Minor + guardian status shown where relevant; sensitive fields redacted on minor records; access to minor records audited; cross-org exposure prevented; **no unrestricted/bulk export** (list + view sizes capped).
- **Append-only audit.** `admin_audit_log` is INSERT-only enforced at the DB (`0121`). Logged: refunds, credits, plan/role changes, flag + config changes, impersonation (with reason + target), pauses/locks, session revokes, exports.
- **Admin-surface hardening.** CSP (self + pinned CDN origins, or vendored assets w/ SRI); `frame-ancestors 'none'` (anti-framing); `noindex`; `Cache-Control: no-store` on the surface. Pin/SRI or vendor the runtime CDN deps (Google Fonts, esm.sh); documented in `DEPLOY.md`. Anon-key-only in the browser, never service-role.
- **Idle lock (not global sign-out).** After N minutes idle the Command Center **locks** (reauth to unlock) and **expires open sensitive grants** — it does **not** call a global `auth.signOut` that would kill the founder's unrelated OnStandard app sessions.
- **Environment indicator.** Prod/staging/dev badge from `admin_bootstrap` (backed by the configured `PROJECT_REF`).
- **No destructive/financial action without confirmation + a valid grant.** Two-step confirm on anything financial or irreversible.

---

## 5. Phase 1 implementation plan — 1A then 1B

Each step ships with: its migration (if any) + gated RPC/fn + panel + **green `npm run verify`** (lint:xss, typecheck, jest, iOS bundle) + **RLS suite green** (via docker-exec-psql) + audited writes. To reduce risk, Phase 1 is split: **1A is a read-only operational foundation; 1B adds reauthenticated mutations and tools. 1A is fully verified and its results documented (a short `docs/audit/cc-phase1a-evidence.md`) before 1B begins.**

### Phase 1A — read-only operational foundation
0. **Bootstrap & hardening** — `platform_admins` seed runbook; `web/admin/DEPLOY.md` (host + CDN); env badge; **`admin_bootstrap()` RPC**; CSP / `frame-ancestors 'none'` / `noindex` / `no-store` headers; pin or vendor CDN deps (SRI).
1. **Shared component module** — extract `h/sparkline/card/row/tbl/modal/toast/deltaOf` into `web/admin/ui.js` (ESM). Behavior identical; shipped Home unchanged.
2. **Nav shell + global-search *framework*** — left-nav rails, top bar (search, env badge, identity, reauth state), hash-routed sections; Home renders as today inside it. **The search framework is built now; each search *type* is wired only once its backend exists** (users → step 3, orgs → step 4, tickets/audit → 1B).
3. **Users (read-only)** — `admin_list_users` + filterable table + entity side-panel (extended `admin_athlete_profile`). Minor/guardian status + redaction; capped results, no bulk export.
4. **Organizations (read-only)** — `admin_list_orgs` + `admin_org_health`; cross-org isolation.
5. **Revenue (truthful, read-only)** — reworked `admin_revenue` with **separated** metrics (estimated subscription value vs collected vs net vs refunds — §8); failed-payment rollup; future streams labeled "not yet live."
6. **AI Operations** — reuse existing RPCs (cost / verify / quality / health).
7. **Error monitoring (Bugs & Incidents slice)** — panel over `app_error` + `admin_system_health`; **explicitly labels the native-crash blind spot** (no Sentry).
8. **Audit Log (read)** — searchable view over the append-only `admin_audit_log` (extend `admin_recent_audit` or add `admin_audit_search`).

**Gate: run full verification + write the 1A evidence note before starting 1B.**

### Phase 1B — reauthenticated mutations & tools
9. **Server-verified step-up reauth** — `0117` grants + `admin_open_sensitive_window` (amr/aal-verified) + reauth modal; wire to the existing flag-write path first (proves the seam).
10. **User write-actions** — **action-specific** RPCs (correct role, resend invite, reset onboarding, pause/reactivate, revoke sessions, password-reset) behind grant + confirm + audit; **role change shows `admin_role_change_preview` first**.
11. **View as User (read-only)** — `admin_view_as` (reason required, ticket link, banner, expiry, audited, minor redaction).
12. **Payments foundation** — `0118` ledger + webhook expansion (sig-verified, idempotent, ordered) + **provider-capability-gated** `admin-refund/credit/change-plan/cancel` with the "billing not connected" state; Payments section shows the real ledger (empty + labeled until billing live). Separated financial metrics.
13. **Support** — `0119` tickets + events (history/notes) + validation/rate-limit/abuse + **safety-report separation**; in-app contact capture; founder queue with user context drawn from **existing** activity / subscription / payment / error / attention data (**not** the Phase-2 Account Health system).
14. **Scoring inspector** — read-only weights/profiles/rules/version + what-if (`breakdown-model.js` + `dayFromHistoryRow`, as-of-date std) + contradiction flags (new `attention.js` rules). `scoreParity.test.ts` green; no server recompute.
15. **Configuration + Action Center expansion** — typed/validated/versioned/audited `app_config` (`0120`) for budgets/limits/thresholds + the **restyled** flags panel folded into the shell (flags = availability/rollout/variant/kill-switch **only**). New `attention.js` rules (failed-payment, high-value at-risk, incomplete team onboarding, support-waiting) wired into the queue.

---

## 6. Screens & components

**Reuse (do not rebuild):** the token set — `--bg #0a0d12`, `--surface #141a22`, `--surface2 #1a212c`, `--ink/--ink2/--mut`, `--blue #3b82f6`, `--teal #33c6d6`, `--sig` (120° blue→teal), `--warn #f0616d`, `--note #e6a93c`, `--ok #3ecf8e`, `--r 14px`/`--r-sm 10px`, `--sans Fira Sans`, `--mono Fira Code` — plus `sparkline()`, `card/row/tbl/deltaOf`, `openModal/toast`, `.hero/.attn/.chip/.big.sig/.grid/.btn.pri`, and the `textContent`-only `h()` discipline.

**New components (built once in `ui.js`, reused across sections):**
- Left-nav shell + rail groups; top bar (global search, env badge, identity, reauth state)
- Global-search command palette
- Filterable / paginated data table (sort, role/status filters, search)
- Entity side-panel (drill-down container, tabbed)
- **Provider-capability-aware** action bar (renders only rail-supported actions) with confirm + reauth gating
- Step-up reauth modal; View-as **reason** prompt
- Impersonation banner (sticky, countdown to expiry)
- Minor/guardian badge + **redacted-field** treatment; role-change **impact-preview** panel
- "Billing not connected" / "Coming in Phase 2/3" / "No data yet" / "Handled by the store" labeled empty states

---

## 7. Risks, missing data, dependencies

**Blockers / must-do-first**
- `platform_admins` empty in prod → whole surface inert until seeded (ops step 0).
- Billing not live on prod (`STRIPE_*`/`REVENUECAT_*` unset) → financial actions build but don't function; `subscriptions` has ~no paying rows, so MRR/Payments read near-empty (labeled, not faked).

**Data gaps (label, don't fake)**
- **Estimated subscription value ≠ revenue** — pricing-based value is `counts × pricing.ts`, an **estimate**, not money collected. Collected / net / refunds come from the `payments` ledger (`0118`), which is empty until billing is live. Never present estimated value as revenue in hand (see §8).
- **Contribution margin, not gross profit** — do not label AI cost alone as gross profit. Surface **"estimated contribution margin based on tracked variable costs (AI)"** until fees + infra + support costs are also tracked.
- **Payments/refunds/disputes** — no ledger today; `0118` starts capturing forward; historical charges require a provider fetch, not the DB.
- **Retention/cohorts** — `analytics_events` is **anonymous by design** (privacy firewall — do NOT de-anonymize). D1/D7/D30 + DAU/MAU must be computed from authenticated `days`/`profiles`. → Phase 2.
- **Native crashes** — `ErrorBoundary` reports nothing, no Sentry; `app_error` is anonymous, no stack/device. Error panel is **explicitly labeled incomplete crash coverage.**
- **Push delivery** — `send-push`/`weekly-digest` are fire-and-forget; no delivery/receipt telemetry. → Notifications-health is Phase 2.
- **Release state** — no DB release table; EAS + `buildInfo.ts` are the source of truth.
- **Product-usage depth** — no screen-view/"standard completed"/"report viewed" events; completion lives unemitted in `days.checked_tasks`; ~3 emitted events silently dropped by whitelist drift (fix as a small instrumentation pass).

**Architecture hazards (from the audit)**
- **Two token systems** (`web/admin` inline Fira vs `proto tokens.css` Plus Jakarta) → extend the `web/admin` inline set only; do not fork a third. `web/admin` is dark-only.
- **Name-collision trap:** `web/admin/attention.js` (admin flag evaluator) vs `src/core/attention.ts` (coach roster risk). Extend the former.
- **Scoring:** two parity-locked formula copies + weights hardcoded in 4 places; keep `scoreParity.test.ts` green; never recompute server-side.
- **`org_memberships` is authored-not-live** — read the 4 legacy link tables.
- **Runtime CDN deps** (Google Fonts, esm.sh) — confirm reachability or vendor; document in `DEPLOY.md`.
- **Hardcoded `SUPABASE_URL`/anon key/`PROJECT_REF`** in `admin.js` + `flags.js` — keep in sync; anon key only, never service-role.
- **Concurrent committer** on the shared tree — use targeted `git add <path>`, work on `feat/founder-command-center`, avoid git surgery.

**Founder-ops dependencies to go fully live:** seed `platform_admins`; set billing secrets (for Payments/financial actions); confirm `admin-brief` cron armed (`BRIEF_CRON_KEY` + `schedule_admin_brief` called); deploy new fns + apply `0115–0121`; host `web/admin` per the new runbook.

---

## 8. Financial metrics (definitions)

Surfaced as **distinct** numbers — never conflated:

| Metric | Definition | Source | Phase-1 state |
|---|---|---|---|
| **Estimated subscription value** | active/`counts × pricing.ts` price (by `plan_id`/`tier`); "ARR-equivalent" = ×12 | `subscriptions` + `pricing.ts` | exact counts; **estimate**, not collected |
| **Collected revenue** | successful charges | `payments` (`kind=charge, status=succeeded`) | real; **empty until billing live** |
| **Refunds** | issued/reflected refunds | `payments` (`kind=refund`) | real; empty until billing live |
| **Net revenue** | collected − refunds − fees | `payments` | real; empty until billing live |
| **Estimated contribution margin** | net (or collected) − **tracked variable costs (AI today)** | `payments` + `ai_calls` | labeled "based on tracked variable costs" |

Every dollar tile states its basis in-UI (e.g. "Estimated — from plan prices, not collected"). AI cost is a **cost input**, never labeled profit.

---

## Phase 2 / Phase 3 (scoped, not built now)

- **Phase 2 (growth & retention):** Account Health rollup, onboarding funnels by role, churn-risk detection, professional-activation alerts, growth analytics (needs UTM capture), automated recovery, report analytics, Notifications-health (needs delivery telemetry), MFA/aal2 hardening, cohort/retention from `days`/`profiles`.
- **Phase 3 (platform ops):** OnStandard Pay, Recruit, Athlete Access/creator, sponsor-funded accounts, advanced experimentation, full compliance automation, forecasting, the D3 versioned per-org weight-set table (RD-governance sign-off required).

---

## Out of scope / explicitly NOT doing
- No second dashboard shell, attention engine, audit log, admin-identity mechanism, cost/flag system, or subscriptions/billing table — all exist; extend them.
- No React/build system for `web/admin`.
- No server-side score recompute.
- No de-anonymizing `analytics_events`.
- No mock data in production-facing surfaces; everything not yet wired is labeled.
