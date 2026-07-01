# Spec — Meal Library & History

**Date:** 2026-06-28
**Status:** Parts A (save seam), B (client history), C (coach/trainer history) — BUILT
**Owner:** founder (jihadwoods57)

## Why

Today a logged meal is a checkbox. The photo is captured, analyzed by the AI,
shown once on the result screen, and then **discarded**. Nothing about the
individual meal survives:

- **Locally:** `dayRollover` resets `meals`/`mealFoods` every day. Only
  score/weight/nutrition history carry across days. There is no per-meal record.
- **Remotely:** the day-sync (`mapStateToDayRow`) pushes a *summary* — the
  four meal checkboxes, the score, the grade — never the individual meals. The
  `insertMeal` / `fetchMeals` functions in `queries.ts` exist but were **never
  called**. The `meals` table (`0001_schema.sql`) and the `meal-photos` storage
  bucket (`0003_storage.sql`) were built for exactly this and sat unused.

So a client can't scroll back through what they ate, and — the persona test's
**#1 unmet coach need** — a coach/trainer opening a client can't see a single
meal the athlete logged. They see a score breakdown and a sample summary, no
food.

The foundation already exists (table + bucket + `fetchMeals` + RLS that lets a
linked coach/trainer/parent read an athlete's meals). What was missing is the
*write*. This spec wires the write, then builds the two read surfaces on top.

## Scope

Three parts, shippable independently:

- **Part A — the save seam (this change).** On meal log, persist the meal to the
  `meals` table and upload its photo to `meal-photos`, gated by `isBackendLive`
  **and** `realDataConsent` (the same fail-closed gate as `pushDay`). Inert until
  the backend is live, so it changes nothing in the current flag-OFF beta.
- **Part B — client meal history.** A scrollable history of the client's own past
  meals (photo thumb + macros + quality + day), tap to re-open the full analysis.
- **Part C — coach/trainer meal history.** A "Recent Meals" section in
  `PersonDetail` (the roster → client overlay) reading the same `fetchMeals`,
  filtered by RLS to the linked athlete.

## Part A — the save seam (implemented here)

### Data already in place

`meals` table (`supabase/migrations/0001_schema.sql`):

```
id uuid pk · athlete_id · day_date · type · photo_path · name
protein · kcal · carbs · fat · quality · detected jsonb · note · logged_at
index meals_athlete_day on (athlete_id, day_date desc)
```

`meal-photos` bucket (`0003_storage.sql`), path convention
`{athlete_id}/{date}/{key}.jpg`. RLS: the athlete writes their own folder; the
athlete + any linked overseer (`can_view`) reads it.

`db.insertMeal(row)` / `db.fetchMeals(athleteId, date)` — already typed, already
no-op when unconfigured.

### What this change adds

1. **`AppState.mealPhoto: string | null`** — the last captured base64 JPEG, held
   only long enough to upload it on log. Ephemeral; **never persisted** (kept out
   of `partialize`, like `mealAnalysis`) so we never write a multi-MB base64 blob
   into AsyncStorage.
2. **`capture()`** stashes the captured `photoBase64` into `mealPhoto` (it was
   previously passed to `analyzeMeal` and dropped).
3. **`src/store/mealSync.ts`** — a new bridge, parallel to `sync.ts`:
   - `uploadMealPhoto(athleteId, date, key, base64)` — decodes the base64 to bytes
     and uploads to `meal-photos/{athlete}/{date}/{key}.jpg` with `upsert: true`
     (re-logging a slot overwrites). Returns the path, or `null` on any failure —
     a photo upload **never blocks** the meal record.
   - `mapMealToRow(...)` — pure projection from the meal slot + analysis + edited
     foods into an `insertMeal` row. Macros come from the edited plate when the
     athlete corrected it (`mealMacros(foods)`), else the analysis estimate.
   - `recordMeal(s, athleteId, key)` — gated on `isBackendLive` **and**
     `realDataConsent` (reuses `consentContextFromState`); uploads the photo if
     present, then `insertMeal`. Returns a discriminated `{ recorded, reason }`
     so tests can see why a write was skipped. Fails closed exactly like
     `pushDay`.
4. **`addMeal` / `saveMeal`** call a debounced `scheduleMealRecord` (mirrors
   `scheduleDaySync`) after the slot is logged; `addMeal` then clears `mealPhoto`.

### Gating — unchanged behavior in the beta

`recordMeal` early-returns `{ recorded: false, reason: 'backend-off' }` whenever
`isBackendLive` is false, and `scheduleMealRecord` doesn't even arm a timer —
identical to `scheduleDaySync`. With the flag OFF (today's config) this is a pure
no-op: no upload, no insert, the photo is dropped exactly as before. The seam only
"turns on" when the founder flips `EXPO_PUBLIC_BACKEND_LIVE` AND the athlete has
recorded consent (and, for a minor, guardian status) — the same bar that gates
every other real-data write.

### Why a separate `mealSync.ts` (not folded into `sync.ts`)

`sync.ts` owns the *day slice* (`days` table, one row per athlete-day). Meals are a
*collection* (N rows per day, plus storage). Keeping them in their own bridge keeps
each file single-responsibility and matches the existing `pushDay`/`hydrateDay`
shape, so the consent gate reads identically in both.

## Part B — client meal history (BUILT)

- New overlay `src/screens/overlays/MealHistory.tsx`, reached from a **History**
  link in the Nutrition "Today's Meals" header; mounted in `AthleteApp`.
- Data: `openMealHistory()` fetches `fetchRecentMeals(userId, daysAgoStamp(14))`
  when the backend is live and stores it in `AppState.mealHistory` (ephemeral,
  never persisted). The overlay groups it by day (`groupMealsByDay`, newest first,
  Today/Yesterday/"Mon, Jun 23" headings).
- Offline/demo: with the backend off, `mealHistory` stays null and the overlay
  falls back to today's locally-logged meals (`localTodayCards` — real logs, never
  fabricated), under a "Sample" note explaining full cross-day history lights up
  once connected.
- Card per meal (`MealCardItem`, shared with Part C): photo thumbnail via a
  short-lived **signed URL** (`signedMealPhotoUrl`) with the app's per-slot color
  block as the fallback, name, slot · macros, quality chip.
- Honest empty state ("No meals yet") when nothing is logged.

## Part C — coach/trainer meal history (BUILT)

- A "Recent Meals" `Card` in `PersonDetail`, directly below the Score Breakdown.
- Reads `fetchRecentMeals(pd.athleteId, daysAgoStamp(14))` in a cancel-safe effect
  — RLS already restricts it to athletes the opener is linked to, so no new
  permission work. `athleteId` now flows `mapLinkedDaysToRoster` → `RosterRow` →
  `openPerson` → `PersonDetail` (live roster only).
- Same `MealCardItem` design as Part B, read-only (a coach reviews, doesn't edit
  the plate). Grouped by day with the same headings.
- Gated on `isBackendLive && pd.athleteId`; on the demo roster (no athleteId) or
  with the backend off it shows the honest "appears here once connected" state with
  a Sample tag — never fabricated food, consistent with the existing
  DAY-STREAK / WEIGHT-Δ sample handling in that overlay. The seeded TrainerView
  clients carry no athleteId, so that surface also shows the not-connected state.

## Follow-ups (not in this change)

- Tap a history card → re-open the full `MealCapture` analysis hydrated from the
  stored row (regenerate the coaching insight from saved macros/goal; no need to
  store AI prose). Currently the cards are read-only.
- Real per-athlete name/photo on the live coach roster (depends on the profile
  read landing).

## Guardrails honored

- `src/core` stays pure — all backend/storage code lives in `src/store` / `src/lib`.
- `isBackendLive` (not `isSupabaseConfigured`) gates every write, and consent
  fails closed — a non-consenting or minor athlete never persists a meal.
- No fabricated history on any read surface; honest empty states until real data.
- `npm run verify` green at every step.
