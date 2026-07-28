# Founder Command Center — Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the shipped single-page `web/admin` dashboard into a left-nav Command Center shell with a read-only operational foundation (bootstrap/auth, users, orgs, truthful revenue, AI ops, errors, audit log), fully verified before any mutation lands in Phase 1B.

**Architecture:** Extend the live static `web/admin` surface in place (zero-build, vanilla ESM). Extract shared helpers into `ui.js` + a shared client into `api.js`; add a `shell.js` router + per-section modules under `web/admin/sections/`. Backend stays the established pattern: `is_platform_admin()`-gated SECURITY DEFINER RPCs over deny-all tables, `EXECUTE` to `authenticated`, all mutations audited to `admin_audit_log`.

**Tech Stack:** Static HTML/CSS/ESM (no framework, no build); `@supabase/supabase-js@2` from esm.sh; Supabase Postgres (plpgsql RPCs) + edge functions (Deno); Jest (jsdom) for pure logic; `psql` RLS suite for authz.

## Global Constraints (verbatim from the spec)
- Extend the shipped `web/admin` surface — **no** second shell, attention engine, audit log, admin-identity mechanism, or subscriptions/billing table; **no** React/build system.
- Every new RPC: `SECURITY DEFINER`, `set search_path = public`, first line `if not is_platform_admin() then raise exception 'not authorized'; end if;`, `grant execute … to authenticated`, deny-all tables. **`admin_bootstrap()` is the ONLY RPC that returns instead of raising for a non-admin.**
- All dynamic values via `textContent` / the `h()` builder — **never** `innerHTML`. `lint:xss` must stay green.
- Extend `web/admin`'s inline token set only (`--bg #0a0d12 / --surface #141a22 / --blue #3b82f6 / --teal #33c6d6 / --sig`). Do not import a second token system.
- Phase 1A is **read-only** — no user mutations, no impersonation, no financial actions, no config writes (all Phase 1B).
- Minor protections: surface minor + guardian status; redact minor contact PII in lists; audit access to minor records; cap list sizes (no bulk export).
- Do not de-anonymize `analytics_events`. Do not recompute the score server-side.
- Reuse `attention.js` (do not fork); reuse existing RPCs (`admin_ai_cost`, `admin_system_health`, `admin_event_counts`, `admin_recent_audit`, `admin_athlete_profile`, `admin_overview`, …).
- Each task ends green: `npm run verify` (lint:xss + typecheck + jest + iOS bundle) and, when SQL changed, `npm run test:rls` (local Supabase db on :54322). Commit per task with targeted `git add` (shared tree — never `git add -A`).

**Verification note (local DB):** `npm run test:rls` requires `supabase start` (Docker) with migrations applied. Apply a new migration locally with `supabase db reset` or a direct `psql -f`. Live RPC smoke uses `supabase db query --linked -o table "select …"`.

---

## File structure (Phase 1A)

**Create**
- `web/admin/api.js` — the shared Supabase client + constants (`SUPABASE_URL/ANON_KEY/PROJECT_REF/VERSION`) + `rpc()` + `bootstrap()`.
- `web/admin/ui.js` — pure DOM/format helpers: `h, $, show, num, numN, one, usd2, usd4, pct, ago, iso, todayStr, sparkline, row, card, deltaOf, tbl, openModal, closeModal, toast, badge, emptyState`.
- `web/admin/shell.js` — nav rails + hash router + section registry + top bar (global search, env badge, identity, reauth-state placeholder) + idle-lock.
- `web/admin/sections/home.js` — the current hero + attention queue + business grid (moved verbatim from `admin.js`).
- `web/admin/sections/users.js` — user list + drill-down (read-only).
- `web/admin/sections/orgs.js` — org list + health drill-down.
- `web/admin/sections/revenue.js` — truthful revenue (estimated subscription value + failed payments).
- `web/admin/sections/ai.js` — AI operations (cost/verify/quality/health) reusing existing RPCs.
- `web/admin/sections/errors.js` — error monitoring (app_error + system health) with the native-crash caveat.
- `web/admin/sections/audit.js` — searchable audit log.
- `web/admin/DEPLOY.md` — host + CDN + `platform_admins` seed runbook.
- `supabase/migrations/0115_cc_bootstrap.sql` — `admin_bootstrap()`, `admin_global_search()`, `admin_audit_search()`.
- `supabase/migrations/0116_cc_users.sql` — `admin_list_users()` + extended, minor-auditing `admin_athlete_profile()`.
- `supabase/migrations/0117_cc_orgs.sql` — `admin_list_orgs()`, `admin_org_health()`.
- `supabase/migrations/0118_cc_revenue.sql` — reworked `admin_revenue()` + `admin_failed_payments()`.
- `docs/audit/cc-phase1a-evidence.md` — final verification note (Task 9).

**Modify**
- `web/admin/index.html` — CSP/anti-framing/noindex/no-store meta; shell markup (nav, top bar, `#view`, env badge); load `admin.js` as the thin entry.
- `web/admin/admin.js` — becomes the thin entry: import `api/ui/shell` + the section registry; `gate()` calls `bootstrap()` and renders "access denied" for non-admins; wires sign-in/out, refresh, search, idle-lock.
- `web/admin/flags.js` / `flags.html` — (Phase 1B restyle) — untouched in 1A except a nav link.
- `supabase/tests/rls_authz_test.sql` — authz assertions for every new RPC.

---

## Task 0: Bootstrap, surface hardening, env badge, runbook

**Files:**
- Create: `supabase/migrations/0115_cc_bootstrap.sql`, `web/admin/DEPLOY.md`
- Modify: `web/admin/index.html`, `supabase/tests/rls_authz_test.sql`
- (admin.js wiring lands in Task 2 once the shell exists; Task 0 ships the RPC + headers + runbook.)

**Interfaces — Produces:**
- `admin_bootstrap() → jsonb` `{ is_admin, email?, environment, spec_version, billing_connected, reauth_required, server_time, capabilities{read,mutate_users,impersonate,financial,flags,config} }` — **returns `{is_admin:false}` for non-admins (never raises).**
- `admin_global_search(p_q text, p_limit int) → table(kind text, id text, label text, sub text)` — Phase 1A wires only `kind='user'` and `kind='audit'`; others land with their sections.
- `admin_audit_search(p_action text, p_actor uuid, p_limit int) → setof admin_audit_log-shaped rows`.

- [ ] **Step 1: Write `0115_cc_bootstrap.sql`**

```sql
-- OnStandard — Command Center Phase 1A: authoritative bootstrap + global search + audit search.
-- admin_bootstrap is the ONLY admin RPC that returns (not raises) for a non-admin, so the client can
-- render a clean "access denied" instead of a broken shell. Everything else keeps the raise-gate.
create or replace function public.admin_bootstrap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean; v_email text;
begin
  v_admin := is_platform_admin();
  if not v_admin then return jsonb_build_object('is_admin', false); end if;
  select email into v_email from profiles where id = auth.uid();
  return jsonb_build_object(
    'is_admin', true,
    'email', v_email,
    'environment', 'production',      -- SYNC: staging/dev override via app_config (Phase 1B)
    'spec_version', 'phase-1a',
    'billing_connected', false,       -- wired in Phase 1B (payments)
    'reauth_required', false,         -- step-up reauth lands in Phase 1B
    'server_time', now(),
    'capabilities', jsonb_build_object(
      'read', true, 'mutate_users', false, 'impersonate', false,
      'financial', false, 'flags', true, 'config', false)
  );
end $$;
grant execute on function public.admin_bootstrap() to authenticated;

-- Global search — Phase 1A supports users + audit; sections add their kinds later.
create or replace function public.admin_global_search(p_q text, p_limit int default 8)
returns table (kind text, id text, label text, sub text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_q is null or length(trim(p_q)) < 2 then return; end if;
  return query
    (select 'user'::text, p.id::text,
            coalesce(nullif(p.full_name,''), p.email, p.id::text),
            p.primary_role::text
     from profiles p
     where p.full_name ilike '%'||p_q||'%' or p.email ilike '%'||p_q||'%' or p.id::text = p_q
     limit greatest(least(p_limit,20),1))
    union all
    (select 'audit'::text, a.id::text, a.action, coalesce(a.target,'')
     from admin_audit_log a
     where a.action ilike '%'||p_q||'%' or a.target ilike '%'||p_q||'%'
     order by a.created_at desc
     limit greatest(least(p_limit,20),1));
end $$;
grant execute on function public.admin_global_search(text, int) to authenticated;

-- Audit search — the Audit Log section's data source (extends admin_recent_audit with filters).
create or replace function public.admin_audit_search(p_action text default null, p_actor uuid default null, p_limit int default 100)
returns table (id bigint, created_at timestamptz, action text, target text, actor_id uuid, before jsonb, after jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select a.id, a.created_at, a.action, a.target, a.actor_id, a.before, a.after
    from admin_audit_log a
    where (p_action is null or a.action ilike '%'||p_action||'%')
      and (p_actor is null or a.actor_id = p_actor)
    order by a.created_at desc
    limit greatest(least(p_limit, 500), 1);
end $$;
grant execute on function public.admin_audit_search(text, uuid, int) to authenticated;
```

- [ ] **Step 2: Add authz assertions to `rls_authz_test.sql`** (follow the existing admin-RPC test block — a non-admin actor + a seeded platform_admin). Assert: a non-admin calling `admin_global_search`/`admin_audit_search` raises `not authorized`; `admin_bootstrap()` returns `is_admin=false` for a non-admin and `true` for the seeded admin.

- [ ] **Step 3: Harden `index.html`** — add inside `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://ftwrvylzoyznhbzhgism.supabase.co https://esm.sh; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'">
<meta name="robots" content="noindex, nofollow">
```
Add a hosting note in `DEPLOY.md` that the host must send `X-Frame-Options: DENY` and `Cache-Control: no-store` (meta cannot set these). Confirm the CSP `connect-src`/`script-src` cover esm.sh + the project URL (pin `@supabase/supabase-js@2` in `api.js`).

- [ ] **Step 4: Write `DEPLOY.md`** — (a) the **first, blocking** step: seed `platform_admins` on prod — `insert into platform_admins(user_id) values ('<founder-uuid>');` via the Supabase SQL editor / service-role; how to find the UUID (`select id,email from profiles where email='…'`). (b) Host options (Cloudflare Pages / Netlify Drop, no build — mirror `web/landing/DEPLOY.md`) with the required response headers (XFO, no-store). (c) CDN dependencies (Google Fonts, esm.sh) + the option to vendor them. (d) The `admin-brief` cron arming steps (`BRIEF_CRON_KEY` + one `schedule_admin_brief` call).

- [ ] **Step 5: Verify + commit** — `npm run test:rls` (green) + `npm run lint:xss`. Commit `git add supabase/migrations/0115_cc_bootstrap.sql supabase/tests/rls_authz_test.sql web/admin/index.html web/admin/DEPLOY.md`.

---

## Task 1: Extract `api.js` + `ui.js` (behavior identical)

**Files:** Create `web/admin/api.js`, `web/admin/ui.js`; Modify `web/admin/admin.js` (import from them; delete the now-moved definitions).

**Interfaces — Produces:**
- `api.js`: `export const sb, SUPABASE_URL, PROJECT_REF, VERSION; export async function rpc(name, args); export async function bootstrap();`
- `ui.js`: `export { h, $, show, num, numN, one, usd2, usd4, pct, ago, iso, todayStr, sparkline, row, card, deltaOf, tbl, openModal, closeModal, toast, badge, emptyState };`

- [ ] **Step 1:** Create `api.js` — move lines `admin.js:5–11` (client + constants) here, add `VERSION='phase-1a'`, pin `@supabase/supabase-js@2`, and move `rpc()` (`admin.js:119–123`); add `bootstrap()` = `rpc('admin_bootstrap')`.
- [ ] **Step 2:** Create `ui.js` — move the helper block (`admin.js:14–114`: `$, show, num, numN, one, usd*, pct, iso, todayStr, ago, h, toast, sparkline, row, card, deltaOf, openModal/closeModal/escClose`) and `tbl()` (`admin.js:382–389`) here verbatim; add small `badge(text, kind)` and `emptyState(text)` helpers used by new sections. `toast/openModal` reference `#toasts`/`#modal-root` — keep those root ids in `index.html`.
- [ ] **Step 3:** Edit `admin.js` to `import { sb, rpc, PROJECT_REF } from './api.js'` and `import { … } from './ui.js'`; delete the moved definitions. No behavior change.
- [ ] **Step 4: Verify** — `npm run lint:xss` (green: the `html`-key no-op stays in `h()`); load `web/admin/index.html` in a browser (or the headless recipe) and confirm Home renders **identically** to before (hero, attention, 7 cards). `npm run verify`.
- [ ] **Step 5: Commit** — `git add web/admin/api.js web/admin/ui.js web/admin/admin.js`.

---

## Task 2: Nav shell + hash router + global-search framework + Home as a section

**Files:** Create `web/admin/shell.js`, `web/admin/sections/home.js`; Modify `web/admin/index.html` (nav + top-bar + `#view` markup), `web/admin/admin.js` (thin entry).

**Interfaces:**
- Each section module exports `export default { id, title, rail, render(view) }` where `render(view)` populates the passed container element and loads its own data.
- `shell.js`: `export function mountShell(sections, ctx)` — builds the left-nav from `sections` grouped by `rail`, wires hash routing (`#/users` → that section's `render`), the top-bar search (calls `admin_global_search`, routes results to `#/<kind>/<id>`), the env badge (from `bootstrap().environment`), identity, a reauth-state chip (inert in 1A), and an idle-lock timer that overlays a "Locked — reauth to continue" screen after 15 min (Phase 1A: lock overlay + `sb.auth` untouched; grants expire in 1B).

- [ ] **Step 1:** `index.html` — replace the single-column `<main class="wrap">` body with: a left `<nav class="rail">` (rail groups: Overview/People/Money & AI/Ops/Trust), a top bar containing the existing brand + a **global search input** + `#envbadge` + identity + Refresh/Sign out, and a `<main id="view" class="wrap">` mount point. Keep `#login`, `#toasts`, `#modal-root`, `#err`. Add CSS for `.rail`, `.rail a`, `.rail .group`, `.rail a.active`, `#envbadge` (pill; `--warn` tint for non-prod), and a responsive collapse (< 900px → top tabs) — all using existing tokens.
- [ ] **Step 2:** `sections/home.js` — move Home render logic (`admin.js:125–380`: `loadAll`, `render`, `renderAttention`, `attnItem`, `setAttn`, `renderPanels`, `linkToSql`, `studioSqlUrl`, `openTopSpenders`, `openAthlete`, `openAsk`, `notify`, `fireNote`, `STATE`) into this module; it imports `api/ui` + `attention.js`; export `{ id:'home', title:'Home', rail:'Overview', render(view){…mount hero+attention+grid into view; run loadAll…} }`. The markup Home needs (hero, attention, grid ids) moves from `index.html` into strings built by `render()` (or a static `home.html` fragment string) so `#view` owns it.
- [ ] **Step 3:** `shell.js` — implement `mountShell`. Registry order defines nav order. Default route `#/home`. Search: debounce 200ms, min 2 chars, dropdown of `admin_global_search` results, Enter/click routes.
- [ ] **Step 4:** `admin.js` — reduce to: imports; `const SECTIONS=[home, users, orgs, revenue, ai, errors, audit]` (add as built — Task 2 ships `[home]`); `gate()`: `const b = await bootstrap(); if(!b.is_admin){ render access-denied; return; } mountShell(SECTIONS, b); startPolling()`; keep sign-in/out/refresh wiring.
- [ ] **Step 5: Verify** — Home works inside the shell identically; nav shows Home; env badge shows "production"; a non-admin session shows "access denied" (test by signing in a non-admin). `npm run verify`.
- [ ] **Step 6: Commit** — `git add web/admin/shell.js web/admin/sections/home.js web/admin/index.html web/admin/admin.js`.

---

## Task 3: Users section (read-only) + minor protections

**Files:** Create `supabase/migrations/0116_cc_users.sql`, `web/admin/sections/users.js`; Modify `rls_authz_test.sql`, `admin.js` (register section), `shell.js` (route `#/user/<id>` → users drill-down).

**Interfaces — Produces:**
- `admin_list_users(p_search text, p_role text, p_status text, p_page int, p_page_size int) → table(user_id uuid, full_name text, email text, primary_role text, is_minor boolean, has_guardian boolean, created_at timestamptz, last_active date, sub_tier text, sub_status text, payment_failed boolean, total_count bigint)` — `p_page_size` capped at 100; **minor email masked**.
- `admin_athlete_profile(p_user uuid)` — **extended** (adds `is_minor`, `has_guardian`, `payment_failed`, `notif_opt_out`, `errors_7d`) and made **volatile** so it audits `user.view_minor_profile` when the target is a minor.

- [ ] **Step 1: Write `0116_cc_users.sql`** — `admin_list_users` (as speced: capped page size, `is_minor(p.id)`, guardian via `guardianships`, minor email masked `regexp_replace(email,'(^.).*(@.*$)','\1***\2')`, `total_count` window, filters on search/role/status, order by `created_at desc`). Then `create or replace admin_athlete_profile` extending the 0113 shape with the new columns; change `stable`→`volatile`; when `is_minor(p_user)` insert `admin_audit_log(actor_id, action, target)` = `(auth.uid(),'user.view_minor_profile', p_user::text)` before `return query`. Grant execute to authenticated.
- [ ] **Step 2:** `rls_authz_test.sql` — assert non-admin `admin_list_users` raises; admin gets rows with `total_count`; a minor row has masked email; reading a minor profile writes exactly one `user.view_minor_profile` audit row.
- [ ] **Step 3:** `sections/users.js` — `render(view)`: a filter bar (search input, role `<select>`, status `<select>`), a paginated `tbl()` of users (name, role + minor/guardian `badge()`, sub tier·status, `payment_failed` warn dot, last active, joined), page controls driven by `total_count`. Row click → `openModal` athlete drill-down reusing the existing `admin_athlete_profile` render (extend with the new fields + a minor/guardian banner). **No action buttons in 1A** (the modal is read-only; "Tag for review" and mutations arrive in 1B). Export `{ id:'users', title:'Users', rail:'People', render }`.
- [ ] **Step 4:** Register `users` in `admin.js` SECTIONS; wire `#/user/<id>` in `shell.js` to open the drill-down.
- [ ] **Step 5: Verify** — `npm run test:rls` + `npm run verify`; live smoke `supabase db query --linked -o table "select user_id,is_minor,has_guardian,sub_status from admin_list_users(null,null,null,0,10);"`; load section, page through, open a profile, confirm minor masking + badges.
- [ ] **Step 6: Commit** — `git add supabase/migrations/0116_cc_users.sql web/admin/sections/users.js web/admin/admin.js web/admin/shell.js supabase/tests/rls_authz_test.sql`.

---

## Task 4: Organizations section (read-only)

**Files:** Create `supabase/migrations/0117_cc_orgs.sql`, `web/admin/sections/orgs.js`; Modify `rls_authz_test.sql`, `admin.js`.

**Interfaces — Produces:**
- `admin_list_orgs(p_search text, p_page int, p_page_size int) → table(org_id uuid, name text, type text, verification_status text, teams bigint, members bigint, staff bigint, created_at timestamptz, total_count bigint)`.
- `admin_org_health(p_org uuid) → table(org_id uuid, name text, type text, verification_status text, teams bigint, members bigint, staff bigint, active_7d bigint, sub_tier text, sub_status text, payment_failed boolean, open_tickets bigint)` — `open_tickets` returns 0 in 1A (support table lands in 1B; keep the column, source it then).

- [ ] **Step 1: Write `0117_cc_orgs.sql`** — both RPCs over `orgs / teams / team_members / team_staff` (and `practices/practice_clients` for independent orgs); `members`/`active_7d` count distinct athletes across the org's teams; **cross-org isolation** = the RPCs aggregate only within `p_org`. Cap page size at 100. `open_tickets` = literal `0::bigint` with a `-- Phase 1B: source from support_tickets` comment.
- [ ] **Step 2:** `rls_authz_test.sql` — non-admin raises; admin gets rows; `admin_org_health` returns a single row for a seeded org.
- [ ] **Step 3:** `sections/orgs.js` — filterable paginated table (name, type, verification `badge()`, teams/members/staff, sub status); row → `admin_org_health` drill-down modal (rollup rows + a "no billing yet" note). Export `{ id:'orgs', title:'Organizations', rail:'People', render }`. Register in `admin.js`.
- [ ] **Step 4: Verify + commit** — `npm run test:rls` + `npm run verify`; live smoke; `git add supabase/migrations/0117_cc_orgs.sql web/admin/sections/orgs.js web/admin/admin.js supabase/tests/rls_authz_test.sql`.

---

## Task 5: Revenue section (truthful, read-only)

**Files:** Create `supabase/migrations/0118_cc_revenue.sql`, `web/admin/sections/revenue.js`; Modify `rls_authz_test.sql`, `admin.js`, `sections/home.js` (point the Home Revenue card at the new metric + relabel).

**Interfaces — Produces:**
- `admin_revenue()` **reworked** → `table(active_subs bigint, team_subs bigint, consumer_subs bigint, seats_used bigint, estimated_subscription_value_usd numeric)` — real prices by `plan_id`/`tier`. (`collected/net/refunds` columns are **added in Phase 1B** with the payments ledger — not faked here.)
- `admin_failed_payments() → table(user_id uuid, tier text, plan_id text, payment_failed_at timestamptz, status text)` — rollup over `subscriptions.payment_failed_at is not null`.

- [ ] **Step 1: Write `0118_cc_revenue.sql`** — `create or replace admin_revenue()` summing a **real price map** over active subs:

```sql
-- Prices SYNC WITH src/core/pricing.ts PLAN_CATALOG. Monthly-equivalent; cadence not stored, so a
-- monthly figure is a documented simplification (annual plans slightly overstated).
create or replace function public.admin_revenue()
returns table (active_subs bigint, team_subs bigint, consumer_subs bigint, seats_used bigint, estimated_subscription_value_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return query
    select
      count(*) filter (where s.status='active')::bigint,
      count(*) filter (where s.status='active' and s.tier='team')::bigint,
      count(*) filter (where s.status='active' and s.tier='consumer')::bigint,
      coalesce(sum(s.seats_used) filter (where s.status='active' and s.tier='team'),0)::bigint,
      round(coalesce(sum(
        case when s.status='active' then case s.plan_id
          when 'individual' then 14.99 when 'individual_plus' then 24.99 when 'family' then 39.99
          when 'pro_solo' then 99 when 'professional' then 179
          when 'org_starter' then 249 when 'org_growth' then 499 when 'org_performance' then 799
          else 0 end
        else 0 end), 0), 2)
    from subscriptions s;
end $$;
grant execute on function public.admin_revenue() to authenticated;
```
Then `admin_failed_payments()` (rows where `payment_failed_at is not null`, newest first, capped 200).

- [ ] **Step 2:** `rls_authz_test.sql` — non-admin raises both; admin gets one revenue row; a seeded active `pro_solo` sub yields `estimated_subscription_value_usd=99`.
- [ ] **Step 3:** `sections/revenue.js` — KPI row: **Estimated subscription value** (big `.sig`, captioned "estimate — from plan prices, not collected"), Active/Team/Consumer subs, Seats. A **"Collected / Net / Refunds"** card rendered as `emptyState("Billing not live — collected revenue appears once billing secrets are set (Phase 1B).")`. A **Failed payments** table from `admin_failed_payments()`. Export `{ id:'revenue', title:'Revenue', rail:'Money & AI', render }`. Register.
- [ ] **Step 4:** `sections/home.js` — Home "Revenue" card: swap `mrr_estimate_usd` → `estimated_subscription_value_usd`; change caption from "MRR · estimate" to "est. subscription value"; update the `$('foot')` copy that says "MRR is a placeholder estimate".
- [ ] **Step 5: Verify + commit** — `npm run test:rls` + `npm run verify`; live smoke `select * from admin_revenue();`; `git add supabase/migrations/0118_cc_revenue.sql web/admin/sections/revenue.js web/admin/sections/home.js web/admin/admin.js supabase/tests/rls_authz_test.sql`.

---

## Task 6: AI Operations section (reuse existing RPCs)

**Files:** Create `web/admin/sections/ai.js`; Modify `admin.js`. **No migration** (reuses `admin_ai_cost`, `admin_ai_cost_by_fn`, `admin_ai_verify`, `admin_system_health`, `admin_meal_quality_metrics`, `admin_top_cost_athletes`).

- [ ] **Step 1:** `sections/ai.js` — `render(view)` loads those RPCs in parallel; renders: cost/meal (big `.sig`) + 7-day avg + month-end `forecast()` + sparkline; cost-by-fn table; verify effectiveness + quality (median delta, text-conflict, correction rate); per-fn ok-rate table; a "Top spenders" drill-down reusing `openTopSpenders`/`openAthlete` moved into `ui.js`-adjacent shared code or imported from `home.js`. **Budgets/rate-limits: `emptyState("Configurable in Phase 1B (typed config).")`** — no writes. Export `{ id:'ai', title:'AI Operations', rail:'Money & AI', render }`. Register.
- [ ] **Step 2: Verify + commit** — `npm run verify`; load section, confirm parity with Home's AI cards; `git add web/admin/sections/ai.js web/admin/admin.js`.

---

## Task 7: Error monitoring section (Bugs & Incidents slice)

**Files:** Create `web/admin/sections/errors.js`; Modify `admin.js`. **No migration** (reuses `admin_event_counts` for `app_error` + `admin_system_health`).

- [ ] **Step 1:** `sections/errors.js` — `app_error` today + 7-day-avg + sparkline (from `admin_event_counts`, same shaping as Home's System-health card); per-fn AI ok-rate table (`admin_system_health`); an **Evidence** button per row copying the `ai_calls?fn=…` / `analytics_events?name=app_error` SQL (reuse `linkToSql`). A **prominent labeled caveat**: `emptyState("Native app crashes are NOT captured (no Sentry/Crashlytics; ErrorBoundary reports nothing). This view understates real crash volume — Phase 2 adds native crash reporting.")`. Export `{ id:'errors', title:'Bugs & Incidents', rail:'Ops', render }`. Register.
- [ ] **Step 2: Verify + commit** — `npm run verify`; `git add web/admin/sections/errors.js web/admin/admin.js`.

---

## Task 8: Audit Log section

**Files:** Create `web/admin/sections/audit.js`; Modify `admin.js`, `shell.js` (route `#/audit/<id>`). Uses `admin_audit_search` (from Task 0).

- [ ] **Step 1:** `sections/audit.js` — filter bar (action contains, actor UUID), table (`ago(created_at)`, action, target, actor short); row click → modal showing `before`/`after` jsonb pretty-printed via `textContent` (`JSON.stringify(…, null, 2)` in a `<pre>` built with `h`). Wire `kind='audit'` search results here. Export `{ id:'audit', title:'Audit Log', rail:'Trust', render }`. Register.
- [ ] **Step 2: Verify + commit** — `npm run verify`; live smoke `select * from admin_audit_search(null,null,20);`; `git add web/admin/sections/audit.js web/admin/admin.js web/admin/shell.js`.

---

## Task 9: Phase 1A verification gate

**Files:** Create `docs/audit/cc-phase1a-evidence.md`.

- [ ] **Step 1:** Run the full suite: `npm run verify` (lint:xss + typecheck + jest + iOS bundle) and `npm run test:rls` — capture the pass counts.
- [ ] **Step 2:** Live-verify each new RPC against the **local** DB (never prod for writes) via `supabase db query`; for a realistic render, follow the memory's temp-admin Playwright recipe (seed a throwaway `platform_admins` row on a **disposable** project, screenshot the shell, then tear down).
- [ ] **Step 3:** Write `docs/audit/cc-phase1a-evidence.md` — per-section: RPCs added, authz test result, live-smoke output, screenshot ref, known gaps (billing not live, native crashes uncaptured, prices monthly-simplified). Note the outstanding founder-ops (seed `platform_admins`, deploy migrations `0115–0118`, host per `DEPLOY.md`).
- [ ] **Step 4: Commit** — `git add docs/audit/cc-phase1a-evidence.md`. **Gate:** do not start Phase 1B until this note exists and both suites are green.

---

## Self-review (spec coverage)
- Bootstrap/env/version/reauth-state/billing-status/capabilities → Task 0 (`admin_bootstrap`). ✅
- Surface hardening (CSP/anti-frame/noindex/no-store/CDN) → Task 0 + `DEPLOY.md`. ✅
- Shared component module + shell + global-search framework (wired per-backend) → Tasks 1–2, 3, 8. ✅
- Users read + minor protections + capped/no-bulk-export → Task 3. ✅
- Orgs + cross-org isolation → Task 4. ✅
- Truthful revenue (separated; estimate labeled; collected/net/refunds deferred not faked) → Task 5 + §8. ✅
- AI ops (reuse) → Task 6. AI budgets deferred to config (1B), labeled. ✅
- Error monitoring + native-crash caveat → Task 7. ✅
- Audit log (append-only enforcement is 1B `0121`; read/search here) → Task 8. ✅
- Verify-and-document gate before 1B → Task 9. ✅
- **Deferred to Phase 1B (own plan):** reauth grants, user mutations + role-change preview, view-as, payments ledger + provider-capability actions, support + safety separation, scoring inspector, typed config + flags restyle, append-only audit trigger, Action Center rule expansion.
