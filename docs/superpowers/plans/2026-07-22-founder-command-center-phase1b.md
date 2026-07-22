# Founder Command Center — Phase 1B Implementation Plan

> **For agentic workers:** use superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add the reauthenticated, mutating, money-moving half of Phase 1 on top of the verified 1A foundation: server-verified step-up reauth, narrow audited user mutations, read-only View-as-User, a reconciliation-grade payments ledger + provider-capability-gated financial actions, minimal support with safety-report separation, a scoring inspector, and typed config + append-only audit.

**Architecture:** Same shipped contract — `is_platform_admin()`-gated SECURITY DEFINER RPCs over deny-all tables, `EXECUTE`→authenticated, audited to `admin_audit_log`. **Sensitive/financial RPCs and edge fns additionally require a valid server-verified sensitive grant.** No new admin-identity mechanism, no server-side score recompute, no de-anonymizing events.

**Tech Stack:** Supabase Postgres (plpgsql) + Deno edge functions (Stripe/RevenueCat APIs); static `web/admin` ESM; `psql` RLS suite; Jest (pure logic).

## Global Constraints (verbatim)
- Reauth grants are **server-verified from the signed JWT** (`amr` recent-auth timestamp; `aal2` when MFA lands) — a client **cannot self-grant**. Grants bind to actor + `session_id` + scope + expiry; **financial grants are single-use** (consumed on execution).
- Financial actions call **real** provider APIs, are **provider-capability-gated** (Stripe ≠ IAP), confirm-guarded, audited, and show a **"billing not connected"** state when secrets are unset — never a fake success.
- `admin_audit_log` becomes **append-only at the DB** (revoke UPDATE/DELETE + trigger).
- Minor protections carry forward (redaction, audited access, no bulk export).
- Feature flags = availability/rollout/variant/kill-switch **only**; budgets/limits/thresholds live in typed `app_config`.
- Each task ends green: `npm run verify` + `npm run test:rls` (docker) + audited writes. Targeted `git add` (shared tree).

**VERIFIED (empirically, on the local stack):** the Supabase access-token JWT carries `amr:[{method,timestamp}]`, `aal`, and `session_id`. `auth.jwt()->'amr'` is readable in an RPC; a fresh sign-in yields a recent `amr.timestamp`; a token refresh does NOT update it. This is the foundation of `admin_open_sensitive_window`.

---

## Migrations (Phase 1B)
> **Numbering note:** a concurrent session shipped **OnStandard Pay** as `0119_onstandard_pay.sql` (Stripe Connect for trainer offers: `offer_payments` ledger, `pay_platform_config` fee, `refund-payment`/`connect-*`/`pay-offer-checkout` fns, expanded `stripe-webhook`). CC 1B migrations therefore start at **0120**.

`0120_cc_reauth` · `0121_cc_user_actions` · `0122_cc_view_as` · `0123_cc_payments` · `0124_cc_support` · `0125_cc_config` · `0126_cc_audit_append_only`.
Edge fns: `admin-refund`, `admin-credit`, `admin-change-plan`, `admin-cancel`, `admin-revoke-sessions`.

**Reconcile with OnStandard Pay (do NOT duplicate):** OnStandard Pay handles *trainer→client offer* payments via Connect destination charges (platform takes `pay_platform_config.fee_percent`). My `payments` ledger (Task 4) is for *platform-subscription* revenue (Stripe subs + RevenueCat IAP) — a **different money flow**. The Command Center must surface **both**: reuse `offer_payments` (via a new founder-facing `admin_*` RPC over the existing table + its `application_fee_cents` = platform-fee revenue) and reuse `pay_platform_config` + `admin_get/set_platform_fee` for the fee control — build a duplicate of neither. `refund-payment` already refunds *offer* payments; my `admin-refund` is for *subscription* refunds only. When expanding `stripe-webhook`, **preserve the concurrent Connect changes** (rebase my additions onto theirs).

---

## Task 1: Reauth foundation (`0120`) — ✅ SHIPPED (commit `cee82db`, renamed to 0120)

**Files:** Create `supabase/migrations/0120_cc_reauth.sql`; Modify `web/admin/ui.js` (reauth modal + `withReauth` helper — deferred to Task 2 where the first mutation wires it), `rls_authz_test.sql`, `admin_bootstrap` (capability flips deferred per-task as actions land).

**Interfaces — Produces:**
- `admin_open_sensitive_window(p_scope text, p_single_use boolean default false) → uuid` (grant id) — **raises `reauth required`** unless the JWT's max `amr.timestamp` is within 300s.
- `admin_has_sensitive_grant(p_scope text) → boolean`.
- `admin_consume_grant(p_grant uuid) → void` (financial single-use).
- Client `ui.js`: `withReauth(scope, actionFn)` — opens the password modal → `signInWithPassword` (re-auth) → `admin_open_sensitive_window(scope)` → runs `actionFn`; surfaces `reauth required`.

- [ ] **Step 1: `0119_cc_reauth.sql`**

```sql
create table if not exists public.admin_sensitive_grants (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users(id) on delete cascade,
  session_id  uuid,
  scope       text not null,
  single_use  boolean not null default false,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists admin_sensitive_grants_actor on public.admin_sensitive_grants (actor_id, scope, expires_at desc);
alter table public.admin_sensitive_grants enable row level security;
revoke all on table public.admin_sensitive_grants from anon, authenticated;

-- most recent auth-method timestamp from the SIGNED jwt (client can't forge; refresh doesn't update it)
create or replace function public.admin_recent_auth_epoch() returns bigint
language sql stable security definer set search_path = public as $$
  select max((e->>'timestamp')::bigint)
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) e;
$$;
revoke execute on function public.admin_recent_auth_epoch() from anon, authenticated;

create or replace function public.admin_open_sensitive_window(p_scope text, p_single_use boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_ts bigint; v_id uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_ts := admin_recent_auth_epoch();
  if v_ts is null or v_ts < extract(epoch from now())::bigint - 300 then
    raise exception 'reauth required';   -- must re-authenticate within the last 5 minutes
  end if;
  insert into public.admin_sensitive_grants (actor_id, session_id, scope, single_use, expires_at)
    values (auth.uid(), (auth.jwt()->>'session_id')::uuid, p_scope, p_single_use, now() + interval '5 minutes')
    returning id into v_id;
  insert into public.admin_audit_log (actor_id, action, target, after)
    values (auth.uid(), 'reauth.grant', p_scope, jsonb_build_object('single_use', p_single_use));
  return v_id;
end $$;
grant execute on function public.admin_open_sensitive_window(text, boolean) to authenticated;

create or replace function public.admin_has_sensitive_grant(p_scope text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_sensitive_grants g
    where g.actor_id = auth.uid()
      and g.session_id is not distinct from (auth.jwt()->>'session_id')::uuid
      and g.scope = p_scope
      and g.expires_at > now()
      and (not g.single_use or g.consumed_at is null));
$$;
grant execute on function public.admin_has_sensitive_grant(text) to authenticated;

create or replace function public.admin_consume_grant(p_scope text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.admin_sensitive_grants g set consumed_at = now()
  where g.id = (
    select id from public.admin_sensitive_grants
    where actor_id = auth.uid() and scope = p_scope and expires_at > now()
      and single_use and consumed_at is null
    order by granted_at desc limit 1);
end $$;
grant execute on function public.admin_consume_grant(text) to authenticated;
```

- [ ] **Step 2:** `rls_authz_test.sql` — with a fresh-`amr` claim, admin `admin_open_sensitive_window('flags')` returns a uuid and `admin_has_sensitive_grant('flags')` = true; with a stale (`-1200s`) `amr`, `admin_open_sensitive_window` raises `reauth required`; a rando is denied both. (Set `amr` in the `request.jwt.claims` the way this Step's block does — the suite already sets claims via `_as`; extend it to include `amr`.)
- [ ] **Step 3:** `ui.js` — `export async function withReauth(scope, actionFn, opts)`: modal prompts password → `sb.auth.signInWithPassword({email: currentEmail, password})` → on success `rpc('admin_open_sensitive_window', {p_scope: scope, p_single_use: !!opts?.single})` → `actionFn()`; on `reauth required`/error, toast + keep modal. Needs the signed-in email (from `admin_bootstrap().email`, stash in a module the sections read).
- [ ] **Step 4:** Prove the seam on the **existing** flag write: gate `admin_set_flag` calls behind `withReauth('flags', …)` in `flags.js` (the one shipped mutation) — no new action yet.
- [ ] **Step 5:** Update `admin_bootstrap` capabilities to reflect 1B (`mutate_users`, `impersonate`, `financial`, `config` become true) — but each RPC still enforces its own grant server-side.
- [ ] **Step 6: Verify + commit** — `test:rls` green; `git add` the migration, tests, ui.js, flags.js.

---

## Task 2: Narrow user mutations (`0120`) + role-change preview

**Files:** `0120_cc_user_actions.sql`; `web/admin/sections/users.js` (action bar behind `withReauth('user_mutation', …)`), `rls_authz_test.sql`; edge fn `admin-revoke-sessions`.

**Action-specific RPCs** (each `is_platform_admin()` + `admin_has_sensitive_grant('user_mutation')`, audited before/after): `admin_correct_primary_role(p_user, p_role)`, `admin_reset_onboarding(p_user)`, `admin_pause_account(p_user)`, `admin_reactivate_account(p_user)`, `admin_start_password_reset(p_user)` (calls GoTrue recover via an edge fn or sets a flag). `admin_resend_invite` and `admin_revoke_sessions` need the GoTrue admin API → thin edge fn `admin-revoke-sessions` (service-role, grant-gated). **No single broad endpoint.**

`admin_role_change_preview(p_user, p_new_role) → jsonb` — returns the blast radius **before** confirm: current role, team/staff memberships, guardianships, subscription, app-flow change (`primary_role` is **global single-value**; staff roles are per-team). Read-only.

- Steps: write each RPC (raise-gate + grant-check + audit); `admin_pause_account` sets `subscriptions.status`/a `profiles.suspended_at` flag (define one column in `0120`); role change updates `profiles.primary_role` after the preview; wire the Users side-panel action bar (each button → `withReauth('user_mutation', …)` → confirm → RPC); role button shows the preview modal first. RLS assertions for gate + grant-required. Verify + commit.

---

## Task 3: View as User (`0121`, read-only)

**Files:** `0121_cc_view_as.sql`; `web/admin/sections/users.js` (View-as button → reason prompt → banner).

`admin_view_as(p_user uuid, p_reason text, p_ticket_id bigint default null) → jsonb` — read-only projected snapshot (today's day, score/grade, standards summary, recent meals metadata — **reusing `admin_athlete_profile`'s projection**, minor fields redacted). **Requires a non-empty reason**; **requires `admin_has_sensitive_grant('view_as')`**; inserts an audit row `impersonation=true` with target + reason + ticket. No write path. Client shows a sticky **impersonation banner** with a countdown to grant expiry; leaving/expiry clears it.

- Steps: RPC (raise-gate + grant + reason-required + audit); client `withReauth('view_as', …)` → reason modal → render snapshot in a full-panel read-only view + sticky banner. RLS: reason-required + grant-required + audit-row asserted. Verify + commit.

---

## Task 4: Payments ledger (`0122`) + provider-capability financial actions

**Files:** `0122_cc_payments.sql`; edge fns `admin-refund`/`admin-credit`/`admin-change-plan`/`admin-cancel`; `supabase/functions/stripe-webhook` + `revenuecat-webhook` (expand); `web/admin/sections/payments.js` (new) + revenue.js (collected/net); `rls_authz_test.sql`.

- [ ] **Ledger (`0122`):**

```sql
create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (provider in ('stripe','revenuecat')),
  kind             text not null check (kind in ('charge','refund','dispute','fee','adjustment')),
  status           text not null,
  owner_id         uuid references profiles(id) on delete set null,
  org_id           uuid references orgs(id) on delete set null,
  subscription_id  uuid,                       -- owner_id of the subscriptions row (owner-keyed)
  amount_cents     bigint not null,
  fee_cents        bigint not null default 0,
  currency         text not null default 'usd',
  provider_object_id text,                      -- charge/pi/refund id
  provider_event_id  text unique,               -- IDEMPOTENCY / dup-prevention
  occurred_at      timestamptz not null,        -- provider event time → ordering
  recorded_at      timestamptz not null default now(),
  failure_code     text,
  failure_message  text,
  metadata         jsonb                        -- FILTERED (never the raw provider payload)
);
create index if not exists payments_owner on public.payments (owner_id, occurred_at desc);
alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;
```
Then `admin_payments(p_days, p_kind)`, rework `admin_failed_payments` to prefer the ledger, and extend `admin_revenue` with `collected_revenue_usd` / `refunds_usd` / `net_revenue_usd` from the ledger (estimated value stays from prices).

- [ ] **Webhooks (retry-safe, ordered, deduped):** `stripe-webhook` handles `charge.refunded`, `charge.dispute.created/closed`, captures `fee_cents` from balance-transaction; `revenuecat-webhook` reflects refunds. Both: **verify signature (already present) → upsert on `provider_event_id` (idempotent) → order by `occurred_at`**. Store only filtered fields in `metadata`.
- [ ] **Provider-capability map** (in `_shared/plans.ts` or a small helper): Stripe = {refund, credit(customer-balance), plan_change, cancel}; RevenueCat/IAP = {reflect only} — refunds "handled by the store", no credit, plan change store-managed. Each edge fn checks the map + `admin_has_sensitive_grant('financial')` (single-use, consumed) + returns "billing not connected" when `STRIPE_*`/`REVENUECAT_*` unset.
- [ ] **UI:** new `payments` section (rail Money & AI) — ledger table + provider-capability-aware action bar (refund/credit/change-plan/cancel shown only where the rail supports it), each → `withReauth('financial', {single:true})` → confirm → edge fn. Revenue section fills in collected/net/refunds.
- Verify + commit.

---

## Task 5: Support (`0123`) with safety separation

**Files:** `0123_cc_support.sql`; `web/admin/sections/support.js`; RN in-app "contact support" capture (minimal); `rls_authz_test.sql`.

`support_tickets(id, user_id, category [question|bug|billing|safety], priority, status, subject, created_at, resolved_at, resolver_id)` (deny-all + owner-insert) + `support_ticket_events(id, ticket_id, actor_id, kind, body, created_at)` (history/notes). `create_support_ticket(category, subject, body)` — **validated + rate-limited** (per-user cap via a count check) + abuse-guarded. **`category='safety'`** → distinct higher-priority queue, audited, visually separated. `admin_support_queue(status, category)`, `admin_add_ticket_event`, `admin_resolve_ticket` (audited). Founder queue shows user context from **existing** activity/subscription/payment/error/attention data (**not** the Phase-2 Account Health system). Wire the global-search `ticket` kind. Verify + commit.

---

## Task 6: Scoring inspector (frontend + pure engine; no server recompute)

**Files:** `web/admin/sections/scoring.js`; reuse `proto day.js` / `breakdown-model.js` / `scoringProfiles.ts` (read-only). No migration.

Read-only panel: the four components + `PROFILE_WEIGHTS` (athlete/general/gain) + time windows + penalties + partial-credit + streak/excused logic + version signals (`PROTO_VERSION` + weight-hash). A **what-if simulator** reusing `breakdown-model.js` (`maxPossibleScore`/`reachPlan`/`explainCategories`) + `dayFromHistoryRow` with as-of-date standard reconstruction. **Contradiction flags** (new `attention.js` rules): low-score-vs-positive-copy, perfect-score-vs-missed-requirement, new-user-marked-overdue, deleted-meal-still-scored, score-lowered-pre-deadline. Keep `scoreParity.test.ts` green; **no server recompute**. Verify + commit.

---

## Task 7: Typed config (`0124`) + append-only audit (`0125`) + flags restyle + Action Center

**Files:** `0124_cc_config.sql`, `0125_cc_audit_append_only.sql`; `web/admin/sections/config.js` (folds the **restyled** flags panel + typed config editor); `web/admin/attention.js` (+rules); `rls_authz_test.sql`.

- `app_config(key, value jsonb, value_type, version, updated_by, updated_at)` (deny-all) + `admin_get_config`/`admin_set_config` (validate against key type/range, bump version, audit before/after). Holds budgets/limits/thresholds/env. `admin_bootstrap.environment` reads from here.
- `0125`: revoke UPDATE/DELETE on `admin_audit_log` from all roles + a `BEFORE UPDATE OR DELETE` trigger that raises (INSERT-only, even under service_role). RLS assertion: an update/delete attempt fails.
- Configuration section: restyle `flags.html`/`flags.js` into the shell token vocabulary + a typed-config editor (all writes behind `withReauth('config', …)`). Extend `attention.js` with failed-payment / high-value-at-risk / incomplete-team-onboarding / support-waiting rules (keep `adminAttentionV2.test.ts` green). Verify + commit.

---

## Phase 1B gate
Full `npm run verify` + clean-reset `test:rls` + `docs/audit/cc-phase1b-evidence.md`. Founder-ops: apply `0119–0125`, deploy the 5 edge fns, set `STRIPE_*`/`REVENUECAT_*` secrets to activate financial actions, (optional) enroll MFA to upgrade reauth from aal1→aal2.

## Self-review (spec coverage)
Reauth (server-verified, session/scope/expiry-bound, single-use financial) ✅ · narrow mutations + role preview ✅ · view-as (reason/banner/audited/read-only) ✅ · reconciliation-grade payments + provider caps + idempotent webhooks ✅ · support + safety separation + history ✅ · scoring inspector + contradiction flags (no recompute) ✅ · typed config vs flags ✅ · append-only audit ✅ · minor protections carried ✅.
