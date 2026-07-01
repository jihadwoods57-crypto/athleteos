# 11 — Strategy, Risks & Decisions (the capstone of the architecture set)

> Slice owner: Founder / CEO / CTO / CPO. Status: **DESIGN ONLY** (no app/TS code, no SQL
> migrations, no tests). Authored 2026-06-29.
>
> This doc is the synthesis across docs `01`–`10` + `PRODUCT-CONSTITUTION.md` against the current
> reality: the app is **role/flow-centric**, the backend is **gated by `isBackendLive`** (and the
> engines by `isEnginesEnabled`), **consent fails closed** (`src/core/consent.ts`, `0008`),
> **subscriptions are an inert seam** (`src/core/subscription.ts`, `0010`), and there are **~970
> tests** over a pure `src/core` that imports no React/RN/Supabase. Ten migrations exist
> (`0001`–`0010`); none of the 10-year target tables do yet — that is correct.
>
> It covers Deliverable **#21 Scalability Risks**, **#22 Technical-Debt Risks**, **#23
> Future-Proofing Recommendations**, **#24 Features That Should NOT Be Built Yet**, and **#25 the
> architectural decisions to make BEFORE writing another line of code.** It is **opinionated** and
> challenges the founder's proposal where a better path exists. It does **not** introduce a new
> model; it judges the ones in `01`–`10` and sequences them.

---

## 1. Summary

The architecture set (`01`–`10`) is, bluntly, **right** — and its rightness is concentrated in one
move repeated ten times: **separate the permanent athlete-owned PROFILE half from the revocable
org-owned ACCESS half**, and route every read through one predicate (`can_view`/`allowed`), every
score through one tuple (`ScoringContext`), every signal through one ledger
(`accountability_events`), every entitlement through one resolver (`resolveEntitlement`), and every
"which org am I in" through one selector (`ActiveWorkspace`). That discipline is what makes
transfer, graduation, cancellation, and multi-org *O(1) access-half operations that never touch
data* — the Salesforce/Stripe/Notion/Whoop lesson absorbed correctly. The risks are therefore **not
in the model**; they are in **(a) what is expensive to get wrong and must be decided before code
(§6, #25)**, **(b) the things that look cheap now and metastasize into debt (§4, #22)**, **(c) the
handful of scale cliffs the design has but hasn't paid down (§3, #21)**, and **(d) the strong
temptation to build the beautiful 10-year tree before the loop has retained a single cohort (§5,
#24).** The single most important decision (§7) is **lock the identity/profile-ownership boundary
and the `org_memberships`+scope grant shape now, as authored-but-unpushed migrations, while
shipping nothing past the current flag-OFF wedge** — because that boundary is the one thing that is
catastrophic and irreversible to change later, and everything else in `01`–`10` is a non-destructive
evolution on top of it. Build order: **(Phase A) integrity seams in pure `src/core` + authored
migrations; (Phase B) the live loop for one coach + one team behind the existing flags; (Phase C)
the org/lifecycle tree only when a real second org exists.** The wedge stays shippable the entire
time because every new thing is an inert seam first, exactly like `consent.ts`/`subscription.ts`
already are.

---

## 2. What the set got right (so the risk register is honest about its baseline)

A risk doc that only lists dangers misleads. The load-bearing strengths the rest of this doc
assumes:

1. **The profile/access split (doc 01 §3.1)** is the correct foundational invariant and is *already
   true in the schema today* (`days`/`meals`/`checkins` keyed on `athlete_id`, self-write-only). The
   10-year docs preserve it rather than inventing it. This is the single best decision in the set.
2. **`can_view`'s signature is held constant while its body evolves** (doc 01 §3.4) — the only way
   to swap a 4-way link disjunction for a membership lookup without touching ~hundreds of policies.
   This is genuine senior architecture, not a rewrite dressed as a migration.
3. **The scoring contract (Constitution §11a, doc 03)** — coach owns the plan, platform owns the
   formula, AI recommends — is enforced *structurally* (no permission key can re-weight; it's
   "impossible, not denied"). That is the difference between a moat and a setting.
4. **`src/core` purity** (no RN/Supabase imports, ~970 offline tests) is the reason every seam can
   ship inert and every formula stays canonical. This is the project's biggest existing asset and
   the cheapest insurance it has. **Protect it above almost everything.**
5. **Consent sits above every grant, billing, and AI surface** in all ten docs, uniformly. The
   fail-closed gate is never an afterthought bolted to one feature.

The rest of this doc is what I would push back on, watch, defer, and decide.

---

## 3. Scalability Risks (#21)

The model scales conceptually; these are the places where it has a **real cliff** the docs name but
do not pay down, ranked by when they bite.

| # | Risk | Where it bites | Severity | Mitigation (and when) |
|---|---|---|---|---|
| S1 | **`can_view` is a per-row, per-policy subquery into `org_memberships` with a recursive `scope_contains`** (doc 01 §3.4). On a department roster read it runs the membership+scope lookup for *every* athlete row of *every* athlete-data table the query touches. | First 150-athlete department dashboard / Copilot roster scan. | **High** | The partial indexes (`om_member`, `om_scope`) help, but `scope_contains` containment (org⊇program⊇group) must be **non-recursive and index-friendly** — precompute a denormalized `scope_path` (materialized closure) on the membership, refreshed on lifecycle events, so containment is a prefix match not a tree walk. Build the path column *when the program/group tree ships (Phase C)*, not before. Until then "one org = one team" makes this a non-issue. |
| S2 | **Read-side derivation of everything** (Performance Profile, leaderboard, derived metrics, department roll-ups) is elegant (doc 05 §4.1, doc 09 §4.2) but means a department dashboard recomputes Current/Projected/Trend/Season-Avg/Momentum/Personal-Best **per athlete per render** from immutable history. | Department/AD dashboard at 150+ athletes × multi-year history. | **Med** | Keep derivation as the *source of truth* but add a **read-through materialized layer** (a daily-refreshed `score_rollups` view keyed by `(athlete, scope, window)`) the moment the AD dashboard is real. The `explain` blob already makes re-projection lossless. **[DON'T BUILD YET]** until a paying department exists — but design the rollup as a pure function over history so it's a cache, never a second truth. |
| S3 | **Cross-program comparability re-projects the platform-default weight set read-side** (doc 09 §4.2) over every component's raw value, per athlete, per dashboard load. | AD comparing Football (protein-weighted) vs Track (hydration-weighted). | **Med** | This is correct (never rewrite frozen history) but compute-heavy at roll-up. Fold it into the S2 materialized layer: store **both** the program-weighted and platform-weighted totals in the rollup. Decision routed to doc-03 owner; not a wedge concern. |
| S4 | **The `accountability_events` ledger is the substrate for escalation, weekly aggregation, achievements, AND the AI Copilot** (doc 04 §3.1). It is append-only and unbounded; every achievement predicate and the escalation state machine scan windows of it. | High-frequency users over years; the Copilot reading event windows per query. | **Med** | Partition `accountability_events` by `day_stamp` (monthly partitions) from day one of the live ledger so window scans hit one or two partitions, and the immutability trigger stays cheap. Achievements compute over a bounded window (`source_window`), never the full history. This is cheap to design now, expensive to retrofit. |
| S5 | **The `outbox` lives in AsyncStorage** (doc 07 §5.2). AsyncStorage is a single JSON blob with no indexing; a long offline session with many past-day edits + photos rewrites the whole blob on every enqueue. | A multi-day offline trip; an athlete with a backlog. | **Low/Med** | The doc already designs the *interface* to swap to SQLite/MMKV without call-site change — good. **Set a hard cap** on outbox depth (e.g. 500 ops) and migrate the adapter to SQLite *before* offline ships to real users, not after a corruption report. Pure reducers in `src/core/outbox.ts` make the swap a storage-adapter change only. |
| S6 | **Notification dispatch is per-recipient token-bucket + dedupe + quiet-hours computed on read** (doc 04 §3.3). At a department, a single below-the-line event can fan out to head coach + position coach + AD + parent, each a dispatch evaluation. | First org with overlapping overseer scopes. | **Low** | Fine at wedge scale. When real, coalesce per-recipient digests (the schema already models `scheduled_for` + `category`); the rate-limit bucket is the throttle. No structural change needed — a config tune. |
| S7 | **Webhook-driven billing is correct and idempotent** (doc 06 §3.9) but `recompute_active_seats` runs on **every** membership lifecycle event + every webhook + nightly. At a department graduating a senior class, that's N recomputes. | Mass graduation / season rollover. | **Low** | Debounce: lifecycle events mark the license `dirty`; one recompute per org per cycle drains it. O(1) per org regardless of class size. Trivial to add when billing goes live. |

**The honest scalability verdict:** there is **no scale risk in the wedge** (one coach, one team,
flag-OFF). Every cliff above is gated behind "a real department exists," and the docs correctly tag
that work `[DON'T BUILD YET]`. The one thing to **design now** even though it ships later is the
**`scope_path` closure (S1)** and **event partitioning (S4)** — because retrofitting indexing onto
a hot predicate and a giant append-only table is the classic "we should have done this at table
creation" debt. Everything else is a cache you add when the bill arrives.

---

## 4. Technical-Debt Risks (#22)

These are the things that are cheap or invisible now and compound into expensive debt. Ranked by
how badly they bite if ignored.

| # | Debt | Why it accrues | Cost if ignored | The discipline |
|---|---|---|---|---|
| D1 | **Pure-core ↔ SQL formula drift.** The Development Score, the active-seat predicate, the weight-set validator, the consent gate, and the escalation thresholds all exist as canonical pure TS *and* are mirrored (or proposed to be mirrored) in SECURITY DEFINER SQL (doc 02 §3.1 note, doc 03 §3.7, doc 06 §3.4). | Two implementations of one truth always diverge. | A score that means one thing on-device and another server-side **kills the Proof pillar and the un-gameable guarantee (Rule #13)** — the worst possible failure. | **Single-source-of-truth or don't duplicate.** Where SQL must enforce (RLS), generate the SQL constant *from* the `src/core` constant in a build step (the docs already gesture at this for `role_permissions` seeding). Where it's only "optional hardening" (server score recompute, doc 03 §6), **don't build it at all yet** — keep `src/core` the only formula. Every duplicated rule gets a golden-vector test asserting parity. |
| D2 | **The four legacy link tables become a long-lived shim.** Doc 01 §5 keeps `team_members`/`team_staff`/`practice_clients`/`guardianships` as updatable views over `org_memberships` "until all call sites read the new table." | "Temporary" compat shims are forever; the views accrete special cases. | A permanent two-headed access model; new devs can't tell which table is authoritative; RLS bugs hide in the view layer. | **Put an expiry on the shim.** The migration plan must name the release that drops the views (doc 01 Phase 4) and gate it on a grep proving zero direct reads of the legacy tables. Track the call-site migration as a checklist, not a vibe. |
| D3 | **Role/flow-centric app code is the current reality and the docs assume it's gone.** Today a user *is* one `flow`/`role` (`flows.ts`, the store). Docs 02/07 say "no surface reads the user's role globally anymore." | The app ships role-centric today; the membership/workspace model is design-only. The gap between "designed" and "built" is itself debt. | Every screen that hardcodes a role check is a future migration to `ActiveWorkspace`. The longer the live app grows role-centric, the bigger that refactor. | **Freeze new role-name checks now.** Even before `ActiveWorkspace` ships, route new permission decisions through a `hasPermission(...)`-shaped helper (it can resolve trivially from the single role today) so the call sites are already permission-keyed, not role-name-keyed. This is a *convention* you adopt before the seam exists. |
| D4 | **`jsonb` permission/scope/settings bags everywhere** (`org_memberships.permissions`, `program/group.settings`, `plan_version.targets`, `org_branding.announcement`). | "Adding a capability is data, not a migration" is the stated benefit (doc 01 §3.3). | Untyped jsonb is unqueryable, undocumented, and silently schema-drifts; a typo in a permission key fails *open or closed* unpredictably. | **The jsonb is the *value*; the *keys* are a closed, typed catalog in `src/core`** (the permission catalog already is, doc 02 §3.1). Validate every jsonb write against the TS catalog in the RPC. jsonb for extensibility, a typed constant for the key space — never free-form. |
| D5 | **Migrations authored-but-unpushed pile up.** The D1-guardrail discipline ("author, don't push to live") means a growing stack of unapplied migrations describing tables that don't exist. | Correct for safety, but the stack drifts from `src/core` types and from each other. | A Phase-C "apply everything" that's never been run end-to-end; ordering/FK surprises at go-live. | Keep authored migrations **CI-validated against a throwaway DB** (apply-all on every PR) even while the live DB stays flag-OFF. The migration is "tested" even though it's not "live." |
| D6 | **Test suite measures `src/core`, not the seams.** ~970 tests cover pure logic; the RLS predicates, the RPC authz, and the consent-on-sync path are the actual security boundary and are SQL. | Pure tests are easy and abundant; RLS tests need a live Postgres. | A green suite that proves the formula and *not* that a position coach can't read another group's athlete — the thing that actually matters legally. | When the backend goes live (Phase B), every RLS policy gets a **pgTAP/integration test** asserting the *deny* case (the fail-closed direction), not just the allow case. Security is proven by what's blocked. |

**The debt verdict:** the single most dangerous debt is **D1 (formula drift)** because it silently
destroys the category moat, and the cheapest mitigation is **build less** — do not mirror the score
into SQL until there's a proven gaming threat (doc 03 §6 already says this; hold the line). The
second is **D6 (untested security boundary)** — the suite's green is currently a *purity* guarantee,
not a *security* guarantee, and the gap is invisible until a breach.

---

## 5. Future-Proofing Recommendations (#23)

What to do now — at near-zero cost — so the expensive future is cheap. These are the seams worth
leaving even though the wedge doesn't use them.

1. **Leave the `org_memberships` grant shape and the `can_view` body-swap as authored migrations
   now (free), but populate nothing.** This is the one seam that is catastrophic to retrofit
   (everything keys off it) and trivial to author ahead (it's a pure projection of the four link
   tables). **Author it; don't push it.** (§7 makes this the #1 decision.)

2. **Adopt permission-key call sites before the RBAC engine exists (D3).** A `can(viewer, athlete,
   action)` helper that today resolves from the single role is a one-file shim that makes the
   eventual RBAC swap a body change, not a call-site hunt. Costs an afternoon; saves a refactor.

3. **Make every new gated feature call `hasFeature(viewer, key)` from day one (doc 06 §7.1)**, even
   though it resolves to `previewEntitlement()` for everyone. The inert resolver is the seam; new
   paywalls must never read a tier string. This keeps "pricing is data" true before pricing exists.

4. **Partition `accountability_events` and freeze the immutability trigger at table creation (S4,
   D1).** Append-only + partitioned + a `BEFORE UPDATE OR DELETE` raise is the same trigger pattern
   as `activity_log` and score history — establish it uniformly the first time any append-only table
   ships, so "history is immutable" is a *database guarantee*, not a code convention.

5. **Establish the `late_correction` event shape now (doc 09 §4.3).** The single shared rule behind
   plan versioning, meal correction, and offline closed-day edits is "never rewrite a graded day;
   write a forward correction event." Define that event type before any of the three features ship
   so all three obey one rule. This is a 10-line decision that prevents three inconsistent
   implementations.

6. **Generate SQL enforcement constants from `src/core` (D1).** Wherever a rule must live in both
   places (permission defaults, active-seat policy, weight rails), the SQL seed is *generated* from
   the TS constant in a build step. Set up the generator the first time you seed `role_permissions`;
   reuse it for every subsequent dual-home rule.

7. **Reserve the columns, build nothing (the docs do this well — keep doing it).** `injury_type`
   /`stage` (Recovery Mode), `identity_providers`/`api_clients` (SSO/API), `messages.kind='free_text'`
   (chat), `roles.org_id` (custom roles), `plans.template_id` (templates) — every one is a reserved
   column that turns a future migration emergency into a flag flip. This is the cheapest
   future-proofing in the set; the discipline is to **reserve the shape, resist the implementation**.

8. **Keep the consent gate on the *sync/drain* path, not just the UI (doc 02 §3.4, doc 07 §5.2).**
   The future-proofing that matters most legally: a minor's data must be *impossible* to produce
   server-side without a verified guardian, so RLS has nothing to leak. Enforce consent at the
   narrowest, most-server point now (the outbox drain + the row-production path), so every future
   surface inherits it for free.

---

## 6. Features That Should NOT Be Built Yet (#24)

The prompt explicitly wants this: a concrete **"not yet" list** with **WHY** and **the cheapest seam
to leave now**. The Constitution's job is "the thing you say *no* with" (preamble) — this is that
list. Each item is genuinely valuable at the 10-year horizon and genuinely a distraction before the
loop retains. **The seam is what makes the "no" cheap to reverse.**

| Feature | Why NOT yet | Cheapest seam to leave NOW |
|---|---|---|
| **Server-side score recompute / anti-tamper trigger** (doc 03 §6) | Re-implementing `computeDerived` in SQL must stay byte-for-byte synced (D1) — high cost, near-zero value while the backend is OFF and the formula is canonical in pure TS. There is no observed gaming threat. | Keep `src/core/scoring.ts` the **single** formula; freeze the day-row `explain` blob so a future recompute can verify without rewriting. The seam is the frozen tuple, already designed (doc 03 §3.8). |
| **Vector / semantic memory DB** (doc 05 §5.1, §12) | A missed allergy in a fuzzy vector is a **safety incident**. Typed structured facts + deterministic retrieval cover the wedge; embeddings only earn their place when free-text volume makes typed retrieval insufficient — that's post-proof. | `retrieveForTask()` interface is unchanged when embeddings arrive (doc 05 §5.3). Ship the typed-fact store; the vector step slots behind the same function. Safety facts stay typed **forever**. |
| **Learned "who falls behind" predictor** (doc 05 §6.1, §12) | Requires real labeled outcome data the Proof pillar doesn't have yet. A model trained on nothing is a hallucination with a confidence bar. | `predict_falling_behind` ships as a **deterministic trend** labeled honestly ("based on recent trend"). The seam is the tool's typed signature — swap the implementation, keep the contract. |
| **Bulk roster import / SIS dedupe engine** (doc 07 §3.3, scenario 17) | Zero department customers. The single-coach broadcast join code covers a 30-athlete team. Building the match/commit/claim pipeline + the privacy-safe dedupe RPC is weeks of work for a customer that doesn't exist. | `roster_imports`/`roster_import_rows` tables can be *authored* (not pushed). The load-bearing seam is **`accept_invitation` deduping onto one profile** — get the "never mint a duplicate" rule right in the single-claim path so bulk inherits it. |
| **Full `programs`/`groups`/`invitations`/`membership_events` tree** (doc 01 §5 Phase 3) | The 10-year hierarchy. The wedge is "one org = one program = one group." Building the tree before a multi-program customer is the textbook over-build. | The `org_memberships` grant + `scope_kind` enum already model the tree as *status + scope*; the deep tables are populated later with zero access-path change. Author the migrations; populate when a real district appears. |
| **Multi-org workspace switcher UI** (doc 07 §6, scenarios 5/22) | 99% of users today have one membership. The switcher is dead UI until `available.length > 1`. | `ActiveWorkspace` ships **inert** (resolves to the single membership, no switcher rendered) — the established `consent.ts`/`subscription.ts` inert-seam discipline. The seam is `src/core/workspace.ts` (pure). |
| **Custom per-org role authoring / ABAC policy engine** (doc 02 §2) | Massive over-build with a fixed 12-role catalog and no enterprise customer. Per-org permission *overrides* cover real near-term variance. | `roles.org_id` column reserved (doc 02 §3.1) so custom roles are a flag, not a migration. Ship the fixed catalog + overrides. |
| **SSO (SAML/OIDC) + SCIM + public API** (doc 07 §7) | Zero enterprise customers; each adds review/integration surface and an attack surface. | `identity_providers` + `api_clients` table *shapes* designed (doc 07 §7), built none. A deprovision is already just a `removed` status transition on the existing ledger. |
| **Unrestricted real-time chat** (Constitution §8, doc 04 §3.4) | Risk-laden (minor safety, moderation, legal), rated ≤4 on the pillar matrix, and not core to execution. Structured presets + AI-draft cover the relationship need. | `messages.kind='free_text'` reserved behind a flag; `messaging_authorized` (`0006`) already governs it. Chat is a flag flip, not a rebuild. |
| **Team leaderboards as a default-on surface** (Constitution §5/§8, scenario 21) | Explicitly warned to "distract from execution"; rated ≤4. Ranking pressure can shame (violates Rule #4). | `leaderboard.ts` math exists; ship the **opt-in seam** (`leaderboard_settings` off-by-default + athlete `leaderboard_optouts`) but keep it folded away. Execution-metrics-only when it does ship. |
| **Org branding beyond logo+accent+copy** (doc 07 §4, scenario 24) | Custom fonts/layouts/white-label is enterprise v3; rated ≤4. | `org_branding` themes the **accent token only** (score-band/semantic tokens excluded by scoping). The seam is the third palette input on `useColors()`. |
| **Multi-stage approval routing / SoD workflow engine** (scenario 20) | A single request→decision row covers the wedge; sequential-approver graphs are enterprise over-build. | The `approvals` ledger + an `allow_with_approval` 3-state permission cell (doc 10 §20) is the whole primitive. Routing graphs deferred. |
| **Per-injury-type RTP protocols / PT integration** (doc 04 §3.7) | Needs a real athletic-trainer customer; one generic episode covers the safety need. | `injury_type`/`stage` columns reserve the expansion; ship one generic override + clearance gate. |
| **Consumer IAP rail (RevenueCat)** (doc 06 §3.7, §2) | The wedge is B2B-coach-led; IAP adds App Store review surface before a direct-consumer signal exists. | The rail is **data on the plan** (`billing_rail`); the org-of-one resolution path serves it with no special case. Reserve; populate when a solo-buyer funnel is proven. |

**The meta-point of #24:** every "no" above is reversible by a **flag flip or a populate-the-table**,
*because the seam is left in pure `src/core` or as a reserved column*. That is the entire reason the
architecture set is worth more than its features: it makes the right "no" cheap. The wrong way to
build any of these is to ship it now and discover the loop didn't retain — then you're maintaining a
department feature for a product with no department. **Validate the loop before you widen it (Rule
#11).**

---

## 7. Architectural Decisions to Make BEFORE Writing Another Line of Code (#25)

These are the decisions that are **expensive or impossible to change later** because the entire
schema and every downstream doc keys off them. Each is stated as: **the decision · the options · my
recommendation · the cost of getting it wrong.** They are ordered by irreversibility — decide #1
before #2 before #3.

> **Decision-forcing rule:** none of these requires *building* the 10-year tree. They require
> *committing the shape* so the authored migrations and the `src/core` types are correct. You can
> ship the flag-OFF wedge the day after deciding all seven.

**#25.1 — The identity / profile-ownership boundary (the keystone; decide first).**
- *Decision:* Is the athlete's permanent profile + all logged history (`days`/`meals`/`checkins`/
  score) **org-free, athlete-owned, and self-write-only forever**, with orgs holding *access only*?
- *Options:* (a) the doc-01 split — athlete owns data, org owns a revocable grant; (b) denormalize
  an `organization_id` onto athlete data for fast roster reads (tempting, doc 01 §2 flags it).
- *Recommendation:* **(a), unconditionally.** Never stamp athlete data with an org. Roster reads
  join through memberships; if that's ever slow, add a *cache* (S2), never a *stamp*.
- *Cost of getting it wrong:* **Catastrophic and irreversible.** An org-stamp means transfer and
  graduation become O(history) data copies, an org "owns" a copy of a minor's record (legal
  nightmare), and the moat ("a college inherits the HS record") becomes a data-migration project.
  Every one of scenarios 5/6/7/22/23 breaks. This is the one decision that, if wrong, requires
  rebuilding the product. **It is currently RIGHT in the schema — the decision is to commit to never
  regressing it.**

**#25.2 — The org / membership / scope schema (the cross-cutting contract).**
- *Decision:* Is **one `org_memberships(member, org, role, scope_kind, scope_id, permissions,
  status)` row** the *single* access-grant object that subsumes all four link tables, with
  `can_view`'s *signature* held constant while its body becomes a membership lookup?
- *Options:* (a) the unified grant table (doc 01 §3.3); (b) keep adding a link table + a `can_view`
  branch per relationship type (today's pattern).
- *Recommendation:* **(a).** Author the table, the `scope_contains`/`scope_path` helper, the
  `can_view` body-swap, and the idempotent backfill **now, as unpushed migrations.** Ship them when
  the backend goes live; never before.
- *Cost of getting it wrong:* Every new relationship becomes a schema migration + an RLS edit + a
  test sweep; the access model fragments; multi-org and specialist-scoping (scenarios 1–5) become
  impossible without a rewrite. Getting the *shape* wrong (e.g. omitting `scope_kind`, or making
  permissions an enum instead of a typed jsonb catalog) means a painful re-migration of live grants.
  **This is the second-most-expensive thing to change — decide the shape before any membership code.**

**#25.3 — Scoring-integrity governance (the category moat).**
- *Decision:* Can a coach ever re-weight or invent a Development Score component, or is weighting
  **bounded, normalized, validated data inside a platform-owned profile** (never free re-weight)?
- *Options:* (a) the doc-03 model — coach owns plan/profile/relevance, platform owns the formula and
  the rails; (b) per-coach custom formulas (the "give the coach control" temptation).
- *Recommendation:* **(a), structurally.** There is **no permission key that edits weights** — it's
  impossible, not denied (doc 02 §3.2). Weight sets are validated/normalized/bounded/versioned (doc
  03 §3.4). The platform default == today's `PROFILE_WEIGHTS` so the ~970 tests pass byte-for-byte.
- *Cost of getting it wrong:* **The product's entire defensibility.** A per-coach formula makes an
  "84" mean something different for every athlete → kills comparability, lets a coach flatter their
  roster (gameable), and **ends the Proof pillar** (you can't prove a rising score predicts
  improvement if the score isn't constant). This is irreversible reputationally — once "84" is
  relative, the category language is dead. Decide the rails (the `[min,max]` per component, doc 03
  OD#3) with RD sign-off **before** any weight-set table ships.

**#25.4 — The entitlement / licensing model (org-keyed, never person-keyed).**
- *Decision:* Are subscriptions keyed to **`organization_id`** with entitlement *inherited* through
  `org_memberships`, and is **pricing data, not code**, behind a single `hasFeature(viewer, key)`?
- *Options:* (a) the doc-06 four-layer split (catalog/subscription/license/resolution), org-keyed;
  (b) the current per-owner `subscriptions.owner_id` seam carried forward; (c) athlete-keyed subs.
- *Recommendation:* **(a).** Org-key the subscription; resolve every gate through
  `resolveEntitlement`; never let a dollar amount, plan name, seat limit, or feature bundle live in
  code. The inert resolver + `previewEntitlement()` fail-safe ship now; the catalog tables are
  authored, not pushed.
- *Cost of getting it wrong:* **(c) is the founder's explicit anti-pattern** ("never hardcode
  subscriptions around athletes; an athlete attached to an active org never pays separately"). An
  athlete-keyed sub breaks transfer, multi-org, and college purchasing, and double-bills.
  Person-keyed (b) can't express a department buying one contract for many programs. Pricing-in-code
  means an app build per price change. All three are painful re-migrations of live billing — the one
  data you *cannot* afford to get wrong because it touches money and FTC/ARL compliance. Decide
  org-keying before the `subscriptions` EVOLVE migration is authored.

**#25.5 — Multi-org workspace scoping (the active-workspace selector).**
- *Decision:* Does **`ActiveWorkspace` select exactly one in-force `org_membership` per request**,
  passed as `acting_org` and *re-validated server-side* (narrows, never widens), with the athlete's
  **primary** membership driving their personal Game Plan?
- *Options:* (a) the doc-07 selector (one source of "which org am I in," RLS is the authority);
  (b) a global role/flow (today's reality); (c) a client-trusted org scope.
- *Recommendation:* **(a).** Ship `ActiveWorkspace` inert (single membership → no switcher). Resolve
  "primary workspace = active plan = primary goal" as **one athlete-owned selection** (doc 09 §4.1).
  `acting_org` is a *narrowing hint*; RLS denies anything the membership doesn't cover.
- *Cost of getting it wrong:* If the active org ever *widens* access (a client-trusted scope), it's a
  privilege-escalation hole. If "which org am I in" is read from a global role, every multi-org
  scenario (5/8/22) requires re-plumbing every screen. The "primary drives the plan" decision closes
  three docs' open questions at once (doc 01 §3.7, doc 03 §3.2, doc 07 §6.1) — leaving it open means
  three inconsistent implementations of "which plan governs." Decide *before* the first scoped read
  passes `acting_org`.

**#25.6 — Audit-log immutability (the legal + dispute spine).**
- *Decision:* Are `activity_log`, `accountability_events`, `membership_events`, `billing_events`, and
  the plan/score/weight-set history **append-only at the database level** (a `BEFORE UPDATE OR DELETE`
  trigger that raises, with no role — not even `service_role` in normal operation — holding
  UPDATE/DELETE)?
- *Options:* (a) DB-enforced immutability triggers uniformly; (b) application-enforced append-only
  (convention); (c) soft immutability (an `is_deleted` flag).
- *Recommendation:* **(a), uniformly, established the first time any append-only table ships.** "Who
  changed my macros and when?" (doc 02 §3.5) and the transfer ledger must be *structurally* true.
- *Cost of getting it wrong:* App-enforced append-only is a bug away from a silently rewritten audit
  trail — which in a minor-facing health product is a **legal and trust catastrophe** (you cannot
  prove who accessed/changed a minor's data). Retrofitting a trigger onto a table that's been mutable
  is a data-integrity audit nightmare. This is cheap to do at table creation, expensive forever after.
  Decide the trigger pattern *before* the first ledger table is authored.

**#25.7 — Consent / COPPA model (supreme over every grant).**
- *Decision:* Does the fail-closed consent gate sit **above every membership, permission, payment,
  and AI surface** — enforced at the narrowest *server* point (row-production / sync-drain) so a
  minor's real data is *impossible* to produce without a verified guardian — and is consent
  **per-org-membership** (re-prompts on transfer), with **verifier (consent authority) distinct from
  read-only viewer**?
- *Options:* (a) consent as a supreme server-side pre-filter, per-org, with verifier≠viewer (docs
  01/02/05/08); (b) consent as a UI gate only; (c) global (cross-org) consent that travels with the
  athlete.
- *Recommendation:* **(a).** Keep `src/core/consent.ts` the canonical predicate *and* mirror it on
  the server row-production path so RLS has nothing to leak (doc 02 §3.4). Consent **re-prompts per
  new org** (COPPA/FERPA, data-minimization). A **verified guardian** (unlocks sync) is a different
  grant from an **additional read-only viewer** (a second parent) the athlete/primary-guardian must
  approve (doc 08 §3, scenario 9).
- *Cost of getting it wrong:* A UI-only gate (b) leaks the moment any non-UI path (an API, a webhook,
  a Copilot query) reads the data — a COPPA violation with regulatory and existential consequences.
  Global consent (c) lets a transfer silently expose a minor's data to a new org without a fresh
  guardian decision. Conflating verifier with viewer auto-grants a non-custodial parent the power to
  unlock a minor's data by mere relationship claim. This is the decision where "wrong" means
  **regulatory action and the end of trust** — it must be supreme, server-enforced, and per-org
  *before* any minor data can sync.

---

## 8. The single most important architectural decision + recommended sequencing

### 8.1 The one decision that governs the rest

> **Commit the identity/profile-ownership boundary and the `org_memberships`+scope grant shape NOW —
> as authored-but-unpushed migrations and pure `src/core` types — while shipping nothing past the
> current flag-OFF wedge.** (#25.1 + #25.2 fused.)

Everything else in docs `01`–`10` is a **non-destructive evolution on top of this boundary**: scoring
governance, billing, AI memory, lifecycle, multi-org, branding — all of them assume "athlete owns the
data; one membership row carries the grant; `can_view` resolves through it." If that boundary is
right and committed, every later phase is additive and the wedge never breaks. If it's wrong — if
athlete data ever carries an org stamp, or if access fragments back into per-relationship link tables
— then the entire 10-year set is built on sand and the moat (transfer/graduation/multi-org portability
with zero data movement) is unbuildable. It is the **only** decision that is both *foundational to
every doc* and *irreversible once live data exists*. Decide it, author it, freeze it; build the loop.

Why this over the scoring contract (#25.3) or consent (#25.7), which are also existential? Because
those two are **already correctly implemented and structurally protected today** (the formula is pure
and un-re-weightable; consent already fails closed in `0008`/`consent.ts`). The profile/access
*boundary* is correct in the *current schema* but **not yet committed as the explicit grant model** —
it's the one keystone that is right-but-uncommitted, and committing it (the `org_memberships` shape +
the `can_view` body-swap) is the act that makes every subsequent doc buildable without a rewrite.

### 8.2 Recommended sequencing — the first 2–3 build phases (wedge stays shippable throughout)

The discipline that keeps the app shippable at every step: **every new thing is a pure `src/core`
seam + an authored (unpushed) migration first — exactly like `consent.ts`/`subscription.ts` already
are — and the live flags (`isBackendLive`, `isEnginesEnabled`) stay the kill switch.**

**Phase A — Integrity seams (no live backend; flag-OFF; ~970 tests stay green).**
*Goal: commit the keystone and the immutability spine without changing one byte of user-visible
behavior.*
- Author (don't push) the `org_memberships` + `scope_path`/`scope_contains` + `can_view` body-swap +
  idempotent backfill (#25.1/#25.2). CI-applies them to a throwaway DB on every PR (D5).
- Add the pure `src/core` seams inert: `membership.ts`, `workspace.ts`, `entitlement.ts`,
  `license.ts`, `dispatch.ts`, `outbox.ts` — each fully unit-tested, no RN/Supabase import, resolving
  to today's behavior (single role → no switcher; everyone → `previewEntitlement()`).
- Adopt the **conventions** that prevent debt before the engines exist: permission-key call sites
  (D3), `hasFeature(...)` gates (future-proofing #3), the append-only trigger pattern + event
  partitioning as the *standard* for any new ledger table (#25.6, S4), and the SQL-from-`src/core`
  generator for any dual-home rule (D1).
- **Decide all seven #25 questions here** — they're shape decisions, not build work.
- *Shippable?* Yes — the app is byte-identical to today; this phase is pure additive seams + decisions.

**Phase B — The live loop, one coach + one team (flip `isBackendLive`; the wedge goes real).**
*Goal: prove the core loop with real people on the smallest possible org tree.*
- Apply the foundational migrations (org_memberships as the grant, with the four legacy tables as the
  D2 compat shim — *with a named expiry release*). One org = one program = one group; no switcher.
- Turn on the durable `outbox` drain (consent-gated), the notification dispatch gate, and the event
  ledger — the biggest user-visible unlock (reminders/coach alerts actually fire), all behind the
  existing flags.
- **Every RLS policy ships with a deny-case integration test (D6)** — security is proven by what's
  blocked, especially the minor-consent fail-closed path (#25.7) and specialist scope.
- Wire the meal-analysis model into the existing `analyze-meal` seam (the headline gap) — the
  Authority Boundary + confidence floor + correction flywheel are already designed (doc 05).
- Keep **everything in #24 OFF** — no multi-org tree, no bulk import, no branding, no leaderboard, no
  custom roles, no SSO/API, no consumer IAP, no server score recompute.
- *Shippable?* This *is* the shippable wedge — the loop the Constitution exists to validate (Rule
  #11). Retention here is the gate to Phase C.

**Phase C — The org/lifecycle tree, only when a real second org exists (populate, don't pre-build).**
*Goal: light up the multi-org/department machinery the seams already anticipate — pulled by a real
customer, never pushed speculatively.*
- Populate `programs`/`groups`/`invitations`/`membership_events` (the deep tree is now rows, not new
  schema — doc 01 Phase 2/3). Activate the workspace switcher (it's been inert since Phase A).
- Org-key billing for real (Stripe rail), active-seat metering, the four-layer catalog — pulled by
  the first paying org.
- Add the materialized roll-up cache (S2/S3) and the `scope_path` closure (S1) *when the first
  department dashboard is real* — they're caches over the existing immutable history, not new truth.
- Retire the D2 compat shim at its named release once a grep proves zero legacy-table reads.
- Branding, leaderboards, approvals, bulk import — each populated per a real customer's signed need,
  each a flag flip or a table-populate because the seam was left in Phase A.

**The through-line:** Phase A commits the keystone for free; Phase B ships the loop the product
exists to prove; Phase C is *pulled* by real demand into seams that already exist. At no point does
the wedge break, because the inert-seam discipline that already governs `consent.ts` and
`subscription.ts` is applied to every new capability. **Decide the seven; commit the boundary; ship
the loop; let the tree be pulled, never pushed.**
