# 09 — Architectural Scenarios 10–17 (validating the models)

> Slice owner: Principal Enterprise Architect. Status: **DESIGN ONLY** (no app/TS code, no SQL
> migrations, no tests). Authored 2026-06-29.
>
> This doc does **not** introduce new primitives. It validates the models authored in docs
> `01`–`07` by walking eight concrete scenarios end-to-end, and it surfaces the few places those
> docs left a gap. Every scenario resolves through the existing cross-cutting contracts:
> `org_memberships` + `can_view` (doc 01), `allowed(viewer, athlete, scope, action)` (doc 02),
> the `ScoringContext` tuple + immutable `plan_versions` (doc 03), the `accountability_events`
> ledger (doc 04), the **Authority Boundary** + `assist()` seam (doc 05), `resolveEntitlement`/
> `hasFeature` keyed on `organization_id` (doc 06), and `ActiveWorkspace` + the `outbox`
> write-ahead log (doc 07). Where a scenario needs a decision none of those docs made, it is
> flagged **GAP →** with the doc that owns it.

---

## 1. Summary

The eight scenarios are stress tests, not new subsystems: each one should fall out of the doc-01
"profile half vs. access half" split and the per-viewer projection. Expanding a department to
every sport (10) is just N `programs` under one `organization` — no new billing or access path.
Multiple goals (11) and multiple nutrition plans (12) are the doc-03 multi-plan model with one
`active` plan and N `reference` plans, plus the primary-goal/secondary-goal split inside a plan
version. Plan versioning (13) is doc-03's append-only `plan_versions` with the day row freezing
the version id. A mis-identified meal (14) is doc-05's confidence-gated, correctable estimate
whose correction supersedes (never edits) and feeds Memory. Offline uploads (15) are doc-07's
`outbox` write-ahead log draining behind the consent gate. Injury recovery (16) is doc-04's
`recovery_episodes` additive plan override with a clinical clearance gate. Bulk-onboarding 150
athletes (17) is doc-07's `roster_imports` → dedupe → `invitations` → athlete-claim path that
**must never mint a duplicate athlete**. The three real gaps the models left open: (a) a
**per-program score must be comparable across an athletic department** without re-weighting the
formula (10/13); (b) when two orgs hold conflicting plans, **which one drives the athlete's own
Game Plan** (11/12 — doc 01 §3.7 / doc 07 §6.1 flagged it; this doc nails the mechanism); and (c)
an **offline meal correction arriving for a closed day** must be a forward-written correction
event, never a silent rewrite of a graded day (14/15). Two scenarios are wholly **[DON'T BUILD
YET]** at the wedge (10 full multi-program tree, 17 bulk import); two are **[ALREADY BUILT]** in
pure `src/core` today (11 goal scaffolding, 14 editable estimate).

---

## 2. Reconciliation with today

| Tag | Scenario element | Where it lives |
|---|---|---|
| **[ALREADY BUILT]** | Editable, self-consistent meal estimate (steppers recompute macros + quality) | `src/core/mealEdit.ts`, `mealHistory.ts` — scenario 14's correction floor exists and is tested. |
| **[ALREADY BUILT]** | Deterministic Development Score + `seasonGoalProgress`/`seasonGoalPhase` (one weight goal) | `src/core/scoring.ts` — scenario 11's progress math exists; generalizing to N goals is doc-03 [EVOLVE]. |
| **[ALREADY BUILT]** | Local-first day cache (meals/water/weight work offline for *today*) | `src/store/useStore.ts` `partialize` — scenario 15's offline floor; durability across sessions is the gap. |
| **[ALREADY BUILT]** | Wearable recovery fold (distinct from injury Recovery Mode) | `src/core/recovery.ts` — NOT scenario 16; doc 04 §3.7 is the injury workflow. |
| **[ALREADY BUILT]** | One team = one `teams` row, join-by-code, seeded demo rosters | `0001`/`0004` — scenario 10/17 start here; the org tree is the doc-01 evolution. |
| **[ALREADY BUILT]** | Consent fail-closed gate, minor data stays on-device | `src/core/consent.ts`, `0008` — gates scenarios 14 (photo), 15 (drain), 17 (provisioned minor). |
| **[EVOLVE]** | One implicit plan → multi-plan (active + reference), versioned | doc 03 §3.1–3.2 — scenarios 11/12/13. |
| **[EVOLVE]** | `teams` → `programs`+`groups` under one `organization` | doc 01 §3.5 — scenario 10. |
| **[EVOLVE]** | `aos_day` cache → durable `outbox` WAL + `days.version`/`meals.client_op_id` | doc 07 §5 — scenario 15. |
| **[NEW]** | `recovery_episodes` additive plan override + RTP clearance gate | doc 04 §3.7 — scenario 16. |
| **[NEW]** | `roster_imports`/`roster_import_rows` + match/commit RPCs + claim flow | doc 07 §3.3 — scenario 17. |
| **[NEW]** | `MealResult.confidence` + `needsClarification` + supersede-on-reanalyze | doc 05 §9 — scenario 14. |
| **[DON'T BUILD YET]** | Full `programs`/`groups` tree for a multi-sport department | doc 01 §2 — scenario 10 ships "one org = one team" until a real department exists. |
| **[DON'T BUILD YET]** | Bulk CSV/SIS roster import + dedupe engine | doc 07 §2 — scenario 17 ships the single-coach `join_team` path until a department-scale customer exists. |
| **[DON'T BUILD YET]** | Cross-program / cross-org comparability warehouse, per-injury RTP protocols | docs 03 §6 / 04 §3.7 — scenarios 10/16 ship the read-side projection + one generic episode. |

---

## 3. The scenarios

> **Reading guide.** "Permissions" cites doc-02 permission keys; "Data ownership" restates the
> doc-01 invariant for that scenario (what is the athlete's vs. the org's); "AI behavior" honors
> the doc-05 Authority Boundary (the engine/coach decides, the LLM phrases). **GAP →** marks a
> decision a model doc must ratify.

---

### Scenario 10 — Athletic department expanding from one team to every sport

A school runs Football on AthleteOS, then wants Track, Soccer, Basketball, and a department-wide
AD view — one contract, one roster, comparable numbers across sports.

**Ideal UX.** The AD signs in, sees a **department dashboard** (every program's compliance at a
glance), and adds a sport with one action ("Add program → Track"), which generates a join code
and an optional CSV import (scenario 17). A head coach sees only *their* program; the AD sees all
programs; an athlete who plays two sports (Football + Track) appears in both programs **without a
second account**. Switching between "Football" and "Track" coaching contexts is the doc-07
`ActiveWorkspace` switcher — same person, same data, different lens. Billing shows **one** "X of N
active athletes across all programs" number, never per-team line items.

**Backend architecture.** Pure doc-01 hierarchy: one `organizations` row (`kind='school'`) →
N `programs` (Football, Track, …) → groups (Varsity/JV/position) → `group_memberships`. Today's
single `teams` row becomes one program + one group under a synthesized org (doc 01 §5 Phase 2,
id-preserving). Adding a sport = `create_program(org_id, name, sport)` + a group + a standing
`open` invitation (the join code). **No new table** — expansion is rows, not schema.

**Permissions.** `head_coach` grant scoped to one `program` (doc 02 `scope_default='broad'`
within their program); `athletic_director`/`org_owner` grant scoped to the whole `organization`
(sees every program). A position/strength/nutrition specialist is `deny_until_scoped` (doc 02
§3.3) — narrowed to their groups. The AD adding a program needs `group.manage`; the AD seeing
cross-program reports needs `report.view` at org scope. All resolve through the single
`allowed(viewer, athlete, scope, action)` predicate — **the dual-sport athlete's Track coach
sees her only because his program-scoped grant contains her Track `org_membership`, not because
he shares Football** (doc 01 §3.6 decoupling).

**Data ownership.** The dual-sport athlete owns **one** profile + one stream of `days`/`meals`/
`checkins`. Football and Track are two `org_memberships` (both `role='athlete'`, different
`scope_id`) in the **same** org. No athlete data carries a program stamp (doc 01 §2
[DON'T BUILD YET] on `organization_id` columns) — program reads join through memberships. The
department "owns" access and the subscription; it never owns the athletes' history.

**AI behavior.** The Copilot (doc 05 §6) is scoped per active workspace: the Track head coach's
"who needs attention today?" runs `attention.needsAttention` over **only his program's** roster
(rows `allowed()` already authorizes). The AD's Copilot spans all programs. No re-ranking, no
fabricated cross-sport "prediction" — `predict_falling_behind` is the deterministic trend,
labeled as such (doc 05 §6.1).

**Edge cases.** (a) *Dual-sport conflicting plans*: Football wants a bulk, Track wants leanness
→ resolved by scenario 11/12's primary-membership rule, not a department override. (b) *Athlete
quits Track mid-season*: that one membership → `left` (doc 01 §3.9); Football membership and all
history untouched; a Track seat frees automatically (doc 06 §3.4). (c) *AD demotes a head coach*:
a `role_grants` change, audited (doc 02 §3.5) — the coach loses program access, the athletes lose
nothing.

**Scalability.** One org → N programs → N groups is a tree, not N flat orgs; roster reads are
`org_membership` lookups indexed by `(scope_kind, scope_id)` (doc 01 `om_scope`). Billing sums
active athletes **once** at the org (doc 06 §3.8) regardless of program count. **[DON'T BUILD
YET]:** the full tree ships only when a real multi-sport department exists; until then the wedge
is "one org = one program = one group" with zero user-visible difference.

> **GAP → doc 03 (Scoring Governance).** *Cross-program comparability.* If Football publishes an
> org/program weight set (protein-heavy) and Track publishes another (hydration/timing-heavy),
> the AD's department dashboard is comparing two differently-weighted scores. Doc 03 §3.4 gives
> the resolution order (`season → program → org → platform`) but does **not** state what the **AD
> dashboard** shows. **Recommendation:** the department roll-up displays the **platform-default
> weight set** score (the comparable "84 means the same everywhere" number, Rule #13), while each
> program's own dashboard may show its program-weighted score. Doc 03 must add: *a per-day score
> is frozen under exactly one weight set, but read-side aggregations may re-project the
> platform-default explain blob for cross-scope comparison* (the `explain` payload already carries
> every component's raw value, so the platform-weighted total is recomputable read-side without
> rewriting history). Founder + doc-03 owner confirm.

---

### Scenario 11 — Athlete having multiple goals

An athlete wants to gain 15 lb, hit 180g protein daily, sleep consistently, and improve a
performance metric — simultaneously.

**Ideal UX.** One **primary** goal headlines the home screen and drives the Game Plan ("Gain
15 lb — on track, +6 of 15"); secondary goals show as supporting habit tracks below, never
competing for the one number. The athlete (or coach) picks which goal is primary; the AI's "what
should I do next?" orders its suggestion by primary first. Changing the primary is one tap and is
**forward-only** (doesn't restate yesterday).

**Backend architecture.** Goals live **inside the active `plan_version`** as a `GoalSet`
(`{ primary: Goal; secondary: Goal[] }`, doc 03 §3.3) — not a floating table — so they version
and freeze into history with the plan. `seasonGoalProgress`/`seasonGoalPhase` (`scoring.ts`,
[ALREADY BUILT]) generalize from the single weight goal to any numeric `Goal` (doc 03 [EVOLVE]).
No new table.

**Permissions.** Editing goals = `goals.edit` (doc 02), the same key that gates `coach_set_goals`.
The athlete holds `goals.edit (self)`; a coach grant overrides on the same athlete (coach owns the
plan, §11a). Selecting *which* goal is primary is part of the plan version write, so it inherits
`goals.edit`.

**Data ownership.** Goals are part of the plan, which is **athlete-subject, author-owned** (doc 03
`plans.author_scope`): a coach-authored plan's goals are the coach's plan; the athlete's own
"Personal Goal" plan is theirs. The athlete always owns the *execution data* the goals measure.

**AI behavior.** Deterministic floor (doc 03 §3.3 / doc 05 §8): the **prioritization order** is
deterministic from `GoalSet` (primary → secondaries); the LLM only phrases it. The AI may
*recommend* a goal target for a human to accept (an `ai_recommendations` row, doc 05 §8.2) but
never edits a goal — coach wins. Secondary goals (sleep, body-fat) feed the AI and the progress
tracks but **stay out of the daily Development Score** (doc 03 §3.3 invariant — keep "one
number"). 

**Edge cases.** (a) *Conflicting goals* (gain weight + drop body-fat): both can be secondary
tracks; the primary drives the calorie target; the AI surfaces the tension as context, never
silently picks. (b) *Goal reached*: `seasonGoalPhase → 'reached'`; the athlete is prompted to set
the next primary — a new plan version, history intact. (c) *No goal set*: solo athlete defaults to
the platform "consistency" posture; no goal machinery forced (Rule #12).

> **GAP → doc 01/03 (Multi-org primary).** When the athlete's goals come from **different orgs**
> (university wants the bulk, private nutritionist wants a cut), *whose* goal is primary? Doc 01
> §3.7 and doc 07 §6.1 both flagged this; this doc commits the mechanism (see scenario 12). **This
> is [ALREADY BUILT] scaffolding** — the goal math exists; only the multi-goal/primary selection
> UI is [EVOLVE].

---

### Scenario 12 — Multiple nutrition plans

An athlete has a Football team plan, a private nutritionist's plan, and a personal goal plan — all
at once.

**Ideal UX.** The athlete sees a **plan switcher**: exactly one plan is **Active** (drives the
score, the AI, accountability), the rest are **Reference** (visible, comparable, AI-aware, but
non-scoring). The AI may say "your nutritionist's plan wants 200g; today's active plan wants 180g"
as *context*, never as a second score. One number stays sacred (Rule #9).

**Backend architecture.** Doc 03 §3.1–3.2 verbatim: N `plans` rows (each its own
`author_id`/`author_scope`), each with append-only `plan_versions`; one `athlete_active_plan`
pointer row names the governing plan. Switching is a single atomic write to that pointer, **forward
-only** (doc 03 §3.2 — yesterday's day still references yesterday's active plan version; #13
invariant). The `ScoringContext` tuple (doc 03 §3.0) resolves the active plan version + weight set
+ goals for every score and every AI surface, so they can never disagree.

**Permissions.** The author of a plan (or any author in the same scope) edits/versions it
(`nutrition.edit`/`goals.edit`). **Switching which plan is Active is governed separately** (doc 03
§3.6): typically the athlete consents, or the primary professional sets it. Doc 03's challenge
guardrail caps **active-eligible** plans to professional-authored + exactly one self "Personal
Goal" plan, so parent/self plans don't fight for the active slot (Rule #3, #5).

**Data ownership.** One athlete, **one** stream of `days`/`meals` — there are N plans but **one
execution**. Each plan *projects* the athlete's same logged data through its own targets/profile
(doc 01 §3.6 / §3.7: "one set of meals, N reports"). The nutritionist's plan is the nutritionist's
config; the meals it scores are the athlete's. Leaving the nutritionist (`practice_clients`/
individual-scope membership → `left`) archives that plan to reference and revokes access — the
athlete's data and the team plan are untouched.

**AI behavior.** The active plan gets full execution scoring + accountability nudges. Reference
plans are **AI-aware context only**: the Copilot may compare them but never produces a competing
Development Score (doc 03 §3.2). All recommendations reference the resolved `ScoringContext`, so
the AI for a "Track-active" day coaches to Track's targets. The AI never switches the active plan
— that is a permissioned human action.

**Edge cases.** (a) *Two professionals both want active*: doc 03 §3.6 arbitration — athlete
consents to a switch, or org policy designates a primary professional. (b) *Reference plan target
is unsafe for a minor* (a parent plan with a crash deficit): the safety floor (doc 05 §8.2)
refuses it even as reference context — the AI never surfaces an unsafe number for a minor (Rule
#8). (c) *Plan deleted*: archived, not destroyed; historical days that referenced its versions
still resolve them (append-only).

> **GAP → doc 01 §3.7 / doc 07 §6.1 — RESOLVED HERE (founder confirm).** *Which plan/goal drives
> the athlete's own Game Plan across orgs?* **Commit the mechanism:** the athlete's `ActiveWorkspace`
> **primary** workspace (doc 07 §6.1) selects the **active plan** via `athlete_active_plan`. Other
> orgs' plans are **reference projections**. So "primary workspace" (doc 07), "active plan" (doc
> 03), and "primary goal" (scenario 11) are **the same selection expressed once**: the primary
> membership → its plan is active → its primary goal headlines. This unifies the three docs'
> open questions into one athlete-owned choice. Founder confirms the athlete (not an org) owns
> this selection.

---

### Scenario 13 — Plan versioning

A coach edits the protein target mid-season; last month's scores must still reflect last month's
plan.

**Ideal UX.** The coach edits a plan and presses save; the change applies **from today forward**
("New target: 190g, effective today"). History is untouched and visibly labeled ("Scored under
v3, effective Jun 1"). A coach can view the version timeline of a plan ("v1 → v2 → v3, who changed
what, when").

**Backend architecture.** Doc 03 §3.1, §3.8 verbatim: `plan_versions` is **append-only** (RLS
grants no UPDATE/DELETE; an immutability trigger like `activity_log`/score-history). Editing a plan
calls `publish_plan_version(plan_id, body)` which **bumps `version_no`**, never mutates a prior
row. The `days` row **freezes** `plan_version_id` + `weight_set_id` + `season_id` + the `explain`
blob at write time (in the athlete's own write path — no new privilege). A historical day
therefore always resolves the exact plan + weights it was scored under.

**Permissions.** `publish_plan_version` asserts the author holds `goals.edit`/`nutrition.edit` in
the plan's scope (doc 02). The version write is logged to `activity_log` (`before`/`after` deltas,
doc 02 §3.5) — "who changed my protein target and when" is answerable and `revert_change`-able
(itself permissioned and logged; no silent undo).

**Data ownership.** The **plan version** is author-owned config; the **frozen reference on the day
row** is part of the athlete's immutable history (the athlete owns their `days`). The coach can
publish new versions forever; they can never rewrite a graded past day — that is the structural
expression of "scoring integrity + history immutability."

**AI behavior.** None decides versioning. The AI may *recommend* a new target (an
`ai_recommendations` row, doc 05 §8.2) that, **when a human accepts it**, becomes a new published
version. The AI never writes a version directly (doc 05 Authority Boundary).

**Edge cases.** (a) *Backfill correction* ("this was always the plan"): doc 03 §5 open decision #2
— that is an **explicit, audited backfill action**, never a silent edit; recommend deferring it.
(b) *Late offline edit for a closed day* (overlaps scenario 15): a finalized historical day is
recomputed-forward / recorded as a correction event, never a silent rewrite (doc 07 §5.3). (c)
*Weight-set re-publish*: same append-only discipline — `score_weight_sets` is versioned; old days
keep their frozen `weight_set_id`.

> **[ALREADY BUILT] adjacency:** `days.score`/`grade`/`computed_at` already stamp a per-day score
> (`0001`); doc 03 only **adds** the frozen `plan_version_id`/`weight_set_id`/`explain` columns.
> The scoring formula in `src/core/scoring.ts` is **unchanged** — versioning changes *where the
> plan comes from*, not *how it scores* (doc 03 §3.1).

---

### Scenario 14 — AI incorrectly identifying a meal

The vision model labels a steak bowl as a chicken bowl; the athlete must be able to fix it, and the
fix must make the system smarter.

**Ideal UX.** The result shows an **honest confidence**. Below the floor (doc 05 §9.2,
`CONFIDENCE_FLOOR ≈ 0.6`) it shows a **question + an adjustable estimate** ("Is this chicken or
steak?"), not a confident grade. The athlete corrects it inline (the [ALREADY BUILT] steppers in
`mealEdit.ts` recompute macros + quality live), or **Reanalyze** with a text hint, or **Replace**,
or **Delete accidental**. The meal still logs immediately — the loop never blocks on a wrong label.

**Backend architecture.** `MealResult` gains `confidence`, per-item provenance, and
`needsClarification` (doc 05 §9.1, additive — UI renders identically). Corrections route through
the existing `mealEdit.ts` math (honest by construction — every number derives from editable
portions). **Reanalyze supersedes, never overwrites** (a new `MealResult`; the prior is kept,
doc 05 §9.2). **Delete-accidental hard-deletes the photo** via a `delete_meal` RPC (privacy, doc
05 §9.2 open decision #8), and the day recomputes deterministically (`src/core/scoring.ts`).

**Permissions.** Only the athlete edits/replaces/deletes **their own** meal (`is_self`, doc 02 —
`days/meals` writes are athlete-only; overseers never write logs). A coach can *see* the corrected
meal through `report.view` but cannot alter it.

**Data ownership.** The meal, the photo, and the correction are **the athlete's** data. The
correction is athlete-authored signal. The org sees the result; it owns none of it.

**AI behavior.** This is the headline Authority-Boundary case (doc 05): the model produces an
**estimate with confidence**, never fake certainty; low confidence triggers clarification (Rule
#6/#8). The correction feeds the **flywheel**: `candidateFactsFromCorrection()` (doc 05 §5.2) turns
"always orders the double-protein steak bowl" into a low-confidence `athlete_memory_facts` row that,
with repetition (`evidence_n`), makes the *next* analysis pre-adjust — **smarter every month, in
the data not the model**. A **safety fact (allergy)** is never auto-superseded by inference (doc 05
§5.1). Consent gates the photo: for a minor it never reaches the model pre-verification (doc 05
§9.4).

**Edge cases.** (a) *Model unconfigured/offline*: the deterministic stub returns `confidence: 1`
for its fixed answer (honest), and `analyzeMeal` falls back deterministically — logging never
breaks (doc 05 §3, [ALREADY BUILT] seam). (b) *Correction arrives offline*: enqueued as an
`outbox` op (scenario 15), drains later; if the day is already closed it is a forward correction,
not a silent rewrite (doc 07 §5.3). (c) *Repeated wrong-label on the same food*: accrues
`evidence_n`; promotes a memory fact; the model is pre-conditioned next time.

> **[ALREADY BUILT]:** the editable, self-consistent estimate is shipped and tested
> (`mealEdit.ts`/`mealHistory.ts`). Doc 05 only adds `confidence` + clarification + memory feed —
> the **correction floor already exists**, which is why a wrong label is recoverable today even
> with no model wired.

---

### Scenario 15 — Offline uploads

An athlete logs three meals, water, and a weight on a flight with no signal; everything must
survive and sync deterministically on landing.

**Ideal UX.** Logging works exactly as online — meals appear, the score updates locally,
"Will sync when connected" is shown honestly. On reconnect everything uploads **once**, in order,
with no duplicates and no lost edits, with zero conflict prompts (Rule #5).

**Backend architecture.** Doc 07 §5 verbatim: a durable, append-only **`outbox`** write-ahead log
(`src/core/outbox.ts`, pure reducers) sits *in front of* the existing `pushDay`/`recordMeal` (which
stay the single write path + consent gate). Each mutation enqueues an `OutboxOp` with a
client-generated `id` (idempotency key) and a `date` (so **past-day** offline edits have a home —
the gap today). A worker drains FIFO with backoff when connectivity + consent allow. Server adds
`days.version` and `meals.client_op_id unique` (doc 07 §5.3) for idempotency. Photo **bytes** stay
out of the queue (a local file handle, uploaded at drain via existing `uploadMealPhoto`).

**Permissions.** Unchanged — the athlete is the only writer of their own logs (`is_self`). The
outbox introduces no new privilege; it just defers the same write.

**Data ownership.** The queued ops are the athlete's pending intent, on the athlete's device. The
server upsert is keyed by the athlete's own op ids. No org touches the queue.

**AI behavior.** None at enqueue time. On drain, a meal photo runs `analyze-meal` (scenario 14);
for a minor that **drain** is consent-gated — a minor without a verified guardian **accumulates ops
locally and never drains** (doc 07 §5.2), exactly satisfying the fail-closed gate. The flywheel and
scoring run on the synced result.

**Edge cases.** (a) *Cross-device conflict* (phone offline at the gym + tablet at home): **field-
level last-writer-wins by `op.createdAt`** (doc 07 §5.3) — the offline op only wins the fields it
changed and is newer for; no whole-row clobber, no prompt. (b) *Meals*: additive, keyed by
`client_op_id` — two offline meals are two inserts, never a conflict. (c) **Closed-day edit (the
gap):** an offline op arriving for a **finalized graded day** must be a **forward correction event,
not a silent rewrite** (history-immutability). (d) *Ambiguous failure / retry*: idempotent on
`op.id` — a retry after a timeout never double-writes. (e) *`delete_account`/`sharingPaused`*: the
outbox is purged/held (doc 07 §5.2).

**Scalability.** The queue is per-device, FIFO, AsyncStorage today with the interface designed to
swap to SQLite/MMKV without call-site change (doc 07 §5.2). Drain is batched; backoff prevents a
reconnect storm. Single-writer-per-athlete keeps the conflict surface tiny — LWW is the right
amount of machinery (doc 07 §5.3 open decision #3).

> **GAP → doc 03 (history immutability) × doc 07 (sync).** Doc 07 §5.3 says a closed day is "never
> overwritten" and is "recorded as a correction event," but **no doc defines that correction-event
> shape or who may see it.** **Recommendation:** a late edit to a closed day writes a doc-04
> `accountability_event` of a new type `late_correction` (payload = the field deltas), and the
> day's *displayed* score is recomputed-forward only for *open* days; a graded historical day keeps
> its frozen `explain`. Doc 03/04 owners ratify the `late_correction` event + that it never mutates
> a frozen `days.score`.

---

### Scenario 16 — Injury recovery

An athlete sprains an ankle; nutrition should adapt (fewer training calories, protein stays high
for repair, hydration up), the coach/AT is alerted, and return-to-play is gated.

**Ideal UX.** The athlete (or coach/AT) logs an injury; the plan visibly shifts into **Recovery
Mode** ("Reduced training load — calories −15%, protein floor 1.0g/lb, hydrate"), with education
content. The coach and athletic trainer are alerted. The athlete **cannot self-clear**; an AT
presses "Cleared — return to play," which restores the original plan exactly.

**Backend architecture.** Doc 04 §3.7 verbatim — and **distinct from `src/core/recovery.ts`**
(which folds wearable signals into the score; this is the *injury* workflow). A `recovery_episodes`
row carries the **override** (`calorie_adjust_pct`, `protein_floor_g`, `hydration_target_l`, stage,
`cleared_by`). The override is an **additive layer** computed in pure `src/core/recoveryMode.ts`
over the active `CoachPlan` — **the base plan is never mutated**, so clearing restores the original
byte-for-byte (history-immutability, doc 04 cross-cutting contract #5). The adjustment is
**safety-bounded deterministic math, never an AI number** (Rule #8, especially for minors).

**Permissions.** Athlete may **log** an injury (`recovery_started`); only a clinical role holding
`recovery.clear` (athletic trainer / org owner) may set `cleared_at` (doc 04 §3.7, open decision
#7). The episode and its medical context route through the doc-04 **`medical` note category**,
which is **deny-by-default to all coaching roles** (`notes.medical.view`, clinical-only) — a head
coach with full `report.view` still cannot read the AT's clinical note (doc 04 §3.5). Every
clearance/adjust is audited.

**Data ownership.** The episode + its plan override are the athlete's data; the AT's clinical notes
are authored *about* the athlete and carry the restricted medical category + (doc 04 §3.5
open decision #5) a separate retention/export posture. The base plan stays the author's; the
override never edits it.

**AI behavior.** The AI **phrases** the recovery education and the coach alert; it **never sets**
the calorie/protein numbers (those are safety-bounded deterministic math) and never clears the
episode. `recovery_started` flows through `notification_dispatch` at high severity (doc 04 §3.3) —
the one place that may pierce quiet hours for critical alerts.

**Edge cases.** (a) *Athlete tries to self-clear*: blocked — `recovery.clear` is clinical-only.
(b) *Injury during a bulk plan*: the override layers on top; clearing returns to the exact bulk
targets. (c) *Re-injury*: a new episode; the prior is part of history. (d) *Minor*: the override
respects the minor calorie safety floor (doc 05 §8.2) — Recovery Mode can lower calories but never
below the safety minimum.

> **[DON'T BUILD YET]:** per-injury-type RTP protocols, PT integration, graded-exertion stages
> (doc 04 §3.7). Ship **one generic episode** (override + alert + clearance gate); `injury_type` +
> `stage` columns reserve the expansion. No model doc left a gap here — doc 04 fully specifies it.

---

### Scenario 17 — Bulk onboarding 150 athletes

An athletic director provisions 150 athletes from a SIS export in one sitting — and a transferring
athlete who already used AthleteOS must be **matched, never duplicated**.

**Ideal UX.** The AD uploads a CSV, maps columns once, sees a preview ("142 new, 6 matched to
existing athletes, 2 need your confirmation"), confirms, and sends invites in bulk. Athletes (or
guardians, for minors) get a claim link; claiming attaches a **new membership to their existing or
new profile** and the coach's roster fills as athletes claim. No athlete account is usable until
its owner claims it.

**Backend architecture.** Doc 07 §3.3 verbatim: client-parses the CSV into `roster_import_rows`
(staging); `match_roster(import_id)` (SECURITY DEFINER) tiers dedupe **most-specific-first** —
`exact_email` (auto-bind, the transfer/return case), `probable` (human-confirm, never auto-merge),
`ambiguous` (never auto-bound), `new` (mints a profile on claim). `commit_roster(import_id)` walks
rows → bulk `invitations` (doc 01 §3.8), carrying `intended_role='athlete'`, `scope_kind=group` +
`scope_id` from the group hint, and (for minors) a `guardian_email`. Each invitation → a per-row
claim link + a fallback group join code. **Idempotent + resumable** (re-running skips `invited`
rows).

**Permissions.** `member.invite` + `group.manage` (doc 02) to import/commit (AD / head coach).
The **privacy guard** (doc 07 §3.3): `match_roster` returns only `(row_id, match_kind, match_score,
masked_hint)` — "Possible match: J. C., '26" — **never** another athlete's email/full name/health
data, so the AD confirms a match without seeing protected data (dedupe-vs-privacy resolved for
privacy).

**Data ownership.** **The athlete always claims their own profile** (doc 07 §3.3 open decision #2,
cross-cutting contract #3): an AD can only *invite*; pre-claim there is only an `invitation` + an
empty seat, **never a usable account an AD backfilled**. A matched transfer binds a **new
membership**, never a new profile or a copy of history — the new coach sees the athlete's existing
history the moment consent is (re)granted. This is the literal mechanism of "athlete owns one
permanent profile."

**AI behavior.** The match is **deterministic** (email exact-match + a fuzzy distance on
name/grad-year/birthdate), **not** an LLM merge — a wrong AI merge would leak one athlete's data to
another (doc 07 §3.3). The AI plays no role in provisioning. Optional: an LLM could *suggest*
column→field header mappings for a messy CSV, but the binding decision stays deterministic +
human-confirmed.

**Edge cases.** (a) *Minor in the import*: the membership is created but the **consent gate keeps
the minor's real data on-device until the guardian is `verified`** (doc 07 §3.3) — a provisioned-
but-unclaimed minor is a **seat placeholder, not a data subject**. (b) *Seat shortfall*:
`commit_roster` checks the count against `subscriptions.seats` (doc 06, keyed to the org) and
**blocks with "N seats short"** rather than over-provisioning. (c) *Ambiguous match (>1
candidate)*: never auto-bound; surfaced to the AD. (d) *Duplicate email in the CSV*: deduped within
the import before invitations are minted. (e) *Athlete already in another org*: `exact_email`
match → a second membership in the new org; both coexist (scenario 10 / doc 01 §3.7).

**Scalability.** 150 rows is trivial; the design scales to thousands because matching + commit are
set-based SECURITY DEFINER RPCs, idempotent and resumable, and the CSV never leaves the device
until the AD confirms a mapping. **SIS feeds are a pluggable row producer** (doc 07 §2
[DON'T BUILD YET]) — "another way to produce `roster_import_rows`," no new path.

> **[DON'T BUILD YET]:** the entire bulk-import subsystem (doc 07 §2/§9 Phase 4). The wedge ships
> the single-coach `create_team`/`join_team` path (a broadcast group join code already covers a
> 30-athlete team). Build `roster_imports` only when the first department-scale customer exists.
> No model gap — doc 07 fully specifies it; this scenario only confirms it composes with the
> consent gate (15) and the org tree (10).

---

## 4. Cross-cutting confirmations these scenarios force

These eight walkthroughs surface **one unifying decision** the model docs each touched but none
fully closed, plus two ratifications:

1. **One selection, three names (RESOLVED — founder confirm).** A multi-org athlete's **primary
   workspace** (doc 07 §6.1) ⇒ **active plan** (doc 03 §3.2 `athlete_active_plan`) ⇒ **primary
   goal** (scenario 11) are the **same athlete-owned choice**. Other orgs are read-side
   projections. This closes doc 01 §3.7, doc 03 §3.2, and doc 07 §6.1's open questions in one
   stroke and is enforced once (the active workspace selects the active plan; everything else
   projects).

2. **Cross-scope comparability (GAP → doc 03).** Per-program/per-org weight sets make raw scores
   non-comparable on a department dashboard. The `explain` blob already carries every component's
   raw value, so a **platform-default re-projection is computable read-side without rewriting
   frozen history**. Doc 03 must state that roll-ups across scopes display the platform-weighted
   number; program dashboards may show the program-weighted one.

3. **Late correction to a closed day (GAP → doc 03 × 04 × 07).** Define `late_correction` as a
   doc-04 `accountability_event`; it **never mutates a frozen `days.score`/`explain`**. Open days
   recompute forward; graded days stay immutable. This is the single shared rule behind scenarios
   13, 14, and 15.

---

## 5. Open decisions for the founder

1. **Primary workspace = active plan = primary goal** is one athlete-owned selection (§4.1).
   Confirm the athlete (never an org) owns it.
2. **Department dashboard shows the platform-default-weighted score** for cross-program
   comparability; program dashboards may show their own weighting (§4.2 / scenario 10). Confirm,
   and route to the doc-03 owner.
3. **`late_correction` event for closed-day offline edits** — never rewrites a graded day (§4.3 /
   scenarios 13–15). Confirm the event-not-rewrite policy with the doc-03/04 owners.
4. **Bulk import (17) and the full multi-program tree (10) are [DON'T BUILD YET]** until a real
   department-scale customer exists; the wedge stays single-coach `join_team` + "one org = one
   program." Confirm the deferral.
5. **Recovery clearance is clinical-only** (`recovery.clear`); athletes may log but not clear an
   injury (scenario 16 / doc 04 §3.7). Confirm.
6. **Offline conflict = field-level LWW, no prompt, never a closed-day rewrite** (scenario 15 /
   doc 07 §5.3). Confirm vs. CRDT.

---

## 6. Cross-cutting contract (what these scenarios require other docs to honor)

1. **No scenario introduces a new access path.** Every read in 10–17 resolves through
   `can_view`/`allowed(...)` (docs 01/02); every score/plan read through the `ScoringContext`
   tuple (doc 03); every behavioral signal through `accountability_events` (doc 04); every AI
   output through the Authority Boundary + `assist()` (doc 05); every entitlement through
   `resolveEntitlement` keyed on `organization_id` (doc 06); every "which org am I in" through
   `ActiveWorkspace` (doc 07).
2. **Profile half stays org-free and athlete-owned** in every scenario — dual-sport (10), multi-
   plan (12), transfer-via-import (17): the athlete's one `days`/`meals` stream never carries an
   org/program stamp and never moves.
3. **History is immutable** in 13, 14, 15: plan versions and weight sets are append-only; a closed
   day's frozen `explain` is never rewritten (the `late_correction` rule, §4.3).
4. **The consent gate sits above everything** — the meal photo (14), the offline drain (15), and
   the provisioned minor (17) all obey `src/core/consent.ts` unchanged; a minor's real data never
   leaves the device until a guardian is verified.
5. **The AI recommends, never dictates** in 11–14, 16: it phrases, drafts, and proposes
   `ai_recommendations`/candidate memory facts; the coach's plan and the deterministic engine win,
   and the safety floor outranks even the coach (doc 05 §8).
