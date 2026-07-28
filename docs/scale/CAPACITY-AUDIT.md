# OnStandard — Capacity Audit (10k / 50k / 100k users)

**Date:** 2026-07-23 · **Branch:** `feat/founder-command-center` · **Method:** static read of `supabase/migrations/**`, `supabase/functions/**`, and the proto client data layer. No DB was queried; all row-count and latency figures are marked `[estimate]`.

---

## 1. Verdict

**The first thing that breaks is not the database — it is the global AI spend cap, and it breaks at roughly 5,000–6,000 registered users, well before 10k.** `GLOBAL_ANALYSIS_CAP` defaults to 5,000 paid photo analyses per day platform-wide and is claimed with `failOpen: false` ([analyze-meal/index.ts:77](../../supabase/functions/analyze-meal/index.ts#L77), [:782](../../supabase/functions/analyze-meal/index.ts#L782)). At ~3 meals per active user per day that ceiling is exhausted by ~1,700 daily-active athletes — roughly 5–6k registered at a 30% DAU ratio `[estimate]`. Once the counter trips, **every** athlete on the platform gets `429 service at capacity` for the remainder of the UTC day, and the counter is not timezone-aware, so West Coast users would routinely find meal logging dead by mid-afternoon. Meal logging is the product's core loop; this is a total outage, not a degradation.

Immediately behind it, at roughly 20k–40k registered users, sits the second wall: **the coach dashboard executes two unindexed sequential scans with an un-inlinable per-row RLS function on top**. `fetchLinkedDaysSince` queries `days` filtered only on `date` ([roles.js:29](../../proto/redesign-2026-07/js/roles.js#L29)) but the only index is `days(athlete_id, date desc)` ([0001_schema.sql:152](../../supabase/migrations/0001_schema.sql#L152)), and `can_view()` is `SECURITY DEFINER` ([0081_guardian_scoped_access.sql:27](../../supabase/migrations/0081_guardian_scoped_access.sql#L27)) so Postgres cannot inline it into a join — it is a black-box function call evaluated per candidate row, and in its current form it is five helpers deep.

Third, and the most dangerous because it is *silent*: `weekly-digest` reads four whole tables with no filter and no pagination ([weekly-digest/index.ts:100-105](../../supabase/functions/weekly-digest/index.ts#L100-L105)) against a PostgREST `max_rows = 1000` ceiling ([config.toml](../../supabase/config.toml)). Past 1,000 teams, most coaches stop receiving their digest and nothing logs an error.

Fourth, on the **athlete** hot path rather than the coach one: every athlete app-open resolves their team standard through `requirement_sets`, whose only index is an *expression* index on `coalesce(team_id, practice_id)` — both plain column indexes were explicitly dropped ([0136:98-99](../../supabase/migrations/0136_practice_operator_parity.sql#L98-L99)), so `where team_id = $1` cannot use it. App-open also calls `ensure_commitment_instances`, a nested `for`/`while` loop that re-expands the full team roster three times per instance ([0141:63](../../supabase/migrations/0141_commitment_production.sql#L63)).

Nothing found here is architecturally fatal. The schema is well-organised, the data layer is RPC-first, there are no realtime subscriptions, and the per-user spend caps are correctly built. The failures cluster into six fixes, four of which are hours of work. The recurring theme is that **almost every hot query is missing exactly one index, and the ones that are indexed are queried on a different column than the index leads with.**

---

## 2. Breaking-point table

| # | Finding | File:line | Breaks at (~users) | Symptom | Sev | Effort |
|---|---------|-----------|--------------------|---------|-----|--------|
| 1 | Global AI cap 5,000/day, fails closed platform-wide | [analyze-meal/index.ts:77,782](../../supabase/functions/analyze-meal/index.ts#L77) | **~5k registered** | Every user gets `429 service at capacity`; meal logging dead until UTC midnight | **P0** | S |
| 2 | Same fail-closed global cap in `assist` (5k), `meal-chat` (2k), `coach-voice-nudge` (5k) | [assist:30](../../supabase/functions/assist/index.ts#L30), [meal-chat:27](../../supabase/functions/meal-chat/index.ts#L27), [coach-voice-nudge:36](../../supabase/functions/coach-voice-nudge/index.ts#L36) | ~5k–10k | Coach voice, chat and assist silently go dark mid-day | **P0** | S |
| 3 | `weekly-digest` reads 4 whole tables unfiltered; `max_rows=1000` truncates silently | [weekly-digest:100-105](../../supabase/functions/weekly-digest/index.ts#L100-L105) | **~1k teams** | Most coaches stop getting digests; no error, no log | **P0** | M |
| 4 | `days` has no index on `date`; coach roster scans the whole table | [roles.js:29](../../proto/redesign-2026-07/js/roles.js#L29) + [0001_schema.sql:152](../../supabase/migrations/0001_schema.sql#L152) | ~20k–40k | Coach dashboard takes 5s → 30s → statement timeout | **P0** | S |
| 5 | `can_view()` is `SECURITY DEFINER` and five helpers deep — un-inlinable, per-row | [0081:27](../../supabase/migrations/0081_guardian_scoped_access.sql#L27), [0078:38](../../supabase/migrations/0078_coach_os_slice_f.sql#L38), [0011:91](../../supabase/migrations/0011_org_memberships.sql#L91) | ~20k–40k | Multiplies #4/#6 by 5+ subqueries, a string-split and an array-contains per row | **P0** | M |
| 6 | `meals` has no index on `day_date`/`logged_at`; coach activity feed scans + sorts whole table | [roles.js:146-151](../../proto/redesign-2026-07/js/roles.js#L146-L151) + [0001:172](../../supabase/migrations/0001_schema.sql#L172) | ~20k–40k | Same load path as #4; adds a large disk sort | **P0** | S |
| 7 | `weekly-digest` `.in('athlete_id', allAthletes)` with every athlete on the platform | [weekly-digest:140-141](../../supabase/functions/weekly-digest/index.ts#L140-L141) | ~30k | Multi-MB request URI → 414 / PostgREST reject; then Deno isolate OOM holding all rows | **P0** | M |
| 8 | `max_rows=1000` truncates claim-RPC results → rows marked claimed but never delivered | [0140:166-203](../../supabase/migrations/0140_commitment_reliability.sql#L166-L203), [commitment-reminders:66](../../supabase/functions/commitment-reminders/index.ts#L66) | ~15k–25k | Athletes silently get no roll-call reminder, permanently | **P0** | S |
| 9 | `commitment-reminders` serial RPC loop, one round trip per due reminder | [commitment-reminders:75-80](../../supabase/functions/commitment-reminders/index.ts#L75-L80) | ~25k | 5-min cron exceeds edge-function wall clock; reminders stop | **P1** | M |
| 10 | `claim_ai_usage_key` global counter = one hot row locked by every paid call | [0030:44-66](../../supabase/migrations/0030_ai_spend_guard.sql#L44) | ~50k | Lock-wait queue on every AI call; latency spikes under burst | **P1** | M |
| 11 | Projected Anthropic spend crosses the per-seat revenue floor | §5 below | ~50k | Gross margin inverts on Solo/Pro tiers | **P1** | M |
| 12 | Retention job never armed; delete is unbatched and unindexed | [0066:16,30](../../supabase/migrations/0066_data_retention.sql#L16) + [0052:25](../../supabase/migrations/0052_analytics_events.sql#L25) | ~50k | `analytics_events` grows unbounded; first purge locks the table for minutes | **P1** | S |
| 13 | `ai_calls`, `ai_usage_key_daily`, `notifications` have no retention at all | [0105:30](../../supabase/migrations/0105_ai_calls.sql#L30), [0030:27](../../supabase/migrations/0030_ai_spend_guard.sql#L27), [0027:19](../../supabase/migrations/0027_notifications.sql#L19) | ~50k–100k | Storage and index bloat; `ai_call_costs` view slows | **P1** | S |
| 14 | `commitment-escalation` serial loop: RPC + query + push per instance | [commitment-escalation:111-127](../../supabase/functions/commitment-escalation/index.ts#L111-L127) | ~50k | Escalation ladder times out at peak roll-call windows | **P1** | M |
| 15 | `admin-brief` uses `count: 'exact'` on `days` and `meals` | [admin-brief:24-33](../../supabase/functions/admin-brief/index.ts#L24-L33) | ~100k | Daily full scan of the two largest tables | **P2** | S |
| 16 | No Expo push receipt handling; dead tokens never pruned | [commitment-reminders:120-131](../../supabase/functions/commitment-reminders/index.ts#L120-L131), [weekly-digest:169-175](../../supabase/functions/weekly-digest/index.ts#L169-L175) | ~50k | `device_tokens` fills with dead tokens; push batches grow, delivery rate falls | **P2** | M |
| 17 | In-memory rate limiters are per-isolate and never evicted | 19 functions, e.g. [analyze-meal:217](../../supabase/functions/analyze-meal/index.ts#L217) | ~50k | Rate limiting becomes decorative; `Map` grows until isolate recycles | **P2** | M |
| 18 | `auth.getUser()` network round trip on every request in 19 functions | e.g. [coach-voice-nudge:60-72](../../supabase/functions/coach-voice-nudge/index.ts#L60-L72) | ~100k | +50–150ms per call `[estimate]`; GoTrue becomes a shared bottleneck | **P2** | S |
| 19 | Coach roster fans out one RPC per team/practice | [roles.js:1364-1365](../../proto/redesign-2026-07/js/roles.js#L1364-L1365) | ~100k | Multi-team org admins issue N concurrent RPCs on dashboard open | **P2** | S |
| 20 | `requirement_sets` has no usable `team_id`/`practice_id` index — only an expression index | [0136:98-100](../../supabase/migrations/0136_practice_operator_parity.sql#L98-L100) | **~30k** | Every athlete app-open seq-scans the standards table | **P0** | S |
| 21 | `ensure_commitment_instances` is a nested loop calling `commitment_audience()` 3× per instance | [0141:63](../../supabase/migrations/0141_commitment_production.sql#L63) | ~30k | Athlete app-open stalls; advisory lock serialises concurrent opens per team | **P0** | M |
| 22 | AI cost views have no date predicate; `admin_ai_cost` filters *after* aggregation | [0106:34,51](../../supabase/migrations/0106_ai_calls_outcome.sql#L34), [0111:14,47](../../supabase/migrations/0111_admin_center_rpcs.sql#L14) | ~25k | Command Center scans all of `ai_calls` with a per-row LATERAL join; times out | **P1** | S |
| 23 | `admin_daily_activity` runs 4 correlated subqueries × 30 days over `days`+`meals` | [0037:42](../../supabase/migrations/0037_analytics.sql#L42) | ~15k | ~120 full scans per Command Center load | **P1** | M |
| 24 | `team_day_rollup` / `intervention_outcomes` run correlated subqueries per athlete per day | [0076:36,73](../../supabase/migrations/0076_team_insights.sql#L36), [0137:23,63](../../supabase/migrations/0137_practice_insights.sql#L23) | ~40k | Coach Insights tab degrades O(athletes × days) | **P1** | M |
| 25 | `export_account_data()` `jsonb_agg`s every row a user ever wrote, no LIMIT | [0065:20](../../supabase/migrations/0065_export_account_data.sql#L20) | age-driven, ~2yr history | GDPR data export OOMs / times out — a legal obligation silently unmet | **P1** | M |
| 26 | ~45 foreign-key columns unindexed, incl. `practices.owner_id` which gates every trainer policy | [0001:32](../../supabase/migrations/0001_schema.sql#L32) + §3 list | ~40k | Trainer-side policy scans; account erasure scans every child table | **P1** | S |
| 27 | `activity_log` and `copilot_artifacts` have zero indexes but RLS filters `actor_id`/`author_id` | [0018:16,32](../../supabase/migrations/0018_copilot.sql#L16) | ~40k | Seq scan on every read of a growing table | **P1** | S |
| 28 | `admin_detect_login_anomalies` runs 3 unindexed `NOT EXISTS` over full login history | [0131:94](../../supabase/migrations/0131_admin_auth_monitor.sql#L94) | ~50k admin logins | Login latency grows with that admin's own history | **P2** | S |
| 29 | `grant_trust_pass` counts qualifying `days` over the athlete's lifetime, no date bound | [0099:18](../../supabase/migrations/0099_trust_pass_policy.sql#L18) | age-driven | Trust-pass grant slows as accounts age | **P2** | S |
| 30 | `performance_profiles.feedback_log` is an append-only jsonb array inside one row | [0020:14](../../supabase/migrations/0020_performance_profiles.sql#L14) | age-driven | Single-row TOAST bloat; whole array rewritten on every append | **P2** | S |
| 31 | ~24 growing tables have no retention policy at all | §3 F13 | ~50k–100k | Storage and index bloat across the schema | **P1** | M |

---

## 3. Findings

### Area 4 — AI spend as a capacity limit *(most severe)*

#### F1 (P0) — The global AI cap turns into a platform-wide outage, not a cost guard

[analyze-meal/index.ts:77](../../supabase/functions/analyze-meal/index.ts#L77) sets `GLOBAL_CAP = posIntCap('GLOBAL_ANALYSIS_CAP', 5000)` and [:782](../../supabase/functions/analyze-meal/index.ts#L782) claims it with `failOpen: false`:

```ts
if (!(await withinKeyCap('global', GLOBAL_CAP, /* failOpen */ false))) {
```

**Why it degrades.** The counter is a single platform-wide integer per UTC day ([0030](../../supabase/migrations/0030_ai_spend_guard.sql)). It does not scale with user count, it is not per-tenant, and it fails closed. At ~3 meals/active user/day, 5,000 analyses supports ~1,667 DAU. Beyond that the *entire* user base — including paying subscribers — loses meal analysis until UTC midnight. Because the reset is at UTC midnight rather than local midnight, US users would burn the day's budget before their own evening meal.

This was designed as a bill backstop against anon-key abuse, and for that it is correct. As a capacity control it is exactly inverted: the users who suffer are the paying ones, and there is no signal to the founder that it happened beyond a counter row.

**The fix.**
1. Make the global cap a function of paying seats, not a constant — e.g. `seats × 6` recomputed nightly — so it can never bind on legitimate traffic.
2. Split the counter: `global_anon` (fails closed, keeps the abuse guard) and `global_authed` (alerts but fails **open** for users with an active subscription). A paying athlete must never be denied by a bill guard; that is a billing decision, not a runtime one.
3. Emit an `admin-alert` when either counter crosses 80% so the ceiling is visible before it bites.

#### F2 (P0) — The same fail-closed pattern in three more functions

`ASSIST_GLOBAL_CAP` 5,000 ([assist:30](../../supabase/functions/assist/index.ts#L30)), `MEAL_CHAT_GLOBAL_CAP` 2,000 ([meal-chat:27](../../supabase/functions/meal-chat/index.ts#L27)), `VOICE_GLOBAL_CAP` 5,000 ([coach-voice-nudge:36](../../supabase/functions/coach-voice-nudge/index.ts#L36)). Same shape, same failure. `meal-chat` at 2,000/day is the tightest — it binds around 3–4k registered users `[estimate]`.

**The fix.** Same as F1, applied uniformly. These four constants are the single highest-leverage change in this document.

#### F11 (P1) — Projected Anthropic spend vs. the revenue floor

Per meal analysis, using the code's actual shape (Sonnet 5, image + cached system/tool, `max_tokens: 1024`) and the seeded intro prices in [0105:66](../../supabase/migrations/0105_ai_calls.sql#L66) ($2/$10/$2.50/$0.20 per Mtok):

| Component | Tokens `[estimate]` | Rate | Cost |
|---|---|---|---|
| Image + user text (uncached input) | ~1,500 | $2.00/Mtok | $0.0030 |
| System + tool schema (cache read) | ~2,000 | $0.20/Mtok | $0.0004 |
| Output | ~600 | $10.00/Mtok | $0.0060 |
| **Per analysis** | | | **≈ $0.0094** |

At ~3 meals/day plus the gated verify second pass ([analyze-meal:880](../../supabase/functions/analyze-meal/index.ts#L880), ~20% trigger rate `[estimate]`), plus assist / voice-nudge / plan-generate / deep-analysis / monthly-report, a realistic blended figure is **$1.30–$2.00 per active user per month** `[estimate]`.

| Registered | DAU @ 30% `[estimate]` | Monthly AI spend `[estimate]` |
|---|---|---|
| 10,000 | 3,000 | $4,500 – $6,000 |
| 50,000 | 15,000 | $22,000 – $30,000 |
| 100,000 | 30,000 | $45,000 – $60,000 |

This lands squarely on the ~$2/user AI cost floor already recorded against `pricing.ts`. **Note the interaction with F1:** these numbers are what the platform *would* spend. Today it cannot, because the global cap stops it at ~$50/day. Removing the cap without a per-tier budget replaces an availability problem with a margin problem. Both fixes must ship together.

**The fix.** Per-tier monthly AI budgets enforced through the existing `claim_ai_usage_key` mechanism, keyed `tier_budget:<user>:<month>`, sized from the tier's price. Prefer Haiku 4.5 for the regen/memory/order paths already using `TEXT_MODEL` — those are prose rewrites where Sonnet is over-specified and Haiku is 5× cheaper on output.

#### F10 (P1) — Hot-row lock on the global counter

[0030:50-58](../../supabase/migrations/0030_ai_spend_guard.sql#L50) increments a single row `(key='global', day=current_date)` with `update ... set count = count + 1`. Every concurrent paid call takes a row-exclusive lock on that one tuple and serializes behind it. Under burst (a team's post-practice meal logging), lock-wait dominates.

**The fix.** Shard the global counter across N=16 keys (`global:<hash(uid) % 16>`) with `limit = GLOBAL_CAP / 16`, or move the backstop to an approximate hourly window that tolerates drift. A bill guard does not need to be exact to the single call.

---

### Area 2 — RLS cost

#### F5 (P0) — `can_view()` cannot be inlined, so it runs per row

`can_view` has been redefined six times (0002 → 0012 → 0013 → 0050 → 0078 → 0081). The current definition is [0081_guardian_scoped_access.sql:27](../../supabase/migrations/0081_guardian_scoped_access.sql#L27), and it is materially more expensive than the 0013 version:

```
can_view(athlete) =
  is_self
  OR ( (can_view_via_memberships AND NOT staff_scope_blocks) OR is_trainer_of )
     AND (NOT is_provable_minor OR has_verified_guardian_consent)
```

It gates `days`, `meals`, `checkins`, `athlete_profiles` ([0002_rls.sql:89-104](../../supabase/migrations/0002_rls.sql#L89-L104)), storage objects ([0003:12](../../supabase/migrations/0003_storage.sql#L12), [0133:12](../../supabase/migrations/0133_progress_photos.sql#L12)), `meal_comments`, `training_logs`, `progress_photos`, `dietary_restrictions`, `performance_profiles`, `athlete_memory_facts` and `plan_style_events`.

**Why it degrades.** Postgres will not inline a `SECURITY DEFINER` function — that is the point of the security barrier. The planner cannot rewrite these into semi-joins; it calls the function once per candidate row. Each call fans out to five helpers:

| Helper | Cost per call |
|---|---|
| `can_view_via_memberships` ([0011:91](../../supabase/migrations/0011_org_memberships.sql#L91)) | `EXISTS` over `org_memberships` containing a **nested** `EXISTS` over `org_memberships` + `scope_contains()` — a correlated self-join |
| `staff_scope_blocks` ([0078:38](../../supabase/migrations/0078_coach_os_slice_f.sql#L38)) | `EXISTS(team_staff ⋈ team_members)` AND `NOT EXISTS(team_staff ⋈ team_members` with `unnest(string_to_array(...))` AND a third `EXISTS` over `coach_groups)` — **3 joins, a string split and an array scan** |
| `is_trainer_of` ([0002:50](../../supabase/migrations/0002_rls.sql#L50)) | `EXISTS` on `practice_clients` / `practices` — and `practices.owner_id` is **unindexed** (F26) |
| `is_provable_minor` ([0050:37](../../supabase/migrations/0050_minor_consent_enforcement.sql#L37)) | `EXISTS` on `profiles` |
| `has_verified_guardian_consent` ([0050:46](../../supabase/migrations/0050_minor_consent_enforcement.sql#L46)) | `EXISTS` on `guardian_consent_requests` |

`staff_scope_blocks` is the sharpest edge: parsing a delimited string and scanning an array, inside a `NOT EXISTS`, evaluated per row.

For queries that already filter by `athlete_id` this is acceptable — the row count is small. It becomes lethal only in combination with F4 and F6, where the candidate row set is the whole table. **That is why the fix order matters: indexes first, RLS second.**

**The fix.** Two options, in order of preference:
1. **Cheapest and safest:** fix F4/F6 first. Correct indexes shrink the candidate set to the coach's own athletes, and the per-row cost stops mattering. Do this before touching the security model.
2. If profiling after (1) still shows RLS dominating: add a `viewer_id → athlete_id` materialized edge table maintained by trigger, index it, and make `can_view` a single indexed lookup against it. This preserves the security barrier while collapsing 3 subqueries into one probe. **Do not** drop `SECURITY DEFINER` to gain inlining — the barrier is load-bearing for the recursion fix in [0013:99](../../supabase/migrations/0013_security_hardening.sql#L99).

---

### Area 1 — Database

#### F4 (P0) — `days` is scanned end-to-end on every coach dashboard load

[roles.js:27-30](../../proto/redesign-2026-07/js/roles.js#L27-L30):

```js
export async function fetchLinkedDaysSince(sinceISO) {
  const c = sb(); if (!c) return [];
  try { const { data } = await c.from('days').select('athlete_id,date,score,grade,tasks').gte('date', sinceISO).limit(2000); return data || []; } catch { return []; }
}
```

The only index on `days` is `days_athlete_date on days(athlete_id, date desc)` ([0001_schema.sql:152](../../supabase/migrations/0001_schema.sql#L152)). Because `athlete_id` is the leading column and this query has no `athlete_id` predicate, that index is unusable. Postgres sequentially scans `days`, applies `date >= X`, then evaluates `can_view(athlete_id)` (F5) on each survivor.

**Why it degrades.** `days` grows one row per active user per day — the fastest-growing table in the schema. The `.limit(2000)` does not save the query: a coach with 30 athletes has only ~210 visible rows in a 7-day window, so the limit is *never reached* and the scan runs to completion every time.

| Registered `[estimate]` | Rows in 7-day window | Coach dashboard load |
|---|---|---|
| 10,000 | ~21,000 | tolerable, ~0.5s |
| 40,000 | ~84,000 | ~3–8s, users complain |
| 100,000 | ~210,000 | statement timeout |

There is a second, quieter bug here: `.limit(2000)` means a large org's roster data is **silently truncated** rather than paginated. Sparklines and scores go missing with no error.

**The fix.**
```sql
create index concurrently days_date_athlete on days (date desc, athlete_id);
```
and change the client to pass the roster's athlete ids explicitly: `.in('athlete_id', athleteIds).gte('date', sinceISO)`. The ids are already known — [roles.js:1372](../../proto/redesign-2026-07/js/roles.js#L1372) computes `athleteIdsOf(perTeam)` immediately after. Reordering so the roster resolves first makes the existing `days_athlete_date` index a perfect match and removes the need for a new index entirely. That is the better fix: **no migration, one client change.**

#### F6 (P0) — `meals` scanned and sorted on the same load

[roles.js:146-154](../../proto/redesign-2026-07/js/roles.js#L146-L154) runs `.gte('day_date', sinceISO).order('logged_at', { ascending: false }).limit(400)`. Only index is `meals_athlete_day on meals(athlete_id, day_date desc)` ([0001:172](../../supabase/migrations/0001_schema.sql#L172)) — again unusable without an `athlete_id` predicate. Worse than F4: the `order by logged_at` forces a full sort of every row in the 2-day window before the limit applies, and `meals` grows ~3× faster than `days`.

**The fix.** Identical: pass `.in('athlete_id', athleteIds)`. Same reordering, same commit.

#### F20 (P0) — Every athlete app-open seq-scans `requirement_sets`

The only index on `requirement_sets` is `requirement_sets_unique_scope_version on (coalesce(team_id, practice_id), scope_kind, ...)` ([0136:100](../../supabase/migrations/0136_practice_operator_parity.sql#L100)). It is an **expression** index, so a predicate of the form `where team_id = $1` cannot use it. Both plain-column variants that would have worked were explicitly dropped — [0085:16](../../supabase/migrations/0085_requirement_sets_versioning.sql#L16) and [0136:98-99](../../supabase/migrations/0136_practice_operator_parity.sql#L98-L99).

**Why it degrades.** Standards resolution runs on every athlete app-open (it decides what the athlete's day looks like). `requirement_sets` accumulates one row per team per scope per version, so it grows with teams × edits — at 4,000 teams with a handful of versions each that is tens of thousands of rows, seq-scanned on every open, by every user. It also carries an `EXISTS`-over-`team_members` RLS policy ([0055:82](../../supabase/migrations/0055_requirements_engine.sql#L82), [0136:201](../../supabase/migrations/0136_practice_operator_parity.sql#L201)) evaluated per scanned row.

**The fix.** Two indexes, no code change, no risk:
```sql
create index concurrently req_sets_team     on requirement_sets (team_id)     where team_id is not null;
create index concurrently req_sets_practice on requirement_sets (practice_id) where practice_id is not null;
```
This is the single cheapest high-impact fix in the audit. Check git history before applying — the drops in 0085/0136 were deliberate, so confirm they were removing genuine duplicates rather than working around a constraint.

#### F21 (P0) — `ensure_commitment_instances` is a nested loop on the app-open path

[0141_commitment_production.sql:63](../../supabase/migrations/0141_commitment_production.sql#L63) is called from the client on app open ([commitment-data.js:66](../../proto/redesign-2026-07/js/commitment-data.js#L66), [:154](../../proto/redesign-2026-07/js/commitment-data.js#L154)). Its structure:

```
for c in (select * from commitments ...) loop
  while d <= v_last loop            -- up to 62 days
     ... commitment_audience(c.id)  -- called 3× per iteration
     ... update athlete_exceptions  -- join on an UNINDEXED athlete_id
  end loop
end loop
```

`commitment_audience()` ([0138:360](../../supabase/migrations/0138_verified_commitments.sql#L360)) is a `setof uuid` function that expands the entire team/room/group roster, and it is re-evaluated rather than materialised — three times per instance, per day, per commitment. `athlete_exceptions.athlete_id` has no index ([0071:52](../../supabase/migrations/0071_coach_os_core.sql#L52)).

**Why it degrades.** Cost is `commitments × days × 3 × roster_size`. A team with 5 active commitments over a 62-day window and 60 athletes is ~56,000 roster expansions **per app open**. The `pg_try_advisory_xact_lock` guard prevents duplicate work but also means concurrent opens by the same team *serialise* — at a morning roll call, that is the whole team queueing behind one lock.

**The fix.** Materialise the audience once per commitment into a CTE before the day loop; replace the 62-day `while` with a single `generate_series` + `insert ... on conflict do nothing`; add `create index concurrently ae_athlete on athlete_exceptions (athlete_id)`. This turns an O(n³) procedural loop into two set-based statements.

#### F22 / F23 / F24 (P1) — Command Center and Insights RPCs aggregate whole tables

Three related shapes, all "filter applied after the aggregation":

- **`admin_ai_cost` / `admin_ai_verify`** ([0111:14](../../supabase/migrations/0111_admin_center_rpcs.sql#L14), [:47](../../supabase/migrations/0111_admin_center_rpcs.sql#L47)) select from `ai_cost_per_meal` / `ai_verify_effectiveness` and *then* apply `p_days`. Those views ([0106:34,51](../../supabase/migrations/0106_ai_calls_outcome.sql#L34), [0107:66](../../supabase/migrations/0107_meal_quality_metrics.sql#L66)) carry **no date predicate**, so the whole of `ai_calls` is scanned and grouped — with `ai_call_costs`' per-row `LATERAL` price lookup ([0106:13](../../supabase/migrations/0106_ai_calls_outcome.sql#L13)) on top — on every dashboard load. `ai_calls` gains a row per paid AI call, so it is one of the fastest-growing tables.
- **`admin_daily_activity`** ([0037:42](../../supabase/migrations/0037_analytics.sql#L42)) issues 4 correlated subqueries per day over `days` and `meals`; at the default `p_days = 30` that is ~120 scans, none able to use an index (F4/F6). `admin_overview` ([0037:70](../../supabase/migrations/0037_analytics.sql#L70)) and `admin_org_health` ([0117:33](../../supabase/migrations/0117_cc_orgs.sql#L33)) repeat the pattern.
- **`team_day_rollup` / `practice_day_rollup`** ([0076:36](../../supabase/migrations/0076_team_insights.sql#L36), [0137:23](../../supabase/migrations/0137_practice_insights.sql#L23)) and `*_intervention_outcomes` ([0076:73](../../supabase/migrations/0076_team_insights.sql#L73), [0137:63](../../supabase/migrations/0137_practice_insights.sql#L63)) run a correlated `count(*) from meals` and `exists(checkins)` per athlete per day. This one is on the **coach** path, not the founder path, so it affects customers.

**Why it degrades.** All three are `O(rows in table)` rather than `O(rows in window)`. They are survivable today only because the tables are small.

**The fix.** Push the date predicate *into* the views (parameterise them as functions taking `p_from`/`p_to`, or add `where created_at >= now() - interval '400 days'` and let the RPC narrow further). Rewrite the correlated subqueries as single grouped joins. For `admin_daily_activity` specifically, one `generate_series` left-joined to a grouped `days` scan replaces 120 subqueries with one.

#### F25 (P1) — `export_account_data()` has no LIMIT

[0065_export_account_data.sql:20](../../supabase/migrations/0065_export_account_data.sql#L20) `jsonb_agg`s every row in `days`, `meals`, `checkins`, `meal_comments` and `notifications` for the caller into a **single jsonb value**. There is no LIMIT and no streaming.

**Why it degrades.** This is age-driven rather than user-count-driven. A two-year-old account has ~730 `days`, ~2,200 `meals` with jsonb detail and text notes, plus comments and notifications — plausibly tens of MB assembled in memory as one value. Postgres has a 1 GB limit on a single value, but the practical failure (work_mem spill, statement timeout, PostgREST response limit) arrives far earlier.

This matters beyond performance: GDPR Art. 20 portability is a legal obligation, and it will begin failing silently for exactly the long-tenured users most likely to exercise it.

**The fix.** Paginate the export — return a manifest plus per-table chunks — or write it to a storage object asynchronously and hand back a signed URL. The latter is the standard pattern and also fixes the request-timeout problem.

#### F26 (P1) — ~45 foreign-key columns have no index

The full list is long; these are the ones on hot or security-critical paths:

| Column | Why it matters | File |
|---|---|---|
| `practices.owner_id` | `owns_practice()` gates **every** trainer-side RLS policy and is reached from `can_view` via `is_trainer_of` | [0001:32](../../supabase/migrations/0001_schema.sql#L32) |
| `athlete_exceptions.athlete_id` | Policy filter **and** the join inside F21's loop | [0071:52](../../supabase/migrations/0071_coach_os_core.sql#L52) |
| `staff_invites.team_id` | Drives the RLS policy on the table | [0061:10](../../supabase/migrations/0061_staff_invites.sql#L10) |
| `threads.counterpart_id` | `threads_read` filters it; the unique index leads with `athlete_id` | [0001:128](../../supabase/migrations/0001_schema.sql#L128) |
| `meal_comments.author_id` | `meal_comments_delete_own` filters it | [0046](../../supabase/migrations/0046_meal_comments.sql) |
| `plan_assignments.assigned_by` | Policy filters it | [0032](../../supabase/migrations/0032_meal_plans.sql) |
| `admin_audit_log.actor_id` | `admin_audit_search(p_actor)` filters it | [0109:20](../../supabase/migrations/0109_feature_flags.sql#L20) |
| `verification_consent.scope_team` | `vc_read` policy filters it | [0138](../../supabase/migrations/0138_verified_commitments.sql) |
| ~35 more `created_by` / `updated_by` / `*_id` columns | Every one is scanned during `delete_account()` cascade | [0079:67](../../supabase/migrations/0079_account_deletion.sql#L67) |

**Why it degrades.** Two distinct failures. Policy-filtered columns cause seq scans on ordinary reads. Unindexed cascade targets mean **account deletion scans every child table end to end** — a GDPR erasure request at 100k users could lock tables for minutes.

**The fix.** Index the eight hot ones now (P1, minutes of work). Before 100k, script the rest: enumerate FK constraints lacking a covering index via `pg_constraint` and generate `create index concurrently` for each.

#### F27 (P1) — Two growing tables with zero indexes

`activity_log` ([0018:16](../../supabase/migrations/0018_copilot.sql#L16)) and `copilot_artifacts` ([0018:32](../../supabase/migrations/0018_copilot.sql#L32)) have only their primary key. Both grow per event, and both have RLS policies filtering `actor_id` / `author_id` — so every read is a seq scan with a per-row policy check. `copilot_artifacts` additionally never garbage-collects discarded drafts.

**The fix.** `create index concurrently on activity_log (actor_id, created_at desc)` and `on copilot_artifacts (author_id, created_at desc)`. Add both to retention (F13).

#### F12 (P1) — Retention is authored but never armed, and the delete will not survive its first run

[0066_data_retention.sql:16](../../supabase/migrations/0066_data_retention.sql#L16) states plainly: *"authored only — NOT applied to live by the audit. If `schedule_data_retention()` is never called, nothing is scheduled."* `analytics_events` is the highest-volume table in the system — the onboarding funnel alone fires ~26 events per completed run ([analytics-ingest:49](../../supabase/functions/analytics-ingest/index.ts#L49)).

Two compounding problems:
1. **Never armed.** At 100k users with 180 days of retention, the table holds tens of millions of rows `[estimate]`.
2. **The purge itself is unsafe at that size.** [0066:30](../../supabase/migrations/0066_data_retention.sql#L30) is a single unbatched `delete from analytics_events where created_at < cutoff`, and there is **no index on `created_at`** — the indexes are `(name, created_at)` and `(session_id)` ([0052:25-26](../../supabase/migrations/0052_analytics_events.sql#L25-L26)). The first run is a full scan plus a multi-million-row delete in one transaction: a long lock, a WAL spike, and a likely timeout.

**The fix.** Arm it *now*, while the table is small. Add `create index concurrently analytics_events_created on analytics_events (created_at)`. Convert the delete to a batched loop (`delete ... where ctid in (select ctid ... limit 10000)` until zero rows). Before 100k, convert `analytics_events` to a monthly-partitioned table so retention becomes `drop partition` — an instant metadata operation.

#### F13 / F31 (P1) — Twenty-four growing tables have no retention policy at all

`purge_stale_data()` covers exactly two tables: `analytics_events` and `food_cache`. Everything else that grows is retained forever (or until account deletion, which is erasure, not retention). The gap:

| Table | Growth | File |
|---|---|---|
| `ai_calls` | per paid AI call — and feeds four unfiltered views (F22) | [0105:13](../../supabase/migrations/0105_ai_calls.sql#L13) |
| `commitment_responses` | per user per commitment per day — **fastest-growing new table** | [0138:158](../../supabase/migrations/0138_verified_commitments.sql#L158) |
| `commitment_instances` | per team per day per commitment | [0138:136](../../supabase/migrations/0138_verified_commitments.sql#L136) |
| `coach_views` | per user per day **per viewer** | [0043:14](../../supabase/migrations/0043_coach_seen.sql#L14) |
| `notifications` | per event — highest-volume writer once roll call goes global | [0027:10](../../supabase/migrations/0027_notifications.sql#L10) |
| `food_enrichment_samples` | one row per *detected food* per meal — a multiple of `meals` | [0104:25](../../supabase/migrations/0104_food_enrichment_samples.sql#L25) |
| `activity_log`, `copilot_artifacts` | per event, and unindexed (F27) | [0018:16,32](../../supabase/migrations/0018_copilot.sql#L16) |
| `ai_usage_key_daily`, `ai_usage_epoch`, `ai_usage_daily` | per key per day; cleanup exists only as a comment | [0030:21](../../supabase/migrations/0030_ai_spend_guard.sql#L21), [0045:10](../../supabase/migrations/0045_deep_analysis.sql#L10), [0015:34](../../supabase/migrations/0015_ai_usage_daily.sql#L34) |
| `monthly_reports` | a full rendered jsonb report per user per month | [0129:2](../../supabase/migrations/0129_monthly_reports.sql#L2) |
| `admin_brief_snapshots` | one per cron run **plus one per dashboard load**, each with a jsonb metrics bundle | [0113:22](../../supabase/migrations/0113_command_center_v2.sql#L22) |
| `admin_login_events` | per login attempt — also F28's scan target | [0131:71](../../supabase/migrations/0131_admin_auth_monitor.sql#L71) |
| `messages` | unbounded `text` column, no length cap, no purge | [0001:195](../../supabase/migrations/0001_schema.sql#L195) |
| `meal_comments`, `training_logs`, `progress_photos`, `plan_style_events`, `admin_audit_log`, `admin_sensitive_grants`, `guardian_invites`, `staff_invites`, `athlete_memory_facts` | per event / expired rows never purged | various |

`days`, `meals` and `checkins` are deliberately retained for the account's life ([0066 header](../../supabase/migrations/0066_data_retention.sql#L7)) — that is a correct product decision and is not counted here.

**The fix.** Extend `purge_stale_data()` in one migration: `ai_calls` 400 days (roll older rows into a daily cost aggregate first so financial history survives), `ai_usage_*` 30 days, `notifications` 180 days, `coach_views` 90 days, `admin_brief_snapshots` 400 days, `food_enrichment_samples` 180 days, expired `guardian_invites` / `staff_invites` / `admin_sensitive_grants` 30 days past expiry, `copilot_artifacts` 90 days for discarded drafts. Add a length cap to `messages.text`. Leave `admin_audit_log` and `payments` alone — those are deliberately append-only for audit and financial reasons.

#### F28 / F29 / F30 (P2) — Three age-driven slowdowns

- **`admin_detect_login_anomalies`** ([0131:94](../../supabase/migrations/0131_admin_auth_monitor.sql#L94)) runs three `NOT EXISTS` checks against `admin_login_events` on `ip` / `country` / `asn` — none of which are indexed (the index is `(user_id, occurred_at)`). Every admin login scans that admin's entire history. **Fix:** `create index concurrently on admin_login_events (user_id, ip)` and equivalents, or bound the lookback to 90 days.
- **`grant_trust_pass`** ([0099:18](../../supabase/migrations/0099_trust_pass_policy.sql#L18)) does `count(*) from days where athlete_id = .. and score >= 80` over the athlete's **lifetime**. Uses the right index but scans an ever-growing range. **Fix:** bound to the policy's actual window.
- **`performance_profiles.feedback_log`** ([0020:14](../../supabase/migrations/0020_performance_profiles.sql#L14)) is an append-only jsonb array inside a single row. Postgres rewrites the whole value on every append and TOASTs it once it passes ~2 KB. **Fix:** move to a child table with a foreign key, or cap the array to the last N entries.

#### F15 (P2) — Exact counts over the two largest tables, daily

[admin-brief:24-33](../../supabase/functions/admin-brief/index.ts#L24-L33) uses `count: 'exact', head: true` on `days` and `meals`. `count: exact` in Postgres is a real count, and with no usable index (F4/F6) it is a full scan of both. Once a day, so survivable — but it will be the slowest query in the system at 100k.

**The fix.** Fold both counts into the F4 index work, or read them from `pg_stat` approximations / an incrementally maintained daily counter.

---

### Area 3 — Edge functions

#### F3 (P0) — `weekly-digest` reads whole tables and is silently truncated at 1,000 rows

[weekly-digest/index.ts:100-105](../../supabase/functions/weekly-digest/index.ts#L100-L105):

```ts
const [teamsRes, membersRes, practicesRes, clientsRes] = await Promise.all([
  svc.from('teams').select('id, created_by'),
  svc.from('team_members').select('team_id, athlete_id, status'),
  svc.from('practices').select('id, owner_id'),
  svc.from('practice_clients').select('practice_id, client_id, status'),
]);
```

Four unfiltered, unpaginated whole-table reads. [`config.toml`](../../supabase/config.toml) sets `max_rows = 1000`, which PostgREST applies to every response.

**Why it degrades.** Past 1,000 teams, `teamsRes` returns only the first 1,000 — with **no error and no indication of truncation**. Every coach beyond that silently loses their weekly digest. Past 1,000 team members (reached far sooner — roughly 1,000 athletes), rosters are wrong for everyone: `teamOwner.get(m.team_id)` misses, so athletes vanish from their coach's digest and the "who went silent" list becomes fiction. This is the most dangerous finding in the audit because the failure mode is a wrong number in a coach's hand, not an error page.

Note the `status` filtering happens in JS ([:109](../../supabase/functions/weekly-digest/index.ts#L109), [:117](../../supabase/functions/weekly-digest/index.ts#L117)) *after* the truncation, so inactive rows consume the 1,000-row budget.

**The fix.** Rewrite as a paginated per-owner loop: `select distinct owner` first, then process owners in batches of 100 with `.range()`. Push the `status = 'active'` filter into the query. Add an explicit assertion that fails loudly if any response returns exactly `max_rows`.

#### F7 (P0) — Every athlete id in one `IN` clause, and every day row in one isolate

[weekly-digest:138-142](../../supabase/functions/weekly-digest/index.ts#L138-L142):

```ts
const allAthletes = [...new Set([...rosters.values()].flatMap((s) => [...s]))];
const [daysRes, profRes] = await Promise.all([
  svc.from('days').select('athlete_id, date, score').gte('date', daysAgo(6)).in('athlete_id', allAthletes),
  svc.from('profiles').select('id, full_name').in('id', allAthletes),
]);
```

At 100k athletes, `allAthletes` is 100,000 UUIDs. PostgREST sends `.in()` as a query-string parameter — roughly 3.7 MB of URI. That exceeds request-line limits and returns 414 long before it reaches Postgres. Even if it succeeded, the response is ~700k `days` rows held in a Deno isolate with a ~150 MB memory ceiling `[estimate]`, plus 100k profile rows.

**The fix.** Same as F3 — batch by owner. Each owner needs only their own roster's rows, which is tens of ids, not tens of thousands.

#### F8 (P0) — `max_rows` truncation on claim RPCs is silent data loss

`claim_due_commitment_reminders` ([0140:166-203](../../supabase/migrations/0140_commitment_reliability.sql#L166-L203)) marks rows as reminded **and** returns them in the same CTE:

```sql
), claimed as (
  update commitment_responses r
     set reminded_offsets = array_append(r.reminded_offsets, d.off), ...
  returning r.id, d.athlete_id, ...
)
select cl.athlete_id, ... from claimed cl;
```

The `UPDATE` commits regardless of how much of the result set PostgREST returns. `max_rows = 1000` applies to RPC responses that return `setof` `[estimate — worth confirming against the deployed PostgREST config before relying on it]`. If it does apply, then once more than 1,000 reminders come due in a single 5-minute tick, the surplus responses are **marked as reminded and never delivered** — and because `reminded_offsets` now contains that offset, they will never be retried. The athlete simply never gets the 4:45 AM roll call the feature exists for.

The same shape applies to `claim_missed_commitments` ([commitment-escalation:79](../../supabase/functions/commitment-escalation/index.ts#L79)), where truncation means responses are marked `missed` with no escalation fired.

**Why it degrades.** A single large team with a shared 5 AM roll call reaches 1,000 concurrent due reminders on its own. Across a platform at 15k–25k athletes with clustered morning windows, this is routine.

**The fix.** Add an explicit `p_limit` parameter (default 500) to both claim RPCs and have the edge function loop until the RPC returns fewer than `p_limit` rows. This is correct regardless of whether `max_rows` applies, and it also bounds isolate memory.

#### F9 (P1) — Serial round trip per reminder

[commitment-reminders:75-80](../../supabase/functions/commitment-reminders/index.ts#L75-L80):

```ts
for (const d of due) {
  const { error: e } = await svc.rpc('record_commitment_reminder', { ... });
  if (!e) recorded++;
}
```

One awaited network round trip per due reminder, sequentially. At ~15ms each `[estimate]`, 1,000 reminders is 15 seconds; 5,000 is 75 seconds and the 5-minute cron starts overlapping itself. (The claim RPC is idempotent, so overlap is safe — but throughput still collapses.)

Note the push path directly below is already correct: batched 100 at a time ([:120-131](../../supabase/functions/commitment-reminders/index.ts#L120-L131)). Only the DB write is serial.

**The fix.** Replace `record_commitment_reminder` with a set-returning `record_commitment_reminders(p_rows jsonb)` that does one bulk `insert ... select from jsonb_to_recordset`. One round trip instead of N.

#### F14 (P1) — Serial loop over escalation instances

[commitment-escalation:111-127](../../supabase/functions/commitment-escalation/index.ts#L111-L127) loops over `coachInstances`, issuing `rollcall_digest` RPC + a `device_tokens` query + an Expo POST per instance, all awaited in sequence. Three round trips per instance. At a few hundred instances in a peak 5-minute window this exceeds the function's wall clock.

**The fix.** Batch the digests into one RPC returning all instances, batch the `device_tokens` lookup into one `.in()`, and issue the Expo sends with bounded concurrency (`Promise.all` over chunks of 6).

#### F17 (P2) — Rate limiters are per-isolate and leak

`const rlHits = new Map<string, { count: number; resetAt: number }>()` appears in 19 functions. Two problems: Supabase runs many isolates concurrently, so the effective limit is `RATE_LIMIT_PER_MIN × isolate_count` — unknown and unbounded; and entries are only overwritten on a same-IP hit, never swept, so the `Map` grows with unique IPs for the isolate's lifetime.

**The fix.** Move to the existing `claim_ai_usage_key` mechanism with a minute-granular key (`rl:<fn>:<ip>:<minute>`) for the paid endpoints where it matters, and add a periodic sweep for the rest. Low priority — the per-user and global caps are the real controls, exactly as the comments state.

#### F18 (P2) — `auth.getUser()` network round trip per request

19 functions call `sb.auth.getUser(token)` (e.g. [coach-voice-nudge:60-72](../../supabase/functions/coach-voice-nudge/index.ts#L60-L72)), which is an HTTP call to GoTrue on every single request. It adds 50–150ms `[estimate]` and makes the auth server a shared dependency of every endpoint.

**The fix.** Verify the JWT locally against the project's JWT secret (signature + `exp` + `aud`) and only call GoTrue when local verification is inconclusive. Standard, well-understood, and removes an entire hop.

---

### Area 5 — Cron / scheduled jobs

Four scheduled jobs exist. Their scaling walls are covered above:

| Job | Cadence | Wall |
|---|---|---|
| `weekly-digest` ([0044](../../supabase/migrations/0044_weekly_digest_cron.sql)) | weekly | **F3, F7** — silently wrong at ~1k teams, hard-fails ~30k |
| `commitment-reminders` ([0140:226](../../supabase/migrations/0140_commitment_reliability.sql#L226)) | 5 min | **F8, F9** — silent loss ~15k, timeout ~25k |
| `commitment-escalation` | 5 min | **F14** — timeout ~50k |
| `admin-brief` ([0113:168](../../supabase/migrations/0113_command_center_v2.sql#L168)) | daily | **F15** — slow but survivable to 100k |
| `data-retention` ([0066:43](../../supabase/migrations/0066_data_retention.sql#L43)) | nightly | **F12 — never armed** |

The 5-minute cadence of the two commitment jobs is the binding constraint: they must complete in well under 300s, and both currently scale linearly with due-reminder volume rather than with available concurrency.

---

### Area 6 — Realtime & push

**Realtime: no exposure.** A search for `.channel(` across `src/` and the proto data layer returns nothing outside the vendored Supabase bundle. There are no realtime subscriptions, so the entire Realtime connection-limit failure class does not apply. The `setInterval` calls found in [Home.tsx:688](../../src/screens/athlete/Home.tsx#L688), [Recovery.tsx:510](../../src/screens/athlete/Recovery.tsx#L510) and [home.js:701](../../proto/redesign-2026-07/js/screens/home.js#L701) are local UI ticks — count-up animation and a derive-compare-render loop — and issue no network traffic. This is a genuinely good architectural position; keep it.

**Push, F16 (P2).** Expo sends are correctly batched at 100 per request in all three senders. Two gaps:
- **No receipt handling.** Expo's `/push/send` returns tickets that must be polled at `/push/getReceipts` to learn about `DeviceNotRegistered`. Nothing does this.
- **No token pruning.** `device_tokens` therefore accumulates dead tokens forever. Every reinstall, every device change adds one. At 100k users with typical churn, a meaningful fraction of every push batch is wasted `[estimate]`, and Expo throttles senders with poor delivery rates.

**The fix.** Add a `push-receipts` function on a 15-minute cron that polls tickets and deletes `device_tokens` rows returning `DeviceNotRegistered`. This is a prerequisite for reliable push at any scale, not just a cleanup.

---

### Area 7 — Client-side

#### F19 (P2) — Roster fan-out, one RPC per book

[roles.js:1364-1365](../../proto/redesign-2026-07/js/roles.js#L1364-L1365) issues `Promise.all(teams.map(t => fetchTeamRoster(t.id)))` — one `team_roster` RPC per team, concurrently. For a single-team coach this is one call. For a multi-team org admin it is N concurrent calls on every dashboard open. Combined with F4/F6 running in the same `Promise.all`, a dashboard load is `N + 3` concurrent queries.

**The fix.** A single `my_rosters()` RPC returning all books at once.

**Checked and clean:**
- [coach.js:200](../../proto/redesign-2026-07/js/screens/coach.js#L200) caps its per-athlete trust-pass fan-out at `rows.slice(0, 12)` — bounded, no N+1.
- The data layer is RPC-first (~40 distinct RPCs), which keeps most read paths server-shaped rather than chatty.
- `fetchTeamActivity` and `fetchLinkedDaysSince` are the only two direct table reads on the coach path, and both are covered by F4/F6.

**Payload growth with account age:** the roster path bounds itself to 7 days of `days` and 2 days of `meals`, so per-athlete payload does not grow with account age. That is correct design and worth preserving.

---

## 4. Remediation plan

### Before 10k — *ship these; the product does not reach 10k without them*

| # | Action | Finding | Effort |
|---|--------|---------|--------|
| 1 | Split the four global AI caps into `anon` (fail closed) / `authed` (fail open, alert at 80%); size from paying seats | F1, F2 | S |
| 2 | Add per-tier monthly AI budgets keyed `tier_budget:<user>:<month>` — ship in the same commit as #1 | F11 | M |
| 3 | Pass `.in('athlete_id', athleteIds)` to `fetchLinkedDaysSince` and `fetchTeamActivity`; reorder so the roster resolves first | F4, F6 | S |
| 4 | Rewrite `weekly-digest` as a paginated per-owner loop; add a loud assertion on any `max_rows`-sized response | F3, F7 | M |
| 5 | Add `p_limit` to both claim RPCs; loop in the edge function until under-limit | F8 | S |
| 6 | Arm `schedule_data_retention()`; add `analytics_events (created_at)` index; batch the delete | F12 | S |
| 7 | Add plain `team_id` / `practice_id` indexes to `requirement_sets` | F20 | S |
| 8 | Index the eight hot unindexed FK columns, starting with `practices.owner_id` and `athlete_exceptions.athlete_id` | F26 | S |
| 9 | Index `activity_log (actor_id, created_at)` and `copilot_artifacts (author_id, created_at)` | F27 | S |
| 10 | Push date predicates into `ai_cost_daily` / `ai_cost_per_meal` / `ai_verify_effectiveness` so the Command Center stops scanning all of `ai_calls` | F22 | S |

> Items 7–10 are all `create index concurrently` or a one-line `where` clause. Together they are perhaps two hours of work and remove four of the audit's worst scans. Do them first — they are also the lowest-risk changes in this document.

### Before 50k

| # | Action | Finding | Effort |
|---|--------|---------|--------|
| 11 | Rewrite `ensure_commitment_instances` set-based: materialise audience once, `generate_series` instead of the day loop | F21 | M |
| 12 | Bulk-insert reminder notifications in one RPC instead of N | F9 | M |
| 13 | Batch `commitment-escalation`'s digest + token reads; bound push concurrency | F14 | M |
| 14 | Add `push-receipts` cron; prune `DeviceNotRegistered` tokens | F16 | M |
| 15 | Shard the global AI counter 16 ways | F10 | M |
| 16 | Extend `purge_stale_data()` to the 24 uncovered tables; cap `messages.text` | F13, F31 | M |
| 17 | Rewrite `admin_daily_activity` as one `generate_series` + grouped join; same for `team_day_rollup` and `*_intervention_outcomes` | F23, F24 | M |
| 18 | Paginate `export_account_data()` or move it to async storage-object delivery | F25 | M |
| 19 | Profile `can_view()` after #3 lands. Only if it still dominates, build the materialized viewer→athlete edge table | F5 | M–L |
| 20 | Local JWT verification, GoTrue only as fallback | F18 | S |
| 21 | Index `admin_login_events (user_id, ip)`; bound the anomaly lookback to 90 days | F28 | S |

### Before 100k

| # | Action | Finding | Effort |
|---|--------|---------|--------|
| 22 | Partition `analytics_events`, `ai_calls` and `commitment_responses` monthly; retention becomes `drop partition` | F12, F13 | L |
| 23 | Script the remaining ~37 unindexed FK columns from `pg_constraint` — required before erasure requests are survivable | F26 | M |
| 24 | Replace `admin-brief` exact counts with maintained counters | F15 | S |
| 25 | Single `my_rosters()` RPC replacing per-team fan-out | F19 | S |
| 26 | Move rate limiting off per-isolate `Map`s to a shared counter | F17 | M |
| 27 | Move `performance_profiles.feedback_log` to a child table; bound `grant_trust_pass`'s lifetime count | F29, F30 | S |
| 28 | Evaluate read replicas for the coach dashboard and Command Center paths | — | L |

---

## 5. Load-test plan

Verify each fix rather than assume it. Run against a seeded staging project — **never prod** (there is no env separation; account-creating simulations need a disposable Supabase project). The existing harness in [`sim/stress/`](../../sim/stress/) is the starting point.

### Seed profile

| Fixture | 10k run | 50k run | 100k run |
|---|---|---|---|
| Athletes | 10,000 | 50,000 | 100,000 |
| Teams (avg 25 athletes) | 400 | 2,000 | 4,000 |
| `days` rows (90 days back) | 900k | 4.5M | 9M |
| `meals` rows (3/day, 90 days) | 2.7M | 13.5M | 27M |
| `analytics_events` | 5M | 25M | 50M |

Seed at least 90 days of history — several findings only appear once the tables are large, and a fresh-seeded DB will pass tests that a real one fails.

### Scenarios

| # | Target | Load | Pass threshold | Catches |
|---|--------|------|----------------|---------|
| L1 | Coach dashboard: `loadCoachRoster()` full path | 50 concurrent coaches, 5 min sustained | p95 < 1,200ms; **zero** statement timeouts; no seq scan on `days`/`meals` in `pg_stat_statements` | F4, F5, F6, F19 |
| L2 | `POST /analyze-meal` (photo, authed) | ramp 5 → 60 RPS over 10 min | p95 < 6s; **zero** `429 service at capacity` for authed users; `ai_calls` row count == request count | F1, F10 |
| L3 | `POST /analyze-meal` with anon key only | 100 RPS from 20 IPs | anon calls throttled; **authed traffic in L2 unaffected** when run concurrently | F1, F17 |
| L4 | `weekly-digest` single invocation | full seeded roster | completes < 150s; `digests` returned **== distinct owner count** (this is the assertion that catches silent truncation); memory < 100MB | F3, F7 |
| L5 | `commitment-reminders`, 5,000 reminders due in one tick | one invocation | completes < 120s; `sent` == `claimed`; **zero** `commitment_responses` rows with the offset appended but no matching `notifications` row | F8, F9 |
| L6 | `commitment-escalation`, 500 instances with misses | one invocation | completes < 120s; one digest push per opted-in instance | F14 |
| L7 | `purge_stale_data()` first run on 50M `analytics_events` | one invocation | completes < 300s; **no lock held > 2s** (watch `pg_locks`); concurrent L2 traffic unaffected | F12 |
| L8 | Mixed steady state: L1 + L2 + athlete Home loads | 60 min at 40% of peak | connection pool never saturates; p95 stable within 20% start vs. end (rules out leak/bloat) | all |
| L9 | Push delivery | 20,000 notifications with 15% dead tokens seeded | delivery rate > 95% of live tokens; dead tokens pruned within one receipt cycle | F16 |
| L10 | **Athlete app-open** (standards resolution + `ensure_commitment_instances` + day hydrate) | 200 concurrent opens, all on one large team | p95 < 900ms; **index scan** on `requirement_sets`; no advisory-lock wait > 200ms | F20, F21 |
| L11 | Command Center full load | 5 concurrent founder sessions | p95 < 3s; `ai_calls` scanned rows < 10× rows in the requested window | F22, F23 |
| L12 | Coach Insights tab, 90-day range, 60-athlete team | 20 concurrent coaches | p95 < 2s; subquery count independent of team size | F24 |
| L13 | `export_account_data()` on a seeded 2-year account | 1 invocation | completes < 30s; peak memory < 200MB; response fully delivered | F25 |
| L14 | `delete_account()` on a seeded 2-year account | 1 invocation, concurrent with L8 | completes < 20s; **no table lock > 1s** | F26 |

### Instrumentation to enable before running

- `pg_stat_statements` reset before each scenario; capture top 20 by `total_exec_time`.
- `auto_explain` with `log_min_duration = 500ms` and `log_analyze = on` — this is what proves F4/F6 are actually fixed rather than just faster on a warm cache.
- Sample `pg_locks` every second during L2 and L7.
- Record `ai_calls` row count and summed `ai_call_costs.cost_usd` per scenario — L2 doubles as a live validation of the F11 cost model against real token usage rather than estimates.

### Gate

No scenario is "passed" on latency alone. Each must also show the **expected query plan** (index scan, not seq scan) and the **expected row counts** (digests == owners, sent == claimed). Three of the P0 findings in this audit fail silently with perfectly healthy latency; only the correctness assertions catch them.

---

## Appendix — What was checked and found sound

Recorded so a future audit does not re-litigate it:

- **No realtime subscriptions** anywhere in the client. Entire connection-limit failure class is absent.
- **Per-user AI caps** (`DAILY_ANALYSIS_CAP`, `ASSIST_USER_CAP`, `VOICE_USER_CAP`, `MEAL_CHAT_DAILY_CAP`, `DEEP_WEEKLY_CAP`) are correctly implemented, atomic, and fail-open in the right direction. The problem is only with their *global* siblings.
- **Prompt caching** is applied to system prompts and tool schemas in every AI function (`cache_control: { type: 'ephemeral' }`), which is where most of the input-token savings are.
- **AI telemetry** (`recordAiCall`) is wired into every paid path with prices held in SQL rather than code — cost modeling is measurable, not guessed, once traffic exists.
- **Expo push batching** at 100/request is correct in all three senders.
- **Client polling** is local-only; no network traffic in any `setInterval`.
- **`coach.js` trust-pass fan-out** is explicitly bounded to 12 rows.
- **The RPC-first data layer** keeps most reads server-shaped; only two direct table reads exist on the coach path, and both are named above.
