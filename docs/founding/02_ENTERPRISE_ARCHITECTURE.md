# 02 — Enterprise Architecture (executive synthesis)

> **Status:** FOUNDING DOCUMENT — the board-readable, one-layer-up synthesis of the full
> `docs/architecture/` set (`00`–`11`, `DECISION-MEMO.md`, `PHASE-A-LOG.md`). Authored 2026-06-29
> in the voice of the CTO + Enterprise-SaaS / AI / Systems architects, ratified by the executive
> team. **This doc does not re-derive the ~6,000 lines of slice architecture** — it abstracts them
> into the system a CTO or VC can absorb in 15 minutes, names where the real risk lives, makes the
> GYM-as-organization architecture first-class, and **points to the depth**. Where it says a thing
> in one sentence, the cited slice doc says it in fifty. Read those for the schema.
>
> **How to read this:** §1 is the spine and the one hard split. §2–§9 are the eight subsystems at
> altitude, each with a "go deeper" pointer. §10 is **GYMS AS ORGANIZATIONS** (a required first-class
> section). §11 is scalability cliffs and when they bite. §12 is "Where we push back."
> The seven RATIFIED keystone decisions (`DECISION-MEMO.md`, restated as D1–D7) are canon and are
> built upon, never relitigated.

---

## 0. The one paragraph a VC needs

OnStandard is **one access primitive, one immutable formula, and one hard ownership split**, and
almost everything else is data on top of those three. The access primitive is a single
`org_memberships` grant (subject ⇄ org, carrying role + scope + permissions + status) that subsumes
every relationship type — coach, trainer, parent, family, gym, college — so a new relationship is a
*row*, never a schema migration. The immutable formula is the platform-owned Development Score: the
coach owns the **plan**, the platform owns the **formula**, the AI **recommends** — so an "84" means
the same thing everywhere and becomes a portable credential. The hard split is **profile vs access**:
the athlete owns their data forever (it never moves, never carries an org stamp), and organizations
own *access only* (a grant they can revoke but never take). Transfer, graduation, a coach quitting, a
cancelled contract — every one is an **access-half-only** mutation that touches zero athlete data.
That split is the moat (`00_STRATEGIC_QUESTIONS.md` §3); this document is the architecture that makes
it true and keeps it true for ten years without a rewrite.

---

## 1. The spine and the hard split (the whole system in one diagram)

**The spine — the entity chain** (full detail: `architecture/00` §1, `architecture/01` §3.2):

```
Organization ─▶ Programs ─▶ Groups ─▶ Athletes/Clients ─▶ Plans ─▶ Development Score ─▶ AI
  (who pays /    (a sport /  (Varsity,   (the PERSON —      (versioned   (one number,   (phrases,
   owns access)   a book /    a cohort,    permanent,        targets +    0–100,          drafts,
                  a gym       a position,  org-free          windows +    platform-       retrieves —
                  facility)   a class)     profile)          goals)       owned formula)  never decides)
```

Read it as: an **Organization** grants access and pays; **Programs/Groups** organize the roster for
display and scope; **Athletes/Clients** own a permanent profile and all the data under it; **Plans**
are versioned, org-authored *configuration about* an athlete; the **Development Score** is the one
platform-owned number measuring execution of the **one active plan**; **AI** is a language layer over
a deterministic core — it recommends, the human decides.

**The hard split the entire system rests on** (`architecture/00` §1, `architecture/01` §3.1):

| PROFILE HALF — athlete-owned, permanent, org-free | ACCESS HALF — org-owned, grant-based, revocable |
|---|---|
| `profiles`, `athlete_profiles`, `days`, `meals`, `checkins`, score history, Performance Profile, AI Memory | `organizations`, `programs`, `groups`, `org_memberships`, `invitations`, `subscriptions`, `licenses`, branding |
| Keyed on `athlete_id`. **Self-write-only.** Overseers only *read*. | Carries who-may-see-what + who-pays. |
| **Survives every org change with zero data movement.** | Granting/transferring/revoking/cancelling **never touches the profile half.** |

**The litmus test that runs through all 11 docs:** *if an operation appears to require moving,
copying, or org-stamping athlete data, the design is wrong.* A transfer is "flip one membership to
`transferred`, insert another" — the athlete's 3-year history is byte-identical the millisecond
before and after.

**The seven invariants we say "no" with** (full table: `architecture/00` §1):
I1 athletes own data · I2 orgs own access only · I3 scoring integrity (no per-coach formula) ·
I4 history immutability · I5 fail-closed consent (supreme over everything) · I6 `src/core` purity
(every decision is a pure, offline-testable function; ~1,000 tests) · I7 AI recommends, the human
decides. **These are the architectural expression of the 14 Founder Rules.** Every subsystem below
inherits all seven.

> **Go deeper:** `architecture/00` is the capstone (thesis + system map + invariants + the phased
> migration + the cross-doc reconciliation ledger). It is the single best 25-minute read after this
> page.

---

## 2. Organizations → Programs → Groups → Athletes (the hierarchy)

**One taxonomy, no special cases.** Everything is an organization (D2). A solo trainer is an
org-of-one; a parent is an org-of-one; a **family is an org type** (one owner, children as members);
a **gym is a facility-scoped org**; a school district is an org with many programs. "The only
difference is organization size." There is **no bespoke parent-link, no special trainer table, no
gym-specific schema** — they are all `org_memberships` rows differing only in `kind`, scope, and
participant count.

- **Organizations** grant access and own the billing relationship.
- **Programs** are a sport or a book of business (Football · Track · "Weight-loss clients" ·
  "7-on-7 travel squad"). Nullable parent for org-level cohorts that cross sports (the
  `architecture/00` §5 reconciliation: groups may attach at org level, not only under a program).
- **Groups** are for *display and scope* (Varsity · JV · Position: WR · "Tuesday 6am class"). They
  are the roster layer and the unit a position coach is scoped to.
- **Athletes/Clients** are the permanent PERSON. One profile, **unlimited orgs** (D2b) — family +
  HS football + baseball + strength coach + dietitian + private QB coach simultaneously, each org
  seeing only what it is permitted.

> **Go deeper:** `architecture/01` (data model, the hierarchy, transfer/graduation workflows, the
> compat-shim migration off the four legacy link tables).

---

## 3. The profile/access split & data ownership (the moat, made structural)

This is the most important architectural decision in the company and the keystone of the
`DECISION-MEMO` (D1). **Athlete data is never stamped with an organization** — no `organization_id`
column is ever added to `days`/`meals`/`checkins`. Roster reads *join through memberships*; if that
is ever slow we add a **cache, never a stamp** (see §11, S1/S2). The consequences:

- **Transfer/graduation lose nothing** — a college inheriting a recruit's multi-year HS execution
  history is a *join*, not a migration (the enterprise selling point in `00_STRATEGIC_QUESTIONS.md`
  §8.5).
- **The org can revoke access but can never delete or take a copy** of a minor's record — the legal
  and ethical line that separates us from every team-trapping incumbent (TeamSnap, Hudl, Teamworks).
- **The portable record is the #1 moat** (`00_STRATEGIC_QUESTIONS.md` §3) — the only moat that gets
  stronger every day even when we ship nothing, because the competitor would have to own the
  athlete's *past*, which their org-stamped model structurally cannot.

> **Go deeper:** `architecture/01` §3.1 (the two halves) and `DECISION-MEMO` D1.

---

## 4. Permissions — the membership + scope model

Access is **one predicate, evolved in place, never forked.** Today's
`can_view() = is_self OR is_team_coach_of OR is_trainer_of OR is_guardian_of` becomes
`allowed(viewer, athlete, scope, action) = consent_ok ∧ sees_athlete ∧ has_permission`, where
`sees_athlete` is **one `org_memberships` scope lookup**. The function *signature never changes* —
only its body — which is the trick that lets us evolve the access model without rewriting hundreds of
RLS policies or breaking the test suite (D2).

- **Role + scope, not all-or-nothing.** A position coach sees *only his group*; an AD sees the
  program tree; a dietitian is `deny_until_scoped`. No competitor's flat roster model can express
  "the WR coach sees only the receivers."
- **Permissions are typed-JSON data** validated against a closed catalog in `src/core` — adding a
  capability is data, not a migration (but the *key space* is a typed constant; see §11 D4).
- **The active workspace narrows, never widens.** `ActiveWorkspace` selects exactly one in-force
  membership per request (`acting_org`), re-validated server-side; RLS is always the authority, the
  workspace is only a selector (D5). This closes a privilege-escalation hole before it exists.

> **Go deeper:** `architecture/02` (the 12-role configurable RBAC catalog, group-scoped visibility,
> the approvals primitive, append-only `activity_log`).

---

## 5. Billing & licensing (org-keyed, pricing-as-data, active-participant metering)

**Four layers that never blur** so price, plan, seats, and feature-access each change on their own
clock without a redesign (`architecture/06` §3.1):

```
PRICING CATALOG   plans · plan_prices · plan_entitlements   (configurable DATA — no $ in code)
   ▼ a subscription references a plan + price
SUBSCRIPTION      subscriptions(organization_id, plan_code, status, provider)   (the live contract)
   ▼ a subscription grants capacity
LICENSE           licenses(seat_model, seat_limit, active_count)   (the seat / active-participant ledger)
   ▼ a member consumes a seat by being an ACTIVE participant
ENTITLEMENT       resolveEntitlement(viewer) → { plan, features{}, seat, source }   ← every gate reads this
```

The founder rules realized in the model: **subscriptions key to `organization_id`, not a person**, and
every user's entitlement resolves **through their `org_memberships`** — so *an athlete attached to an
active org never pays separately*, a department buys ONE contract for many programs, and transfer /
multi-org never double-bills. **Pricing is seed data, not constants** — no dollar amount, plan name,
seat limit, or feature list lives in app code, so a price change is a row edit, not an app-store
release (critical for FTC/ARL agility, per the compliance spec).

**Pricing-as-data, current seed (all editable):** Individual $14.99/mo (consumer, IAP rail reserved) ·
Professional $124.99/mo incl. 50 client seats + add-ons · Organization by **ACTIVE PARTICIPANTS**:
Starter ≤30 $249 · Growth ≤75 $499 · Performance ≤150 $799 · Enterprise custom.

**Active-participant metering is the gym-and-department unlock** and is deterministic: a participant
consumes a seat by being *active* (membership status + recency), so graduated / transferred / archived
/ inactive seats **free up automatically** with no manual reclaim. Billing rails split cleanly: Stripe
for all B2B (no 30% cut), Apple/Google IAP via RevenueCat **only** for the consumer Individual tier —
both writing the same `subscriptions` shape via a service-role webhook.

> **Go deeper:** `architecture/06` (the catalog tables, active-athlete recompute job, college
> purchasing, the Stripe-B2B vs IAP split) + `specs/2026-06-29-subscription-compliance.md`.

---

## 6. The Development Score (deterministic, governed, rails)

The score is the credential, and its integrity is non-negotiable (D3, I3). The pure formula stays
**exactly where it is** (`src/core/scoring.ts`); everything it reads — plan, weight set, goals,
season — becomes immutable, versioned, org-owned **configuration data** resolved through one tuple:
`ScoringContext = (active_plan_version, weight_set, season, goals, profile)`. Every day-score row
*freezes* the IDs that produced it, so **history is self-describing and never rewritten** (I4).

**The governance line — the heart of the moat-multiplier:**
- The **coach owns the plan** (targets, windows, instructions, goals — versioned).
- The **platform owns the formula.** There is *no permission key that edits the formula* — it is
  impossible, not merely denied.
- Org customization is **weights within evidence-based rails**, validated/normalized/bounded:
  Protein 10–40 · Meal Consistency 20–40 · Hydration 10–25 · Recovery 10–25 · Coach Compliance
  10–40 · Sport-specific 0–20. **No org can set Protein 90 / rest 10.** (Ranges want a final RD
  sign-off before the weight-set table ships — `DECISION-MEMO` D3 / s5.)
- The athlete picks **ONE primary plan** that drives their score; every other org's plan is a
  *reference plan* (D5). This single rule resolves "whose plan governs" across conflicting orgs.
- The **AI recommends, never dictates** (I7): it phrases, drafts, summarizes, and retrieves; only
  the **safety floor** can outrank a coach. A model never sets a minor's calorie target or
  re-weights the formula.

**The honest-naming caveat the Constitution doc must carry** (`00_STRATEGIC_QUESTIONS.md` §18-C): the
in-product number is named to its *current honest substance* ("Execution / Nutrition Development
Score") while "Development Score" is the destination brand we grow into as real recovery/performance
signals earn it. The architecture already supports this — the component set expands as data, the
formula and rails are the governed constant.

> **Go deeper:** `architecture/03` (plan versioning, weight-set governance, seasons, templates) +
> `architecture/05` §8 (the AI Authority Boundary + `arbitrate()`).

---

## 7. AI memory, profiles & the Authority Boundary

AI is a **language layer over a deterministic core**, behind one seam (`assist()`): a ContextPack
goes in, phrasing comes out. The deterministic engine + the coach's plan are ground truth; the LLM
never sets a number. Memory is **typed facts now, embeddings deferred** — and **safety facts are
typed forever** (a missed allergy in a vector is a safety incident, the single most important
deferral in the set, `DECISION-MEMO` reconciliation B7). The **Performance Profile** is derived
read-side from immutable history (portable, compounding) — not a separate stored truth that can drift.

> **Go deeper:** `architecture/05` (the Authority Boundary, Memory, Copilot drafts-only, Personality,
> Meal Analysis with confidence floor + correction flywheel).

---

## 8. Performance Profiles & the daily execution signal (portable, compounding)

The Performance Profile is the athlete's portable, compounding record — Current / Projected / Trend /
Season-Avg / Personal-Best — **derived from the frozen score history**, so it follows the athlete
across every org as a *projection over data they own*, never a copy. It is the substrate of the
credential endgame (a recruiter reading a Development Score history like a transcript).

**A first-class score input the founding strategy doc requires (`00_STRATEGIC_QUESTIONS.md` §18-A,
flagship #6):** a **low-friction daily execution commitment** (did you hit your plan today:
yes/no/partial + optional photo) must sit *alongside* meal-photo logging as a score input — because
40 teenagers will **not** photograph every meal daily, and the dashboard goes empty by week two if the
loop depends on it. The score must read honestly at low logging volume (incomplete reads as
incomplete) so a coach still gets a usable roster signal at 60% rich-logging. This is a Phase-B
unlock, not a "wait."

> **Go deeper:** `architecture/05` §4 (Performance Profile derivation) + `architecture/04` (the
> accountability ledger that the commitment signal writes to).

---

## 9. Security (fail-closed, per-org consent, immutable audit)

Three structural guarantees, each a `DECISION-MEMO` keystone:

- **Fail-closed consent (D7, I5) sits above everything** — every membership, permission, paid seat,
  and AI surface. A minor's real data is *impossible to produce* without a verified guardian, enforced
  at the narrowest server point (row production / sync drain), not in the UI. Consent **re-prompts per
  new org** (a new school/gym/trainer = a fresh guardian decision). The **verifying guardian is
  distinct from a read-only viewer** — a second parent is approved, not assumed.
- **Immutable audit (D6, I4)** — every ledger (`activity_log`, `accountability_events`,
  `membership_events`, billing/plan/score history) is **append-only at the database level** (a
  `BEFORE UPDATE OR DELETE` trigger that raises; no role holds UPDATE/DELETE in normal operation).
  "Who changed my kid's macros, and when?" is structurally unanswerable-with-a-lie.
- **`src/core` purity (I6)** — every decision is a pure function with no React/Supabase import,
  offline-testable, ~1,000 tests. This is the discipline that makes every deferred capability a *flag
  flip* instead of a rebuild.

> **Go deeper:** `architecture/02` (audit + RBAC) and the consent gate in `architecture/01` §3.9 /
> `architecture/05` §5.4.

---

## 10. GYMS AS ORGANIZATIONS (required first-class section)

**The gym is not a new product surface — it is the highest-value instance of "everything is an
org."** A gym is a `kind='gym'` facility-scoped organization, priced by **active participants**, whose
owner sees execution across every trainer and member on **one contract**. Nothing in the gym thread
requires a new access path, a new billing model, or a new score. It is the org model, populated. This
is the §14 indispensability thesis (`00_STRATEGIC_QUESTIONS.md`) made architectural: *a facility that
can prove it keeps members accountable between visits retains better and can charge for it.*

### 10.1 The gym mapped onto the spine

| Gym concept | OnStandard primitive | Notes |
|---|---|---|
| The gym | `organization(kind='gym')` | Facility-scoped org. One billing relationship. |
| Trainer's book of clients | a **program** (or group) scoped to that trainer | Trainer sees only their book; owner sees the roll-up. |
| A class ("Tuesday 6am") | a **group** | Display + scope; the unit a leaderboard or challenge attaches to. |
| Member | an **athlete/client** profile | Owns their data forever; takes it when they cancel or leave. |
| Member risk score | the **Development Score** + trend, read as a churn-risk signal | Not a new number — the platform-owned score, surfaced as risk. |
| Owner dashboard | scoped roll-up over the program tree (read-side) | The §11 S2 materialized layer when it's real. |

### 10.2 The six gym capabilities, and how each is already-an-org-feature

1. **Member risk score → retention engine.** The gym's churn is its existential threat. The
   member's Development Score *trend* is the leading indicator of a cancellation: a member sliding
   below their plan for two weeks is the one the owner intervenes on. This is the
   *intervention dashboard* (flagship #4) pointed at retention — "who's slipping → one-tap outreach +
   a documented trail." **The risk score IS the platform score**; we do not invent a gym-specific
   number (I3). *Architecture: read-side projection over `days` history, no new write path.*
2. **Trainer dashboards & trainer performance.** Each trainer sees their scoped book (the position-
   coach scope model, `architecture/02`); the owner sees a roll-up *across trainers* — adherence,
   retention, and engagement per trainer. This makes trainer performance visible to the business
   without the trainer seeing other trainers' books. *Architecture: scope + the roll-up view.*
3. **Gym-wide + trainer + private challenges.** A challenge is a **time-boxed, execution-metric,
   opt-in group construct** — the same primitive at three scopes: org (gym-wide), program (one
   trainer's book), private (an athlete-chosen subset). It reads the platform score; it creates no new
   number. *Architecture: a `challenge` is a scoped group + a window over `accountability_events`.*
4. **Leaderboards / TV-mode / rewards as OPT-IN context surfaces.** See §10.3 — the reconciliation.
5. **ROI / business-intelligence reporting.** The owner's report: retention lift, adherence trend,
   active-participant utilization vs the seat tier, trainer performance. This is the asset that turns
   the subscription from a cost into a P&L line and clears the renewal. *Architecture: read-side
   aggregation over the immutable ledger + the billing license — no new athlete data.*
6. **Gym monetization of OnStandard.** The gym can market accountability as a differentiator and a paid
   tier of *its own* membership. The architecture supports this because the gym owns the *access
   relationship and branding* (accent token only at first) while the member owns their data — the gym
   resells the layer, never the record. *Architecture: org branding (`architecture/07`) + the
   active-participant license; the member's portability is preserved (when they cancel the gym, they
   keep their history — which is also our consumer-conversion hook, §12-E in the strategy doc).*

**Pricing by ACTIVE participants, not total membership** (the load-bearing gym pricing rule): a gym
with 400 members but 90 actually using the daily loop pays the Performance tier (≤150), not a 400-seat
price. This is fair, it lowers the adoption barrier, and the **automatic seat recovery** (graduated /
churned / dormant members free up) means the gym is never over-billed for ghosts. This is the
`architecture/06` active-athlete definition pointed at the facility case.

### 10.3 The honest reconciliation: why a gym's leaderboard is legitimate where a HS team's is not

The Constitution is **skeptical** of leaderboards (§5/§8 rate Squad/leaderboard ≤4: "can distract from
execution"; Rule #2: every feature must move *execution*; Rule #4: reward executing the plan, not
being perfect, and never shame). `00_STRATEGIC_QUESTIONS.md` §10 lists the default-on leaderboard as a
**removal** candidate. We do not wave this away — we resolve it with **Goal-Aware Intelligence**
(Constitution §11b): *the same surface is legitimate or distracting depending on the context it runs in.*

| Dimension | HS competitive team | Gym community |
|---|---|---|
| **Consent reality** | Minors; many cannot meaningfully consent; guardian gate applies | Adults; opt-in is a real, freely-given choice |
| **Social dynamic** | Ranking a 15-year-old below teammates can *shame* (Rule #4 violation) and the coach's authority makes it coercive | Members *chose* a community gym for the social energy; competition is the product they bought |
| **What it ranks** | Risks ranking the kid, not the execution | Ranks **execution metrics only** (consistency, plan adherence) — never raw weight or PRs |
| **Goal context** | Goal = development; a leaderboard can pull focus from the plan | Goal = *adherence + belonging*; the leaderboard *is* an execution-aligned motivator |
| **Default** | **Off.** Minor appearance defaults off; guardian opt-in, not just athlete | **Opt-in, off by default**, but a legitimate surface to enable |

So the architecture is **one opt-in seam, context-gated**: `leaderboard_settings` per group
(execution-metrics-only, minimum participant threshold) + athlete-owned `leaderboard_optouts` (an org
can *enable* a board but **can never force an athlete onto it** — athletes own their visibility, I1).
The board reads the *one platform-owned score* (no leaderboard-specific number, no fan-out, computed on
read), so it can never drift from the real number. **Goal-Aware Intelligence is exactly what makes the
same primitive ship enabled for the adult gym and ship off for the minor team** — the context decides,
not a per-feature flag. **TV-mode and rewards are opt-in *context surfaces* on the same seam**: a gym
display showing the day's execution leaders, and rewards tied to *finishing the plan* (Rule #4), never
to logins or vanity.

> **Go deeper:** `architecture/10` Scenario 21 (the leaderboard math, opt-in config, consent layer,
> minor-default-off rule) — already `[ALREADY BUILT]` as pure math, `[DON'T BUILD YET]` as a shipped
> default-on surface.

---

## 11. Scalability — the cliffs, and when they bite

**The honest verdict (`architecture/11` §3): there is no scale risk in the wedge.** One coach, one
team, flag-OFF, ~1,000 tests green. Every cliff is gated behind "a real department or large gym
exists," and is correctly tagged `[DON'T BUILD YET]`. The board should know the seven cliffs and the
two we must *design now even though they ship later*:

| # | Cliff | When it bites | Mitigation |
|---|---|---|---|
| **S1** | `can_view` is a per-row scope subquery with recursive `scope_contains` | First 150-athlete department / large-gym roster scan | **DESIGN NOW:** precompute a denormalized `scope_path` (materialized closure) so containment is a prefix match, not a tree walk. Ships with the program/group tree. |
| **S2** | Everything derived read-side (Performance Profile, roll-ups) recomputes per athlete per render | Department/gym dashboard at 150+ athletes × multi-year history | Add a read-through `score_rollups` materialized layer when the dashboard is real — a *cache*, never a second truth (the `explain` blob makes it lossless). |
| **S3** | Cross-program score comparability re-projects the platform-default weights read-side | AD comparing protein-weighted football vs hydration-weighted track | Fold into the S2 rollup (store both program-weighted and platform-weighted totals). |
| **S4** | `accountability_events` is append-only, unbounded, and the substrate for escalation + weekly + achievements + Copilot | High-frequency users over years | **DESIGN NOW:** partition by `day_stamp` (monthly) from day one of the live ledger — cheap now, expensive to retrofit. |
| **S5** | The offline `outbox` lives in AsyncStorage (single JSON blob, no index) | A multi-day offline trip with a photo backlog | Hard cap on depth + swap the adapter to SQLite/MMKV *before* offline ships to real users (the interface already supports the swap). |
| **S6** | Notification dispatch fans out per overseer | First org with overlapping coach/AD/parent scopes | Coalesce per-recipient digests; the rate-limit bucket is the throttle. Config tune, no structural change. |
| **S7** | `recompute_active_seats` runs per lifecycle event | Mass graduation / season rollover / gym churn cycle | Debounce: mark license `dirty`, one recompute per org per cycle. O(1) per org. |

**The discipline:** design `scope_path` (S1) and event partitioning (S4) *at table creation* —
retrofitting indexing onto a hot predicate and a giant append-only table is the classic "should have
done this at table creation" debt. Everything else is a cache you add when the bill arrives.

> **Go deeper:** `architecture/11` §3 (scalability) + §4 (technical-debt risks: pure-core↔SQL formula
> drift is the #1 debt — a score that means one thing on-device and another server-side *kills the
> Proof pillar*; the rule is single-source-of-truth or don't duplicate).

---

## 12. Where we push back

A real board, not a yes-man. Four architectural assumptions we believe are wrong or under-examined,
each with a recommended alternative. (These sit *on top of* the strategy doc's §18 pushbacks, which we
honor; these are the **architecture-specific** ones.)

**A. PUSH BACK on shipping TV-mode and rewards in V1 — even for gyms.** The founder will want the gym
demo to *sparkle*, and TV-mode + a rewards loop is the obvious sparkle. **We disagree for V1.** TV-mode
is a presentation surface with real privacy edges (whose name and number appears on a public screen in
a facility, who consented, what happens when a member is sliding and sees themselves last) and rewards
introduce a points economy that is *gameable* the moment it has value — directly threatening I3 (score
integrity) if rewards ever attach to the score. **Recommended:** ship the **opt-in leaderboard seam**
(the real-roster, execution-metrics-only board) as the gym's V1 community surface, because it is the
already-built math (`architecture/10` Scenario 21) with the lowest new surface area. Treat **TV-mode as
a thin, opt-in *projection* of that board** (no new data, no new number) only after a real gym asks, and
hold **rewards behind a hard rule: rewards may only ever attach to *executing the plan*, never to the
score and never to a ranking** (Rule #4) — and even then, after PMF. The risk is not that TV-mode is
bad; it's that it is *the wrong first thing* and its privacy/consent edges are exactly where a
minor-adjacent health brand gets burned.

**B. PUSH BACK on "member risk score" as new vocabulary.** The gym thread keeps wanting a "risk score."
**There must not be a second number.** The instant "risk score" is a distinct stored value, it can
drift from the Development Score, it becomes gameable, and it fractures the credential (I3, and the §11
D1 formula-drift debt). **Recommended:** "member risk" is a **read-side *interpretation* of the
Development Score trend** (a band/label over the one number), never a stored second score. The owner
sees "at risk" because the platform score trend says so — same source of truth, different framing. This
keeps the gym's most-wanted feature on the right side of the moat.

**C. PUSH BACK on under-designing the active-participant *definition* before the first gym.** Active-
participant metering is the gym/department pricing engine, but "active" is currently a deterministic
predicate the docs gesture at, not a contract a gym owner has agreed to. A gym owner who feels they're
billed for ghosts churns *us*. **Recommended:** make the **active-participant definition a published,
plain-English contract** (e.g. "a participant who logged or committed in the last N days") *before* the
first gym signs, surfaced in the owner's BI dashboard so the seat count is never a black box. This is a
GTM/billing dependency, not just an engineering one — the §11 S7 mechanics are fine; the *transparency*
is the gap.

**D. PUSH BACK on letting the four legacy link-table compat views become permanent (D2 debt).** The
migration keeps `team_members`/`team_staff`/`practice_clients`/`guardianships` as views over
`org_memberships` "until all call sites read the new table." **Temporary shims are forever.**
**Recommended:** name the **release that drops the views** and gate it on a grep proving zero direct
reads — track it as a checklist, not a vibe (`architecture/11` D2). A permanent two-headed access model
is where RLS bugs hide, and RLS bugs in a minor-facing product are the catastrophe class.

---

## 13. Cross-doc dependencies the other founding docs must honor

- **Constitution doc:** carry the §6 honest-naming caveat — the in-product number is named to its
  current substance ("Execution / Nutrition Development Score") while "Development Score" is the
  destination brand. The score component set (4 today → the 6-component rails) expands *as governed
  data*, never as a per-coach formula.
- **Pricing/GTM doc:** the **active-participant definition (§12-C) is a published contract**, not just
  an engineering predicate; the **gym is a first-class GTM segment** priced by active participants with
  automatic seat recovery; and the **graduated/cancelled-member portability** (they keep their history)
  is the consumer-conversion hook to design as a revenue motion, not leave as an architecture fact.
- **Roadmap doc:** **TV-mode and rewards are post-PMF** (§12-A); the **opt-in leaderboard seam** is the
  gym's V1 community surface; the two "design-now" scale items (`scope_path` S1, event partitioning S4)
  must be authored at table creation, not retrofitted; and the **low-friction daily execution
  commitment** (§8) is a Phase-B score input, not a wait.
- **All docs:** the seven keystone decisions (D1–D7) and the seven invariants (I1–I7) are canon. The
  one rule that survives everything: *every operation changes only the access half; the profile half is
  permanent, org-free, athlete-owned, and never moves.* **That is OnStandard.**
