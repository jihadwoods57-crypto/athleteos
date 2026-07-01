# 00 — Enterprise Architecture Overview & Reading Index (the capstone)

> Deliverable #1 (Enterprise Architecture) **and** the index / reading order for the whole
> `docs/architecture/` set (docs 01–10). Status: **DESIGN ONLY** — no app/TS code, no SQL
> migrations shipped here. Authored 2026-06-29. This doc does **not** restate docs 01–10; it
> **reconciles** them into one thesis, one system map, one set of invariants, and one phased
> migration path, and it resolves the conflicts the slice docs flagged across each other.

---

## 1. The one-page thesis

**OnStandard is the org-centric AI execution platform: it turns a coach's plan into an athlete's
daily execution — and proves it worked.** Everything in the architecture is a consequence of one
spine and one hard split.

**The spine (the entity chain):**

```
Organization ─▶ Programs ─▶ Groups ─▶ Athletes ─▶ Plans ─▶ Development Score ─▶ AI
  (who pays /     (a sport /   (Varsity,   (the          (targets +    (one number,    (phrases,
   owns access)    a book)      a cohort)   PERSON)       windows +     0–100,           drafts,
                                                          goals,        platform-        retrieves —
                                                          versioned)    owned formula)   never decides)
```

Read it as: an **Organization** grants access; **Programs/Groups** organize the roster; **Athletes**
own a permanent profile and the data under it; **Plans** are versioned, org-authored configuration
*about* an athlete; the **Development Score** is the one platform-owned number that measures
execution of the active plan; and **AI** is a language layer over a deterministic core — it
recommends, the coach decides.

**The hard split that the entire system rests on** (doc 01 §3.1, restated in every scenario):

> **PROFILE HALF** — athlete-owned, permanent, org-free: `profiles`, `athlete_profiles`, `days`,
> `meals`, `checkins`, score history, Performance Profile, AI Memory. Keyed on `athlete_id`,
> **self-write-only**, survives every org change with **zero data movement**.
>
> **ACCESS HALF** — org-owned, grant-based, revocable: `organizations`, `programs`, `groups`,
> `org_memberships`, `invitations`, `subscriptions`, `licenses`, branding. Carries
> who-may-see-what and who-pays. Granting, transferring, revoking, or cancelling **never touches
> the profile half.**

A transfer, a graduation, a coach quitting, a cancelled subscription, a workspace switch — every
one of these is an **access-half-only** mutation. The litmus test that runs through all 10 docs:
*if an operation appears to require moving, copying, or org-stamping athlete data, the design is
wrong.*

### The core invariants (the things we say "no" with)

These are the non-negotiables every slice doc inherits. They are the architectural expression of
the Product Constitution's Founder Rules.

| # | Invariant | Where it is enforced | Constitution tie |
|---|---|---|---|
| I1 | **Athletes own their data** — `days`/`meals`/`checkins` keyed on `athlete_id`, self-write-only; overseers only read. | `*_write = is_self` on every athlete table (docs 01–04) | "amplify, never replace" |
| I2 | **Organizations own access only** — every grant is one `org_memberships` row; an org can revoke access but never delete or own history. | `can_view`/`allowed(...)` over `org_memberships` (docs 01/02) | §11a, Rule #3 |
| I3 | **Scoring integrity** — the coach owns the PLAN; the platform owns the FORMULA; weights are bounded/normalized data inside a platform-owned profile, never a free re-weight. An "84" means the same thing everywhere. | `validateWeightSet`, no `weights.edit` permission key (docs 02/03) | §11a, Rule #13 |
| I4 | **History immutability** — `plan_versions`, `score_weight_sets`, `accountability_events`, `activity_log`, `membership_events`, `billing_events` are append-only; a graded day's frozen `explain` is never rewritten. | immutability triggers; frozen tuple on `days` (docs 02/03/04) | Rule #9, #11 |
| I5 | **Fail-closed consent** — a minor's real data never leaves the device until a guardian is `verified`; consent sits **above** every membership, permission, paid seat, and AI surface. | `src/core/consent.ts` + `0008`/`0006` RLS pre-filter (every doc) | COPPA, Rule #8 |
| I6 | **`src/core` purity** — every decision (scoring, scope, dispatch, entitlement, outbox, workspace, memory) is a pure, offline-testable function with no React/RN/Supabase import; the impure layer is only RPCs + seams. | `src/core/*.ts` (all docs); ~970 tests | Rule #8, #12 |
| I7 | **AI recommends, the coach decides** — the deterministic engine + the coach's plan are ground truth; the LLM only phrases/drafts/summarizes/retrieves; disagreement is surfaced, never silently resolved; only the **safety floor** can outrank a coach. | the Authority Boundary + `arbitrate()` + `ai_recommendations` (doc 05) | §11a, Rule #13 |

---

## 2. The system map — how docs 01–10 fit together

Three layers of docs: **foundation** (01–02 define identity, access, and the security spine),
**execution & commerce** (03–07 build the product on that spine), and **validation** (08–10
stress-test the whole set against 25 real-world scenarios). Every slice exposes exactly one
cross-cutting **contract** the other docs consume — and consume *only through that contract*, never
by inventing a parallel path.

```
                         CONSTITUTION  (the filter: 5 pillars, 14 Founder Rules, the Scoring Contract)
                                 │
   FOUNDATION ───────────────────┼───────────────────────────────────────────────────
   01 Data Model & Org Hierarchy  │  contract:  org_memberships (membership + role + SCOPE + status)
        │  the PROFILE/ACCESS split, can_view(athlete), invitations, membership_events
        ▼
   02 Roles, Permissions, Security│  contract:  allowed(viewer, athlete, scope, action)  + activity_log
        │  configurable RBAC, group-scoped visibility, append-only audit, the RLS predicate
        │
   EXECUTION & COMMERCE ──────────┼───────────────────────────────────────────────────
   03 Plans, Goals, Dev Score     │  contract:  ScoringContext = (active_plan_version, weight_set, season, goals, profile)
        │  versioned plans, weight-set governance, immutable per-day frozen tuple
   04 Accountability & Comms       │  contract:  accountability_events (the behavioral ledger) + notification_dispatch gate
        │  escalation SM, structured messaging, notes, achievements, Recovery Mode
   05 AI Systems                   │  contract:  the Authority Boundary + assist() seam (ContextPack in, phrasing out)
        │  Performance Profile, Memory, Copilot (drafts-only), Personality, Meal Analysis
   06 Billing & Licensing          │  contract:  resolveEntitlement(viewer) → hasFeature(viewer, key)  (org-keyed)
        │  4 layers: pricing catalog · subscription · license · entitlement; active-athlete metering
   07 Onboarding, Branding, Offline│  contract:  ActiveWorkspace.active (the acting-org selector) + outbox WAL
        │  activation vs provisioning, dedupe-on-import, org_branding, workspace switching, SSO/API seam
        │
   VALIDATION ────────────────────┼───────────────────────────────────────────────────
   08 Scenarios 01–09  · 09 Scenarios 10–17  · 10 Scenarios 18–25
        25 end-to-end walkthroughs proving the contracts are sufficient with NO new access path;
        each surfaces the founder decisions the model docs left open (consolidated in §5 below).
```

### The cross-cutting contracts (the API between slices)

Every doc keys off these six objects and nothing else. This is what makes the architecture
composable rather than a pile of features — and it is why "adding a user type / role / org type /
plan / feature" is *data*, not a new code path.

1. **Membership + scope** — `org_memberships(organization_id, member_id, role, scope_kind,
   scope_id, permissions, status)` (doc 01). The single access-grant object. Subsumes today's
   `team_members`/`team_staff`/`practice_clients`/`guardianships`. Billing keys off
   `organization_id`; permissions key off `permissions`; dashboards key off `scope`; the active
   workspace selects *which* membership is in force.
2. **The RLS predicate** — `allowed(viewer, athlete, scope, action) = consent_ok ∧ sees_athlete
   ∧ has_permission` (doc 02), whose `can_view(athlete)` body is one `org_memberships` scope
   lookup (doc 01 §3.4). **No doc invents a second access path.** The function *signatures* never
   change; only `can_view`'s body evolves — that is the whole non-destructive trick.
3. **The active plan/weight/season tuple** — `ScoringContext = (active_plan_version_id,
   weight_set_id, season_id, goals, profile)` (doc 03). Every score and every AI surface resolves
   exactly this tuple; the day recorder *freezes* its ids onto the `days` row, so history is
   self-describing and immutable. The pure formula in `src/core/scoring.ts` never changes — only
   *where the plan comes from*.
4. **The accountability signal schema** — `accountability_events(athlete_id, event_type, severity,
   payload, day_stamp, dedupe_key)` (doc 04). One append-only behavioral ledger; the escalation
   machine transitions on it, the weekly report aggregates it, achievements derive from it, and the
   AI Copilot reads it (and *only* it). Severity is owned by the deterministic engines; the AI may
   not set it.
5. **The feature-entitlement object** — `resolveEntitlement(viewer) → { plan, status, features{},
   seat, source }`, gated through `hasFeature(viewer, key)` (doc 06). Every gated feature checks
   this; no doc reads a tier string or a `subscriptions` row directly. Resolution walks
   org → license → membership, so an athlete attached to an active org **never pays separately**.
6. **The active-workspace context** — `ActiveWorkspace.active` (doc 07): the one
   `org_membership` a request asserts, passed as `acting_org` and re-validated server-side. Every
   screen, query, report, brand, and entitlement reads it. It **narrows, never widens** — RLS is
   the authority, the workspace is the selector.

### How the contracts compose (the dependency order)

`org_memberships` (01) is the root. `allowed()` (02) is built on it. `ScoringContext` (03),
`accountability_events` (04), the AI Authority Boundary (05), `resolveEntitlement` (06), and
`ActiveWorkspace` (07) all sit on top of `allowed()` and never bypass it. The consent gate (I5)
sits **above all six**. The scenarios (08–10) prove the composition holds: every one of the 25
decomposes into `(role, scope, permissions, status)` + plan-as-projection + the consent gate, with
no new primitive. **The single most important emergent result across the scenarios: a multi-org
athlete's *primary workspace* (07) ⇒ *active plan* (03) ⇒ *primary goal* (11) are the same
athlete-owned selection, expressed once** (docs 09 §4.1, 10 §3; closes doc 01 §3.7).

---

## 3. TARGET vs TODAY — the gap, and the non-destructive migration

### Where we are today (the current reality, honestly)

- **Role/flow-centric, not org-centric.** A user *is* one role; onboarding is `flows.ts`
  step-descriptors; access is the link spine (`team_members`/`team_staff`/`practice_clients`/
  `guardianships`) with `can_view = is_self OR is_team_coach_of OR is_trainer_of OR is_guardian_of`.
- **Backend gated by `isBackendLive` / `isEnginesEnabled`.** The pure `src/core` engines all run
  on-device; sync/RPC/notify seams are inert. The app is byte-identical with the flag off.
- **Consent is fail-closed and real** (`src/core/consent.ts` + `0008`/`0006`).
- **Subscriptions are an inert per-owner seam** (`src/core/subscription.ts` + `0010`):
  `previewEntitlement()` is the default; `isPro()` is the gate.
- **~970 tests**, almost all over pure `src/core` (scoring, adherence, attention, leaderboard,
  mealEdit, consent, subscription) — the asset the whole migration must protect.

### The target (the 10-year platform)

The org-centric AI execution platform of §1: one unifying `org_memberships` grant, a
configurable RBAC engine with group-scoped visibility, versioned plans + governed weight sets, a
durable accountability ledger, an AI Authority Boundary over an `assist()` seam, four-layer
org-keyed billing, and an `ActiveWorkspace`-scoped multi-org experience.

### The gap, stated as deltas (not a rewrite)

The target is reachable **by evolution, not replacement**, because today's model already encodes
the right invariants in a narrower form. The migration is: *generalize the seams that exist,
preserve every signature, populate the deep tree only when a real customer needs it.*

| Today | Target | Move |
|---|---|---|
| 4 link tables | one `org_memberships` (+`programs`/`groups`) | **[EVOLVE]** — compat views first; `can_view` body swaps to one scope lookup, **signature unchanged** |
| `can_view = OR of links` | `can_view = one scope predicate`; `allowed()` adds RBAC + audit | **[EVOLVE]** — same function name, new body; no policy/call-site rewrite |
| `staff_role(head/assistant)` | 12-role configurable catalog + per-org overrides | **[EVOLVE]** — fixed catalog first; custom roles **[DON'T BUILD YET]** |
| implicit single plan + 2 hard-coded weight maps | versioned `plans`/`plan_versions` + governed `score_weight_sets` | **[NEW]** tables; `scoring.ts` formula **untouched** (fed by `coachPlanFromVersion`) |
| local-only escalation/reminders | durable `accountability_events` + `notification_dispatch` gate | **[NEW]** ledger; pure engines stay the transition rule |
| inert AI seam (`isAiConfigured=false`) | `assist()` + Authority Boundary + Memory/Profile | **[EVOLVE]** the one seam; honest labels flip when a model is configured |
| per-owner `subscriptions` | org-keyed sub + license + pricing catalog + resolver | **[EVOLVE]** `owner_id → organization_id`; `isPro` survives as a shim |
| single role/flow, current-day cache | `ActiveWorkspace` selector + `outbox` WAL | **[NEW]** inert seams; single-membership users see no change |

### The phased migration path (ship the seam now, populate later, break nothing)

Each slice doc carries its own staged plan; they share one cadence, sequenced by dependency. The
rule throughout: **`src/core` is untouched, every RLS/RPC signature is preserved, and the
preview/flag-off path stays byte-identical**, so the ~970 tests pass at every step.

- **Phase 0 — author the seams (now, flag-OFF).** Add the pure `src/core` modules
  (`membership.ts`, `rbac.ts`, `plan.ts`, `scoreWeights.ts`, `dispatch.ts`, `assist.ts`,
  `entitlement.ts`, `license.ts`, `workspace.ts`, `outbox.ts`) as inert, fully-tested, no-RN/Supabase
  files — the established `consent.ts`/`subscription.ts` discipline. **Author** (do not push, per the
  D1 guardrail) the migrations: `org_memberships` + `scope_contains` + the rewritten `can_view`
  body, the RBAC/audit tables, the plan/weight/season tables, the accountability ledger, the
  billing catalog, the offline columns. The app is byte-identical.
- **Phase 1 — compat shims + resolver.** Keep the four link tables as updatable **views over
  `org_memberships`** (or dual-write via trigger) so every query and `connected()` helper keeps
  working while `can_view` reads the new table. Introduce `resolveEntitlement`/`hasFeature` with the
  `isPro` shim; re-point the few call sites. ~970 tests pass.
- **Phase 2 — hierarchy + active workspace (inert).** `orgs → organizations` (id-preserving),
  `teams → groups` under a synthesized one-per-team `programs` row; today's flat world becomes "one
  org → one program → one group" with **no user-visible change**. `ActiveWorkspace` resolves the
  single membership a user already has; **no switcher** until `available.length > 1`. Every scoped
  read starts passing `acting_org`.
- **Phase 3 — durability + delivery + billing go-live.** Wire the `outbox` worker in front of the
  unchanged `pushDay`/`recordMeal`; turn on `notification_dispatch` so reminders/alerts actually
  fire (the biggest user-visible unlock). Org-key the subscription, add `licenses`, wire Stripe
  Checkout + Billing Portal + webhook for the first paying org. The AI `assist()` endpoint flips on
  when a model is configured (honest labels flip with it).
- **Phase 4 — the deep tree, on demand (**[DON'T BUILD YET]** until a real customer exists).**
  `invitations` + `membership_events` + transfer/graduation RPCs; bulk `roster_imports` + dedupe +
  claim; `org_branding`; structured messaging presets; notes/achievements/Recovery Mode; the
  multi-org workspace switcher UI; weight-set governance for a multi-program department.
- **Phase 5 — enterprise seams (shape only).** `identity_providers` (SSO), `api_clients` (public
  API), custom roles, enterprise contract tooling — authored as seam shapes so they are never a
  migration emergency, built only per signed enterprise customer.

**Why this is not a destructive rewrite:** the wedge stays "one coach, one team, one role"
end-to-end. The org-centric machinery ships as *inert seams that activate when a second membership,
a paying org, or a transferring athlete first appears* — exactly the discipline that already makes
`consent.ts` and `subscription.ts` safe today.

---

## 4. Index & reading order

Read **the Constitution first** (it is the filter every doc answers to), then the docs in number
order — they are authored to be read sequentially, each consuming the prior contracts.

| # | Doc | Owns (cross-cutting contract) | Read it for |
|---|---|---|---|
| — | `../PRODUCT-CONSTITUTION.md` | the 5 pillars, 14 Founder Rules, §11a Scoring Contract, §11b Context model | **why** every decision below is made |
| **00** | this doc | the thesis, system map, invariants, migration, index | the whole-set orientation |
| **01** | Data Model & Org Hierarchy | `org_memberships` (membership + role + **scope** + status); `can_view`; the PROFILE/ACCESS split; `invitations`; `membership_events` | the foundation — read **before** 02–07 |
| **02** | Roles, Permissions, Security & Audit | `allowed(viewer, athlete, scope, action)`; group scope; append-only `activity_log` | who-may-do-what-to-whom |
| **03** | Plans, Goals, Dev Score Governance | the `ScoringContext` tuple; immutable `plan_versions`; governed `score_weight_sets` | the score's integrity + multi-plan |
| **04** | Accountability, Comms, Notes, Recovery | the `accountability_events` ledger; `notification_dispatch` gate | the execution spine |
| **05** | AI Systems | the **Authority Boundary** + `assist()`; Performance Profile; Memory | how AI phrases without deciding |
| **06** | Billing, Licensing, Subscriptions | `resolveEntitlement` / `hasFeature` (org-keyed); active-athlete metering | what's purchased / who pays / inheritance |
| **07** | Onboarding, Branding, Offline, Multi-Org | `ActiveWorkspace` + `acting_org`; `outbox` WAL; dedupe-on-import | getting in, switching workspaces, working offline |
| **08** | Scenarios 01–09 | (validation) specialists, trainer's two business models, transfer, disagreement, parent | proof the access half is sufficient |
| **09** | Scenarios 10–17 | (validation) department, multi-plan, versioning, meal correction, offline, injury, bulk-150 | proof the profile half never moves |
| **10** | Scenarios 18–25 | (validation) cancel, mid-season buy, approvals, leaderboards, switching, graduation, branding, long-term memory | proof billing/lifecycle are access-half-only |

---

## 5. The reconciliation ledger — conflicts across docs, resolved here

The capstone's job is to *reconcile*. The slice docs flagged inconsistencies and open decisions
against each other; this section settles the cross-doc ones and consolidates the founder sign-offs
so they live in one place (each cites the owning doc).

**A. Cross-doc conflicts the capstone resolves now:**

1. **Org-level (cross-program) groups.** Doc 01 §3.5 puts `groups` strictly under `programs`; doc
   02 §3.3 allows org-level groups; scenario 02 needs a class-year/nutrition cohort to span sports.
   **Resolved in favor of doc 02:** `groups` may attach at org level (nullable `program_id`) so a
   cohort can cross programs. Doc 01's tree is the *common* case, not the only one.
2. **"Membership scope" (doc 01) vs. "role_grants + grant_group_scopes" (doc 02)** are the **same
   access object** described at two grains. **Reconciled:** `org_memberships` carries the coarse
   `(role, scope_kind, scope_id)`; doc 02's `grant_group_scopes` is the fine-grained
   multi-group narrowing on top. Implement as one spine — a membership *is* a role grant, and group
   scopes are an optional refinement. No two parallel grant tables.
3. **Cross-scope score comparability** (scenario 10). Per-program weight sets make raw scores
   non-comparable on a department dashboard. **Resolved (routed to doc 03):** a per-day score is
   frozen under exactly one weight set, but read-side roll-ups **re-project the platform-default
   `explain` blob** for the comparable number; program dashboards may show their own weighting.
   History is never rewritten — the `explain` payload already carries every component's raw value.
4. **Late correction to a closed day** (scenarios 13/14/15). **Resolved (routed to docs 03/04/07):**
   a late offline edit to a graded day writes a doc-04 `accountability_event` of type
   `late_correction` (field deltas); it **never mutates a frozen `days.score`/`explain`**. Open days
   recompute forward; graded days stay immutable (I4).
5. **The `approvals` primitive** (scenario 20) — no slice doc owned coach/guardian/admin sign-off.
   **Resolved (routed to doc 02):** a generic `approvals` request→decision ledger + a 3-state
   permission cell `{deny, allow, allow_with_approval}` extending `org_permission_overrides`. Empty
   and inert until an org configures a policy — byte-identical to today for the wedge.

**B. The founder decisions the scenarios force (consolidated; each owned by a slice doc):**

1. **Specialist `scope_default = deny_until_scoped`** for position/strength/nutritionist/AT/assistant;
   broad for owner/AD/head-coach (doc 02 §3.3). *Scenarios 1–3 are wrong without it.*
2. **Active-plan arbitration = one athlete-owned selection.** Professional-authored plans are
   active-eligible; the **athlete consents** among them (guardian for a minor), defaulting to the
   nutritionist for nutrition; disagreement always shown; the **safety floor outranks every coach**
   (docs 01 §3.7 / 03 §3.2 / 05 §8 / 07 §6.1). *Scenario 8 is the forcing function; this is the
   single most load-bearing open decision.*
3. **Family = an `organization` (`kind='family'`)** and the consumer Individual plan = an
   **org-of-one**, so there is **no athlete-keyed subscription anywhere** and one resolution path
   serves both billing rails (docs 01 §3.5 / 06 §3.7).
4. **Consent re-prompts per org/transfer**, and the **verified guardian (consent authority) is
   distinct from additional read-only viewers** the athlete/guardian must approve (docs 01 §3.9 /
   05 §5.4 / 09). COPPA/FERPA-sensitive.
5. **Org-owner succession** — an org must always have ≥1 `admin`; last-admin departure is blocked
   pending `transfer_org_ownership` (docs 01/02; scenario 7).
6. **Offline conflict = field-level last-writer-wins, no prompt, never a closed-day rewrite** (doc 07
   §5.3; scenario 15).
7. **Memory: typed facts now, embeddings deferred; safety facts typed forever** (doc 05 §5.1) —
   the single most important deferral (a missed allergy in a vector is a safety incident).
8. **Branding themes `accent`/`brand` tokens only** — structurally excluded from score-band/semantic
   tokens, so it can **never** restyle the Development Score (docs 07 §4 / 10; Rule #13).

**The one rule that survives all of it:** every scenario, every conflict, every phase changes only
the **access half** — memberships, scopes, plan-as-projection, entitlement, consent. The
**profile half** is permanent, org-free, athlete-owned, and never moves. That is OnStandard.
