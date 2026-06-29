# 04 — Product Roadmap (the phased path from flag-OFF wedge to category)

> **Status:** FOUNDING DOCUMENT — the board-readable, time-ordered build plan that sequences the
> twelve flagship features (`00_STRATEGIC_QUESTIONS.md` §19), ships the signature experience (§20),
> and honors the actual build state. Authored 2026-06-29 in the voice of the CPO + Founder + Sports
> Performance Director + VC partner, ratified by the executive team. **This doc does not re-derive
> strategy** (`00_STRATEGIC_QUESTIONS.md`), **the formula/pillars** (`01_PRODUCT_CONSTITUTION.md`),
> or **the system** (`02_ENTERPRISE_ARCHITECTURE.md` and `architecture/00`–`11`). It decides *what
> ships when, what gates the next phase, and which segment each phase wins* — and it is brutally
> honest that the next real milestone is human (legal + a vendor + a phone + Apple), not code.
>
> **How to read this:** §1 is the honest starting line (where we actually are). §2 is the spine —
> the phase ladder with theme / features / gate / segment. §3 places the 12 flagships on the ladder.
> §4 is the signature experience and when it ships. §5 is the NOT-YET / cut list with the cheap seam.
> §6 is the go-live human critical path (the part a roadmap usually lies about). §7 is "Where we push
> back." The seven RATIFIED keystone decisions (`DECISION-MEMO.md`, D1–D7) are canon throughout.

---

## 0. The one paragraph a board needs

We have already built more than we have validated. The code-side of the loop, two engines, accounts,
consent, audit, and the `org_memberships` keystone are **done and green (~1001 tests)** — and the
entire thing is **OFF behind two flags** (`EXPO_PUBLIC_BACKEND_LIVE`, `EXPO_PUBLIC_ENGINES_ENABLED`).
So the roadmap is *not* a build plan in the usual sense; it is a **validation plan with a build tail.**
The single most important truth on this page: **the next milestone is not a feature — it is a lawyer,
a parent-verification vendor, an email sender, a real phone, and Apple's review queue** (§6). Until a
real coach's real roster runs the real loop, every line of new code is speculative. Therefore the
roadmap's spine is five gates — **MVP → Closed Beta → V1 → V2 → V3** — and *each gate is a retention
or revenue proof, not a feature count.* We refuse to widen until the loop retains (Constitution Rule
#11). The flagships are sequenced so the wedge (the competitive-sport coach / performance trainer,
`00` §6) is won completely before breadth is *pulled* — never pushed.

---

## 1. The honest starting line — where we actually are (read before any phase)

A roadmap that ignores the build state is a fantasy. The facts (`PHASE-A-LOG.md`,
`NEXT-SPRINT-PRIORITIES.md`, `LAUNCH-CHECKLIST.md`):

- **Phase A (integrity seams) is COMPLETE** — `org_memberships` grant model, the pure-`src/core`
  access primitive, the inert workspace/entitlement seams, the keystone migrations `0011`/`0012`
  authored and validated on a throwaway Postgres. Flag-OFF, byte-identical to before, ~1001 tests.
- **Phase B code-side is largely DONE** — the live loop (photo → score → log → tasks), accounts
  (email + Apple seam), consent fail-closed, the meal library, the coach plan/targets editor,
  on-time logging folded into the score, the two engines (Restaurant Coach + Accountability) built
  and hidden behind `EXPO_PUBLIC_ENGINES_ENABLED` (default OFF), the analytics seam, the subscription
  entitlement seam (inert, reads "Free preview").
- **What is NOT done is the part the crew cannot do**: legal sign-off + hosted policies, a VPC vendor,
  an email sender, applying migrations to live, flipping `EXPO_PUBLIC_BACKEND_LIVE`, a real device
  (camera/notifications/VoiceOver), a meal-analysis model key, Apple submission, and **recruiting the
  coaches.** These are §6.

**The strategic consequence:** our risk is *not* "can we build it." It is **"will the loop retain,
and did we widen before we knew."** The roadmap below is engineered against exactly that risk. Two
product gaps that the strategy doc flagged as loop-threatening are treated as **gating Phase-B
unlocks, not features**: (a) the real meal-analysis vision model wired into the `analyze-meal` seam
(`00` §11, §19 #3), and (b) the **low-friction daily execution commitment** that keeps the dashboard
alive when 40 teenagers do *not* photograph every meal (`00` §18-A, §19 #6). Neither "waits." Both
must land before we claim the loop is proven.

---

## 2. The phase ladder (the spine)

Each phase names its **THEME**, the **few** features in it, the **single metric that gates the next
phase**, and the **segment it wins.** The cardinal rule: *a phase does not begin until the prior
phase's gate metric is met.* No gate, no widening.

### MVP — "Prove the loop retains for ONE coach" (the smallest thing that proves the loop)

- **Theme:** Does a real roster *come back to the daily loop* without us widening anything?
- **Segment it wins:** A single private **sports-performance / strength facility** owner-coach with a
  roster of ~15–40 athletes, most 18+ (so the minor-consent layer is not yet the gate) — the
  within-wedge beachhead order's step 1 (`00` §6).
- **What ships (deliberately minimal — engines OFF):** the core loop only — onboarding → Starting
  Score → the **Daily Game Plan + Finish-Today projection** (the signature, §4) → the **low-friction
  daily execution commitment** (yes/no/partial, sub-30s) with **real meal-photo analysis** as the
  rich optional layer → the **Needs-Attention intervention dashboard** for the coach (who's slipping →
  one-tap action + trail). `EXPO_PUBLIC_ENGINES_ENABLED=OFF`. No Restaurant Coach, no leaderboard, no
  multi-org switcher.
- **Gate to the next phase (the only number that matters):** **≥60% of activated athletes complete
  the daily commitment on ≥4 of 7 days in week 3, AND the coach opens the Needs-Attention dashboard
  ≥3× in week 3** (the coach's behavior is the leading indicator of indispensability, `00` §13/§16).
  If the dashboard goes empty by week two (the §18-A failure mode), we have *not* passed — we fix the
  loop's fuel, we do not add features.
- **Why this is the MVP and not less:** the loop is **Plan → Execute → Reflect → Connect** and you
  cannot prove retention with fewer than those four surfaces wired to one coach. Anything less proves
  nothing; anything more is unvalidated breadth.

### Closed Beta — "Prove the loop retains for 3–5 coaches and their rosters"

- **Theme:** Does the *coach→roster network effect* (`00` §5) actually fire — does one coach light up
  many athletes who did not choose us, and do *they* retain?
- **Segment it wins:** 3–5 hand-held performance-trainer / HS-coach cohorts (per `docs/BETA-TEST-PLAN.md`),
  now including the **first HS program** where guardian consent becomes load-bearing (beachhead step 2).
- **What ships:** the MVP loop, hardened, at multi-roster scale: position-group / sub-roster
  segmentation, the "who hasn't logged today" view, the overseer alert pipeline actually firing
  (reminders + coach alerts), the consent-on-sync fail-closed path proven with a real minor + a real
  VPC verification, and the activation instrumentation producing **signal, not anecdotes** (`NEXT-SPRINT`
  P2). Engines may flip ON for one cohort as an A/B — *only* if the loop already retained without them.
- **Gate to V1:** **≥40% week-4 athlete retention across cohorts AND at least one coach runs their
  WEEKLY REVIEW off the dashboard** ("who's below 70, who slipped" — `00` §16, the indispensability
  tell). Plus a **clean consent/audit record** (zero fail-open incidents) — the trust gate.
- **Why this gate:** the weekly-review behavior is the moment we stop being a tool and become the
  operating procedure. If no coach reaches it, more features will not create it.

### V1 — "The wedge is the reference case" (first paid, first credential language)

- **Theme:** Win the competitive-sport coach / performance-trainer wedge *so completely it becomes the
  reference case* (`00` §6, §18-B) — and turn it on economically.
- **Segment it wins:** the full wedge — private facilities (gym-as-org roll-up) + HS competitive
  programs. First **paying** orgs.
- **What ships:** org-keyed billing live on the Stripe B2B rail with active-participant metering
  (Starter ≤30 $249 / Growth ≤75 $499 / Performance ≤150 $799 — pricing-as-data, D4) and the
  compliant checkout/disclosure UI (`subscription-compliance.md`); the **gym-as-organization roll-up**
  (owner sees across trainers; each trainer sees their book — `00` §14); the **recognition / execution-
  streak engine** (the missing dopamine for *finishing the plan*, `00` §9/§19 #10); **coach plan
  authoring** matured (targets + relevance + weights within evidence rails, D3); the **Decision Engine**
  graduates the Restaurant Coach into "what do I eat *here*" (restaurants → gas station → travel →
  pantry, §19 #7) — flipped ON because the loop is proven. The in-product number is honestly named
  ("Execution Score" / "Nutrition Development Score", §18-C) with "Development Score" as the destination
  brand.
- **Gate to V2:** **net revenue retention ≥100% on org contracts (seats expand, not churn) AND ≥3
  reference customers who will take a sales call** — i.e., the wedge is repeatable, not a set of heroic
  one-offs. Plus a designed **graduated/transferred-athlete conversion surface** showing a measurable
  attach rate (the §18-E hole closed, see §7).
- **Why this gate:** revenue retention is the only honest proof that the value is load-bearing, not
  novelty. Reference customers are what make the *next* segment a pull, not a push.

### V2 — "The org tree, pulled by a real second org" (enterprise, multi-org density)

- **Theme:** Light up the multi-org / department machinery the seams already anticipate — **pulled by a
  real customer, never pushed** (architecture Phase C, `11` §8). The compounding moat (`00` §3/§4)
  becomes usable.
- **Segment it wins:** the first **multi-program / department** customer (a school district, a
  multi-site gym chain, or a small college program) — the credential story begins here.
- **What ships:** the **portable multi-org profile + workspace switcher** activated (inert since
  Phase A — `00` §19 #8); the deep `programs`/`groups`/`invitations`/`membership_events` tree
  *populated* (rows, not new schema); **org governance + consent + audit + role-scoped staff access**
  matured for procurement (`00` §19 #12, §8); the **Goal-Aware Context engine** populated beyond
  athlete + general as a *mixed-book trainer pulls it* (§11b, Rule #14 — architecture-ready, GTM-pulled);
  bulk roster import *only if* a real department signs needing it (else it stays a reserved seam, §5).
- **Gate to V3:** **at least one signed multi-program contract renews AND cross-org athlete density is
  real** (a meaningful share of new athletes are *already on the platform* via another org — the
  multi-homing network effect, `00` §5). Plus the **outcomes dataset is accumulating** (the Proof
  pillar has labeled data).
- **Why this gate:** density is the proof that the network effect compounds; an accumulating outcomes
  dataset is the only thing that earns the right to V3's credential claim.

### V3 — "The Development Score becomes a credential" (the endgame)

- **Theme:** Substantiate the score as a **portable development credential** that people who never
  installed the product cite (`00` §1 — "a recruiter asks for the Development Score the way they ask
  for a 40 time").
- **Segment it wins:** college / program tier + the two-sided **credential market** (recruiters,
  colleges pulling HS programs in to produce the score — `00` §5 demand-side credentialing).
- **What ships:** the **Proof / outcomes engine** (does a rising score predict real development? —
  `00` §19 #11) as the substantiating asset; exportable program-level reporting; the score's broader
  "Development Score" name earned by *real performance/recovery signals* (wearable recovery blended in
  per D8 only once it changes the number honestly); SSO/SCIM/public API populated for the institutions
  that now require them.
- **Gate (the endgame test):** **an external party (a recruiter, a college) requests an athlete's
  Development Score history.** That is the moment we are infrastructure, not an app.
- **Why this is last:** every earlier gate exists to protect the score's integrity (D3) long enough to
  make this claim true. Claiming it before the signals back it is the first fabricated authority — the
  exact crack the brand cannot survive (§18-C).

### Long-term (beyond V3) — adjacent execution domains, only after nutrition is owned

Nutrition is the **first** execution domain, not the only one (`00` §1). The long-term surface —
training execution, recovery/return-to-play, then academics/eligibility — is the same loop (Plan →
Execute → Reflect → Connect → Prove) pointed at a new domain, on the *same* `org_memberships` grant
and the *same* portable profile. **None of it is built until nutrition is the operating procedure for a
real cohort in each adjacent buyer.** International / non-English and wearables-first remain
`[DON'T BUILD YET]` with reserved seams (`00` §7). The discipline never changes: **validate, then
widen.**

---

## 3. The 12 flagship features, placed on the ladder

The five-year flagship set (`00` §19) mapped to the phase that ships it. The Roadmap's job is to
**protect these against creep** — nothing not on this list ships ahead of something on it.

| # | Flagship feature | Pillar | Phase it ships | Why there |
|---|---|---|---|---|
| 1 | **Development Score** (platform-owned, portable, watched) | Accountability + Proof | **MVP** (honestly named) → **V3** (earns "Development") | The number is the spine of the loop from day one; the *name* grows with the signals (§18-C). |
| 2 | **Daily Game Plan + Finish-Today projection** | Accountability + Decision | **MVP** | The signature (§4); the loop has no home without it. |
| 3 | **Real meal-photo → analysis** (vision + confidence + correction flywheel) | Intelligence | **MVP** (the Phase-B unlock, not a "wait") | The headline delight surface + the flywheel's fuel; most-cited gap (`00` §11). |
| 4 | **Intervention dashboard** (Needs-Attention → one-tap + trail) | Accountability + Human Connection | **MVP** (single coach) → **Closed Beta** (segmentation/scale) | The 3-second triage; the indispensability hook for every pro segment. |
| 5 | **Coach plan authoring** (targets/relevance within evidence rails) | Human Connection | **MVP** (basic) → **V1** (matured) | The coach owns the plan (§11a); the labor that creates switching cost. |
| 6 | **Low-friction daily execution commitment** | Accountability | **MVP** (gating) | Fixes the §18-A logging-dependence flaw; keeps the dashboard alive at teen scale. |
| 7 | **Decision Engine** (eat-anywhere: restaurants → gas station → travel → pantry) | Decision + Intelligence | **V1** (Restaurant Coach engine flips ON post-proof) | The decision-fatigue killer; widened only after the loop retains. |
| 8 | **Portable multi-org profile + workspace switcher** | Accountability (continuity) | **V2** (activated; inert since Phase A) | The compounding moat made usable — pulled by a real second org. |
| 9 | **Goal-Aware Context engine** (one app, many brains) | Intelligence | **V2** (populated beyond athlete+general as a buyer pulls it) | Breadth seam; populated as proof lands, never pushed (Rule #14). |
| 10 | **Recognition / execution-streak engine** | Accountability + Human Connection | **V1** | The missing reward layer; rewards *finishing the plan*, not logins (Rule #4). |
| 11 | **Proof / outcomes engine** (does a rising score predict development?) | Proof | **V3** | The credential's substantiation; needs accumulated labeled data (gated on V2). |
| 12 | **Org governance + consent + audit + role-scoped staff access** | cross-cutting | **MVP→Beta** (consent/audit/staff scope live, gating) → **V2** (matured for procurement) | The trust/procurement layer; consent + audit are non-negotiable from the first minor. |

**Creep guard:** if a proposed feature is not on this list, it ships only after every higher-priority
flagship in its phase is live and gated. The two flagships that are *not* a phase later than their
strategic urgency (#3 meal analysis, #6 commitment) are the loop-fuel fixes — they are the price of
admission to claiming "the loop is proven," and we resist any pressure to defer them.

---

## 4. The signature experience — and exactly when it ships

**The signature is the morning Daily Game Plan built around your score, anchored by the Finish-Today
projection** (`00` §20): every morning the app tells you the one number, the one focus, and exactly
how to still win *today* — and you know the person invested in you is watching you do it. The one
unforgettable line we are engineering for: *"Every morning AthleteOS tells me exactly how to win the
day, and my coach is watching me do it."*

**When it ships: at the MVP — it is not deferrable.** The signature is the *home of the loop*; you
cannot prove the loop retains without the experience that opens it every morning. We ship it before
the meal-analysis polish, before the engines, before billing. Two non-negotiable framings travel with
it from day one:

1. **Forward-looking, not a post-mortem** (the Whoop-Recovery reframe) — "how to win today," never
   "how you did yesterday." This is what makes it *ours* and not a tracker's log screen.
2. **Honestly named** (§18-C) — in-product the projected number reads to its true substance ("Execution
   Score" / "Nutrition Development Score"); "Development Score" is the *destination* brand we plant in
   the market and grow into as the signals (V3) earn it. The copy is load-bearing: the same data is
   delight when athlete-first framed ("you control who sees this") and dread when it isn't (`00` §9 vs §2).

---

## 5. NOT YET / cut — with the reason and the cheap seam

Mirrors `architecture/11` §6 and `00` §10/§11. Every "no" is reversible by a **flag flip or a
populate-the-table** because the seam is already in pure `src/core` or a reserved column. This list is
the roadmap's *no*, and it is as load-bearing as the *yes*.

**CUT from launch (removed or off-by-default — credibility / safety gates):**

| Item | Why cut now | The cheap seam / un-cut trigger |
|---|---|---|
| **All demo / "Sample" data** (hardcoded 92% retention, `weightScore=95`, `EAGLES24`, canned AI) | Most-cited persona problem; "nothing is real" is a credibility gate, not a feature (`00` §10, Rule #10). **Highest-priority removal.** | N/A — it is deleted. Real signals or nothing. |
| **Default-on leaderboard / squad surface** | Ranking pressure can shame; "distracts from execution" (Rule #4). | `leaderboard.ts` math exists; ship **opt-in, off-by-default, execution-metrics-only** seam. Un-cut: a cohort explicitly asks and it tests as motivating, not shaming. |
| **Unrestricted real-time chat** | Minor-safety / moderation / legal risk; rated ≤4 (`00` §10). | `messages.kind='free_text'` reserved behind a flag; `messaging_authorized` (`0006`) governs it. Un-cut: **counsel blesses the minor-messaging posture** (Launch Phase 0). |
| **Prominent PR / performance from the headline score** | Bait-and-switch risk; PRs stay decoupled (D3, §18-C). | PRs live on a separate page; never fold into the daily score. |
| **Confident AI conclusions off thin data** ("1-on-1 before Friday" regardless of roster) | Fabricated authority is where trust cracks (Rule #8). | Derive from real signals + confidence labels, or remove. |

**NOT YET (valuable, deferred behind a named trigger — `00` §11, `11` §6):**

| Item | Why it waits | Reserved seam | Un-ignore trigger |
|---|---|---|---|
| **Server-side score recompute / anti-tamper** | No gaming threat; formula is pure-TS canonical; SQL mirror is cost with near-zero value while backend is OFF. | Frozen day-row `explain` blob (doc 03 §3.8). | A real observed gaming threat at scale. |
| **Vector / semantic AI memory** | A missed allergy in a fuzzy vector is a safety incident; typed facts suffice. | `retrieveForTask()` interface unchanged; safety facts stay typed forever. | Free-text volume makes typed retrieval insufficient (post-proof). |
| **Learned "who-falls-behind" predictor** | No labeled outcome data yet; a model trained on nothing is a confident hallucination. | Ships as a deterministic trend ("based on recent trend"), same typed signature. | The V2→V3 outcomes dataset has labels. |
| **Bulk roster / SIS import** | Zero department customers; single-coach join code covers 30 athletes. | `accept_invitation` dedupe (never mint a duplicate) is the load-bearing seam; import tables authored, unpushed. | A real department signs needing it (V2). |
| **Multi-org workspace switcher UI** | 99% have one membership today; dead UI until `available.length > 1`. | `src/core/workspace.ts` ships **inert** (resolves to single membership). | A real second org per athlete (V2). |
| **Full programs/groups/invitations tree** | The 10-year hierarchy; wedge is one-org-one-program. | `org_memberships` + `scope_kind` model it as data. | First multi-program customer (V2). |
| **SSO / SCIM / public API** | Zero enterprise customers; pure attack-surface add. | `identity_providers` / `api_clients` shapes designed, built none. | An institution requires it (V3). |
| **Org branding beyond logo + accent** | Enterprise v3; rated ≤4. | `org_branding` themes the accent token only (third `useColors()` input). | A signed enterprise need (V3). |
| **Consumer IAP rail (RevenueCat)** | Wedge is B2B-coach-led; adds Apple review surface pre-signal. | `billing_rail` column reserved; org-of-one path serves it. | A solo-buyer / graduated-athlete funnel is independently proven (§7). |
| **Wearable recovery into the score (D8)** | Changes what the number *means*; premature blending corrupts comparability. | `blendRecovery` pure seam, inert. | V3, when it honestly improves the number. |
| **Custom per-org roles / ABAC engine** | Over-build vs. a fixed 12-role catalog + overrides. | `roles.org_id` column reserved. | An enterprise with real role variance (V2+). |

---

## 6. The go-live human critical path (the part roadmaps usually lie about)

**This is the most important section for the founder.** The code is "in good shape"; nothing between
us and a real beta is code (`LAUNCH-CHECKLIST.md`). The critical path is a chain of **human** steps,
and later steps depend on earlier ones. We sequence them honestly:

1. **Phase 0 — Legal + vendors (gates everything):** counsel reviews + hosts the Privacy Policy +
   Terms with COPPA/FERPA sign-off; pick a **VPC (parent-verification) vendor** (the thing that flips a
   guardian from pending→verified — until it exists, every minor is local-only and no coach sees their
   data); pick an **email sender** (guardian link + sign-up confirmation); decide the **minor-messaging
   question** with counsel (leave messaging OFF until blessed).
2. **Phase 1 — Turn the backend on (founder's hands on the keyboard):** apply migrations to live
   **one at a time** (`0004`→`0010`, then the keystone `0011`→`0012` — re-run the `can_view`
   equivalence check on a throwaway DB with real-shaped data **before** trusting `0012`); flip email
   confirmation on; set the three env vars and rebuild with `EXPO_PUBLIC_BACKEND_LIVE=true` (this *is*
   the on-switch and the kill-switch); wire the guardian-consent verify endpoint and the overseer
   alert pipeline.
3. **Phase 2 — The phone + the App Store (needs a real device):** install + wire `expo-notifications`;
   test camera + meal analysis on-device; VoiceOver/contrast a11y pass; **Sign in with Apple** (Apple
   *requires* it because we offer email login — Guideline 4.8); confirm bundle id, age rating,
   screenshots, reachable account deletion; submit for review.
4. **Phase 3 — Run the actual beta (the real unlock):** **recruit 3–5 coaches** + their athletes; run
   `docs/BETA-TEST-PLAN.md`; watch whether the loop sticks.

**The MVP gate (§2) cannot be measured until Phase 3 is reached** — which means the *real* first
milestone on this roadmap is "the founder finishes Phase 0." Every phase in §2 sits *downstream* of
this human chain. The meal-analysis model key and the engine flip are the two product unlocks that
ride on top of the live backend. **A roadmap that pretends the next step is a feature is lying; the
next step is a lawyer and a vendor.**

---

## 7. Where we push back (the mandate)

We owe the founder bluntness. Five places the roadmap challenges an assumption or a default:

**A. Push back on shipping the two engines in the closed beta "because they're built."** They are
done and gated (`EXPO_PUBLIC_ENGINES_ENABLED=OFF`) — and the temptation will be to show them off in
the beta. **Resist.** Capability is not strategy (`00` §18-B). The MVP must prove the *bare loop*
retains; if we ship engines on day one and retention is good, we will not know *what* retained. **Recommended:**
keep engines OFF through the MVP gate; flip them ON in Closed Beta only as an **A/B on a cohort whose
loop already retained without them.** The Restaurant Coach graduates to the full Decision Engine at V1
— after proof, not before. This is Rule #11 made literal: validate before you widen.

**B. Push back on treating "the code is done" as "we are close to launch."** We are close to a
*build* milestone and far from a *market* milestone. The honest distance to revenue is the Phase 0→3
human chain (§6) **plus** a retention proof **plus** a pricing decision. **Recommended:** the founder's
single highest-leverage action this quarter is not reviewing more features — it is **starting Phase 0
today** (lawyer + VPC vendor + email sender in motion). Every week those three are not moving is a week
the entire roadmap is stalled regardless of code velocity.

**C. Push back on the meal-photo loop as the primary daily signal at HS scale (the sharpest one).**
The single most load-bearing risk in this roadmap is §18-A: **the loop currently assumes 40 teenagers
photograph every meal daily, and they will not.** If the MVP ships with meal-photo as the *primary*
execution signal, the dashboard is empty by week two and the gate fails for the wrong reason. **Recommended
(and we are firm):** the **low-friction daily commitment (yes/no/partial, sub-30s) is the PRIMARY loop
signal and meal-photo is the rich OPTIONAL layer** — flagship #6 is a *gating* MVP feature, co-equal
with the signature, not a later add. The score must read honestly at low logging volume (incomplete =
incomplete) and give the coach a usable roster signal at 60% rich-logging. **This is the one product
change we will not let the roadmap defer.**

**D. Push back on V1 launching paid before the graduated-athlete conversion surface exists.** The
"athlete never pays while attached to an active org" model creates a **graduation cliff** (`00` §18-E):
the moment an athlete leaves the org they pay $14.99 or churn, and we have *no proven conversion
motion.* The portable record ("keep your history, keep your score") is our best consumer conversion
lever and we are currently leaving it as an architecture fact. **Recommended:** make the V1→V2 gate
include a **designed, instrumented graduated/transferred-athlete conversion surface** with a measured
attach rate — not an afterthought. The Pricing/GTM doc owns the motion; the roadmap *gates on it.*

**E. Push back on any pressure to soften the score's integrity to win a beta coach faster.** Real
coaches will ask "why can't I weight it my way," and some will walk (`00` §18-D). The roadmap will be
tempted to add per-coach formula control to hit a beta-recruitment number. **Resist, every time.** A
portable score that means something different per coach is a portable *nothing* — it destroys the V3
credential before we reach it. **Recommended:** lose the coach who wants a vanity formula; arm the
sales motion with the integrity *as* the value prop ("your '84' means the same thing a recruiter will
read"). We resolve the §5↔§6 tension in favor of integrity, on the record, in the roadmap.

---

### Cross-doc dependencies the other founding docs MUST honor

- **Constitution doc (`01`):** must carry §18-C — the in-product number is honestly named ("Execution /
  Nutrition Development Score") at MVP while "Development Score" is the destination brand earned at V3.
  The roadmap *gates* the name change on real performance/recovery signals; the Constitution must not
  let the in-product number claim "Development" before V3.
- **Architecture doc (`02` / `architecture` set):** must keep flagship #6 (the **low-friction daily
  execution commitment**) a **first-class score input** alongside meal logging (push-back C) — the
  roadmap's MVP depends on it being honest at low logging volume. Must hold the §5 reserved-seam table
  as the "don't build yet" contract the roadmap's NOT-YET list mirrors.
- **Pricing / GTM doc (`03`):** must (a) supply the **pricing decision** that unblocks the V1 paid
  gate and `NEXT-SPRINT` P7 checkout; (b) **own the graduated/transferred-athlete conversion surface**
  the roadmap gates V1→V2 on (push-back D); (c) supply the wedge-order GTM (`00` §6) and the
  per-segment un-ignore triggers (`00` §7) that the roadmap's segment-per-phase assignments assume.
- **Strategy doc (`00`):** is the source of the 12 flagships (§19) and the signature (§20) this roadmap
  sequences; the roadmap honors §19's exclusion list as its NOT-YET/cut contract.
