# Connected Standards — go-live

Wearable-verified activity requirements: a coach (or the athlete) sets a measurable target —
10,000 steps by Friday, 2.5 miles from a recorded run, 12 miles across the week — and the
platform decides whether it was met from health data the phone already has.

Migrations **0155** and **0156** are authored and statically reviewed but **NOT applied to prod**.
Everything below is founder work.

## What ships without any native code

Slices 1–4 are complete and usable with **no HealthKit at all**. An athlete logs a standard by
hand, it records as *reported* rather than *verified*, and the coach can require approval. That is
why this can go live before the device work: the feature is not a stub waiting on a native module,
it is a working accountability loop that gets *better* when the watch is wired.

## Step 1 — apply the migrations

```
supabase db push                 # 0155 + 0156
npm run test:rls                 # expect ALL GREEN (469/469)
```

`npm run test:rls` needs the local stack (`supabase start`, port 54322). The suite rolls back and
leaves no data.

## Step 2 — turn the flag on

The flag **fails CLOSED**, deliberately unlike `vc_enabled` (0141): Connected Standards has never
shipped, so an un-seeded or restored database must not start reading health data on its own. With
no flag row, or with `default_on = false`, nothing materializes and every surface renders nothing.

Stage to pilots first:

```sql
update feature_flags
   set enabled_user_ids = array['<athlete-uuid>', '<coach-uuid>']::uuid[]
 where name = 'connected_standards';
```

Then globally:

```sql
update feature_flags set default_on = true where name = 'connected_standards';
```

Kill switch (beats every allowlist):

```sql
update feature_flags set kill_switch = true where name = 'connected_standards';
```

## Step 3 — deploy the tick function

One scheduled function does three things every five minutes: materialize upcoming periods,
adjudicate deadlines that passed, and send the reminders that came due.

```
supabase secrets set CONNECTED_STANDARDS_CRON_KEY=<long random string>
supabase functions deploy connected-standards-tick --use-api --no-verify-jwt
```

Then schedule it (pg_cron + pg_net must be installed):

```sql
select schedule_connected_standards(
  'https://<project>.supabase.co/functions/v1/connected-standards-tick',
  '<the same key>');
```

Verify it is alive:

```sql
select jobname, schedule, active from cron.job where jobname = 'connected-standards-tick';
```

`--no-verify-jwt` is correct here: the function authenticates with its own `x-cron-key`, compared
in constant time. An anon caller without the key gets 401.

## Step 4 — native iOS (the only part a dev machine cannot do)

Everything above works first. This step upgrades *reported* to *verified*.

1. **Module.** `npx expo install react-native-health` (SDK-57 compatible resolution). If it has
   gone unmaintained by the time you read this, `@kingstinct/react-native-healthkit` is the
   sanctioned fallback — decide once and note it in the PR.
2. **Entitlement + config plugin.** Add HealthKit to `app.json`: the
   `com.apple.developer.healthkit` entitlement, `NSHealthShareUsageDescription` (reuse the wording
   from `js/screens/health-consent.js` so the OS prompt and the explainer agree), and the module's
   config plugin beside `./plugins/withDeferredAppleSignIn`.
   Read scopes: `stepCount`, `distanceWalkingRunning`, `workouts`, `appleExerciseTime`.
3. **Wire the seam — one file.** Implement `healthConnected` / `connectHealth` / `readActivity` /
   `observeActivity` in `src/lib/health/index.ts` and set `isHealthAvailable = true`. Nothing else
   changes: `src/lib/health/index.test.ts` guards on the flag, so it becomes a no-op rather than a
   red build you have to delete.
   - **Prefer the platform's aggregated totals.** An iPhone and an Apple Watch both record the
     same steps; summing two sources inflates every athlete who owns both.
   - **`readActivity` must return `null`, never an empty sample, when it cannot read.** That single
     distinction is what keeps a dead battery out of the miss column — see step 5.
4. **Background delivery.** `HKObserverQuery` + `enableBackgroundDelivery` on steps and workouts,
   waking `syncActivity` in `src/lib/health/activitySync.ts`. That path writes to Supabase
   **directly** and must never route through the WebView bridge: a goal crossed at 6:40 PM can
   wake a process whose WebView does not exist.
5. **Un-gate.** `#connected-standards` reveals its connect row automatically once `available()`
   returns true; `js/screens/health-consent.js` stops redirecting. Nothing to edit.
6. **Build and QA on a real device.** HealthKit has no data in the Simulator and background
   delivery is unreliable there — **simulator green is not evidence.**

### Device QA sheet

- [ ] Connect flow: explainer → OS prompt → `#devices`-style connected state
- [ ] Live progress updates during the day; "Synced 6:42 PM" tracks the real last read
- [ ] Crossing the target mid-day flips to **Verified** with nothing tapped
- [ ] A stale sync reads "Last synced yesterday, 2:04 PM" — never a bare time
- [ ] **Deadline passes with the phone off → `awaiting_sync`, NOT missed**
- [ ] Power the phone back on → a late sync that clears the target lifts the verdict
- [ ] Revoke Health access mid-period → `disconnected`, and the coach board says so
- [ ] A minor without guardian consent is refused **server-side** (not just hidden in the UI)
- [ ] Manual logging still works with the device connected
- [ ] Deliberate-workout distance: a long walk does NOT satisfy a "recorded run" standard

## What is deliberately NOT wired

| Not shipping | Where the seam is |
|---|---|
| Score impact on the daily 0–100 | `connected_standards.score_impact`, authored and read by nothing. **Never touch** `PROFILE_WEIGHTS` (day.js:15-19), `src/core/scoring.ts`, or the 0041 evidence ceiling — `scripts/score-parity` will fail the build. |
| AI narration ("you're on pace…") | Reminder copy is a template over SQL-computed numbers. A later version clones `ai-followup`: haiku tier, spend-gate, `recordAiCall` awaited. |
| Pace, heart-rate zones, cycling, swimming, sleep | The `metric` CHECK in 0155 is one constraint-swap away; `ActivitySample` extends additively. |
| Android Health Connect | Authored behind the same abstraction and flag-gated. **Not QA'd on Android.** |
| Team challenges | Nothing depends on their absence. |
| Premium gating | Ungated by decision. `has_premium_access` + the locked-payload pattern are available if that reverses. |

## The invariant to protect

A device failure is never a disciplinary record. `awaiting_sync`, `disconnected` and
`insufficient_data` leave the compliance denominator entirely; only fresh data showing a genuine
shortfall, or an attributable staff act, ever writes `missed`.

That rule is enumerated as **"the deadline matrix"** in `supabase/tests/rls_authz_test.sql` — all
eleven states, plus idempotence and late-data recovery. It was written before the function body.
If you change a branch in `claim_missed_connected_standards`, that test is the specification you
are changing, not an obstacle in the way of changing it.
