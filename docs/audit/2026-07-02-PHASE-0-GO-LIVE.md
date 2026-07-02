# Phase 0 — Apply-to-Live Runbook (audit fixes, 2026-07-02)

This is the **single source of truth** for landing the Phase 0 audit fixes on the live Supabase
project (`ftwrvylzoyznhbzhgism`). It supersedes the migration/apply instructions in
`START-HERE.md` and `docs/FOUNDER-GO-LIVE-CHECKLIST.md`, both of which predate the live cutover and
are now wrong about what's applied.

Everything below was authored + statically reviewed + typechecked, and the full test suite is green
(1345 tests). **Nothing here has been applied to live** — these are the steps that need your
credentials and a throwaway-DB validation pass first. Do them in order.

> **CONFIRMED LIVE STATE (2026-07-02, via `supabase migration list --linked`):** the ledger is
> **clean — Step 0 needs no repair.** Local and remote match 1:1 through **0033** (both correctly
> skip 0017; there is NO phantom 0017 — the audit's "ledger drift" concern was mistaken). So
> **0001–0033 are applied to live** (including the 0029–0033 security batch the audit thought was
> pending), and **only 0034–0037 are pending** — exactly the Phase 0 + Phase 1 migrations in this
> branch. `supabase db push --dry-run` confirms it would apply 0034 → 0035 → 0036 → 0037 in order.
> **Step 1 (throwaway-DB validation) still MUST run before the push** and needs Docker (not present
> in the authoring env), so it's done on your machine per the commands below.

---

## What changed in this branch (`fix/audit-phase0-live-fixes`)

**Three new migrations** (additive, forward-only — no existing migration was edited):

| File | Closes | What it does |
|------|--------|--------------|
| `0034_team_membership_sync.sql` | Item 1 — coach can't see new athletes | Triggers on `team_members`/`team_staff` mirror active links into `org_memberships` (the table `can_view` reads since the 0012 cutover), + re-runs the idempotent backfill to catch every link made since. |
| `0035_privilege_hardening.sql` | Items 2 & 3 — minor self-consent, notify() forgery | Removes the minor's read of their own consent `token` (column-level) + strips its latent direct-write grant; revokes `EXECUTE` on `notify()` + `backfill_org_memberships_teams()` from app users; flips the default so future functions don't auto-grant `EXECUTE`. |
| `0036_fix_table_grants.sql` | Item 4a — mark-as-read broken on live | Grants the `UPDATE/DELETE` (notifications) and `INSERT/UPDATE/DELETE` (meal_plans tables) that the RLS policies promise but 0027/0032 never granted after 0013's default revoke. |

**Code changes (no DB):**
- `supabase/functions/plan-generate/index.ts` (Item 4b) — added the global + anon-per-IP spend caps it was missing (sharing analyze-meal's counters for one unified daily bill), bumped `max_tokens` 2048→4096 with an explicit truncation check, and stopped leaking `String(e)` (now logs server-side, returns a generic message). **Redeploy required** (see step 4).
- `src/lib/ai/*`, `src/store/useStore.ts`, `src/screens/overlays/MealCapture.tsx`, `src/core/types.ts` (Item 5) — a configured AI failure (incl. the daily cap) now shows an honest "couldn't analyze" state that never fabricates a plate/label. Ships with the next app build; no live action.

---

## Step 0 — Reconcile the migration ledger FIRST (Item 6)

The repo's migration numbers drifted from live: local files jump 0016→0018 (no 0017), and three
renumber collisions happened (git: `638ff3c`, `f06a30e`, `722535c`). Before pushing anything, find
out exactly what live has:

```bash
supabase link --project-ref ftwrvylzoyznhbzhgism      # if not already linked
supabase migration list                                # local vs remote, side by side
```

- If a remote version has **no local file** (e.g. a live `0017`), or a local file is marked applied
  that you don't recognize, resolve it with `supabase migration repair --status <applied|reverted> <version>`
  until `migration list` shows local and remote agreeing on everything through `0033`.
- **Do not** `db push` until that list is clean, or the push ordering is unpredictable.
- Record the reconciled applied-set at the bottom of this file so the next person has one truth.

> Forward policy: adopt timestamp-prefixed migration names (`supabase migration new <name>`) from
> here on to end the renumber collisions. 0034–0036 keep the sequential scheme to stay adjacent to
> 0033; number the next new one by timestamp.

## Step 1 — Validate 0034–0036 on a throwaway Postgres

I could not run these locally (no Docker/psql in the authoring environment). Validate before live:

```bash
# with Docker available:
supabase start                     # local stack
supabase db reset                  # applies ALL migrations 0001..0036 from scratch
```
`db reset` applying cleanly is the primary check (it exercises the whole chain, incl. the 0034
triggers firing on the seed and the 0035/0036 grant/revoke statements). Then sanity-check the
invariants in Step 3 against the local DB before touching live.

## Step 2 — Apply to live (after Step 0 is clean and Step 1 passed)

```bash
supabase db push        # applies 0034 → 0035 → 0036 in order
```

## Step 3 — Verify the fixes on live

Run this block in the Supabase **SQL editor** (as `postgres`) right after the push — it checks the
`authenticated` role's exact grants + the new objects, so you don't need a second test account:

```sql
-- Item 1 — coach visibility: the sync triggers exist, and the re-backfill populated memberships.
select tgname from pg_trigger
 where tgrelid = 'public.team_members'::regclass and not tgisinternal;   -- expect trg_team_member_membership
select count(*) as active_team_memberships from org_memberships
 where role = 'athlete' and scope_kind = 'group' and status = 'active';  -- expect > 0 if any active team links exist

-- Item 2 — a minor can no longer read their own consent token; status stays readable.
select has_column_privilege('authenticated','public.guardian_consent_requests','token','SELECT')  as token_readable,  -- expect FALSE
       has_column_privilege('authenticated','public.guardian_consent_requests','status','SELECT') as status_readable; -- expect TRUE

-- Item 3 — notify() is no longer callable by app users (triggers still run; they're definer).
select has_function_privilege('authenticated','public.notify(uuid,text,text,text)','EXECUTE') as notify_callable; -- expect FALSE

-- Item 4a — the grants the RLS policies promised now exist.
select has_table_privilege('authenticated','public.notifications','UPDATE') as notif_update,  -- expect TRUE
       has_table_privilege('authenticated','public.meal_plans','INSERT')    as plans_insert;  -- expect TRUE

-- Item 8 — analytics is live (seed yourself first: insert into platform_admins(user_id) values ('<your-uuid>');)
-- select * from admin_overview();
```

Then confirm behavior end-to-end: join a team from a second account and check the coach's roster shows
that athlete's day (Item 1), and mark a notification read in the app — it persists, no 42501 (Item 4a).
Item 4b is covered by the Step 4 redeploy.

## Step 4 — Redeploy the AI edge functions

`plan-generate` code changed, and the spend caps only bite once the functions run migration 0030's
`claim_ai_usage_key` (make sure 0030 is applied — it's in the 0029–0033 batch):

```bash
supabase functions deploy plan-generate
supabase functions deploy analyze-meal      # if 0030 was just applied, redeploy so its caps engage
supabase functions deploy assist            # same
```
Confirm the caps: an anon-key call to `plan-generate` past the per-IP daily cap returns 429.

---

---

# Phase 1 — Measure & monetize (code-shaped items #8, #9)

Both are **backend-only** (no app change): analytics aggregates data already collected, and the
Stripe seam only writes the `subscriptions` row the client already reads.

## #8 — Founder analytics (migration `0037_analytics.sql`)

Answers "how many athletes logged today?" with an admin-gated, PII-free set of RPCs over existing
`days`/`meals` data. After applying (with the Phase 0 batch):

```sql
-- one-time: make yourself a platform admin (find your id in Auth → Users)
insert into platform_admins (user_id) values ('<your-profile-uuid>');
-- then, any time:
select * from admin_overview();            -- totals + active today/7d + new-7d
select * from admin_daily_activity(30);    -- per-day active/scored/meal-loggers + avg score
```
Run these from the Supabase SQL editor or a service-role script. An in-app admin dashboard can be
built on these RPCs later; the data question is answerable now.

**Crash/error reporting (Sentry) — deferred to the EAS build, on purpose.** Sentry needs the native
SDK + a config plugin + a real device build to report anything, none of which exist or can be tested
until the EAS build (Phase 1 #7). Add `@sentry/react-native` + `sentry-expo` when you cut that
build; wiring it before then reports nothing. The daily-actives view above is the half that delivers
value today.

## #9 — Stripe first dollar (`supabase/functions/stripe-webhook`)

The webhook that turns a payment into an entitlement. Steps:

1. **Deploy it** (JWT off — Stripe authenticates via signature, not a Supabase JWT):
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
2. **Create the webhook in Stripe** → endpoint `<project>/functions/v1/stripe-webhook`, events:
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET` (step 1).
3. **Create a Payment Link** for the Starter tier (a recurring per-seat price). **Critical:** the
   coach's OnStandard profile id must ride along as `client_reference_id` — that's how a payment maps
   to an owner. For a shared Payment Link, append `?client_reference_id=<ownerId>` when you send it;
   for a per-coach Checkout Session, set it in the session. A payment with no valid owner id is
   acknowledged and logged, never guessed.
4. **Set the portal URL** so "Manage / cancel" works: `EXPO_PUBLIC_BILLING_PORTAL_URL=<stripe billing
   portal link>` (the client seam `src/lib/billing/portal.ts` is already wired to it).
5. **Verify:** run a test-mode checkout → the owner's `subscriptions` row flips to
   `tier='team', status='active'` with the seat count and period end; cancel → `status='canceled'`.

Because the wedge is B2B off-platform, this is the whole path to first dollar — Apple IAP/RevenueCat
is not needed until the consumer Individual tier ships.

> Note: `deno check` flags a pre-existing readonly-vs-mutable type nit on `PLAN_TOOL`/`MEAL_TOOL`
> (`as const` tool schemas) in the AI functions — harmless at runtime, present before this work, and
> outside the project's `tsc` scope. Clean up opportunistically, not as a blocker.

---

## Deferred (needs a live/throwaway DB to do safely — do NOT guess these)

1. **Deeper function-EXECUTE lockdown.** 0035 only revokes the two provably-safe helpers. Many
   functions (`is_minor`, `team_head_coach_name`, `is_org_admin`, the `is_*` predicates) are lower-
   value to lock but should be reviewed. **Risk:** several `is_*` functions are evaluated inside RLS
   policies, where the querying role MUST keep `EXECUTE` or every governed query breaks — so each
   revoke must be verified against a real DB (spin up `supabase start`, revoke, run the app's read
   paths). This is why it wasn't done blind here.
2. **Score server-authority (audit item 15).** `days.score` is still client-written and now feeds
   trust-pass eligibility. Near-term slice: compute eligibility from photo-bearing `meals` rows.
3. **Self-attested minor age.** `athlete_profiles.base_age` is athlete-writable and is the entire
   minor-safety keystone — make an explicit risk-acceptance decision (COPPA).
4. **meal_plans write path.** 0036 grants the DML the policies imply; when the coach editor's direct
   writes are actually wired, confirm the columns/flow match before flipping `isMealPlansEnabled`.

## Reconciled applied-set (fill in after Step 0)

> _Record here what `supabase migration list` shows as applied on live, once reconciled._
