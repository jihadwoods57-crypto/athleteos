# AthleteOS — Architectural Decision Memo (founder sign-off)

**Date:** 2026-06-29 · **For:** the founder · **From:** the architecture crew
**Source:** `docs/architecture/11-strategy-risks-decisions.md` §7, reconciled across docs `01`–`10`.

---

> ## ✅ RATIFIED — 2026-06-29 (founder)
> **All seven decisions approved as recommended.** Every sub-question answered in line with
> the crew's recommendation, plus two sharpenings the founder added:
>
> - **D1 Profile ownership — APPROVED.** Organizations never own athletes; they own *access*
>   only. The athlete owns history, meals, progress, score history, photos, habits, AI memory.
>   Graduation/transfer lose nothing. *(Founder's "decision 7": orgs never own athletes — this
>   is D1, ratified emphatically as the core differentiator vs. team-trapping competitors.)*
> - **D2 Membership/scope schema — APPROVED**, incl. both conventions: **trainer/nutritionist/
>   parent = an organization of one**, and **a family = an organization type** (one owner, the
>   children as members). "The only difference is organization size." No special-case logic.
> - **D2(b) Unlimited organizations per athlete — APPROVED** *(founder's "decision 6")*. One
>   athlete, one profile, many orgs (family + HS football + baseball + strength coach +
>   nutritionist + PT + private QB coach + summer camp), each seeing only what it's permitted.
>   This is an explicit moat. Locks the `org_memberships` shape as the single grant.
> - **D3 Scoring integrity — APPROVED with the founder's evidence-based rails** (supersedes the
>   crew's placeholder 10–50%). Customizable per org **only within these limits**:
>   | Component | Allowed range |
>   |---|---|
>   | Protein | 10–40% |
>   | Meal Consistency | 20–40% |
>   | Hydration | 10–25% |
>   | Recovery | 10–25% |
>   | Coach Compliance | 10–40% |
>   | Sport-specific metrics | 0–20% |
>   No org may set Protein = 90% / rest = 10%. *(Note: this is a **6-component** model; today's
>   engine has 4 components (nutrition/recovery/tasks/checkin). The rails are now governance
>   canon; expanding the component set to match is a [DON'T BUILD YET] target reconciled when the
>   weight-set table ships — and the exact ranges still want a dietitian's blessing before launch.)*
> - **D4 Entitlements — APPROVED.** Org-keyed, pricing-as-data.
> - **D5 Workspace scoping — APPROVED.** The **athlete chooses ONE Primary Plan** that drives the
>   Development Score, accountability, Daily Game Plan, and recommendations; every other org's
>   plan is a Reference Plan. Schools/trainers/parents assign plans but never control the score.
> - **D6 Audit immutability — APPROVED.** DB-enforced append-only.
> - **D7 Consent/COPPA — APPROVED**, incl. **re-prompt on every new organization** (new school /
>   gym / trainer / nutritionist requires fresh authorization). Verifier ≠ viewer.
>
> **Next:** the keystone (D1 + D2) is signed off → the crew may execute **Phase A** (author the
> `org_memberships` grant + `can_view` body-swap as pure `src/core` seams + unpushed migrations,
> flag-OFF, tests green; nothing user-visible changes).

---

## How to read this
These are the **seven decisions that are expensive or impossible to change once real data
exists.** Everything else in the 10-year set is a non-destructive evolution on top of them.

**None of these require building the 10-year tree.** They commit a *shape* — the database
columns and the `src/core` types — so the seams are authored correctly. You can keep shipping
today's flag-OFF wedge the day after you decide all seven.

Each decision has a **recommendation you can just approve**, the **cost of getting it wrong**,
and — where it exists — **the one sub-question only you can answer.** Tick a box per decision.

> **Decide in order:** D1 → D2 are the keystone (commit them first); D3–D7 can be ratified
> together. Six of seven are "lock in what's already right." Only the small sub-questions need
> genuinely new input from you.

---

## D1 — Identity / profile-ownership boundary  *(the keystone — decide first)*

**Question:** Is an athlete's permanent profile + all logged history (`days`/`meals`/`checkins`/
score) **org-free, athlete-owned, and self-write-only forever**, with organizations holding
*access only*?

**✅ Recommendation: YES — unconditionally.** Athlete data is never stamped with an organization.
Roster reads join through memberships; if that's ever slow, add a *cache*, never a *stamp*.

**Why:** This is the moat. Transfer, graduation, a coach quitting, multi-org — all become
access-only operations that never move data. A college inheriting a high-schooler's record is a
join, not a migration. It's also **already true in your schema today** (`days`/`meals` are keyed
on `athlete_id`, self-write-only) — the decision is to *commit to never regressing it*.

**Cost if wrong:** Catastrophic and irreversible. An org-stamp means transfer/graduation become
full data copies, an org "owns" a copy of a minor's record (legal nightmare), and the moat is
unbuildable. This is the one decision that, if wrong, requires rebuilding the product.

**Commits you to:** athlete data tables stay org-free; no `organization_id` column ever added to
`days`/`meals`/`checkins`.

**Your call needed on:** nothing — approve as recommended.

**Sign-off:** ☐ Approve  ☐ Discuss

---

## D2 — Org / membership / scope schema  *(the cross-cutting contract)*

**Question:** Is **one `org_memberships(member, org, role, scope_kind, scope_id, permissions,
status)` row** the single access-grant object that subsumes all the link tables
(`team_members`/`team_staff`/`practice_clients`/`guardianships`), with `can_view`'s *signature*
held constant while its *body* becomes a membership lookup?

**✅ Recommendation: YES.** Author the table, the scope helper, the `can_view` body-swap, and an
idempotent backfill **now, as unpushed migrations.** Apply them when the backend goes live; never
before.

**Why:** Every other doc keys off this one object — billing off `org_id`, permissions off
`permissions`, dashboards off `scope`, the workspace switcher off *which* membership. Holding the
function signature constant while swapping its body is what lets you evolve the access model
without touching hundreds of RLS policies or breaking the ~970 tests.

**Cost if wrong:** Every new relationship becomes a schema migration + an RLS edit + a test sweep;
the access model fragments; multi-org and specialist-scoping become impossible without a rewrite.
Getting the *shape* wrong (omitting `scope_kind`, or making permissions an enum instead of a typed
JSON catalog) means re-migrating live grants.

**Commits you to:** the grant shape above as the one access primitive; the four legacy link tables
become temporary compat views with a **named expiry release**.

**Your call needed on:** two scope conventions the docs left open —
- **Personal trainer & parent = an "individual-scope org-of-one"?** (Recommended: yes — a solo
  trainer or a parent is modeled as a 1-athlete org, so there's no special-case code path.)
- **Is a family an organization?** (Recommended: yes — "family" is just an org type, so a parent
  with two athletes is one org with two members. Cleaner than a bespoke parent-link.)

**Sign-off:** ☐ Approve (incl. both conventions)  ☐ Approve, but discuss the two conventions

---

## D3 — Scoring-integrity governance  *(the category moat)*

**Question:** Can a coach ever re-weight or invent a Development Score component — or is weighting
**bounded, normalized, validated data inside a platform-owned profile**, never a free re-weight?

**✅ Recommendation: bounded data, structurally.** There is **no permission key that edits the
formula** — it's impossible, not merely denied. Orgs customize *weights within rails* (e.g.
Football: protein 40 / cal 30 / hydration 20 / timing 10); the platform owns the formula and the
min/max rails. The platform default equals today's `PROFILE_WEIGHTS`, so existing tests pass
byte-for-byte.

**Why:** An "84" must mean the same thing for every athlete, every org, forever — that's what
makes the score a credential and lets you *prove* a rising score predicts improvement. A per-coach
formula makes the number relative and gameable (a coach could flatter their roster), which ends
the Proof pillar. This is already correct today (the formula is pure + un-re-weightable); the
decision is to keep it that way as weight-customization ships.

**Cost if wrong:** The product's entire defensibility. Once "84" is relative, the category
language is dead — and it's irreversible reputationally.

**Commits you to:** weight sets are validated/normalized/bounded/versioned; the formula stays the
single pure function in `src/core/scoring.ts`.

**Your call needed on:** the **per-component rails** (the min/max each weight may move within) —
this wants a registered-dietitian / sports-science sign-off before the weight-set table ships.
Recommended: set conservative rails now (no component below 10% or above 50%), refine with the RD.

**Sign-off:** ☐ Approve (set rails with an RD before the weight table ships)  ☐ Discuss

---

## D4 — Entitlement / licensing model  *(money — keep it org-keyed)*

**Question:** Are subscriptions keyed to **`organization_id`** with entitlement *inherited* through
membership, and is **pricing data, not code**, behind a single `hasFeature(viewer, key)` gate?

**✅ Recommendation: YES — org-keyed, pricing-as-data.** Never let a dollar amount, plan name, seat
limit, or feature bundle live in app code. The inert resolver + `previewEntitlement()` fail-safe
(already built) ship now; the catalog tables are authored, not pushed.

**Why:** "An athlete attached to an active org never pays separately" is your explicit rule — only
an org-keyed sub expresses that, plus a department buying one contract for many programs, plus
transfer/multi-org without double-billing. Pricing-in-code means an app-store release for every
price change, promo, or regional experiment.

**Cost if wrong:** Athlete-keyed subs break transfer, multi-org, and college purchasing and
double-bill people. Person-keyed can't model a department contract. Pricing-in-code throttles
every experiment. All three are painful re-migrations of *live billing* — the one data you can't
afford to get wrong because it touches money and FTC/ARL compliance.

**Commits you to:** evolving the current per-owner `subscriptions` seam to org-keyed; the
generalized `hasFeature()` gate on every paid feature.

**Your call needed on:** the **tier numbers** ($14.99 individual / $124.99 pro / $249–$799 program
/ enterprise-custom) are now *catalog data* — you can set/change them anytime without code. No
decision needed to commit the architecture; just confirm they live in the catalog, not in code.
(This is also the unblock for the queued checkout build — price + frequency + trial.)

**Sign-off:** ☐ Approve org-keyed + pricing-as-data  ☐ Discuss

---

## D5 — Multi-org workspace scoping  *(the active-workspace selector)*

**Question:** Does **`ActiveWorkspace` select exactly one in-force membership per request** (passed
as `acting_org`, *re-validated server-side* — narrows, never widens), with the athlete's
**primary** membership driving their personal Game Plan?

**✅ Recommendation: YES.** Ship `ActiveWorkspace` **inert** (one membership → no switcher rendered,
exactly like today). `acting_org` is a *narrowing hint*; RLS denies anything the membership
doesn't cover.

**Why:** "Which org am I in" must come from one selector, not a global role, or every multi-org
scenario re-plumbs every screen. Making it server-validated-narrowing closes a privilege-escalation
hole before it exists.

**Cost if wrong:** If the active org can ever *widen* access, that's a privilege-escalation
vulnerability. If "which org" is read from a global role, multi-org is a full re-plumb later.

**Commits you to:** a pure `src/core/workspace.ts` selector; RLS is always the authority.

**Your call needed on:** **which membership is "primary"** when orgs set conflicting targets (e.g.
the school says gain 15 lb, the private trainer says cut fat) — i.e. *whose plan governs the
athlete's own daily Game Plan and score.* Recommended: **the athlete chooses their primary**
(athlete owns their data → athlete owns which plan is "active" for themselves); other orgs' plans
are reference plans. This is the single most-asked sub-question across the docs — one answer closes
three of them.

**Sign-off:** ☐ Approve (athlete chooses primary)  ☐ Approve, but a different primary rule: ______

---

## D6 — Audit-log immutability  *(the legal + dispute spine)*

**Question:** Are all ledgers (`activity_log`, `accountability_events`, `membership_events`,
billing + plan/score/weight history) **append-only at the database level** — a `BEFORE UPDATE OR
DELETE` trigger that raises, with no role (not even `service_role` in normal operation) holding
UPDATE/DELETE?

**✅ Recommendation: YES — DB-enforced, uniformly, from the first ledger table.**

**Why:** "Who changed my kid's macros, and when?" must be *structurally* unanswerable-with-a-lie.
App-enforced append-only is one bug away from a silently rewritten audit trail — unacceptable in a
minor-facing health product. The trigger is cheap at table creation, a data-integrity nightmare to
retrofit.

**Cost if wrong:** A rewritten audit trail in a minor-facing health product is a legal and trust
catastrophe — you can't prove who accessed or changed a minor's data.

**Commits you to:** the immutability trigger pattern as the standard for every ledger/history
table.

**Your call needed on:** nothing — approve as recommended.

**Sign-off:** ☐ Approve  ☐ Discuss

---

## D7 — Consent / COPPA model  *(supreme over everything)*

**Question:** Does the fail-closed consent gate sit **above every membership, permission, payment,
and AI surface** — enforced at the narrowest *server* point (row-production / sync-drain) so a
minor's data is *impossible* to produce without a verified guardian — is consent **per-org-
membership** (re-prompts on transfer), and is the **verifying guardian distinct from a read-only
viewer** (a second parent)?

**✅ Recommendation: YES on all three.** Keep `src/core/consent.ts` canonical *and* mirror it on
the server row-production path so RLS has nothing to leak. Consent **re-prompts per new org**. A
**verified guardian** (unlocks sync) is a different grant from an **additional viewer** (a second
parent) the athlete/primary guardian must approve.

**Why:** A UI-only gate leaks the moment any non-UI path (an API, a webhook, a Copilot query) reads
the data — a COPPA violation. Global (cross-org) consent lets a transfer silently expose a minor to
a new org without a fresh guardian decision. Conflating verifier with viewer would let any
self-claimed parent unlock a minor's data.

**Cost if wrong:** Regulatory action and the end of trust — the highest-stakes "wrong" in the set.

**Commits you to:** consent enforced server-side + per-org; the verifier/viewer distinction.

**Your call needed on:** **does consent re-prompt on transfer?** Recommended: **yes** (a new org =
a new guardian decision; data-minimization + COPPA/FERPA favor it). Confirm this is acceptable
product friction (a transferring athlete's guardian re-approves for the new school).

**Sign-off:** ☐ Approve (incl. re-prompt on transfer)  ☐ Approve, but don't re-prompt on transfer

---

## The smaller decisions that ride underneath (confirm or defer)

These were flagged across docs `01`–`10` as founder inputs; none block the seven above, but
answering them removes ambiguity for Phase A.

| # | Question | Recommended default |
|---|---|---|
| s1 | Trainer/parent modeled as individual-scope org-of-one? | Yes (folds into D2) |
| s2 | Family = an organization type? | Yes (folds into D2) |
| s3 | Which membership is the athlete's "primary"? | Athlete chooses (folds into D5) |
| s4 | Consent re-prompts on transfer? | Yes (folds into D7) |
| s5 | Per-component score weight rails | Conservative now (10–50%), RD sign-off before ship (D3) |
| s6 | Consumer IAP rail (RevenueCat) timing | Defer — reserve `billing_rail` column, build when a solo-buyer funnel is proven |
| s7 | Reference plans: who may author them | Professionals + one athlete personal slot; rest reference-only |

---

## One-page sign-off

| Decision | Recommendation | Approve | Discuss |
|---|---|---|---|
| **D1** Profile ownership | Athlete owns data forever; orgs never stamp | ☐ | ☐ |
| **D2** Membership/scope schema | One `org_memberships` grant; author now, push later | ☐ | ☐ |
| **D3** Scoring integrity | Bounded weights, no per-coach formula; RD sets rails | ☐ | ☐ |
| **D4** Entitlements | Org-keyed; pricing is data not code | ☐ | ☐ |
| **D5** Workspace scoping | One active membership; athlete picks primary plan | ☐ | ☐ |
| **D6** Audit immutability | DB-enforced append-only triggers | ☐ | ☐ |
| **D7** Consent/COPPA | Server-supreme, per-org, verifier≠viewer | ☐ | ☐ |

**The keystone (do first):** approve D1 + D2 → the crew authors the `org_memberships` grant +
`can_view` body-swap as pure `src/core` seams + unpushed migrations, flag-OFF, tests green
(Phase A). Nothing user-visible changes; the foundation is committed; the loop stays shippable.
