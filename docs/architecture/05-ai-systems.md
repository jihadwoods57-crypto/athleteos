# 05 — AI Systems: Memory, Performance Profile, Copilot, Personality, Authority, Meal Analysis

> Slice owner: Principal Enterprise Architect. Status: **DESIGN ONLY** (no app/TS code, no SQL migrations, no tests).
> Scope: Deliverables #12 (AI Memory), #13 (Performance Profile), #18 (Coach Copilot), plus AI Personality,
> AI Authority, Meal Analysis. Depends on the contracts in `01-data-model-and-org-hierarchy.md`,
> `02-roles-permissions-security.md` (the `allowed()` predicate), `03-plans-goals-development-score.md`
> (the `ScoringContext` tuple), and the accountability signals owned by `04`.

## 1. Summary

Today AthleteOS has **no AI doing work**: meal "analysis," coaching language, and team summaries are all
deterministic functions in `src/core` (`coaching.ts`, `content.ts`, `mealEdit.ts`, `attention.ts`), and the
only real AI seam — `src/lib/ai/` — is inert (`isAiConfigured === false`), so every label honestly reads
"Coach"/"Coach memory" via `aiPrefix` (Founder Rule #8). The 10-year target keeps that exact boundary and
makes it the spine of the whole AI system: **the deterministic core is the AUTHORITY (scoring, targets,
safety numbers, the at-risk ranking, the coach's plan); the LLM is the LANGUAGE LAYER only (explanation,
drafting, summarization, retrieval-grounded phrasing).** Around that boundary we add four athlete-owned,
org-access-only data assets — a **Performance Profile** (the permanent record that follows the athlete
across orgs), a **Memory store** (structured facts + optional embeddings the LLM retrieves), a **Copilot**
(a tool/skill harness scoped to a coach's groups that *drafts but never sends*), and an **AI Personality**
(an org-configurable posture that re-phrases, never re-decides). Every AI surface runs through one server
seam (`assist()` Edge Function) that injects a deterministic context pack, enforces the **authority rule
(the coach always wins; the engine is ground truth)**, fails closed on consent, and labels honestly until
a model is actually configured. Meal analysis becomes an **honest, correctable estimate with an explicit
confidence score** — low confidence triggers clarification rather than fake certainty.

## 2. Reconciliation with today

| Element | Tag | Notes |
|---|---|---|
| `src/lib/ai/` seam (`analyzeMeal`, `isAiConfigured`, `AI_ENDPOINT`, `aiPrefix`, honest labels) | **[ALREADY BUILT]** | The single entry point + honest-labeling pattern. The whole AI system generalizes this one seam. Stays the contract. |
| Deterministic coaching (`coaching.ts`: `mealCoaching`, `coachingScopeNote`, `medicalDisclaimer`, `coachReinforcement`) | **[ALREADY BUILT → EVOLVE]** | This *is* the LLM's fallback + grounding contract. The LLM phrases over this output shape; it never replaces the safety/scope notes. |
| Meal estimate editing (`mealEdit.ts`: editable foods, `mealQuality`, `addFood`, `removeFood`, `stepServings`) + `mealHistory.ts` | **[ALREADY BUILT → EVOLVE]** | The "honest, correctable estimate" floor. Add a confidence field, reanalyze, replace, delete-accidental, and persisted user corrections that feed Memory. |
| `MealResult` shape (`content.ts`) the UI renders identically real-or-stub | **[ALREADY BUILT → EVOLVE]** | Add `confidence` + `items[]` provenance so low confidence is structural, not cosmetic. |
| At-risk ranking / "who needs attention" (`attention.ts`: `needsAttention`, `riskValue`, `atRiskReason`, `scoreLanguage`) | **[ALREADY BUILT]** | The Copilot's **deterministic answer engine** for "who needs attention today?". The LLM narrates this; it never re-ranks. |
| Goal-Aware Intelligence / `ScoringProfile` as the Context seed | **[ALREADY BUILT → EVOLVE]** | Constitution §11b. The Performance Profile + Memory become the full Context the LLM reads; profile selection stays deterministic. |
| Consent fail-closed gate (`realDataConsent`), third-party-AI disclosure in `consentSummary` | **[ALREADY BUILT]** | Already names Anthropic as the meal-photo processor. Every AI write/read inherits it unchanged; a minor's data never reaches the model pre-verification. |
| The `allowed(viewer, athlete, scope, action)` predicate (doc 02 §3.7) + `ScoringContext` tuple (doc 03) | **[ALREADY BUILT]** (other slices) | The Copilot reads ONLY through `allowed()`; the LLM context pack is built ONLY from a resolved `ScoringContext`. No second access path. |
| **Performance Profile** as a first-class, athlete-owned, portable record (#13) | **[NEW]** | New `performance_profiles` + read-side projection over existing day/score/weight/meal/checkin history. |
| **AI Memory** store: structured facts (+ optional embeddings) (#12) | **[NEW]** | New `athlete_memory_facts` (typed, athlete-owned, append-with-supersede) + deferred `athlete_memory_embeddings`. |
| **Coach Copilot** tool/skill harness (#18) | **[NEW]** | New `copilot_query`/`copilot_artifact` + an Edge Function with a fixed, RLS-scoped tool set. Drafts only. |
| **AI Personality** (org coaching philosophy) | **[NEW]** | New `ai_personality` config on the org/team/practice; a deterministic style token the LLM mirrors. |
| **AI Authority** model (coach always wins, conflict transparency) | **[NEW]** (policy) | A pure `aiAuthority.ts` arbiter + a persisted "AI suggested / coach decided" disagreement record. No new privilege. |
| One server **`assist()`** Edge Function as the single LLM ingress | **[NEW]** | Generalizes `analyze-meal`; holds the key server-side, injects context, enforces authority + consent, labels honestly. |
| Real vision model wired into `analyze-meal` | **[EVOLVE]** | The function exists as a documented seam (`client.ts`); flip it on by configuring the endpoint. The *architecture* is built; the *model* is the switch. |
| Vector DB / semantic memory at scale, behavioral-pattern ML, predictive "who falls behind" model | **[DON'T BUILD YET]** | Structured facts + deterministic risk scoring cover the wedge. Embeddings + learned models earn their place after the loop retains and real data exists. See §9. |
| Fine-tuned org-personality models, multi-agent Copilot, autonomous send | **[DON'T BUILD YET]** | Personality = a prompt/style token, not a model. Copilot never auto-sends. |

---

## 3. The cross-cutting contract (what every AI surface must honor)

This doc adds **one contract** the rest of the system must respect, layered on top of doc 02's `allowed()`
and doc 03's `ScoringContext`:

> **The Authority Boundary.** Every AI surface is a pure function of a deterministic **Context Pack** plus a
> **language model that may only phrase, draft, summarize, or retrieve — never decide.** The numbers
> (Development Score, targets, calorie/protein safety bounds, the at-risk ranking, the active plan) are
> produced by `src/core` and are *immutable inputs* to the LLM. If the LLM output disagrees with the
> deterministic source, **the deterministic source wins and the disagreement is surfaced, not silently
> resolved.** No AI surface may write a score, a target, a plan, or send a message on a human's behalf.

Concretely, every call into the LLM goes through one seam:

```ts
// src/core/assist.ts  ([NEW], pure — builds the request, never calls the network)
export type AssistTask =
  | 'meal_analysis'        // vision -> MealResult + confidence
  | 'meal_coaching'        // phrase the coaching over deterministic mealCoaching()
  | 'copilot_query'        // coach Q&A over RLS-scoped roster signals
  | 'copilot_artifact'     // draft message / report / summary
  | 'memory_extract';      // turn a correction/log into candidate memory facts

export interface ContextPack {
  // EVERYTHING the LLM is allowed to see, already authorized + consent-filtered upstream.
  scoring: ScoringContext;            // doc 03 — the ONE source of plan/targets/profile/goals
  profile: PerformanceProfileView;    // §4 — read-only projection
  memory: MemoryFact[];               // §5 — retrieved, athlete-owned facts
  signals: AccountabilitySignals;     // doc 04 — at-risk / compliance, already computed
  personality: PersonalityStyle;      // §7 — org posture token
  guardrails: Guardrails;             // disclaimers, scope note, minor flag, confidence floor
}
export interface AssistRequest { task: AssistTask; pack: ContextPack; input: unknown; }
// The deterministic fallback for EVERY task, so an unconfigured/failed model never blocks the loop:
export function assistFallback(task: AssistTask, pack: ContextPack, input: unknown): AssistResult;
```

`src/core/assist.ts` is **pure** (no RN/Supabase/network). The network call lives in `src/lib/ai/assist.ts`
(generalizing `client.ts`): it POSTs to the `assist` Edge Function, which holds `ANTHROPIC_API_KEY`, calls
the model, validates the output **against the deterministic guardrails**, and on any failure returns
`assistFallback(...)`. When `isAiConfigured === false`, the lib never calls the network — it returns the
fallback directly, exactly as `analyzeMeal` does today. **Honest labeling (`aiPrefix`/`aiCoachTag`) flips
the day the endpoint is set; no further code change.**

---

## 4. Performance Profile (#13) — the athlete-owned, org-access-only, portable record

The Performance Profile is the **permanent identity of the athlete**: goals, strengths/weaknesses, eating
habits, favorite restaurants/foods, coach feedback, behavior trends, consistency, hydration, meal timing,
weight history, and Development Score history — and later recovery, sleep, wearables, progress photos.
**Every recommendation references it.** It must *follow the athlete across orgs* (the whole moat: a college
inherits the high-school athlete's record).

### 4.1 Design principle: profile = projection + curation, not a duplicate store

Most of the profile is **derived** from data that already exists (`days`, `meals`, `weight_log`, `checkins`,
plan history). We do **not** copy that into a profile table — we project it (pure read-side functions over
the immutable history doc 03 established). The profile table stores only the **durable, curated, slow-moving
record** that isn't a time series:

```
performance_profiles                 -- one row per athlete; the portable record
  athlete_id      uuid pk -> profiles(id)        -- THE athlete owns this row
  summary         jsonb not null default '{}'    -- curated strengths/weaknesses, coach-visible narrative
  habits          jsonb not null default '{}'    -- derived+confirmed: typical meal timing, skipped meals, hydration pattern
  preferences     jsonb not null default '{}'    -- favorite foods/restaurants, budget band, dislikes/allergies (mirrors Memory)
  feedback_log    jsonb not null default '[]'    -- coach feedback entries {author_id, scope, text, at} (append-only)
  baselines       jsonb not null default '{}'    -- starting score, anchor weight, onboarding inputs (immutable anchors)
  updated_at      timestamptz
  schema_version  int not null default 1
```

The **runtime profile** the AI and screens read is a projection:

```ts
// src/core/performanceProfile.ts  ([NEW], pure)
export interface PerformanceProfileView {
  athleteId: string;
  goals: GoalSet;                       // from the ACTIVE plan version (doc 03), not duplicated
  scoreHistory: DayScore[];             // immutable history (doc 03) — never rewritten
  weightHistory: WeightPoint[];
  consistency: { last7: number; last30: number; trend: TrendDir };  // reuse adherence.ts / attention math
  hydration: { typical: number | null; trend: TrendDir };
  mealTiming: { typicalByMeal: Record<MealKey, string | null>; skipped: MealKey[] };
  strengths: string[]; weaknesses: string[];      // from summary + derived signals
  preferences: ProfilePreferences;                // favorite foods/restaurants/budget/allergies (joins Memory)
  feedback: CoachFeedback[];
  // future (DON'T BUILD YET): recovery, sleep, wearables, progressPhotos
}
export function buildProfileView(/* history + profile row + memory */): PerformanceProfileView;
```

> **Architectural call:** the profile is **read-mostly and derived**; only `summary`, curated
> `preferences`, `feedback_log`, and immutable `baselines` are stored. This avoids a stale duplicate of the
> score/weight/meal history (which already lives, immutable, in the doc-03 tables) and guarantees the
> profile can never disagree with the Development Score history. This is the Notion lesson: derive the view,
> store only the irreducible record.

### 4.2 Portability across orgs (the moat) — INFERRED, founder confirm

The profile is keyed to the **athlete (`profiles.id`)**, not to an org. When an athlete joins a new org, the
org gains *access* (via `allowed()`), not *ownership* — the record is unchanged and immediately enriches the
new coach's view. This is the literal expression of the Constitution's "athletes own their data /
organizations own access only."

- **What transfers:** Score history, weight history, baselines, habits, preferences, Memory (athlete-owned).
- **What does NOT transfer by default:** an org's *private coach feedback* about the athlete. `feedback_log`
  entries carry `author_id` + `scope`; a new org sees feedback authored under a relationship it still holds,
  not another org's private notes. **(INFERRED — founder confirm the feedback-visibility rule on org change;
  recommend: athlete-authored + athlete-acknowledged feedback is portable, raw private coach notes are not.)**
- **Leaving an org** revokes the org's *access* (doc 02 archive/retention) but never deletes the athlete's
  profile. Deletion is the athlete's right alone (`delete_account` RPC already exists).

### 4.3 RLS

```sql
-- READ: profile visibility = the standard predicate. NO new access path.
create policy pp_read on performance_profiles for select using ( /* allowed(auth.uid(), athlete_id, scope, 'report.view') */ );
-- WRITE: athlete owns curated self-fields; coach feedback appends via RPC only.
create policy pp_self_update on performance_profiles for update using (is_self(athlete_id));
--   add_coach_feedback(athlete_id, text)        -- SECURITY DEFINER; authz: allowed(..,'nutri.edit'/'goals.edit'); appends to feedback_log
--   confirm_profile_fact(athlete_id, patch)     -- athlete confirms/edits a derived habit/preference
```

---

## 5. AI Memory (#12) — long-term, athlete-owned, smarter every month

Memory is the long-term per-athlete knowledge that makes recommendations personal: goals, favorite foods,
restaurants, allergies, budget, meal timing, travel patterns, eating + hydration habits, coach preferences,
motivation style, skipped/frequent meals, behavior patterns. It must **get smarter every month** and stay
**athlete-owned**.

### 5.1 Structured facts FIRST, embeddings LATER (the key decision)

> **Architectural call: structured, typed facts are the system of record; embeddings are a deferred
> retrieval accelerator, not the store.** A minor's allergy, calorie budget, or "skips breakfast on game
> days" must be a *queryable, auditable, correctable, deterministic* fact — never a fuzzy vector the model
> might miss. This is non-negotiable for a minor-facing nutrition product (a missed allergy is a safety
> incident). Embeddings are added **only** when free-text memory volume makes keyword/typed retrieval
> insufficient — that is post-proof (§9).

```
athlete_memory_facts                 -- append-with-supersede; athlete-owned
  id            uuid pk
  athlete_id    uuid not null -> profiles(id)
  kind          text not null        -- 'allergy'|'dislike'|'favorite_food'|'favorite_restaurant'|'budget'|
                                      --  'meal_timing'|'travel'|'hydration_habit'|'skipped_meal'|'motivation_style'|
                                      --  'coach_preference'|'behavior_pattern'|'goal_note'|... (open, curated UI vocab)
  value         jsonb not null       -- typed payload per kind (e.g. {restaurant:'Chipotle', order:'double chicken bowl'})
  confidence    numeric not null     -- 0..1 — how sure we are (a stated allergy = 1.0; an inferred pattern < 1)
  source        text not null        -- 'athlete_stated'|'coach_stated'|'inferred_log'|'inferred_correction'
  evidence_n    int not null default 1   -- how many observations back an inferred fact (drives "smarter every month")
  status        enum('active','superseded','rejected') not null default 'active'
  supersedes_id uuid null -> athlete_memory_facts(id)   -- correction chain; never hard-edit
  first_seen    timestamptz; last_seen timestamptz
  created_at    timestamptz
```

- **Safety:** `allergy`/`dislike` facts with `source='athlete_stated'`/`'coach_stated'` are **hard
  constraints** the deterministic recommender honors (never recommend a Chipotle order with an allergen),
  not soft preferences. A safety fact is **never auto-superseded by inference** — only the athlete/guardian
  can change it.
- **"Smarter every month":** inferred facts accumulate `evidence_n` and `last_seen` as the same pattern
  recurs; a deterministic `promoteFact()` raises confidence with repetition and lets a low-confidence
  inference graduate to a surfaced fact only past a threshold. **The growth is in the data, not the model.**
- **Correction = supersede, never edit:** an athlete fixing a fact writes a new row pointing `supersedes_id`
  at the old (the same append-only discipline as score history). Full provenance survives.

```ts
// src/core/memory.ts  ([NEW], pure)
export interface MemoryFact { id: string; kind: MemoryKind; value: unknown; confidence: number;
  source: MemorySource; evidenceN: number; status: 'active'|'superseded'|'rejected'; }
export function activeFacts(all: MemoryFact[]): MemoryFact[];           // status==='active'
export function safetyConstraints(facts: MemoryFact[]): SafetyConstraint[];  // allergies/dislikes -> hard filters
export function retrieveForTask(facts: MemoryFact[], task: AssistTask, ctx: ScoringContext): MemoryFact[];
  // deterministic relevance ranking (kind + recency + confidence) — the "RAG" without a vector DB yet
export function candidateFactsFromCorrection(before: MealResult, after: EditableFood[]): MemoryFact[];
export function promoteFact(existing: MemoryFact | undefined, observation: MemoryFact): MemoryFact;
```

### 5.2 Write paths (how memory is created/updated)

1. **Explicit:** athlete/coach states a fact (allergy, budget, favorite restaurant) → `confidence=1`,
   `source=*_stated`. (Athlete entry > coach entry for athlete-owned facts; a coach-stated allergy is
   surfaced for the athlete to confirm.)
2. **From corrections:** when an athlete edits a meal estimate (`mealEdit.ts`) or replaces a meal,
   `candidateFactsFromCorrection()` proposes facts ("usually orders the double-protein bowl") → low
   confidence, `source=inferred_correction`. **Proposed, never silently committed** for safety kinds.
3. **From behavior:** a recurring log pattern (skips breakfast on game days) accrues `evidence_n` via a
   scheduled deterministic job → graduates past a threshold.

> **Boundary:** the LLM may *propose* candidate facts (`memory_extract` task) from free text, but a proposed
> fact is just a candidate `MemoryFact` the deterministic pipeline validates, dedupes, and (for safety kinds)
> routes to the athlete to confirm. The LLM never directly writes the store.

### 5.3 Retrieval for prompting

`retrieveForTask()` deterministically selects the relevant facts (by `kind`, recency, confidence) and the
**hard safety constraints**, which the Edge Function injects into the `ContextPack`. The model sees a small,
relevant, authorized fact set — not the whole store. (When embeddings ship, `retrieveForTask` gains a vector
similarity step; the *interface is unchanged*.)

### 5.4 Privacy / permission scoping

Memory is **athlete-owned data**, governed by the same `allowed()` predicate and consent gate as everything
else:

```sql
create policy mem_self     on athlete_memory_facts using ( is_self(athlete_id) );          -- full control
create policy mem_coach_rd on athlete_memory_facts for select using ( /* allowed(..,'report.view') AND kind in (coach-visible set) */ );
```

- **Tiered visibility (INFERRED — founder confirm):** not all memory is coach-visible. Allergies/dislikes,
  meal timing, and budget *band* (not raw finances) inform coaching → coach-visible. `motivation_style`,
  travel, raw spend, and personal restaurant history default **athlete-only** unless the athlete opts to
  share. Recommend a per-kind `coach_visible` policy table, athlete-overridable.
- **Consent supremacy:** for a minor, no memory leaves the device or reaches the model until guardian
  `verified` (`realDataConsent`). Memory is part of "real data."
- **Right to forget:** `delete_account` purges memory; an athlete may `reject` any single fact.

---

## 6. Coach Copilot (#18) — drafts, never sends; RLS-scoped to the coach's groups

The Copilot answers a coach's natural-language questions and drafts artifacts. The questions in the master
prompt — "who needs attention today?", "who missed protein this week?", "summarize nutrition", "generate
accountability messages", "predict who is falling behind", "identify positive trends", "create reports" —
are **mostly already deterministic** in `attention.ts` / `adherence.ts` / `weeklyReport.ts`. The Copilot is a
*natural-language front door* to those engines, plus a drafting layer.

### 6.1 The tool/skill set (fixed, typed, RLS-scoped)

The Copilot is **not** an open agent. It is a fixed catalog of typed tools, each of which runs a
deterministic core function over data the coach is **already authorized to see** (`allowed(... 'report.view')`
for every athlete in the coach's resolved group scope). The model's job is to pick a tool, fill its
parameters, and narrate the result — never to fetch data directly.

| Tool | Backed by (deterministic core) | Returns |
|---|---|---|
| `whoNeedsAttention(groupId, date)` | `attention.needsAttention` / `rankByRisk` | ranked at-risk list + honest reasons |
| `whoMissed(metric, window)` | `adherence.ts` over RLS-scoped roster | athletes below target (protein/hydration/logging) |
| `summarizeNutrition(scope, window)` | `weeklyReport.ts` + roster aggregates | structured summary numbers |
| `positiveTrends(scope, window)` | trend math over score/compliance history | improving athletes (the recognition engine) |
| `predictFallingBehind(scope)` | **deterministic risk slope** (today: `riskValue` + trend); **ML = DON'T BUILD YET** | early-warning ranked list, labeled "based on recent trend," not a fake prediction |
| `draftAccountabilityMessage(athleteId, intent)` | `messaging.composeMessage` + plan/signals + personality | a **draft** message (status `local`, never sent) |
| `draftReport(scope, window)` | `weeklyReport.ts` | a **draft** report artifact |

```ts
// src/core/copilot.ts  ([NEW], pure — the tool catalog + result shapes; no network)
export type CopilotTool = 'who_needs_attention'|'who_missed'|'summarize_nutrition'
  |'positive_trends'|'predict_falling_behind'|'draft_message'|'draft_report';
export interface CopilotResult {
  tool: CopilotTool;
  data: unknown;                 // the deterministic engine output (the SOURCE OF TRUTH)
  narration: string | null;     // LLM phrasing over `data`; null when unconfigured (UI shows `data` directly)
  isDraft: boolean;             // true for any artifact a coach must act on to send
  grounding: string[];          // which athletes/metrics the answer is computed from (transparency)
}
```

### 6.2 "Drafts, never sends" — enforced structurally

A drafted message/report is created with status `local` (the existing `MessageStatus` from `messaging.ts`)
and lands in the coach's compose box. **Sending is a separate, explicit coach action** through the doc-02
`msg.send` permission and the doc-04 delivery path. The Copilot Edge Function has **no send capability** —
it can only produce a `copilot_artifact` row:

```
copilot_artifacts
  id           uuid pk
  author_id    uuid not null -> profiles(id)   -- the coach
  athlete_id   uuid null -> profiles(id)        -- for a per-athlete draft
  scope_id     uuid null                        -- group/team for a roster draft
  kind         enum('message','report','summary') not null
  body         jsonb not null                   -- the draft
  status       enum('draft','sent','discarded') not null default 'draft'
  model_meta   jsonb null                       -- which model/version produced it (transparency + audit)
  created_at   timestamptz
```

- RLS: `author_id = auth.uid()` AND every referenced athlete passes `allowed(author, athlete, scope,
  'report.view')`. A draft can only reference athletes the coach can already see.
- The transition `draft → sent` is a **separate RPC** requiring `msg.send` and writing the doc-02
  `activity_log` — so "the AI sent a message" is impossible; the audit always shows a human pressed send.

### 6.3 What the Copilot reads

ONLY the doc-04 accountability signals + doc-01/02 roster, **already scoped by `allowed()`** before they
reach the model. The Edge Function builds one roster-level `ContextPack` per query from rows the coach can
read; the model never receives an athlete the coach isn't authorized to see. **No raw PHI/photos in the
prompt** — the model gets computed signals (scores, compliance, reasons), not meal images (consistent with
doc 02's audit rule of keeping image bytes out of secondary stores).

---

## 7. AI Personality — org-configurable philosophy the AI *mirrors*

An org configures a coaching philosophy; the AI mirrors it in **tone only**. The set: `encouraging`,
`performance_driven`, `educational`, `supportive`, `tough_love`, `military`, `professional`.

```
ai_personality                       -- one row per org/team/practice (resolution: team > org > platform default)
  scope        enum('platform','org','team','practice') not null
  scope_id     uuid null
  style        enum('encouraging','performance_driven','educational','supportive','tough_love','military','professional') not null
  intensity    enum('soft','standard','firm') not null default 'standard'
  guardrails   jsonb not null default '{}'   -- hard caps even on 'tough_love'/'military' (see below)
  updated_at   timestamptz
```

```ts
// src/core/personality.ts  ([NEW], pure)
export interface PersonalityStyle { style: PersonalityStyleKind; intensity: 'soft'|'standard'|'firm'; }
export function resolvePersonality(/* season > team > org > platform */): PersonalityStyle;
export function personalityDirective(p: PersonalityStyle): string;   // the style instruction added to the prompt
export function clampForAudience(p: PersonalityStyle, isMinor: boolean): PersonalityStyle;  // safety floor
```

> **Architectural call: personality is a STYLE TOKEN, not a model and not a content switch.** It changes
> *how* something is said, never *what* the deterministic engine decided. `tough_love`/`military` re-phrase
> firmly; they may **never** shame, attack body image, prescribe an unsafe deficit, or override the medical/
> scope disclaimers — `clampForAudience` hard-caps intensity for minors and weight-loss clients, and the
> `bodyImageNote`/`medicalDisclaimer` from `coaching.ts` are appended **regardless of personality**.
> Personality is the Slack-emoji of coaching: surface flair over an unchanged substrate.

- **Resolution** mirrors doc 03's weight-set order (`season > team/practice > org > platform`); a solo
  athlete gets the platform default (`encouraging`/`standard`).
- **Inferred — founder confirm:** can an *athlete* override the org personality for themselves (some kids
  hate `military`)? Recommend: athlete may dial *intensity* down, not *up*, and not below the safety floor.

---

## 8. AI Authority — the coach always wins

> **The rule (Constitution §11a, Founder Rule #3 & #13):** the deterministic engine + the coach's plan are
> the source of truth; the AI is the language layer. **If the AI disagrees with a coach, the coach wins.**

### 8.1 The hierarchy (highest authority first)

```
1. Safety floor          (medical/scope disclaimers, minor calorie bounds, allergy constraints) — ABSOLUTE, nobody overrides
2. The coach's PLAN      (active plan version: targets, windows, profile — doc 03)
3. The deterministic ENGINE (Development Score formula, at-risk ranking — src/core)
4. The AI LANGUAGE LAYER (explanation, drafting, recommendation) — may SUGGEST to 2/3, never overwrite
5. The AI's own free generation — lowest; only ever phrasing within 1-4
```

The AI can *recommend* a change to layer 2 (a new target, a different template — doc 03 §3.6) but the change
only takes effect when a **human with the right permission accepts it** (the doc-03 versioning RPC). The AI
never writes a plan, a target, or a score.

### 8.2 Conflict resolution + transparency

When the AI's recommendation differs from the coach's plan (e.g. AI thinks protein should be 200g, coach set
180g), the system does **not** silently pick one — it records the disagreement and shows both:

```
ai_recommendations
  id            uuid pk
  athlete_id    uuid not null -> profiles(id)
  field         text not null              -- 'protein_target'|'profile'|'plan_template'|...
  ai_value      jsonb not null
  current_value jsonb not null             -- the coach's current plan value (the WINNER by default)
  rationale     text not null              -- the deterministic basis, phrased by the LLM
  status        enum('pending','accepted','dismissed') not null default 'pending'
  decided_by    uuid null -> profiles(id)  -- the human who resolved it
  decided_at    timestamptz
  created_at    timestamptz
```

```ts
// src/core/aiAuthority.ts  ([NEW], pure — the arbiter)
export interface AuthorityDecision { effectiveValue: unknown; source: 'coach_plan'|'safety_floor'|'engine';
  aiSuggested: unknown | null; conflict: boolean; note: string; }
export function arbitrate(field: string, planValue: unknown, aiValue: unknown,
  safety: SafetyBound | null): AuthorityDecision;
//  - safety floor present and violated -> source='safety_floor' (even the coach can't go below; e.g. minor min calories)
//  - else planValue ALWAYS wins; aiValue is recorded as a suggestion, conflict=true if they differ
```

- **Transparency:** any surface that shows an AI recommendation shows *"AI suggests X; your plan is Y"* with
  a one-tap accept (writes a doc-03 plan version) or dismiss. The coach is never overridden, and never
  *surprised* — the disagreement is visible (the Stripe lesson: make the override explicit and logged).
- **The one exception is upward, not downward:** the **safety floor** can refuse a value even a coach set
  (a minor's minimum calories, a stated allergy) — this protects the athlete, and it is deterministic, never
  the model's opinion. **Founder confirm** the safety floor is the only thing that can outrank a coach.
- **Enforcement:** the `assist` Edge Function validates every model output against `arbitrate()` before
  returning; a model that tries to assert a target the plan doesn't hold has its assertion demoted to a
  *suggestion* automatically. Authority is enforced server-side, not by trusting the prompt.

---

## 9. Meal Analysis — honest confidence, correctable, never fake certainty

Meal analysis is the headline AI feature and today's biggest gap (a deterministic stub). The architecture
makes it **honest by construction**: a confidence score, full editability, replace/delete/reanalyze, and
user corrections that feed Memory — and **low confidence triggers clarification instead of pretending.**

### 9.1 Evolve `MealResult` to carry confidence + provenance

```ts
// EVOLVE content.ts MealResult — additive, the UI renders identically either way
export interface MealResult {
  name: string; quality: number; protein: number; kcal: number; carbs: number; fat: number;
  detected: string[]; note: string;
  confidence: number;                       // 0..1 overall analysis confidence  [NEW]
  items?: { name: string; portion: string; confidence: number }[];  // per-item provenance  [NEW]
  needsClarification?: ClarifyPrompt | null;  // set when confidence < floor  [NEW]
}
export interface ClarifyPrompt { question: string; options?: string[]; field: 'item'|'portion'|'whole_meal'; }
```

- The deterministic stub returns `confidence: 1` for its canned results today (honest: it *is* certain of its
  fixed answer); the real vision model returns a true model confidence.

### 9.2 The confidence-gated flow (pure `mealAnalysis.ts` [NEW] + existing `mealEdit.ts`)

```ts
export const CONFIDENCE_FLOOR = 0.6;   // tunable — founder/RD confirm
export function gateAnalysis(r: MealResult): MealResult;     // if confidence < floor -> attach needsClarification, never a confident note
export function applyCorrection(r: MealResult, edits: EditableFood[]): MealResult;  // recompute via mealEdit math
```

- **Never pretend certainty (Founder Rule #6/#8):** below `CONFIDENCE_FLOOR`, the result shows a question
  ("Is this a chicken bowl or a steak bowl?") and an **adjustable estimate**, not a confident grade. The
  meal still logs (the loop never blocks); the score uses the corrected/estimated macros.
- **Editing / replace / reanalyze / delete-accidental** all already have a home in `mealEdit.ts` +
  `mealHistory.ts`; we make them first-class actions on the result + history:
  - **Edit** → `applyCorrection` (existing `stepServings`/`addFood`/`removeFood`), recomputes macros +
    quality live (honest by construction — every number derives from editable portions).
  - **Replace meal** → discard this analysis, run a fresh `analyzeMeal` (or manual add); the day's score
    recomputes deterministically.
  - **Delete accidental upload** → remove the meal row; the day recomputes; the photo is purged (a
    `delete_meal` RPC; photo storage deletion, not just a soft hide — privacy).
  - **Reanalyze** → re-call the model on the same photo (e.g. after the athlete adds a text hint), producing
    a new `MealResult` with its own confidence; the prior is superseded, not silently overwritten.

### 9.3 Corrections feed Memory + Profile (the flywheel)

Every correction is signal: `candidateFactsFromCorrection()` (§5.2) turns "user always bumps the rice
portion" into a low-confidence Memory fact that, with repetition, makes the *next* analysis pre-adjust. This
is the Constitution's behavioral-data flywheel (§11.1) expressed concretely — **and it lives in deterministic
core**, so it works before any model is wired.

### 9.4 Server seam + consent (unchanged contract)

Vision runs **server-side** in the existing `analyze-meal` Edge Function (key never in the bundle —
`client.ts` already documents this). For a minor, the photo never leaves the device until guardian
`verified` (`realDataConsent`); `consentSummary` already discloses Anthropic as the processor. On any model
failure, `analyzeMeal` already falls back to the deterministic result — logging never breaks.

---

## 10. Text ER sketch

```
profiles ─┬─ performance_profiles            (1/athlete; curated record + projection over doc-03 history)
          ├─< athlete_memory_facts           (append-with-supersede; athlete-owned; safety facts = hard constraints)
          ├─< ai_recommendations             (AI suggests; coach's plan value is the WINNER; status pending/accepted/dismissed)
          └─< meals (doc 01) ──> MealResult{ confidence, items, needsClarification }   (EVOLVE)

orgs/teams/practices ──< ai_personality       (style token; resolution season>team>org>platform)

coach (profiles) ──< copilot_artifacts         (draft message/report; status draft->sent via msg.send RPC + audit)

assist() Edge Function  =  ONE LLM ingress
  input:  AssistRequest{ task, ContextPack{ ScoringContext(doc03), ProfileView, MemoryFacts, AccountabilitySignals(doc04), Personality, Guardrails } }
  guard:  allowed()(doc02) + realDataConsent() upstream → arbitrate()(authority) on output → assistFallback() on any failure
  output: phrasing/draft/analysis ONLY — never a score, target, plan, or sent message
```

---

## 11. Open decisions for the founder

1. **Memory: structured facts now, embeddings deferred (§5.1).** Confirm we ship the typed-fact store and do
   NOT build a vector DB until free-text memory volume forces it post-proof. *(Strongly recommend yes — a
   missed allergy in a vector is a safety incident.)*
2. **Memory visibility tiers (§5.4).** Which fact kinds are coach-visible by default vs athlete-only?
   *(Recommend: allergies/dislikes/timing/budget-band coach-visible; motivation/travel/raw-spend athlete-only,
   athlete-overridable.)*
3. **Profile portability on org change (§4.2).** What coach feedback transfers when an athlete moves orgs?
   *(Recommend: athlete-acknowledged feedback portable; raw private coach notes not.)*
4. **The safety floor is the ONE thing that can outrank a coach (§8.2).** Confirm: a deterministic safety
   bound (minor minimum calories, stated allergy) may refuse a value even a coach set; everything else, the
   coach wins.
5. **Personality safety clamp & athlete override (§7).** Confirm `tough_love`/`military` are hard-capped for
   minors and may never touch body image; confirm an athlete may lower intensity but not raise it.
6. **Confidence floor + clarification UX (§9.2).** Sign off on `CONFIDENCE_FLOOR` (0.6 proposed) and that
   low confidence shows a question + adjustable estimate rather than a confident grade.
7. **`predict_falling_behind` honesty (§6.1).** Confirm v1 is a *deterministic trend* labeled as such, not a
   learned "prediction" — and that an ML predictor is **[DON'T BUILD YET]** until real outcome data exists.
8. **Delete-accidental purges the photo (§9.2).** Confirm a deleted meal hard-deletes the stored image
   (privacy), not just a soft hide.

---

## 12. Explicitly deferred ([DON'T BUILD YET])

- **Vector/semantic memory DB.** Structured typed facts + deterministic relevance retrieval cover the wedge.
  Add embeddings only when free-text volume makes typed retrieval insufficient — and keep safety facts typed
  forever. *(The single most important deferral in this slice.)*
- **Learned "who falls behind" predictor.** Requires real outcome data the Proof pillar doesn't have yet
  (Constitution §2/§11.3). Ship the deterministic trend; train a model only after the loop produces labeled
  outcomes.
- **Behavioral-pattern ML / per-org fine-tuned personality models.** Personality is a prompt token, not a
  model. Patterns are deterministic `evidence_n` accrual until scale justifies more.
- **Multi-agent / autonomous Copilot.** Fixed tool catalog + drafts-only. No agent fetches its own data; no
  AI sends anything.
- **Full N-profile Context model.** Build the `ContextPack` seam; populate the two profiles the wedge needs
  (athlete + general) — "design for many, ship two" (§11b).
- **Wearables / sleep / recovery / progress-photo profile fields.** The `PerformanceProfileView` reserves
  the shape; populate after the nutrition loop retains.
