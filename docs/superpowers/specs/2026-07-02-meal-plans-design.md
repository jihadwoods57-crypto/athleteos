# Meal Plans — Design

**Date:** 2026-07-02
**Status:** Approved for planning
**App:** OnStandard (athlete-accountability, Expo/RN + Supabase)

## Problem

OnStandard is accountability-first: an athlete logs what they eat (photo + AI vision),
gets a quality score, and a coach sees compliance against generic macro *targets*. There
is no concept of a *prescribed plan* — "here are the 6 specific meals you are supposed to
eat today." Coaches/nutritionists want to hand an athlete an actual plan, and measure
compliance against **that plan**, not against generic macros.

## Decisions (locked)

1. **Both, layered.** A plan slot can be *pinned* ("eat this exact meal") or *open* ("hit
   these macros — pick from approved options"). One union type serves the whole roadmap.
2. **AI drafts, human approves.** The AI generator is the primary authoring surface; the
   coach/nutritionist is the gate. AI never auto-assigns. (Matches the app-wide
   "AI proposes, the professional stays in control" rule.)
3. **Approach C — plan as the primary layer, freeform as the floor.** When a plan is
   active it drives the top of the Nutrition screen (completion, photos, follow-ups).
   The existing macro scoring keeps running unchanged underneath, so there is **one
   score**, not a competing "plan compliance" number in the scoring path. No plan → the
   current freeform Nutrition screen, unchanged.
4. **Extras in v1:** restaurant equivalents, smart substitutions, bulk assign, templates +
   library — but **sequenced in waves** so every step ships runnable.

## Why Approach C (and the ripple map)

The point of C is that it **barely changes anything upstream**:

- **Onboarding — no new athlete steps.** The AI "protocol builder" inputs (current/target
  weight, calories, meals/day, position, goal, deadline) are *already collected* at
  onboarding (`baseWeight`, `weightTarget`, `weeklyGoalLb`, `position`, `baseGoal`,
  `baseMealsPerDay`). The generator **prefills** from them. Athletes never author a plan
  (self-serve was cut), so athlete onboarding is untouched. Only optional add: a
  coach/nutritionist gets an "assign a starter plan" nudge after linking their first
  athlete.
- **Scoring — weights untouched.** Constitution Rule #13 (platform owns the scoring
  formula) is honored: the day score stays macro-based. "Plan compliance %" is a **display
  metric layered on top**, never a change to how points are earned. Athlete follows plan →
  hits macros → scores well.
- **`meals` / `days` tables — unchanged.** Compliance is a pure function matching existing
  logged `meals` rows to plan slots.
- **Beta safety.** The whole system sits behind a feature flag (like `isEnginesEnabled`),
  so the prove-the-loop beta is unaffected until it is flipped on.

## Data model

### Extended `CoachPlan` (src/core/coachPlan.ts)

`CoachPlan` today carries `calorieTarget`, `proteinTarget`, `windows`, `instructions`.
It gains one field:

```ts
CoachPlan {
  ...existing...
  slots: PlanSlot[]            // NEW — the prescribed meals
}

PlanSlot {
  key            'breakfast' | 'lunch' | 'snack' | 'dinner'  // matches a MealWindow
  mode           'pinned' | 'open'
  macros         { kcal: number; protein: number; carbs?: number; fat?: number }
  pinnedMeal     PlanMeal | null      // set when mode === 'pinned'
  options        PlanMeal[]           // approved choices when mode === 'open' (#3)
  restaurantAlts PlanMeal[]           // Chipotle / Publix / Wawa equivalents (#4)
  note           string | null        // "eat within 30 min of waking" — shows when the window opens (#12)
  photoRequired  boolean              // (#9)
}

PlanMeal {
  name    string                 // "High-Calorie Breakfast"
  items   string[]               // ["4 eggs","4 pancakes","turkey sausage"]
  macros  { kcal; protein; carbs; fat }
  source  'ai' | 'template' | 'restaurant'   // provenance
}
```

`DEFAULT_PLAN` gains `slots: []`. `activePlan()` reads `slots` from the athlete's active
plan (or `[]` when none), so every existing caller is unchanged when there is no plan.

### New Supabase tables (migration `0027_meal_plans.sql`, RLS team-scoped)

- **`meal_plans`** — one row per plan *or* template.
  `id, author_id, athlete_id (null = template/master), name, version int,
  status ('draft'|'active'|'archived'), goal_json jsonb (protocol-builder inputs the AI
  received), plan_json jsonb (the PlanSlot[] array), created_at, updated_at`.
- **`plan_assignments`** — `id, plan_id, athlete_id, assigned_by, assigned_at, status`.
  Enables **bulk assign** (#16) as insert-many; individual customization = clone the plan
  for that athlete and reassign.
- **`meal_templates`** — reusable `PlanMeal`s a coach searches/drags (#2/#13). **Deferred
  to Wave 3.**

**Why jsonb `plan_json` instead of a relational `plan_slots` table:** the app already
stores a day's meals as a jsonb blob and scores it client-side in pure TS (`src/core`).
Keeping slots as a blob read by `activePlan()` routes the plan through the *exact same*
trusted, offline-testable scoring path — no new query layer, no child-row RLS. Relational
slots would buy queryability not yet needed and cost that clean seam.

## AI generator

New edge function **`plan-generate`** (pattern: existing `analyze-meal` / `assist` —
Claude, keyed, metered via `ai_usage_daily`).

- **Input:** protocol params prefilled from onboarding + a free-text prompt
  ("5,200 cal, 6 meals, 2 shakes, 290lb OL").
- **Output:** a `PlanSlot[]` JSON, **zod-validated (forbid-unknown)** before it reaches
  the coach.
- **Discipline:** Claude drafts only. It never assigns. The coach lands in an editable
  review.

## Author flow (coach)

`CoachPlanEditor` evolves. Existing targets/windows/instructions stay. Adds:

- **"Generate plan"** → protocol form → `plan-generate` → editable draft `slots`.
- Per slot: flip pinned⇄open, edit items, toggle `photoRequired`, add `note`, regenerate
  one slot, accept.
- **Save** → `meal_plans` row (`draft` → `active` on assign).
- **Assign:** PersonDetail (single); roster (**bulk**, #16).

## Athlete consumption (Nutrition.tsx)

When `plan_assignments` yields an active plan:

- **"Today's Prescribed Meals"** renders at the top: each slot shows its pinned meal or its
  approved options + restaurant alts.
- Per-meal `note` appears only when its window opens (#12).
- `photoRequired` slots demand a photo (#9).
- Logging matches to the slot → states become 🟡scheduled / 🟢completed / 🔴missed (#8);
  existing reminders become the auto follow-up (#10).
- **Plan compliance %** is a derived read (#11). **The day score is unchanged.**
- No active plan → today's freeform screen (macro rings, protein gap, snacks), unchanged.

## Compliance (pure function, no schema change)

`planCompliance(slots, loggedMeals, windows)` in `src/core`:

- Matches each logged `meals` row to a slot by `type` + logged-within-window time.
- Per-slot state: completed (logged + macros within tolerance), partial, missed.
- Overall % = completed slots / required slots, with a hydration line reusing existing
  hydration tracking.
- Fully unit-testable offline, alongside existing `src/core` tests.

## Smart substitutions (#6)

Extends the existing meal-vision function: when a logged meal misses the slot's macros,
the AI returns the **closest compliant swap** ("replace with grilled chicken + fruit +
chocolate milk"), phrased as a coach would — never "bad meal." Same provenance discipline.

## Restaurant equivalents (#4)

Generated at plan time (part of `plan-generate` output, `restaurantAlts` per slot) and
surfaced in the slot UI so a traveling athlete stays compliant. Builds on the existing
Restaurant Coach ("what should I eat?") seam.

## Build sequence (each wave ends runnable)

- **Wave 1 — spine + cheap wins:** extended `CoachPlan` + `plan-generate` + author flow +
  athlete consumption + `planCompliance` + smart substitutions (#6) + restaurant
  equivalents (#4).
- **Wave 2 — roster scale:** bulk assign (#16) + per-athlete customize via plan clone.
- **Wave 3 — authoring speed:** templates + meal library (#2/#13).

## Feature flag

A master switch (mirroring `isEnginesEnabled`) gates the entire plan system: coach
"Generate plan" entry, athlete "Today's Prescribed Meals", compliance reads. OFF for the
current beta; nothing in the existing loop changes until it is ON.

## Explicitly deferred (from ChatGPT's 18, not in v1)

Grocery mode (#5), calendar week view (#7), version history (#15), weekend plans (#17),
full drag-drop Composer. Revisit after Wave 3 if demand is real.

## Non-goals

- The AI never auto-assigns a plan.
- No change to the day-score formula or its weights.
- No change to the `meals` / `days` logging schema.
