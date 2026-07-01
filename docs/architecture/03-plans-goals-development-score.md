# 03 — Plans, Goals, Templates, Seasons & Development Score Governance

> Slice owner: Principal Enterprise Architect. Status: **DESIGN ONLY** (no code, no migrations, no tests).
> Scope: Deliverables #9 (Plan Versioning), #11 (Development Score Governance), #17 (Season Management),
> plus the Plan System, Multiple/Reference Plans, the Goal System, and the Plan Template Library.

## 1. Summary

OnStandard today computes a single, deterministic Development Score in `src/core/scoring.ts` from one
implicit plan (athlete-editable targets + `DEFAULT_PLAN` windows) and one of two hard-coded
`ScoringProfile` weight sets in `src/core/scoringProfiles.ts`. The 10-year target keeps that pure
formula **exactly where it is** and turns everything the formula reads — the plan, the weight set, the
goals, the season — into **immutable, versioned, org-owned configuration data** that scoring and AI both
resolve through one tuple: **`(active_plan_version, weight_set_version, season)`**. A plan is a typed,
versioned bundle of targets + windows + instructions + goals; an athlete may carry many plans but exactly
one is `active` (drives score/AI/accountability) and the rest are `reference`. Every day-score row freezes
the IDs of the plan version and weight-set version that produced it, so **history is never rewritten**.
Org-customizable weighting is allowed only as a **validated, normalized, bounded weight set inside a
platform-owned profile** — never a free re-weight — preserving the Constitution §11a Scoring Contract: the
coach owns the PLAN, the platform owns the FORMULA, the AI recommends. Templates are immutable published
plan versions an org can instantiate; the AI recommends templates by org/sport but never invents targets.

## 2. Reconciliation with today

| Element | Tag | Notes |
|---|---|---|
| Deterministic Development Score formula (`computeDerived`, `profileNutritionScore`) | **[ALREADY BUILT]** | `src/core/scoring.ts`, `src/core/scoringProfiles.ts`. The platform-owned formula. Stays pure, stays canonical. |
| `ScoringProfile` = `'athlete' \| 'general'` + `PROFILE_WEIGHTS` | **[ALREADY BUILT → EVOLVE]** | Two hard-coded weight maps. Evolve into a `weight_set` row keyed by profile, validated/normalized, versioned. Constitution §11b names `ScoringProfile` as the seed of the Context model. |
| The "plan" as athlete-editable `proteinTarget`/`calTarget`/`weightTarget`/`planInstructions` + `DEFAULT_PLAN` | **[ALREADY BUILT → EVOLVE]** | `src/core/coachPlan.ts` `activePlan()` already calls itself "THE KEYSTONE." Evolve the implicit single plan into a typed, versioned, multi-plan model with one active. |
| `athlete_profiles.targets` / `season_goal` jsonb + `coach_set_goals()` RPC | **[ALREADY BUILT → EVOLVE]** | `0001_schema.sql`, `0002_rls.sql:177`. Becomes the *legacy mirror* of the active plan version; writes route through a versioning RPC instead of an in-place `update`. |
| `days.score` / `days.grade` / `days.computed_at` | **[ALREADY BUILT → EVOLVE]** | Already stamps a per-day score. Add frozen `plan_version_id`, `weight_set_id`, `season_id`, `explain` jsonb to make history self-describing and immutable. |
| RLS spine: `can_view()`, `is_self()`, `is_team_coach_of()`, `is_trainer_of()` | **[ALREADY BUILT]** | `0002_rls.sql`. All new tables reuse it verbatim. Athlete owns writes to *their* day/score; coach writes *plan config* via SECURITY DEFINER RPC only. |
| Consent fail-closed gate (`realDataConsent`) | **[ALREADY BUILT]** | `src/core/consent.ts`. Plan/score sync inherits it unchanged: no plan-derived real data leaves a minor's device pre-verification. |
| Subscription inert seam | **[ALREADY BUILT]** | `src/core/subscription.ts`. Template Library tiers + plan-count limits gate through `isPro()`; inert today. |
| Multiple plans per athlete (active + reference) | **[NEW]** | New `plans` + `plan_versions` tables; `active_plan_id` pointer on the athlete. |
| Immutable plan **versioning** (#9) | **[NEW]** | `plan_versions` append-only; `days` freeze the version id. |
| Org-scoped **weight-set governance** (#11) | **[NEW]** | `score_weight_sets` table + validation RPC (normalize, bound, version). |
| **Season** model (#17) | **[NEW]** | `seasons` table carrying its own active plan + weight set + AI posture. |
| Plan **Template Library** | **[NEW]** | `plan_templates` (published immutable plan versions) + `instantiate_template()` RPC. |
| Goal system (1 primary + N secondary) | **[EVOLVE]** | Today: scalar `weightTarget` + free-text `goals[]`. Evolve to a structured `goals` array inside the plan version. |
| Server-side score recompute / anti-tamper trigger | **[DON'T BUILD YET]** | `0002_rls.sql:190` already flags it as optional hardening. A Postgres re-impl of `computeDerived` must stay byte-for-byte synced — high cost, low current value with backend OFF. See §6. |
| Org-level **Context model** beyond athlete/general profiles | **[DON'T BUILD YET]** | "Design for many, ship two" (§11b). Build the *seam* (profile = data row), populate only the two profiles the wedge needs. |
| Cross-org / lifetime score comparability warehouse, "Momentum" analytics service | **[DON'T BUILD YET]** | Derivable from the frozen history; ship as read-side views/jobs only after the loop retains. |

---

## 3. The Design

### 3.0 The cross-cutting contract (the tuple everything reads)

Every scoring computation and every AI/coaching surface resolves the **scoring context tuple** for an
athlete on a date:

```
ScoringContext = {
  athlete_id,
  date,
  season_id        | null,   // §3.5
  plan_version_id,           // the immutable active plan version on that date (§3.1)
  weight_set_id,             // the immutable, validated weight set on that date (§3.4)
  goals,                     // primary + secondary, embedded in the plan version (§3.3)
  profile,                   // 'athlete' | 'general' — the platform formula selector
}
```

**Contract for all other slice docs:** *No surface may read targets, weights, profile, or goals from
anywhere except a resolved `ScoringContext`.* The plan/season editor writes new **versions**; the day
recorder freezes the tuple's IDs onto the day row; readers (Home, Coach, Parent, AI) resolve the same
tuple, so scoring, copy, recommendations, and card selection can never disagree about who the user is or
what plan governs them (Constitution §11b). This is the successor to passing `scoringProfile` around as a
loose enum.

### 3.1 Plan & Plan Version model

A **Plan** is a stable container ("Football Nutrition Plan"); a **Plan Version** is an immutable snapshot
of its contents. Editing a plan **appends a new version**; it never mutates an existing one. This is what
makes #9 true — a historical day always references the version that existed at the time.

```
plans
  id            uuid pk
  athlete_id    uuid not null  -> profiles(id)        -- the plan's subject
  author_id     uuid not null  -> profiles(id)        -- who owns/edits it (coach/trainer/nutritionist/parent/self)
  author_scope  enum('team','practice','guardian','self')   -- which relationship authored it (drives RLS + reports)
  plan_type     text not null                          -- 'weight_gain'|'weight_loss'|'recomp'|'recovery'|
                                                        --  'offseason'|'in_season'|'muscle_gain'|'personal_training'|
                                                        --  'nutrition_coaching'|'general_wellness'|... (open vocabulary)
  title         text not null
  relation      enum('active','reference') not null default 'reference'   -- see §3.2
  current_version_id uuid -> plan_versions(id)         -- the latest published version
  template_id   uuid null -> plan_templates(id)        -- provenance if instantiated from a template
  created_at    timestamptz
  archived_at   timestamptz null

plan_versions                       -- APPEND-ONLY. never UPDATE, never DELETE.
  id             uuid pk
  plan_id        uuid not null -> plans(id)
  version_no     int not null                          -- 1,2,3... monotonic per plan
  profile        enum('athlete','general') not null    -- which platform formula measures this plan
  targets        jsonb not null   -- { protein_g, calories_kcal, hydration_l, meals_per_day }
  windows        jsonb not null   -- [{ key, label, open_min, deadline_min, required }]  (CoachPlan.windows shape)
  instructions   text[] not null default '{}'          -- standing instructions ("Pre-bed protein shake")
  expectations   text null                             -- coach expectations / special instructions (free text)
  goals          jsonb not null   -- { primary: Goal, secondary: Goal[] }  (§3.3)
  components      jsonb not null   -- on/off relevance toggles { nutrition, recovery, tasks, checkin } (§11a "relevant")
  effective_from date not null    -- the date this version starts governing scoring
  authored_by    uuid not null -> profiles(id)
  created_at     timestamptz
  unique (plan_id, version_no)
```

**TypeScript (pure `src/core/plan.ts` — [NEW], no RN/Supabase imports):**

```ts
export type PlanRelation = 'active' | 'reference';
export type PlanType = string; // open vocabulary; UI offers a curated list

export interface PlanTargets {
  proteinG: number; caloriesKcal: number; hydrationL: number; mealsPerDay: number;
}
export interface PlanVersion {
  id: string; planId: string; versionNo: number;
  profile: ScoringProfile;             // reuse existing type
  targets: PlanTargets;
  windows: MealWindow[];               // reuse coachPlan.MealWindow
  instructions: string[];
  expectations: string | null;
  goals: GoalSet;                      // §3.3
  components: ComponentRelevance;      // { nutrition; recovery; tasks; checkin }: boolean
  effectiveFrom: string;               // ISO date
}
// Resolve a CoachPlan (the existing keystone shape) from a PlanVersion, so scoring.ts is unchanged.
export function coachPlanFromVersion(v: PlanVersion): CoachPlan { /* pure projection */ }
```

> **Design call:** `activePlan()` in `coachPlan.ts` stays the keystone selector but is *fed* by
> `coachPlanFromVersion(activeVersion)` instead of reading loose `AppState` fields. `scoring.ts` does not
> change at all — it still consumes a `CoachPlan` + `ScoringProfile`. We changed *where the plan comes
> from*, not *how it scores*. This preserves the ~970 tests and the formula's purity.

### 3.2 Multiple plans, one active (the hierarchy + switching)

An athlete carries N plans (`Football Nutrition Plan`, `Personal Nutritionist Plan`, `Parent Plan`,
`Personal Goal Plan`). **Exactly one** has `relation = 'active'`; it alone drives the Development Score,
the AI, and accountability. All others are **Reference Plans**: visible, comparable, AI-aware, but
non-scoring.

```
athlete_active_plan                 -- one row per athlete; the single source of "which plan governs"
  athlete_id    uuid pk -> profiles(id)
  plan_id       uuid not null -> plans(id)
  set_by        uuid not null -> profiles(id)
  set_at        timestamptz
```

- **Why a pointer table, not a column on `plans`:** the active plan is a *property of the athlete*, and
  switching must be a single atomic write that flips governance without rewriting any plan row. It also
  gives RLS a clean object to authorize ("who may switch the active plan").
- **Switching policy (INFERRED — founder confirm):** switching the active plan is **forward-only** —
  it sets the new plan's `effective_from`-style governance from the switch date; **it never restates past
  days**. Yesterday's score still references yesterday's active plan version (#9 invariant). This is the
  Stripe lesson: configuration changes are events with an effective date, not retroactive edits.
- **Permission per plan:** the author of a plan (or any author in the same scope) may edit/version it;
  switching *which* plan is active is governed separately (§3.6) — typically the athlete consents, or the
  primary professional sets it, depending on org policy.
- **Reports/AI per plan:** Active plan → full execution scoring + accountability nudges. Reference plans →
  the AI may surface "your Personal Nutritionist Plan wants 200g protein; today's active plan wants 180g"
  as *context*, never as a competing score. **One number** stays sacred (Founder Rule #9): only the active
  plan produces a Development Score.

> **Challenge to the founder's framing:** "Parent Plan" and "Personal Goal Plan" as *plans* risk plan
> sprawl and a UI where four people fight over the active slot. Recommended guardrail: cap **active-eligible**
> plans to professional-authored ones (team/practice/nutritionist) plus exactly one self-authored "Personal
> Goal" plan; parent/self plans default to `reference`. This protects "Never replace the coach" (Rule #3)
> and "Reduce decisions" (Rule #5) while still honoring multi-plan. Flagged for confirmation.

### 3.3 Goal system (primary + secondary)

Goals live **inside the plan version** (so they version with the plan and freeze into history), not as a
separate floating table. One **primary** goal the AI optimizes; N **secondary** goals it supports.

```ts
export type GoalKind =
  | 'body_weight' | 'body_fat' | 'protein' | 'hydration'
  | 'sleep_consistency' | 'performance_metric' | 'custom';
export interface Goal {
  id: string;
  kind: GoalKind;
  label: string;                 // "Gain 15 lb", "Hydration consistency"
  target: number | null;         // 15, or null for habit goals
  unit: string | null;           // 'lb','%','g','L','nights/wk'
  start: number | null;          // anchor for progress (seasonGoalProgress already does this math)
  deadline: string | null;       // ISO date
  priority: 'primary' | 'secondary';
}
export interface GoalSet { primary: Goal; secondary: Goal[]; }
```

- **AI behavior (deterministic floor):** the AI ranks "what should I do next?" (§11b Q4) by primary goal
  first, then secondaries. Phrasing is the LLM layer; the *prioritization order* is deterministic from
  `GoalSet`. The AI never edits a goal's target — only recommends one for the coach to accept (§11a).
- **Reuse:** `seasonGoalProgress()` / `seasonGoalPhase()` in `scoring.ts` already compute clamped progress
  + a "first-run/tracking/reached" phase for a weight goal; generalize them to any numeric `Goal`. This is
  [EVOLVE], not [NEW] math.
- **Scoring boundary (invariant):** goals feed the **weight/progress track and the AI**, NOT the daily
  Development Score directly. Today `weightScore` is deliberately *not* folded into `athleteScore`
  (`scoring.ts` lines ~266–281). Keep that separation: a flawless day is an A even if a long-arc goal is
  slow. **Confirm with founder** that secondary goals likewise stay out of the daily number.

### 3.4 Development Score Governance — weight sets (#11)

The single hardest governance problem. Orgs want to customize weighting (Football: protein 40 / calories
30 / hydration 20 / timing 10) **without breaking integrity**. The resolution (Constitution §11a):
**weights are configurable data inside a platform-owned profile, validated, normalized, bounded, and
versioned.** No human ever assigns a *score*; they only tune *weights within rails*.

```
score_weight_sets                   -- APPEND-ONLY (versioned, like plan_versions)
  id             uuid pk
  scope          enum('platform','org','team','practice','season') not null
  scope_id       uuid null          -- org/team/practice/season id; null for platform defaults
  profile        enum('athlete','general') not null   -- which platform formula this re-weights
  version_no     int not null
  weights        jsonb not null     -- normalized component weights, see invariants
  sub_weights    jsonb null         -- optional nutrition sub-component weights (protein/calorie/timing/hydration)
  status         enum('draft','published','retired') not null default 'draft'
  effective_from date not null
  authored_by    uuid not null -> profiles(id)
  created_at     timestamptz
  unique (scope, scope_id, profile, version_no)
```

**Integrity invariants (enforced by a pure validator in `src/core/scoreWeights.ts` [NEW] AND mirrored in
the publishing RPC — defense in depth):**

1. **Components are the platform set, not invented.** `weights` keys ⊆
   `{ nutrition, recovery, tasks, checkin }` — the four `SCORE_WEIGHTS` keys that already exist. A coach
   cannot add a metric (§11a: "may NOT re-weight or invent metrics" → we allow *bounded* re-weight, never
   invention).
2. **Normalization.** Weights are stored and applied **normalized to sum 1.0** (reject/auto-normalize
   non-summing input). `PROFILE_WEIGHTS` already sums to 1.
3. **Per-component bounds (INFERRED — founder/RD confirm).** Each component clamped to a `[min,max]` rail
   (e.g. nutrition ∈ [0.35, 0.65]; no component may be 0 if its plan component is `on`, and none may
   dominate so far that the score becomes single-signal). Bounds are the rail that keeps an "84"
   comparable across the platform.
4. **Sub-weights bounded the same way** if an org tunes the nutrition internals (protein/calorie/timing/
   hydration). Default sub-weights = the shipped athlete/general formulas in `scoringProfiles.ts`.
5. **Determinism preserved.** The formula is still `Σ wᵢ · componentScoreᵢ`, clamped 0–100. Changing
   weights re-weights; it can never make the score non-deterministic, non-explainable, or unbounded.

```ts
// src/core/scoreWeights.ts  (pure)
export interface WeightSet {
  profile: ScoringProfile;
  weights: Record<ScoreComponentKey, number>;       // sums to 1, each within rails
  subWeights?: { protein: number; calorie: number; timing: number; hydration: number };
}
export const WEIGHT_RAILS: Record<ScoreComponentKey, { min: number; max: number }> = { /* ... */ };
export function validateWeightSet(w: WeightSet): { ok: boolean; errors: string[]; normalized?: WeightSet };
// scoring.ts changes ONLY in that PROFILE_WEIGHTS[profile] becomes resolveWeights(ctx) -> WeightSet.weights
```

**Resolution order (most specific wins):** `season → team/practice → org → platform default`. The platform
default *is* today's `PROFILE_WEIGHTS` (athlete `.5/.25/.15/.1`). So an org that customizes nothing scores
byte-for-byte as today — the ~970 tests pass unchanged.

**Explainability payload (#11 "transparent, explainable").** Every score carries a frozen `explain` blob
so "What's in this score?" is true forever, not recomputed:

```ts
export interface ScoreExplain {
  total: number; grade: string;
  weightSetId: string; planVersionId: string; seasonId: string | null; profile: ScoringProfile;
  components: { key: ScoreComponentKey; label: string; raw: number; weight: number; contribution: number; desc: string }[];
}
```

This generalizes the existing `SCORE_WEIGHTS` array (`scoring.ts` lines ~141–146) into a per-day frozen
record. Already-present `ScoreWeight.desc` honesty copy ("self-reported", etc.) carries through.

**The derived metrics (#11 list)** — Current, Projected, Weekly/Monthly trend, Season Average, Lifetime
Average, Momentum, Personal Best — are **all read-side aggregations over the immutable per-day score
history**, computed by pure functions in `src/core/scoreStats.ts` [NEW]; none of them write or reset
history. `trendSeries`/`scoreHistory` already seed Current + weekly trend. Season Average filters history
by `season_id`; Lifetime by athlete; Momentum = a slope/EMA over recent days; Personal Best = max over
history. **Never reset history** is enforced structurally: history rows are append-only with a frozen tuple.

### 3.5 Season management (#17)

A **Season** is a dated phase (`offseason | summer | preseason | in_season | playoffs | recovery`) that can
carry its *own* active plan, weight set, and AI posture. It is the top of the resolution order in §3.4.

```
seasons
  id            uuid pk
  scope         enum('team','practice') not null
  scope_id      uuid not null            -- team or practice
  kind          enum('offseason','summer','preseason','in_season','playoffs','recovery') not null
  name          text not null            -- "Fall 2026 In-Season"
  starts_on     date not null
  ends_on       date null
  default_plan_template_id uuid null -> plan_templates(id)   -- the plan new members get this season
  weight_set_id uuid null -> score_weight_sets(id)           -- season-scoped weighting
  ai_posture    jsonb not null default '{}'  -- { emphasis:'recovery'|'volume'|..., intensity:'maintain'|'push' }
  created_at    timestamptz
```

- A season **does not** rewrite an athlete's active plan; it provides the **default** plan template for the
  season and the season-scoped weight set the tuple resolves. Switching seasons is forward-only (same #9
  rule): days scored in the old season keep their frozen `season_id`/`weight_set_id`.
- `ai_posture` is the deterministic input that shifts coaching emphasis (recovery-forward in `recovery`
  season, volume-forward `in_season`) — the LLM phrases it; it never invents safety numbers.
- **Season Average** (#11) is exactly "scores where `days.season_id = X`."

> **Challenge:** seasons are a **team/practice** concept, not an athlete one. An independent athlete with no
> org has `season_id = null` and resolves org/platform weights — no season machinery needed for them. Don't
> force a season onto solo users (Rule #12).

### 3.6 Template Library

A **template** is a published, immutable plan version not bound to an athlete — a starting point so coaches
don't build from scratch.

```
plan_templates
  id            uuid pk
  scope         enum('platform','org') not null   -- platform = curated library; org = a team's saved template
  scope_id      uuid null
  plan_type     text not null
  sport         text null                          -- 'football','basketball','soccer',...  (AI match key)
  org_type      org_type null                      -- reuse existing enum: 'school'|'club'|'independent'
  title         text not null                      -- "Football Weight Gain", "Basketball In Season"
  body          jsonb not null                     -- a full PlanVersion payload (targets/windows/goals/components/profile)
  is_published  boolean not null default false
  created_by    uuid null -> profiles(id)
  created_at    timestamptz
```

- `instantiate_template(template_id, athlete_id)` RPC creates a `plans` row + `plan_versions` v1 copying
  `body`, stamping `template_id` provenance. The coach then customizes (which appends v2). Templates are
  **immutable**; "editing a template" publishes a new template row, never mutates the old (so any plan that
  cited it can still be traced).
- **AI recommends templates by org/sport** (§11b, deterministic): rank `plan_templates` by
  `(sport, org_type, plan_type, season.kind)` match against the athlete's context. The AI *recommends*;
  the coach *accepts* — never auto-applied (§11a). Targets inside the template are evidence-based
  deterministic defaults, never model-hallucinated, **especially for minors** (Rule #8, §11a).
- Platform templates seed the library; **[DON'T BUILD YET]:** an org-authored template marketplace /
  sharing-across-orgs is correct long-term but over-engineering now.

### 3.7 RLS & RPC shapes (reusing the existing spine)

All new tables reuse `can_view()`, `is_self()`, `is_team_coach_of()`, `is_trainer_of()` from
`0002_rls.sql`. Athletes never lose ownership of their **day/score** data; coaches own **plan config** and
write it only through SECURITY DEFINER RPCs (mirroring `coach_set_goals`).

```sql
-- READ: plan visibility = can_view(athlete_id) (athlete + their linked coaches/trainers/guardians)
create policy plans_read on plans for select using (can_view(athlete_id));
create policy pv_read    on plan_versions for select using (
  can_view((select athlete_id from plans p where p.id = plan_id)));

-- WRITE: no direct INSERT/UPDATE on plan_versions. All edits go through versioning RPCs (append-only):
--   publish_plan_version(plan_id, body jsonb) -> uuid     -- authz: author in plan's scope; bumps version_no
--   set_active_plan(athlete_id, plan_id)       -> void    -- authz: §3.2 policy; writes athlete_active_plan
--   publish_weight_set(scope, scope_id, profile, weights, sub_weights) -> uuid
--        -- authz: org/team/practice admin; SERVER-SIDE re-runs validateWeightSet; rejects out-of-rail
--   instantiate_template(template_id, athlete_id) -> uuid -- authz: is_team_coach_of/is_trainer_of(athlete)
--   open_season(scope, scope_id, kind, starts_on, template_id, weight_set_id) -> uuid
```

- **Invariant enforced server-side:** `publish_weight_set` re-runs the same rail/normalization checks the
  pure `validateWeightSet` runs on the client — a tampered client can never store an integrity-breaking
  weight set. This is the §11a guarantee in SQL.
- **Day write stays athlete-only** (`days_write/days_update` policies unchanged). The freeze of
  `plan_version_id`/`weight_set_id`/`season_id`/`explain` onto `days` happens in the athlete's own write
  path (client resolves the tuple, writes its own day) — so no new privilege is granted.

### 3.8 Immutability & history (the #9 / #11 invariant, made structural)

```
days  (EVOLVE existing table — add frozen columns)
  ...existing...
  plan_version_id  uuid -> plan_versions(id)   -- the active plan version that governed this day
  weight_set_id    uuid -> score_weight_sets(id)
  season_id        uuid null -> seasons(id)
  explain          jsonb                        -- frozen ScoreExplain (§3.4)
```

- `plan_versions` and `score_weight_sets` are **append-only** (RLS grants no UPDATE/DELETE; a
  retention policy may archive, never edit). A historical day therefore always resolves the *exact* plan +
  weights it was scored under — **history can never be rewritten** even if the athlete switches plans or the
  org re-weights tomorrow.
- Recompute, if ever run (§6), recomputes only *today/forward*, never backfills past `explain`.

---

## 4. Text ER sketch

```
profiles ─┬─< plans ──< plan_versions            (plan_versions: append-only, immutable)
          │      │            ▲
          │      │            │ template_id
          │      └── athlete_active_plan          (1 row/athlete -> the ONE active plan)
          │
          ├─< days ──> plan_version_id            (frozen) ──┐
          │       └──> weight_set_id (frozen) ──┐            │
          │       └──> season_id    (frozen) ─┐ │            │
          │                                   │ │            │
orgs/teams/practices ──< seasons ─────────────┘ │            │
        │                   └──> weight_set_id ──┤            │
        └──< score_weight_sets ──────────────────┘            │
                 (scope: platform/org/team/practice/season)   │
plan_templates ───────────────────────────────────────────────┘ (instantiated into plans/plan_versions)

ScoringContext(athlete,date) = resolve( active_plan_version, weight_set[season>team>org>platform], season, goals, profile )
   └── feeds coachPlanFromVersion() -> CoachPlan -> scoring.ts computeDerived()  [formula UNCHANGED]
```

---

## 5. Open decisions for the founder

1. **Active-plan eligibility & arbitration (§3.2).** Do parent/self plans get to be `active`, or are they
   reference-only with one self-authored "Personal Goal" slot? Who wins when a coach and a nutritionist
   both want the active slot — athlete consent, or primary-professional priority? *(Recommend: professional-
   authored + one personal; athlete consents to switches.)*
2. **Switching is forward-only / never restates history (§3.2, §3.5).** Confirm this is the intended #9
   semantics (it is the Stripe model). If a coach wants a "this was always the plan" correction, that is a
   new explicit "backfill" action with its own audit, not a silent edit.
3. **Weight-set rails (§3.4 invariant 3).** The exact per-component `[min,max]` bounds (and whether
   nutrition sub-weights are even org-tunable in v1) need founder + RD sign-off. These rails are the line
   between "customizable" and "gameable."
4. **Do secondary goals stay out of the daily Development Score? (§3.3).** Current architecture keeps
   weight/long-arc progress *separate* from the daily number. Confirm secondaries (sleep, body-fat) are
   AI/track signals, not daily-score components — else "one number" dilutes.
5. **Profile vocabulary cadence (§11b "design for many, ship two").** Stay at `athlete | general` until the
   loop retains? (Recommend yes — build the weight-set/profile *seam*, populate only two.)
6. **`general` weight set sign-off.** `scoringProfiles.ts` flags `general` (`.55/.2/.15/.1`) + its
   calorie-adherence numbers as pending RD sign-off. The governance model above is the mechanism to ratify
   them as a published platform weight set.

---

## 6. Explicitly deferred ([DON'T BUILD YET])

- **Server-side score recompute / anti-tamper trigger.** Already flagged optional in `0002_rls.sql:190`.
  A Postgres re-impl of `computeDerived` must stay byte-for-byte synced with `src/core` — high maintenance
  cost, near-zero value with backend OFF and the formula already canonical in pure TS. Revisit when (a)
  backend is live for real athletes and (b) score-gaming is an observed threat. Until then, `src/core`
  remains the single canonical formula and the client writes its own (RLS-scoped) day.
- **Org template marketplace / cross-org sharing.** Correct at scale; over-engineering pre-proof.
- **Full N-profile Context model / per-user-type code paths.** Build the data seam; ship two profiles.
- **Lifetime/cross-season analytics warehouse + Momentum service.** All derivable as pure read-side
  functions over the immutable history; promote to a materialized/job layer only after retention is proven.
