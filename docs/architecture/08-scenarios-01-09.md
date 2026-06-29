# 08 — Architectural Scenarios 01–09 (end-to-end validation of docs 01–07)

> Slice owner: Principal Enterprise Architect. Status: **DESIGN ONLY** (no app/TS code, no SQL
> migrations, no tests). Authored 2026-06-29.
> This doc does **not** introduce a parallel model. It **stress-tests** the contracts already
> defined in docs `01`–`07` against nine real-world situations and proves they resolve without a
> new code path. Every scenario reuses: doc `01`'s `org_memberships` (role + scope + status) and
> the `can_view(athlete)` predicate; doc `02`'s `allowed(viewer, athlete, scope, action)` (consent
> ⋅ group-scope ⋅ permission) + `activity_log`; doc `03`'s `ScoringContext` tuple + plan
> versioning + the Scoring Contract; doc `04`'s `accountability_events` ledger; doc `05`'s
> Authority Boundary; doc `06`'s org-keyed billing + active-athlete metering; doc `07`'s
> `ActiveWorkspace` selector + provisioning/claim. Where a scenario exposes a **gap a model doc
> left open**, it is flagged inline as `[MODEL GAP]`.

---

## 1. Summary

Nine scenarios — three "specialist with a narrow slice of the roster" (position coach,
strength coach, nutritionist-across-sports), one "two business models in one account"
(trainer with athletes *and* fitness clients), and five lifecycle/relationship cases (multi-org
athlete, transfer, coach departure, goal disagreement, parent read-only) — are each solved
end-to-end on the **existing** models. The headline finding: **the doc 01–07 contracts are
sufficient for all nine with no new access path**; every scenario decomposes into (a) one or more
`org_memberships` rows with the right `(role, scope_kind, scope_id, permissions, status)`, (b)
group-scoped visibility via doc 02's `grant_group_scopes`, (c) a per-membership/per-plan
*projection* of the athlete's single owned dataset, and (d) the consent gate sitting above all of
it. The scenarios surface **five model gaps the founder must close** — most importantly the
**target-conflict arbitration rule** (scenario 8, left open by doc 01 §3.7 and doc 03 §3.2) and
the **specialist scope-default** (`deny_until_scoped`, doc 02 §3.3, which scenarios 1–3 depend
on). Scenarios 5–7 (multi-org / transfer / coach-leaving) are **[DON'T BUILD YET]** at the
build-tree level (they need `programs`/`groups`/`invitations`/`membership_events`, doc 01 Phase
3) but must be **architecturally honored now** so the seam is correct. Scenario 9 (parent
read-only) is the closest to **[ALREADY BUILT]** — guardianship + the consent gate already exist
(`0008`, `src/core/consent.ts`).

---

## 2. Reconciliation with today (the map for this slice)

| Tag | Element this slice leans on | Where it lives |
|---|---|---|
| **[ALREADY BUILT]** | Guardian read-only relationship + fail-closed consent gate (scenario 9) | `0008_guardian_consent.sql`, `src/core/consent.ts`, `src/core/parent.ts` |
| **[ALREADY BUILT]** | `is_team_coach_of` / `is_trainer_of` / `can_view` disjunction — the "specialist sees their athletes" floor (scenarios 1–4, coarse) | `0002_rls.sql` |
| **[ALREADY BUILT]** | Trainer's per-client book via `practice_clients` (scenario 4's client side) | `0001_schema.sql` |
| **[ALREADY BUILT]** | One profile per `auth.users` + auto-profile trigger — "one permanent athlete" (scenarios 5–6) | `0001`, `handle_new_user` |
| **[ALREADY BUILT]** | `coach_set_goals` (the one sanctioned overseer write) + athlete-self-write-only logs (scenario 8) | `0002_rls.sql` |
| **[ALREADY BUILT]** | Deterministic `ScoringProfile` (athlete/general) — the seed of trainer's general-fitness clients (scenario 4) | `src/core/scoringProfiles.ts` |
| **[EVOLVE]** | `team_staff(head_coach\|assistant)` → role catalog incl. `position_coach`/`strength_coach`/`nutritionist` (scenarios 1–3) | doc 02 §3.1 |
| **[EVOLVE]** | `can_view` whole-team grant → **group-scoped** `sees_athlete` (scenarios 1–3 are impossible without this) | doc 02 §3.3 |
| **[EVOLVE]** | Per-owner subscription → org-keyed + active-athlete metering (scenarios 5–7 free/consume seats) | doc 06 §3.4 |
| **[NEW]** | `grant_group_scopes` (the linebacker/freshman/sport narrowing) | doc 02 §3.3 |
| **[NEW]** | `membership_events` transfer/leave ledger (scenarios 6–7) | doc 01 §3.9 |
| **[NEW]** | `ai_recommendations` disagreement record (scenario 8's "show both, don't pick") | doc 05 §8.2 |
| **[DON'T BUILD YET]** | `programs`/`groups`/`invitations`/transfer-ledger needed for multi-org, transfer, coach-leave (scenarios 5–7) | doc 01 §5 Phase 3 |
| **[DON'T BUILD YET]** | Multi-org workspace switcher UI (scenario 5) — seam now, switcher only at `available.length>1` | doc 07 §6.3 |

> **The one rule every scenario obeys:** the athlete's data is **one** row set keyed on
> `athlete_id`, self-write-only, org-free. Every scenario below changes only the **access half**
> (memberships, scopes, plans-as-projection) — never the **profile half**. This is the doc 01
> invariant restated as a test: *if a scenario seems to require moving or copying athlete data, the
> design is wrong.*

---

## 3. The scenarios

### Scenario 01 — Position coach managing only linebackers

**Ideal UX.** The linebackers coach signs in, lands in the Lincoln HS Football workspace
(`ActiveWorkspace`, doc 07), and sees a roster containing **only the linebacker group** — not the
whole team. Needs-attention, weekly reports, and the Copilot ("who missed protein this week?")
are all pre-narrowed to those ~12 athletes. There is no "filter to my position" step; the narrow
view *is* their view. They can set targets/send recognition for their linebackers and nothing
else.

**Backend architecture.** One `org_memberships` row: `role='position_coach'`,
`organization_id=Lincoln`, `scope_kind='group'`, `scope_id=<LB group>` (doc 01 §3.3). The
linebacker group is a doc 02 `groups(kind='position')` row; the coach's grant is attached to it
via `grant_group_scopes(grant_id, group_id)` (doc 02 §3.3). Reads resolve through `can_view`
whose body checks `scope_contains(viewer.scope, athlete.scope)` (doc 01 §3.4) — a group-scoped
grant contains only that group's athletes. Copilot tools (`whoNeedsAttention(groupId)`,
`whoMissed(metric, window)`, doc 05 §6.1) take a `groupId` already constrained to the coach's
scope; the model never receives an athlete outside it.

**Permissions.** Position Coach default matrix (doc 02 §3.2): `goals.edit ✓`, `report.view ✓`,
`alert.receive ✓`, `message.send ✓`; **no** `member.invite/remove`, `group.manage`, `billing`,
`nutrition.edit`. Crucially this is a **specialist role with a group scope attached** → doc 02
§3.3's `deny_until_scoped` semantics: a position coach with *no* group attached sees **nothing**,
not the whole org. `[MODEL GAP — confirm]` doc 02 §3.3 left `scope_default` per-role as an
INFERRED founder decision; scenario 1 only works correctly if `position_coach` is
`deny_until_scoped`. **This scenario is the proof that the founder must confirm that default.**

**Data ownership.** Unchanged: the linebackers own their `days`/`meals`/`checkins`. The position
coach has **read access + the one sanctioned overseer write** (`coach_set_goals`, now scoped via
`has_permission(athlete,'goals.edit')`, doc 01 §4). The coach never writes a log.

**AI behavior.** The Copilot narrates the *deterministic* `attention.needsAttention()` /
`weeklyReport.ts` output over the LB roster (doc 05 §6.3). Recommendations are scoped to the
group; the AI cannot surface an athlete the coach can't see (the ContextPack is built only from
`allowed()`-passing rows). Authority Boundary holds: AI phrases, the coach decides.

**Edge cases.** (a) An athlete plays **two positions** (LB + special teams) → they're in two
`groups`; both position coaches see them via separate group scopes — no duplication, the athlete
appears in two rosters (doc 01 §3.6 "same athlete, different viewers"). (b) An athlete **moves
position** mid-season → a `group_members` change (doc 02), audited; the old position coach loses
the roster view the instant the membership flips. (c) The **head coach** (org/program scope, no
group attached → `broad` default) still sees every linebacker — leadership is broad-by-default,
specialists narrow-by-default.

**Scalability.** Group-scoped reads use the `om_scope` partial index (doc 01 §3.3) + doc 02's
`group_members` PK; a 12-athlete narrow read is cheaper than a whole-team scan. Adding a 13th
position coach is one membership + one group-scope row, zero schema change.

> **Status:** the *role + group scope* is **[EVOLVE]** (today `team_staff` is head/assistant
> only); the narrowing is **[NEW]** (doc 02 `grant_group_scopes`). Validates doc 02 §3.1/§3.3.

---

### Scenario 02 — Strength coach managing only freshmen

**Ideal UX.** Identical *shape* to scenario 1 — the strength coach sees only the **freshman**
cohort — but the cohort is a **class-year group** that cuts *across* position and even across
programs (freshmen on Football *and* the same kids who lift in the offseason). The strength coach
cares about hydration/recovery/lifting-day compliance, not position tactics.

**Backend architecture.** `role='strength_coach'`, scope = a `groups(kind='class_year', name='Freshmen')`
group via `grant_group_scopes` (doc 02 §3.3). Because **groups are orthogonal to the roster**
(doc 02 §3.3: an athlete is in N groups — Linebackers ∩ Freshmen ∩ Weight-Gain), the freshman
group is populated independently of position groups. A strength coach scoped to multiple
class-year groups (Freshmen + Sophomores) simply holds multiple group scopes on one grant.

**Permissions.** Strength Coach default = Position Coach default (doc 02 §3.2 row): `goals.edit`,
`report.view`, `alert.receive`, `message.send`; specialist → `deny_until_scoped`. A strength
coach's *relevant components* differ (recovery/hydration emphasis) — that is a **plan
`components` toggle** (doc 03 §3.1 `ComponentRelevance`), not a permission. `[MODEL GAP — minor]`
docs 02/03 don't say **whose** component-relevance wins when a position coach and a strength coach
both touch an athlete's plan; this is the same arbitration question scenario 8 raises and should
be answered there (single active plan, one author-of-record).

**Data ownership.** Unchanged. The freshman athlete owns one dataset; the strength coach reads a
recovery/hydration-weighted *projection* of it (doc 01 §3.6) via the active plan's `components`.

**AI behavior.** Copilot `positiveTrends`/`whoMissed('hydration')` over the freshman group; the
`ai_posture` for a strength context can emphasize recovery (doc 03 §3.5, doc 05 §7 personality is
tone-only). Safety floor for **minors** is absolute (doc 05 §8.1) — a strength coach cannot drive
a freshman below the minor calorie floor even via a plan.

**Edge cases.** (a) A freshman **reclassifies** (held back / skips) → move them between class-year
groups; audited; no data change. (b) **Promotion to varsity** mid-year → still a freshman by class
year, so the strength coach keeps them while the position coach's varsity scope picks them up —
two orthogonal groups, both correct. (c) A freshman is **also** on Track → if the strength program
spans both sports as one `programs` row, one freshman group suffices; if Football and Track are
separate programs, the freshman group lives at **org scope** so it spans programs (`groups` hang
off `programs` in doc 01 §3.5, but a class-year cohort is naturally org-wide → `[MODEL GAP —
confirm]` doc 01 §3.5 puts `groups` strictly under `programs`; a **cross-program cohort group**
(class year) needs to attach at **org or program-set** level. Recommend allowing a `groups.program_id`
to be nullable for org-level cohorts, OR modeling class-year as a doc-02 `groups(org_id, unit_id null)`
which already permits org-level groups. The two docs disagree on whether a group can be org-level;
reconcile in favor of doc 02's org-level groups).

**Scalability.** One cohort group reused by every specialist who cares about freshmen (strength
coach, AD's freshman report). Cohort membership is a `group_members` set; recomputable from
`grad_year` on import (doc 07 §3.3 stages `grad_year`).

> **Status:** **[EVOLVE]/[NEW]** like scenario 1. Surfaces the **org-level (cross-program) group**
> reconciliation between doc 01 §3.5 and doc 02 §3.3.

---

### Scenario 03 — Nutritionist managing multiple sports

**Ideal UX.** A school nutritionist serves Football, Soccer, and Track. They see **all athletes
they're assigned to across all three sports**, in one roster grouped by sport, with nutrition-first
columns (protein adherence, meal timing, allergies). They edit nutrition plans/macros; they do not
touch tactical or strength plans.

**Backend architecture.** Two valid shapes; the doc-01 model supports both:
1. **Org-scoped grant** (`role='nutritionist'`, `scope_kind='organization'`) → sees every athlete
   in the org across all programs. Use when the nutritionist owns the whole department's nutrition.
2. **Multiple group/program scopes** on one grant (`grant_group_scopes` to a "Nutrition: Weight-Gain"
   cohort that spans sports, or to each program) → narrower. Use when they serve specific cohorts.

Because the nutritionist's concern (nutrition) is **cross-cutting**, the cleanest model is an
**org-scoped nutritionist** whose *view* is filtered to a **nutrition cohort group** (doc 02 §3.3,
`kind='nutrition'`) — the same orthogonal-group mechanism as scenarios 1–2, but the group spans
sports.

**Permissions.** Nutritionist default (doc 02 §3.2): **`nutrition.edit ✓`** (the only role besides
Owner/Personal-Trainer with it), `goals.edit ✓`, `score.config ✓` (set the **profile**, not
weights), `report.view`, `alert.receive`, `message.send`. This is the role that **owns the
nutrition plan** in the Scoring Contract sense (doc 03 §3.1, Constitution §11a): they set
targets/profile, the platform owns the formula. `score.config` lets them pick `athlete` vs
`general` profile per client and toggle relevant components — never re-weight (structurally
impossible, doc 02 §3.2, doc 03 §3.4).

**Data ownership.** Athletes own their meals; the nutritionist reads + writes **plan config** only
(via `publish_plan_version` / `coach_set_goals`, doc 03 §3.7). Allergy/dislike facts are **athlete-
owned hard safety constraints** (doc 05 §5.1) the nutritionist can *see and add for confirmation*
but the athlete/guardian owns.

**AI behavior.** `summarizeNutrition(scope, window)` (doc 05 §6.1) over the cross-sport roster;
meal-analysis confidence + correction flywheel (doc 05 §9) feeds the nutritionist's view. The AI
*recommends* macro targets (deterministic evidence-based, never hallucinated for minors, doc 05 §8,
Constitution §11a); the nutritionist accepts → a new plan version.

**Edge cases.** (a) A **multi-sport athlete** (Football + Track) is one profile in two programs but
**one nutrition plan** — the nutritionist sets the active nutrition plan once; both sports'
coaches view the same execution number (doc 01 §3.7, one dataset, N lenses). This is the cleanest
demonstration that nutrition is *athlete-level*, not *program-level*. (b) Conflicting demands from
two sport coaches (bulk for Football, lean for Track) → scenario 8's arbitration. (c) A
**privately-contracted** nutritionist (not school staff) is scenario 4/5 — an *individual-scope*
grant or a separate org, not org-scope.

**Scalability.** Org-scope read is one `org_memberships` lookup (doc 01 §3.4) regardless of sport
count; the nutrition cohort group keeps the *displayed* roster manageable. Adding a fourth sport
adds a `programs` row, zero change to the nutritionist's grant.

> **Status:** **[EVOLVE]** (nutritionist role) + **[NEW]** (cross-sport nutrition group). Validates
> doc 02 §3.2's `nutrition.edit` and doc 03's plan-config ownership. Confirms the Scoring Contract
> end-to-end: nutritionist owns the plan, platform owns the formula.

---

### Scenario 04 — Trainer managing athletes AND general-fitness clients

**Ideal UX.** A private trainer has a **book** that mixes a 16-year-old volleyball recruit (an
"athlete") and a 45-year-old weight-loss client (a "general-fitness client"). **Same app, same
screens** (Constitution §11b "shared interface"), but each person's *intelligence* differs: the
recruit sees performance-framed coaching against an `athlete` profile; the client sees
wellness-framed coaching against a `general` profile. The trainer's roster shows both; switching
between them re-skins the *brain*, not the *screens*.

**Backend architecture.** The trainer is `role='trainer'` (a professional, doc 01 §3.3) with **one
`org_memberships` row per client, `scope_kind='individual'`** (doc 01 §3.3 mapping of
`practice_clients` → individual-scope grants). The book = N individual grants in the trainer's
`kind='private_practice'` org (doc 07 §3.2 "solo pro" path). **Athlete vs client is not a role
difference — it is a `ScoringProfile` on each person's active plan** (doc 03 §3.0 `ScoringContext.profile`):
the recruit's active plan version has `profile='athlete'`, the client's has `profile='general'`.
This is exactly the Constitution §11b Context model and doc 03's "design for many, ship two"
(athlete + general are the **two** shipped profiles).

**Permissions.** Personal Trainer default (doc 02 §3.2) is **broad** — `invite/remove/archive/
nutrition.edit/goals.edit/score.config/report.view/billing.own/audit.view` — because they *are*
the org owner of their own practice. Each grant is `individual` scope, so the trainer sees exactly
their named clients, never anyone else's.

**Data ownership.** Both people own their own data identically — the model **does not distinguish**
an athlete's data from a client's data (same `days`/`meals`/`checkins`, same self-write-only RLS).
The *only* difference is the `profile` selector on the plan, which changes the **formula weight
set** (`athlete` `.5/.25/.15/.1` vs `general` `.55/.2/.15/.1`, doc 03 §3.4) and the coaching copy.
A weight-loss client is **never** penalized for a check-in the trainer doesn't run — `components`
toggles handle that (doc 03 §3.1, Constitution §11a).

**AI behavior.** The single biggest validation of Goal-Aware Intelligence: the trainer's Copilot,
the meal coaching, and the recommendations all read the **per-person `ScoringContext`** (doc 05
§3) and adapt by `profile` + `goals` deterministically; the LLM phrases over it. A **minor athlete**
and an **adult client** in the same book get different safety floors (minor calorie floor absolute,
doc 05 §8.1) — enforced by the safety layer, not the trainer's discretion.

**Edge cases.** (a) A client **becomes an athlete** (the 45-year-old enters a masters competition)
→ switch their active plan's `profile` from `general` to `athlete`; **no data migration, no new
account** — the Context model flexes (doc 03 §5 decision 5). (b) A client is **also** on a school
team (the recruit has a school coach too) → that's scenario 5 (multi-org): two memberships, two
plans, one dataset; primary workspace drives the personal Game Plan. (c) **Billing**: every client
is a `client_seats` consumer on the trainer's `professional` plan (doc 06 §3.2); a churned client
(`status='left'`) frees a seat automatically (doc 06 §3.4). (d) A general-fitness client with **no
goal beyond "feel better"** → `general` profile, habit-style goals (doc 03 §3.3 `kind` allows
non-numeric habit goals), no performance pressure.

**Scalability.** "Design for many, ship two" is the whole point — the trainer's two business
models are **two profile rows**, not two apps or two code paths (Constitution §11b, doc 03 §6).
Adding a "busy professional" or "bodybuilder" profile later is a `weight_set` + copy row, not a
schema change.

> **Status:** trainer-per-client grant is **[ALREADY BUILT]** in spirit (`practice_clients`,
> `0001`) → **[EVOLVE]** to individual-scope memberships. The athlete/client distinction-as-profile
> is **[EVOLVE]** of `ScoringProfile`. **This scenario is the canonical proof of Constitution §11b**
> and needs no new model — only doc 03's profile seam, which already exists in two flavors.

---

### Scenario 05 — Athlete belonging to multiple organizations

**Ideal UX.** A recruit belongs to **University team + private nutritionist + 7-on-7 club**. She
has **one** profile, **one** stream of meals, **one** Development Score. A **workspace switcher**
(doc 07 §6) lets her view her standing *as each org sees it* — the university's targets, the
nutritionist's plan, the club's report — but her morning **Daily Game Plan** follows **one
primary** workspace so there is still "one number, one focus" (Founder Rule #9). Coaches in each
org see only their org's lens.

**Backend architecture.** Three concurrent `active` `org_memberships` (doc 01 §3.7), each a
different `organization_id`, each with its own scope/permissions. Her one dataset is read through
three projections (doc 01 §3.6). `ActiveWorkspace.active` selects which org's targets/branding/
report render; `available` lists all three (doc 07 §6.1). The **primary** membership (doc 07 §6.1,
closing doc 01 §3.7's open question) drives her personal plan; the other two are **reference
plans** (doc 03 §3.2) — visible, AI-aware, non-scoring.

**Permissions.** Each org's staff resolve `allowed()` independently against **their** membership
scope; none can see the other orgs' grants or data beyond what `can_view` permits for *their* org
(doc 02 §3.4). The athlete sees everything (she's `is_self`).

**Data ownership.** The textbook case: **the athlete owns the data; three orgs own access only**
(doc 01 §3.1). No org's targets, weights, or reports touch another org's. There is exactly one set
of meals and three reports (doc 01 §3.7).

**AI behavior.** The Copilot for each org reads only that org's authorized projection. The
athlete's *own* AI (her Game Plan) reads her **primary** plan's `ScoringContext`; reference plans
appear as context ("your nutritionist wants 200g; today's active plan wants 180g") never as a
competing score (doc 03 §3.2). **Authority Boundary**: the AI surfaces the divergence, never
silently picks (doc 05 §8.2) — which is the bridge to scenario 8.

**Edge cases.** `[MODEL GAP — the central one, scenario 8 owns it]` **conflicting targets across
orgs** (university bulk vs nutritionist cut). Doc 01 §3.7 and doc 07 §6.1 both defer to a
**primary-membership** rule: primary drives the personal plan; others are read-side compliance
projections. **This must be founder-confirmed** (doc 01 open decision 3). (b) **Consent is
per-org** (doc 01 §3.9): she can share with the university but pause the club; the fail-closed gate
is per-membership, not global. (c) **Billing**: she consumes an active seat in *each* org with a
plan, but **never pays herself** while attached to any active org (doc 06 §3.6 rule 2). If she's
solo + a private nutritionist, she may have her own `kind='family'` org-of-one (doc 06 §3.7).

**Scalability.** N memberships = N rows; the switcher appears only at `available.length>1` (doc 07
§6.3), so single-org users (99% today) see no added surface. Each org's roster query is
independently scoped — no cross-org join.

> **Status:** **[DON'T BUILD YET]** at the build level (needs the workspace switcher + multi-org
> plans, doc 07 Phase 2 / doc 03 multi-plan) but the **seam must be honored now**: one profile, N
> memberships, primary drives the plan. The architecture is correct today even though the UI ships
> later. Validates doc 01 §3.7, doc 03 §3.2, doc 07 §6.

---

### Scenario 06 — Athlete transferring schools

**Ideal UX.** A junior transfers from Lincoln HS to Madison HS. At Madison, the new coach finds the
athlete already in the system (no re-entry), and — **once the athlete/guardian re-consents** — sees
her full history from day one. At Lincoln, she drops off the active roster but her record is
untouched. The athlete experiences **zero data loss and zero re-onboarding** — she signs into her
**same** profile and accepts the new org's invitation.

**Backend architecture.** A pure **access-half** operation (doc 01 §3.9): `transfer_athlete(membership_id,
to_org=Madison, reason)` flips the Lincoln membership `status='transferred'`, creates an `active`
membership in Madison, and appends `transferred_out` + `transferred_in` to `membership_events`. The
athlete's `days`/`meals`/`checkins`/score-history **carry over automatically because they were never
attached to an org** (doc 01 §3.1). On the provisioning side (doc 07 §3.3), Madison's roster import
**dedupes on `exact_email`** → binds a *new membership* to her *existing* profile, never minting a
duplicate (doc 07 §11 contract 3 — "never create a duplicate athlete").

**Permissions.** Madison's coach gains `report.view` etc. via the new membership scope. Lincoln's
coach loses live access the instant the membership flips to `transferred` (doc 01 §3.9). The
**transfer requires destination-admin call AND athlete/guardian acceptance** (doc 01 §4) — an org
cannot pull an athlete in unilaterally.

**Data ownership.** The clean proof of "graduation/transfer never resets progress" (doc 01 §3.9):
the score history is byte-identical the millisecond before and after. The plan, however, is **per-
org** — Madison's coach authors a **new active plan** (Lincoln's plan becomes a reference plan or
is archived); switching is **forward-only**, so historical days keep Lincoln's frozen
`plan_version_id`/`weight_set_id` (doc 03 §3.8, #9 invariant). Her **Development Score history stays
comparable** because the *formula* is platform-owned and constant (Constitution §11a/§13) even
though the *plan* changed.

**AI behavior.** The **Performance Profile follows the athlete** (doc 05 §4.2, the moat) — Madison's
coach inherits her habits, preferences, allergies (athlete-owned Memory facts, doc 05 §5), and
score trend. `[MODEL GAP — confirm]` doc 05 §4.2 leaves the **coach-feedback portability** rule
INFERRED: athlete-acknowledged feedback transfers; raw private Lincoln coach notes do **not** (and
doc 04 §3.5 medical notes are deny-by-default and likely org-bound). Founder/legal must confirm
what crosses.

**Edge cases.** (a) **Consent re-prompt** `[MODEL GAP — legal, doc 01 §3.9 + doc 05 §5.4]`: does a
verified guardian's consent travel with the athlete, or re-prompt per new org? Doc 01 recommends
**re-prompt** (data-minimization, COPPA/FERPA-safe); **the new coach sees nothing until Madison's
consent is granted** even though the membership exists. This is the fail-closed gate over a valid
grant (doc 01 §7 contract 4). (b) **Mid-season transfer** → Lincoln's seat frees automatically
(`status='transferred'` is not active, doc 06 §3.4); Madison consumes one. (c) **Transfer back**
(returns to Lincoln) → **reactivate the same Lincoln membership row** (`reactivated` event, doc 01
§3.9) — never a third membership, never a duplicate.

**Scalability.** Transfer is two membership writes + two ledger rows — O(1), no data movement
regardless of history size. This is *why* athlete data must stay org-free (doc 01 §3.1): a transfer
that copied history would be O(history) and would let an org "own" a copy.

> **Status:** **[DON'T BUILD YET]** at build level (needs `membership_events` + `transfer_athlete`,
> doc 01 Phase 3) but **architecturally settled now**. The dedupe-on-import seam (doc 07 §3.3) is
> the load-bearing piece that must be designed correctly so a transfer never duplicates. Validates
> doc 01 §3.9, doc 03 §3.8, doc 05 §4.2, doc 07 §3.3.

---

### Scenario 07 — Coach leaving an organization

**Ideal UX.** A position coach quits Lincoln mid-season. **The athletes' data, plans, and history
are completely unaffected** — they don't lose their targets or score. The coach loses all access to
Lincoln athletes immediately. Any plans the departing coach authored remain in force (the athletes
still have a plan) until a remaining coach revises them. The org admin reassigns the linebacker
group to another coach in two taps.

**Backend architecture.** The coach's `org_memberships` row flips `status='left'` (or `removed` if
involuntary) + a `membership_events` row (doc 01 §3.9, doc 06 §3.5 "archive" verb). Access ends
immediately because `can_view` only counts `status='active'` grants (doc 01 §3.4). **Plans they
authored are org/athlete-owned config, not coach-owned** — a `plan_versions` row has `authored_by`
but the plan belongs to the athlete (`plans.athlete_id`, doc 03 §3.1), so it **survives the
author's departure**. Reassignment = move the `grant_group_scopes` (or grant a new coach the group
scope), audited via `activity_log` (doc 02 §3.5).

**Permissions.** On `status='left'`, every `allowed()` check for that coach against Lincoln athletes
returns false (consent ⋅ scope ⋅ permission all collapse with no active grant). The coach keeps
their **own profile** and any *other* org memberships (e.g. if they also coach at a club) — leaving
one org never touches another (doc 01 §3.7).

**Data ownership.** The cleanest "organizations own access only" proof from the *staff* side:
removing a coach is a pure access revocation. **No athlete data, plan, or score is deleted** — doc
02 §3.6's invariant ("org-initiated removal is always access-only; only the data owner destroys
data") applies symmetrically to removing staff. The departing coach also cannot take a copy of the
roster (their access simply ends; the Copilot's `copilot_artifacts` they drafted are theirs, but
reference athletes they can no longer see → doc 05 §6.2 RLS denies re-reading them).

**AI behavior.** The departing coach's drafted-but-unsent messages/reports (`copilot_artifacts`
status `draft`, doc 05 §6.2) become unreadable (RLS re-checks `allowed()` on every athlete
referenced). No AI action survives the access loss. The replacement coach's Copilot reads the same
athletes fresh.

**Edge cases.** (a) **The coach was the only one who could see a group** → the athletes still own
their data and still have their plan; they're just temporarily unrostered to staff until the admin
reassigns. The athlete's own experience is unchanged (their Game Plan persists). (b) **Head coach /
org owner leaves** `[MODEL GAP — confirm]`: docs 01/02 don't specify **org-owner succession** —
who inherits `role.manage`/`billing.own` if the sole owner departs? Recommend an org must always
have ≥1 `admin`; `leave_membership` on the last admin is **blocked** until ownership is transferred
(a new RPC `transfer_org_ownership`). Flag for doc 01/02. (c) **Involuntary removal** (`removed` vs
voluntary `left`) → same access effect, different `membership_events.kind` for audit/dispute.
(d) **Billing seat**: a coach is **not** an active-athlete seat (doc 06 §3.4 counts only
`role='athlete'`), so a departing coach frees no athlete seat — correct.

**Scalability.** O(1): one status flip + one ledger row + (optional) one scope reassignment. No
cascade over athlete data.

> **Status:** **[DON'T BUILD YET]** at build level (needs `membership_events` + lifecycle RPCs) but
> **architecturally trivial on the existing model** — it's the staff-side mirror of scenario 6.
> Surfaces the **org-owner-succession gap** (must always have ≥1 admin). Validates doc 01 §3.9, doc
> 02 §3.6, doc 03 §3.1 (plan survives author).

---

### Scenario 08 — Two coaches disagreeing on nutrition goals

**Ideal UX.** The Football coach wants the athlete bulking (200g protein, surplus); the school
nutritionist wants a recomp (180g protein, maintenance). **Neither silently overwrites the other.**
The athlete sees **one** active plan driving her Game Plan, with the disagreement surfaced honestly
("Coach K's plan: 200g · Nutritionist's plan: 180g — your active plan is the Football plan").
Whoever has authority sets the active plan; the other plan is visible as a **reference plan**. The
**platform never picks a side by re-weighting the score** — an "84" still means "84% of *your
active plan*," whoever set it (Constitution §11a).

**Backend architecture.** This is **two plans, one active** (doc 03 §3.2). Each professional authors
their own `plans` row (`author_scope='team'` for the coach, a nutritionist plan for the
nutritionist), each versioned immutably (doc 03 §3.1). The athlete has **exactly one**
`athlete_active_plan` pointer (doc 03 §3.2); that plan drives the Development Score, AI, and
accountability. The other is `relation='reference'`. The disagreement itself is recorded — this is
where doc 05 §8.2's **`ai_recommendations`** pattern generalizes: a structured record of
"value A vs value B, current winner, who decided." `[MODEL GAP — the biggest one]` doc 03 §3.2 and
doc 01 §3.7 both flag **active-plan arbitration as an open founder decision** (doc 03 open decision
1, doc 01 open decision 3). **This scenario is the forcing function for that decision.**

**Permissions.** Both the coach (`goals.edit`) and the nutritionist (`nutrition.edit`+`goals.edit`)
can author *their own* plan version (doc 02 §3.2). The contested action is **`set_active_plan`**
(doc 03 §3.7) — *who may switch which plan governs*. Doc 03 §3.2 leaves this governed "separately"
and recommends: **professional-authored plans are active-eligible; the primary professional sets
it, or the athlete consents to switches.** Recommended resolution (founder confirm):
- **Org policy designates a "nutrition authority" role** (typically the nutritionist for nutrition
  plans, else the head coach) who owns `set_active_plan` for nutrition; OR
- **The athlete consents** to which professional-authored plan is active (athlete agency, Founder
  Rule — she owns her data, she picks her primary guide).
Recommend: **athlete consents among professional-authored candidates**, defaulting to the
nutritionist for nutrition (domain authority), with the disagreement always visible.

**Data ownership.** Unchanged — the athlete owns her meals; **both** plans are config *about* her,
neither is her data. The active-plan pointer is a property of the athlete (doc 03 §3.2), reinforcing
that **she** (or her designated authority) decides which plan governs — not whichever coach wrote
last. There is **no last-write-wins on goals**; goal edits append plan versions, they don't clobber
(doc 03 §3.1 immutability). This is precisely why doc 03 made the plan versioned: to make
"two coaches editing" a non-destructive, auditable, side-by-side state rather than a race.

**AI behavior.** The **Authority Boundary** (doc 05 §8) is the spine of this scenario: the AI
**records the disagreement and shows both** (doc 05 §8.2 `ai_recommendations`), never silently
resolves it. The active plan's value is the "winner by default"; the AI may *recommend* (with
deterministic, evidence-based rationale — never a hallucinated minor target, Constitution §11a) but
a human with `set_active_plan`/`goals.edit` decides. The **safety floor is the one thing that
outranks both coaches** (doc 05 §8.2): if the bulk surplus would push a *minor* past a safe ceiling,
or the cut below the minor calorie floor, the deterministic safety bound refuses it regardless of
who set it.

**Edge cases.** (a) **Both are minors-aware**: the safety floor caps both plans. (b) **The coach
overrides the nutritionist's macros directly** → this is *not* allowed as a silent edit; each owns
their **own** plan version. A coach cannot edit the nutritionist's plan — they author a *competing*
plan, and arbitration picks which is active. (c) **No designated authority** → fall back to athlete
consent; if the athlete is a minor, guardian consent. (d) **The two agree later** → one switches
their plan to match or sets the other's active; the `ai_recommendations`/audit trail shows the
resolution (doc 02 §3.5). (e) **Cross-org version** (Football coach at school, nutritionist is
private) = scenario 5's multi-org conflict — same primary-membership resolution; the **primary
workspace's plan** is active (doc 07 §6.1).

**Scalability.** N plans per athlete, one active pointer — O(1) governance read. Disagreements are
data (`ai_recommendations` rows), not a workflow engine; they don't block the loop (the athlete
always has an active plan to execute).

> **Status:** **[EVOLVE]/[NEW]** — needs doc 03 multi-plan + `athlete_active_plan` + doc 05
> `ai_recommendations`. **This scenario is the single most important model-gap forcing function in
> the slice**: it demands the founder close *active-plan arbitration* (doc 01 §3.7 / doc 03 §3.2 /
> doc 07 §6.1 all defer to it). The model's bones are right (versioned plans, one active, show-both,
> safety-floor-supreme); the **policy** ("who sets active") must be confirmed. Validates the entire
> Scoring Contract (Constitution §11a) under adversarial conditions.

---

### Scenario 09 — Parent requesting read-only access

**Ideal UX.** A parent of a 15-year-old requests to see their child's progress. The athlete (and,
because she's a minor, the consent flow) grants **read-only** access: the parent sees a **weekly
digest** — score trend, weight, "last synced" — and can send encouragement, but sees **no raw meal
photos** unless the athlete explicitly shares them, and can **never edit** a plan, target, or log.
For the parent, this is the closest-to-shipping scenario.

**Backend architecture.** A `role='guardian'` membership, `scope_kind='individual'`,
`scope_id=<athlete>`, `permissions={view_score:true, view_weight:true, message:true}` (doc 01 §3.3
guardianship mapping). In a `kind='family'` org if the founder confirms family-as-org (doc 01 §3.5);
else the legacy `guardianships` path (doc 01 maps both to the same membership shape). Reads resolve
through `can_view` (the guardian individual-scope branch, doc 01 §3.4); `is_guardian_of`
short-circuits `report.view` (doc 02 §3.4) preserving the parent relationship without an org grant.

**Permissions.** Parent default (doc 02 §3.2): `report.view ✓`, `alert.receive ✓`, `message.send ✓`
(gated by the minor-messaging rules `0006`); **everything else denied** — no `goals.edit`,
`nutrition.edit`, `score.config`, `archive`, `member.*`. **Read-only is the default and the
maximum** for a guardian-in-a-school-context. (`billing.own` is ✓ only in the consumer **Parent
Plan** context, doc 02 §3.2 note — INFERRED, founder confirm.)

**Data ownership.** The sharpest expression of "athlete owns the data": **the minor still owns and
controls her data**, and the parent's *read* is gated by **both** the athlete's sharing controls
**and** the fail-closed consent gate (doc 01 §3.6, `src/core/consent.ts`). Raw meal photos are
**athlete-only by default** (doc 05 §5.4 tiered visibility) — the parent sees the digest, not the
images, unless the athlete opts in. The parent can **never write** to the athlete's logs or plan.

**AI behavior.** The parent's view is the doc 04 weekly digest + doc 05 Performance Profile
*projection* — read-only, no Copilot authoring over the child (the parent is not a coach). D9 Part A
("last synced," parent sync) is the relevant surface (referenced in the prompt's D9 spec). The AI
phrases the digest; it never exposes data the consent gate withholds.

**Edge cases.** (a) **The minor's consent is unverified** → the parent (even with a valid
guardianship) sees **nothing** real; the consent gate is supreme over the grant (doc 01 §7 contract
4). For a minor, the *guardian's own verification* is what unlocks the minor's data leaving the
device (`0008`, the COPPA spine) — so a *requesting* parent who isn't yet the **verified** guardian
is in a pending state. `[MODEL GAP — minor, confirm]`: the model conflates "guardian who verifies
consent (unlocks sync)" with "parent who requests read-only viewing." For a minor these are usually
the same person; but a **non-custodial parent requesting view-only** must NOT automatically gain the
consent-verifier role. Recommend: the **verified guardian** controls consent; *additional*
read-only viewers (a second parent) are `role='guardian'` grants the athlete/primary-guardian must
approve, never auto-granted by relationship claim. (b) **Athlete pauses sharing** (`sharingPaused`,
doc 01 §3.6) → the parent's read goes dark immediately; consent/sharing wins over the grant. (c)
**Adult athlete** (18+) → no guardian consent required; the *athlete alone* grants a parent read
access (or doesn't) — parental access is never assumed for an adult. (d) **Parent of multiple
children** → multiple individual-scope guardian grants, one per child (doc 01 §3.5 family-as-org
gives a clean home for siblings).

**Scalability.** One membership per (parent, child); reads are individual-scope index lookups (doc
01 §3.3 `om_scope`). The family-as-org model (doc 01 §3.5) scales a multi-child parent to one org
with N guardian grants.

> **Status:** **[ALREADY BUILT]** (closest of all nine) — guardianship + consent gate +
> `src/core/parent.ts` exist today (`0008`, `0006`, `0009`). **[EVOLVE]** only to express
> guardianship as a `guardian` membership and to add per-kind photo visibility (doc 05 §5.4).
> Surfaces the **verifier-vs-viewer** distinction the consent model must clarify. Validates doc 01
> §3.6, doc 02 §3.2, doc 05 §5.4, and the consent gate's supremacy.

---

## 4. Cross-scenario findings & the model gaps (consolidated for the founder)

The nine scenarios prove the docs-01–07 contracts are **structurally sufficient** — every case is
some combination of `(role, scope, permissions, status)` + plan-as-projection + the consent gate,
with **no new access path**. They surface **five decisions the founder must close** (each already
flagged as INFERRED/open in a model doc; the scenarios show *why they bite*):

1. **Specialist scope-default = `deny_until_scoped`** (doc 02 §3.3). **Scenarios 1–3 are wrong
   without it** — an unscoped position coach/nutritionist would see the whole org. Confirm
   `position_coach/strength_coach/nutritionist/athletic_trainer/assistant_coach` are
   deny-until-scoped; `org_owner/AD/head_coach` are broad.
2. **Active-plan arbitration** (doc 01 §3.7, doc 03 §3.2, doc 07 §6.1 — all defer to it).
   **Scenario 8 is the forcing function.** Recommend: professional-authored plans are
   active-eligible; the **athlete consents** among them (guardian for a minor), defaulting to the
   nutritionist for nutrition plans; the disagreement is always shown, never silently resolved; the
   **safety floor outranks every coach**.
3. **Org-level (cross-program) cohort groups** (scenario 2). Doc 01 §3.5 puts `groups` strictly
   under `programs`; doc 02 §3.3 allows org-level groups. **Reconcile in favor of doc 02** so a
   class-year/nutrition cohort can span sports.
4. **Consent on transfer + verifier-vs-viewer** (scenarios 6 & 9; doc 01 §3.9, doc 05 §5.4).
   Confirm consent **re-prompts per new org** (COPPA/FERPA), and that the **verified guardian**
   (consent authority) is distinct from **additional read-only viewers** the athlete/guardian must
   approve.
5. **Org-owner succession** (scenario 7). Docs 01/02 don't specify it. Recommend: an org must always
   have ≥1 `admin`; leaving as the last admin is **blocked** pending `transfer_org_ownership`.

**What is [DON'T BUILD YET]:** scenarios 5–7 (multi-org switcher, transfer ledger, coach-leave
lifecycle) need doc 01 Phase 3 (`programs`/`groups`/`invitations`/`membership_events`) + doc 07
Phase 2 (workspace switcher). **Build the seam now** (the `org_memberships` model already supports
them as status transitions), populate the lifecycle tables only when a real multi-org/transferring
customer exists. Scenarios 1–4 are the near-term wedge (specialist roles + group scope + the
athlete/client profile split). Scenario 9 is closest to shippable on today's guardianship code.

**The cross-cutting contract this doc re-asserts (no new contract, a restatement):** *every
scenario changes only the access half — memberships, scopes, plan-as-projection, consent — never
the athlete-owned profile half. If a scenario appears to require moving, copying, or org-stamping
athlete data, the design is wrong.* This is doc 01's invariant, and all nine scenarios hold it.

---

## 5. Open decisions for the founder

(These are the five §4 gaps, listed for sign-off; each cites the model doc that owns the fix.)

1. **Specialist `scope_default = deny_until_scoped`** for position/strength/nutritionist/AT/assistant
   roles (doc 02 §3.3) — *scenarios 1–3 depend on it.*
2. **Active-plan arbitration policy** — who sets the active plan when two professionals disagree?
   Recommend: athlete-consents-among-professional-plans, nutritionist-default for nutrition,
   disagreement always shown, safety-floor supreme (doc 03 §3.2 / doc 01 §3.7 / doc 07 §6.1) —
   *scenario 8 forces this.*
3. **Org-level cohort groups** allowed (reconcile doc 01 §3.5 vs doc 02 §3.3 toward org-level
   groups) — *scenario 2.*
4. **Consent re-prompts per transfer**, and **verified-guardian (consent authority) ≠ read-only
   viewer** (doc 01 §3.9, doc 05 §5.4) — *scenarios 6 & 9.*
5. **Org-owner succession** — always ≥1 admin; block last-admin departure until ownership transfers
   (doc 01/02) — *scenario 7.*
