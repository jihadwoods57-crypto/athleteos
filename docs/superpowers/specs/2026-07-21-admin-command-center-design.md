# Solo-Founder Admin Command Center (v1) — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending spec review
**Scope:** Build-brief Section B, NEW: "Solo-founder admin command center" — the biggest confirmed-but-unbuilt piece. v1 is a hosted, read-only decision dashboard.
**Builds on:** the existing admin RPCs (0037/0052), and this session's AI cost telemetry (8a: `ai_cost_daily`/`ai_call_costs`) + quality metrics (8b: `admin_meal_quality_metrics`, `ai_verify_effectiveness`).

---

## 1. Goal & posture

A hosted, founder-authenticated web dashboard that tells the founder **what needs attention today** and why — not just charts. Read-only in v1; the brief's sensitive founder actions (refunds, role changes, feature flags, pause automations) + their audit log are v2, because they touch money/permissions and there's little to act on yet (0 paying subs, no support queue). The brief's hard rule is honored throughout: **it links to evidence and never invents causes** — every flag states a fact + a link, and the plain-English briefing fills real numbers into sentences with no LLM.

## 2. Surface & auth

- Lives at **`web/admin`** — a static, no-build page (same approach as `web/landing`), laptop-sized (a founder runs a business on a wide screen, not the phone app).
- The page holds **only the anon key + the founder's login JWT — never the service-role key.** The founder signs in with their Supabase account; an unauthenticated visitor, or any signed-in non-admin, gets **nothing** (every RPC is `is_platform_admin()`-gated). A login gate stands in front of the dashboard.
- All data flows through **platform-admin-gated `SECURITY DEFINER` RPCs**. No direct table/view reads from the browser.

## 3. Data layer — reuse + one new migration

**Reused directly** (already `is_platform_admin()`-gated, granted to `authenticated`): `admin_overview`, `admin_daily_activity(n)`, `admin_onboarding_funnel(n)`, `admin_event_counts(n)`, `admin_meal_quality_metrics(n)`.

**New — migration `0108_admin_center_rpcs.sql`** (needed because the AI-cost/verify data lives in **service-role-only** views the founder's authenticated JWT can't read; a `SECURITY DEFINER` RPC gated on `is_platform_admin()` bridges it — the exact pattern validated end-to-end against local Postgres this session):
- **`admin_ai_cost(p_days)`** — daily cost + calls + avg latency by function/model (from `ai_call_costs`); the unit economic **cost per active athlete** (window AI cost ÷ distinct active athletes); and top-N athletes by cost (surfaces a photo-spammer). Serves the brief's "AI cost per meal/athlete/team" + "margin after AI."
- **`admin_ai_verify(p_days)`** — from `ai_verify_effectiveness`: verify calls, catch-rate (`allergen_caught`+`macros_moved` ÷ ok), cost.
- **`admin_revenue()`** — subscriptions rollup across BOTH revenue sources (`subscriptions` = Stripe/team + `consumer_iap_subscriptions` = RevenueCat, 0102): active count, MRR (Σ tier price × active), 30-day churn, by-tier. Returns zeros today; live the moment a webhook writes a paying sub.
- **`admin_system_health(p_days)`** — the "is anything on fire" data: AI-function error rate from `ai_calls.ok` (per `fn`), and client `app_error` counts from `analytics_events`. (Webhook failure tracking is a small follow-up — see §8; the webhooks would need to emit a failure signal to be queryable, so v1 health covers AI functions + client errors, which are free.)

## 4. Attention layer (the decision system) — reusable + deterministic

**`web/admin/attention.js`** — a plain ESM JS module (so the browser page loads it AND jest tests it, the proven proto pattern), exporting two **pure** functions:
- **`evaluateFlags(metrics) → Flag[]`** where `Flag = { level:'warn'|'ok', label, value, link }`. Deterministic rules over the metric bundle, reusing the exact tier-1 thresholds:
  - AI cost/meal vs 7-day avg > +30% → warn.
  - `median_delta ≤ −15` (one-sided AI bias) → warn · `|median_delta| > 25` after 50+ events → warn.
  - `text_conflict_rate > 0.10` → warn.
  - verify catch-rate: fired but changed < ~10% → note "triggers may be too loose"; never fired over the window → note "may be too tight."
  - onboarding step drop (role→goal, goal→complete) below a floor → warn.
  - AI-function ok-rate < 100% → warn · `app_error` spike vs 7d → warn.
  - Each flag carries a **link** (§6). Nothing guesses *why*.
- **`briefing(metrics) → string`** — plain-English template: `"{active_today} athletes active today ({±d} vs last week). AI holding at ~${cost_per_meal}/meal over {calls} calls. {subs} paying subscriptions. {n} items need attention."` No LLM, so it can never invent a cause.

**Why pure + reusable:** the brief's *next* item (Founder automation system) is the push side of exactly this — a cron running `evaluateFlags` and emailing/pushing when a flag turns `warn`. Extracting the logic now means that system is wiring, not new logic. `attention.js` is importable by a future Deno scheduled function.

## 5. Panels (each with a trend, not just a point)

The single change that makes it a decision tool: every panel shows **current value + a trend** — an inline SVG sparkline where the RPC returns a daily series (activity, AI cost — `admin_daily_activity`/`admin_ai_cost` already return per-day rows), and a **"vs prior window" delta** everywhere the metric is a window aggregate (funnel, quality). Panels:
- **Activity / user health** — athletes, active today/7d, meals logged, new signups (`admin_overview` + `admin_daily_activity` series).
- **Growth funnel** — onboarding step counts + drop-offs (`admin_onboarding_funnel`).
- **AI cost & margin** — cost/meal, cost/day, by function & model, **cost per active athlete**, top cost outliers (`admin_ai_cost`). "Margin after AI" = revenue − AI cost (just −cost today; margin-ready).
- **AI quality** — score-delta, contradiction rate, correction rate, verify catch-rate (`admin_meal_quality_metrics` + `admin_ai_verify`).
- **Revenue** — MRR / active subs / churn / by-tier (`admin_revenue`); scaffolded, 0 today.
- **System health** — per-function AI ok-rate, client error counts (`admin_system_health`).

## 6. Evidence links

Each flag and panel links to the record without a bespoke viewer: a deep-link into **Supabase Studio** for the relevant table/filter (e.g. the athlete row, the `ai_calls` for a costly athlete, the `analytics_events` for an error), or a one-click **copyable `supabase db query`**. Cheap, and makes "links to evidence" real.

## 7. Security posture (explicit)

- Browser holds anon key + founder JWT only; **service-role key never ships to the page.**
- Every data path is a `SECURITY DEFINER` + `is_platform_admin()` RPC → unauthenticated = nothing, signed-in non-admin = `not authorized`.
- Read-only: no RPC mutates state.
- Migration 0108 ships **only after the RLS suite runs green locally** (the tier-1 hard trigger; now runnable via Docker per this session).

## 8. Fast-follow (flagged, not v1): the automation bridge

A scheduled edge function (or `pg_cron`) that runs `evaluateFlags` + `briefing` each morning and pushes the result to the founder (email / notification). This is the first piece of the brief's **Founder automation system**, and §4's pure function makes it wiring. Needs a founder notification channel (the athlete `send-push` path isn't it) — hence out of v1. Also folds in **webhook-failure logging** (the webhooks emit a `webhook_error` signal) so `admin_system_health` can show billing-webhook health — the exact class of silent breakage (`stripe-webhook` 500s) the stress test flagged.

## 9. Explicitly NOT v1

Founder-action controls (refunds, role changes, feature flags, pause automations) + audit log; support queue (no support system exists); AI-written briefing (invents-causes risk); premium branded reports/exports (Tier 3).

## 10. Files

- Create: `web/admin/index.html` (login gate + dashboard shell), `web/admin/admin.js` (supabase-js init, RPC calls, render, sparklines), `web/admin/attention.js` (pure `evaluateFlags` + `briefing`).
- Create: `supabase/migrations/0108_admin_center_rpcs.sql` (`admin_ai_cost`, `admin_ai_verify`, `admin_revenue`, `admin_system_health`).
- Test: `src/core/adminFlags.test.ts` — jest unit tests for `evaluateFlags` (each threshold fires/doesn't) + `briefing` (real numbers, no fabrication), importing `web/admin/attention.js` the proto way.
- Reuse (no change): `admin_overview`/`admin_daily_activity`/`admin_onboarding_funnel`/`admin_event_counts`/`admin_meal_quality_metrics`, `ai_call_costs`/`ai_verify_effectiveness`, `subscriptions`/`consumer_iap_subscriptions`.
