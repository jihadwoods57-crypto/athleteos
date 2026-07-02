# Meal Plans — Wave 2 Design

**Date:** 2026-07-02
**Status:** Approved for planning (continuation of the Wave 1 design)
**App:** OnStandard (Expo/RN + Supabase)
**Depends on:** Wave 1 (merged, PR #15) — `PlanSlot`, `buildPlanDraft`, `generatePlan`,
`parsePlanSlots`, `CoachPlanEditor`, `isMealPlansEnabled`, migration `0029_meal_plans.sql`.

## Problem

Wave 1 made meal plans real for a single session: the plan lives in one `planSlots`
value (the logged-in user's own plan). It is not yet a coach→athlete tool — a
nutritionist can't author a plan **for a specific client** or **assign one plan to many
clients**. Finding #2 from Wave 1 verification: the plan editor is only reachable from the
athlete-side Plan screen and edits the single-session plan, not a selected client's plan.

## Decisions (locked)

1. **Local-first, backend as a thin seam.** Per-athlete plans live in the store
   (`athletePlans`, keyed by a stable athlete key) exactly like the rest of the app's
   offline-first state. A backend seam (`saveMealPlan`/`assignPlan`) writes to
   `meal_plans`/`plan_assignments` only when `isBackendLive` — inert in the demo, mirroring
   `CoachGoalsEditor`'s `pushAthleteGoals` pattern. This keeps Wave 2 fully buildable and
   verifiable in the app now (the `0029` migration is not yet applied to live).
2. **One editor, a scoped target.** `CoachPlanEditor` gains an edit *target*: `self` (the
   athlete editing their own plan, today's behaviour) or `athlete:<key>` (a coach editing a
   selected client's plan). The store holds `planEditTarget`; the editor reads/writes the
   right slice. No second editor component.
3. **Stable athlete key.** `athletePlans` is keyed by `personDetail.athleteId ?? personDetail.name`
   (the same fallback the roster already uses for demo rows without a backend id).
4. **Reuse Wave 1 generation.** Per-athlete authoring and bulk assign both use the existing
   `generatePlan` (AI draft + deterministic fallback) and `parsePlanSlots`.

## Scope

**In:**
- Per-athlete plan storage + pure helpers (`athletePlans`, get/set/assign-to-many).
- `CoachPlanEditor` scoped by `planEditTarget` (self vs a selected client).
- **PersonDetail** entry: "Meal plan" → opens the editor scoped to that client (Generate,
  edit, save), mirroring the existing "Targets & scoring" entry.
- **Bulk assign:** from the coach roster, "Assign a plan to N clients" — generate/confirm a
  plan, pick clients, assign (copies the `PlanSlot[]` to each client's `athletePlans`).
- Backend seam `saveMealPlan(plan)` / `assignPlan(planId, athleteKeys)` (inert unless
  `isBackendLive`), unit-tested for shape; demo shows a "connect to push" note, never a
  fabricated write.

**Out (later):** template library UI (Wave 3), server-side realtime plan sync to the
athlete's device (needs the backend live + the athlete-side read wired), grocery/calendar.

## Data model

No new tables (Wave 1's `0029` already has `meal_plans` + `plan_assignments`).

Store additions:
```ts
athletePlans: Record<string, PlanSlot[]>   // key = athleteId ?? name; the coach's working plans
planEditTarget: { kind: 'self' } | { kind: 'athlete'; key: string; name: string }
bulkAssignOpen: boolean                     // the bulk-assign overlay
```
`athletePlans` is persisted (partialize). `planEditTarget` defaults to `{ kind: 'self' }`.

Pure helpers (`src/core/athletePlans.ts`):
```ts
getAthletePlan(map, key): PlanSlot[]                       // [] when absent
setAthletePlan(map, key, slots): Record<string, PlanSlot[]>
assignPlanToMany(map, keys, slots): Record<string, PlanSlot[]>   // copies slots to each key
```

## Editor scoping

`CoachPlanEditor` reads `planEditTarget`:
- `self` → reads/writes `planSlots` + `setPlanSlots` (today's behaviour, unchanged).
- `athlete:<key>` → reads `getAthletePlan(athletePlans, key)` and writes via
  `setAthletePlan`; the header shows the client's name ("Coach Plan · Maya Lopez"); Generate
  seeds that client's plan. On Done, if `isBackendLive` + a real `athleteId`, call the
  backend seam; else demo-safe note.

`openPlanEditor()` keeps its self behaviour; a new `openAthletePlanEditor(key, name)` sets
`planEditTarget` then opens. PersonDetail calls the latter.

## UI

- **PersonDetail:** a "Meal plan" row beneath "Targets & scoring" — same card idiom,
  `Icon name="sparkle"`, subtitle "Prescribe meals for {name}". Opens the scoped editor.
- **Bulk assign:** a coach-dashboard entry "Assign a plan" → overlay: (1) Generate/confirm a
  plan (reuse the slot list), (2) a checklist of roster clients, (3) "Assign to N" →
  `assignPlanToMany`. Demo-safe; backend seam when live.

## Backend seam (`src/lib/ai/` or `src/lib/mealPlans.ts`)

```ts
isMealPlanSyncConfigured: boolean            // isBackendLive && configured
saveMealPlan(args): Promise<{ id: string } | null>          // insert meal_plans, returns id or null
assignPlan(planId, athleteIds): Promise<boolean>            // insert plan_assignments (many)
```
Both no-op (return null/false) when not live. Real inserts use the existing supabase client
+ RLS (author = auth.uid()). Not runtime-verifiable until `0029` is applied — unit-test the
argument shaping; guard every call behind `isBackendLive`.

## Non-goals / invariants

- Day-score formula still untouched; compliance still display-only.
- Everything new is gated by `isMealPlansEnabled`; flag-off renders exactly as today.
- The AI never auto-assigns: bulk assign always shows the plan for coach confirmation first.
- No fabricated backend writes in the demo (match `CoachGoalsEditor`).

## Build sequence (each ends runnable)

1. `athletePlans.ts` pure helpers + tests.
2. Store: `athletePlans`, `planEditTarget`, actions (`openAthletePlanEditor`,
   `setAthletePlanSlots`, `assignPlanToMany`, bulk-assign open/close) + partialize + a pure
   reducer test.
3. `CoachPlanEditor` scoped by `planEditTarget` (self vs athlete), header name, correct
   read/write.
4. PersonDetail "Meal plan" entry.
5. Bulk-assign overlay + coach entry.
6. Backend seam `mealPlans.ts` (inert unless live) + shape tests.
