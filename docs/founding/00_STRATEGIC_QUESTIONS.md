# 00 — The 20 Strategic Questions (the founding answer key)

> **Status:** FOUNDING DOCUMENT — the load-bearing strategic logic the Constitution, Architecture,
> Pricing/GTM, and Roadmap docs all cite. Authored 2026-06-29 in the voice of the CEO / CPO / VC
> partner, ratified by the executive team. This doc does **not** restate the Constitution
> (`docs/PRODUCT-CONSTITUTION.md`) or the architecture set (`docs/architecture/00`–`11`,
> `DECISION-MEMO.md`); it **decides** the questions those docs assume answered, and where two
> answers conflict it resolves the tension on the record.
>
> **How to read this:** each question is quoted, then answered with a *call* — not a survey of
> options. The reasoning is competitive, not academic. The seven RATIFIED keystone decisions
> (`DECISION-MEMO.md`) are treated as canon and built upon, never relitigated. The mandate is to be
> a board, not a yes-man: §18 and the "Where we push back" boxes name the founder's assumptions we
> believe are wrong and give the alternative.

---

## The thesis in one paragraph (so every answer below ladders to it)

AthleteOS is not a nutrition app and must never be benchmarked against one. It is the **execution
and accountability operating system** that sits between a plan and a human doing it, and it wins by
owning two things no incumbent can copy without rebuilding their data model: (1) a **portable,
athlete-owned profile and Development Score history that compounds across every organization an
athlete ever joins**, and (2) the **coach↔athlete↔org graph** that turns one coach's adoption into a
whole roster's. Trackers own *measurement*; we own *did-the-plan-get-done, and can you prove it.*
Everything that follows is downstream of that.

---

## 1. "What should AthleteOS become?"

**The category-defining operating system for human execution — the system of record for "did the
plan get done, and did it work" — starting in nutrition and expanding into the full athlete-
development stack (training, recovery, then return-to-play and academics).** Concretely: the layer
that every coach, trainer, parent, dietitian, and program runs their accountability through, where
the **Development Score becomes the credential** that follows an athlete from an 8th-grade strength
coach to a Power-5 program to a pro front office — the way a credit score follows a consumer or a
Whoop Recovery score follows a body.

The test for "became what we should": **a college recruiter asks for an athlete's AthleteOS
Development Score history the way they ask for a transcript or a 40 time.** That is the endgame —
not MAU, not meals logged. We become infrastructure, not an app, when the *number we own* is cited
by people who never installed our product.

This is bigger than the Constitution's "execution platform" framing in one specific way the
executive team wants on the record: the Constitution scopes the wedge (nutrition, coach-led). This
document scopes the *destination* (a portable development credential + the graph that carries it).
The wedge is how we earn the right to the destination; it is not the destination.

## 2. "What should it never become?"

**Never a tracker, a macro-counting app, a chatbot, or a quantified-self toy — and never an
athlete-only consumer app.** Specifically, four bright lines we will not cross:

1. **Never a database that competes on food-DB breadth or step counts.** MyFitnessPal, Cronometer,
   and Apple Health already won "log it." If we are ever compared feature-for-feature to MFP, we have
   lost — because a tracker measures the athlete and walks away; we measure *execution of a plan a
   trusted human set* and put it in front of that human. (Reinforces Founder Rules #2, #9.)
2. **Never a product that owns the athlete on the org's behalf.** The day an organization can trap,
   delete, or take a copy of an athlete's history, we have become the team-software incumbents we are
   built to displace. (Ratified D1: orgs own *access*, athletes own *data forever*.)
3. **Never an "AI coach" that replaces the human or invents the plan/score.** The AI phrases and
   recommends; it never sets a minor's calorie target or re-weights the formula. The moment a model
   hallucinates a number a 15-year-old acts on, the brand is over. (Rules #3, #8, #13.)
4. **Never a surveillance product that feels like homework graded by your coach and your mom.** The
   persona review (Jayden, §7) flagged "surveillance dread" as the athlete-side churn risk. We never
   become the app a kid deletes because it made them feel watched instead of coached.

## 3. "What is our biggest moat?"

**The portable, athlete-owned profile + Development Score history that compounds across orgs is the
biggest moat. The org graph is the second moat and the distribution engine. The coach-owns-the-plan
trust contract is the *enabling* moat that makes the first two defensible — but it is a moat
multiplier, not the moat itself.** We rank them, because a founding doc that says "all four matter"
is useless:

- **#1 — Portable athlete-owned data + score history (the compounding moat).** This is the only moat
  that gets *stronger every day for every athlete even when we ship nothing*, and the only one a
  competitor cannot replicate by copying our features — they would have to own the athlete's *past*,
  which they structurally cannot, because in their model the org owns the data and it dies at
  transfer/graduation. Every team-software incumbent (TeamSnap, Hudl, Teamworks, Bridge Athletic)
  stamps data with the org. When the athlete leaves, the record dies. **Ours follows the athlete for
  a decade across six orgs.** That is the credit-score / transcript moat, and it is architecturally
  locked by Ratified D1 — which is precisely why D1 is the keystone decision in `DECISION-MEMO.md`.
- **#2 — The org graph (the network + distribution moat).** A coach who brings their roster brings 30
  pre-warmed athletes; an athlete in six orgs is six switching costs. This is real and ranked second
  because it is *copyable in principle* (any team app has a roster) — what makes ours uncopyable is
  that it sits on top of moat #1 (the portable profile), so our graph carries history theirs can't.
- **#3 (multiplier) — The coach-owns-plan / platform-owns-formula trust contract (§11a).** This is
  what makes the score a *credential* instead of a vanity metric. Without it, an "84" is relative,
  gameable, and uncomparable — and then moat #1 is worthless because a portable score that means
  nothing is portable nothing. So the scoring contract is not a separate moat; it is the integrity
  that makes the data moat *bankable*. (Ratified D3.)

The behavioral data flywheel (Constitution §11.1) is real but is a *future* moat — it only compounds
at scale we don't have yet. We do not lead the pitch with it. We lead with the portable credential,
because it is true on day one for a single athlete.

## 4. "What creates switching costs?"

Switching costs, ranked by how hard they are to overcome, each tied to a ratified decision:

1. **Accumulated, irreplaceable score history (D1).** A coach can re-create a roster in a competing
   app in an afternoon. They cannot re-create 14 months of an athlete's daily execution history,
   trend, and proof. The *past* is the lock-in. This is why athlete-owned-forever is a feature, not a
   constraint: the athlete's accumulated history is the thing nobody — not even us — can take away,
   which is exactly why they'll keep it where it lives.
2. **Multi-org entanglement (D2, D5).** An athlete in a family org + an HS team + a private QB coach
   + a dietitian has *four* relationships routed through one profile. Leaving means coordinating an
   exit across four parties. The unlimited-orgs-per-athlete model (Ratified D2b) turns every added
   relationship into another anchor.
3. **The coach's configured plans, weight emphasis, and roster scoping.** A coach who has tuned plans
   for 30 athletes within the evidence rails (D3) has invested labor that does not export.
4. **Org-keyed billing + seat history (D4).** A program that has run a season on one contract, with
   active-participant metering and an audit trail, faces procurement friction to move — switching is
   a re-procurement, not an app swap.
5. **The Development Score as the team's shared language.** Once a staff says "who's below 70 this
   week" in meetings, the number *is* the workflow. Replacing it means re-teaching a vocabulary.

The strategic point: we deliberately build switching costs that accrue to **the athlete and the
relationship**, not just to the org's admin — because org-only lock-in is the incumbent trap (the
org churns, the product churns). Athlete-anchored lock-in survives org churn.

## 5. "What creates network effects?"

We have **four distinct network effects**; naming which is which prevents us from over-claiming a
flywheel we don't have yet:

- **Cross-side, direct (the real one we have today): coach → roster.** One coach adoption instantly
  onboards 15–40 athletes who did not choose us. This is our primary, *immediate* network effect and
  the engine of the wedge GTM. It is the TeamSnap/Remind playbook — but ours adds the portable
  profile, so the athletes don't churn when they leave the coach.
- **Athlete-side, multi-homing (the compounding one): athlete → orgs.** Because an athlete has *one*
  profile across unlimited orgs (D2b), each new org an athlete joins is a new node that finds the
  athlete *already on the platform* — the second coach, the dietitian, the college all onboard against
  an existing record. The more orgs adopt, the more likely any new org's athlete is already here. This
  is the effect that becomes a true network as density rises.
- **Org-side, indirect (data network effect): more athletes → smarter recommendations.** The
  behavioral flywheel (Constitution §11.1). Real only at scale; a *future* effect, not a launch claim.
- **Demand-side credentialing (the endgame effect): recruiters/colleges asking for the score.** Once
  enough programs adopt, the Development Score becomes a thing colleges *expect* to see, which pulls
  HS programs in to produce it — a two-sided credential market. This is the Whoop-Recovery / LinkedIn-
  endorsement effect and the highest-value network effect we can build. It is years out and we name it
  so the roadmap protects the score's integrity (D3) long enough to earn it.

**Resolution of the tension between §3 and §5:** the *moat* is the portable data (a stock); the
*network effect* is the coach→roster→multi-org density (a flow). They reinforce: the flow (graph
growth) accumulates into the stock (compounding history). We must never let a growth tactic that
inflates the flow (e.g. per-coach custom scores to win a coach faster) corrupt the stock (a portable
score that means the same thing everywhere). That is the §6-vs-§18 tension resolved in advance: **we
will lose individual coach deals rather than fragment the score.**

## 6. "Which customers should we dominate FIRST?"

**The wedge segment is the single competitive-sport coach or sports-performance trainer running a
roster of ~15–40 athletes (high-school varsity and private performance/strength facilities), who
will adopt AthleteOS as a nutrition-accountability tool — explicitly NOT as a full performance
system.** This is the persona review's own verdict (strongest target user: the HS / sports-
performance coach; recommended beta: a hand-held cohort of HS or sports-performance coaches, roster
~15–40, athletes whose parents are *not yet* load-bearing so the minor-consent layer isn't the
gate). We ratify it and sharpen it:

**Why this segment and not the others:**
- **It matches the one thing the product already does brilliantly.** The intervention-first "who's
  slipping → one-tap nudge" dashboard maps exactly onto how a coach triages in 3 seconds. Every
  persona praised it. We dominate where our best instinct already lives.
- **It carries the coach→roster network effect (§5) for free.** One coach = 30 athletes. The wedge
  segment *is* the distribution engine. A trainer with 50 clients is one sale that lights up 50 seats.
- **It tolerates the current product's honest gaps.** A coach accepts "nutrition accountability tool,
  not a performance system"; the *athlete* and the *college coach* reject exactly that framing
  (bait-and-switch / governance). So we win where the gap isn't disqualifying first.
- **It is the cheapest path to real proof (Rule #11).** A 30-athlete roster generates real
  execution-and-outcome data faster than any other entry, feeding the future Proof moat.

**Reconciling with the current trainer/coach build:** the app today is "an athlete app with a coach
skin" (persona review). The wedge is NOT the athlete and NOT the parent and NOT the non-athlete
weight-loss trainer — it is the **competitive-sport coach/performance-trainer specifically**, because
that is the persona for whom "athlete-coded" is a *feature*, not a bug. We make that persona first-
class and let the others stay honestly secondary until proof.

**The within-wedge beachhead order:** (1) private sports-performance / strength facilities (owner is
the buyer, decision is fast, no procurement, clients are often 18+ which sidesteps the minor-consent
blocker) → (2) HS competitive programs (bigger rosters, the credential story starts here, minor
consent becomes load-bearing) → (3) college/program tier (procurement, governance, the credential
endgame). We start where the sale is one conversation and the consent layer isn't the gate.

## 7. "Which markets should we intentionally IGNORE (for now)?"

We ignore — *deliberately, on the record* — the following, each with the trigger that un-ignores it:

- **The direct-to-consumer solo athlete / general-fitness consumer.** This is the MFP/Whoop graveyard:
  CAC-heavy, no network effect, no coach to anchor retention, and it pits us against free incumbents on
  their turf. *Un-ignore when:* a solo-buyer funnel is independently proven (Ratified s6 — reserve the
  `billing_rail` column, build IAP later). Note this contradicts the founder's instinct in §18.
- **Parents of minors as a primary buyer.** Weakest payer in the persona review (1/10) and gated by the
  minor-consent layer. Parents are a *viewer/consent* role in the graph, not a launch GTM segment.
  *Un-ignore when:* the HS cohort makes guardian consent a tailwind (the parent is already in the org)
  rather than a cold acquisition.
- **College / P5 programs and athletic departments.** Highest ACV, but procurement + FERPA/governance +
  multi-program tree (Phase C) make them a 12–18 month sale we are not staffed to win pre-proof.
  *Un-ignore when:* a real second org / department pulls the multi-org tree (architecture Phase C).
- **The non-athlete weight-loss / general-wellness market.** The Goal-Aware Intelligence architecture
  (§11b, the Context model) is *built to flex* here, but "design for many, ship two" (Rule #14) says we
  populate only athlete + general now. Chasing the weight-loss market head-on puts us against Noom/WW
  with a worse-funded product. *Un-ignore when:* a performance-trainer's mixed book (athletes + fat-loss
  clients) creates organic pull — i.e. the same buyer asks for it.
- **International / non-English, wearables-first, and academics/eligibility tracking.** All real 10-year
  surface; all `[DON'T BUILD YET]`. Seams reserved, implementations resisted.

**The discipline:** every ignored market has a *reserved seam* (a column, a profile entry, a flag) so
re-entry is a populate-the-table, never a rebuild — exactly the architecture set's "make the right 'no'
cheap" principle (`11-strategy-risks-decisions.md` §6).

## 8. "Which features create ENTERPRISE value?"

Enterprise value = what a program/department/franchise will sign a contract and clear procurement for.
Ranked:

1. **Org-keyed billing on active-participant metering with an immutable audit trail (D4, D6).** A
   department buys ONE contract covering many programs; the audit log answers "who changed my athlete's
   data and when" — the thing that clears legal. This is table-stakes for any sale above a single coach.
2. **Scoped, role-based staff access across a program/group tree (D2, D5; architecture 02).** Head
   coach, position coach, AD, and athletic trainer each see exactly their scope. No competitor's flat
   roster model expresses "the position coach sees only his group."
3. **Fail-closed, per-org consent + COPPA/FERPA governance (D7).** The college coach and the AD both
   named the *absence* of this as disqualifying. Its *presence* is enterprise value: it is what lets the
   product enter a compliance-bound institution at all.
4. **The Proof / outcomes dataset and exportable program-level reporting.** Evidence that a rising
   Development Score predicts real development — the asset sold to colleges, the credential market (§5).
   No nutrition product has it. This is the highest-ceiling enterprise feature and the slowest to earn.
5. **The portable athlete record at transfer/graduation (D1).** Counterintuitively an *enterprise*
   selling point: a college inherits a recruit's multi-year HS execution history as a join, not a
   migration — institutional value created by athlete ownership.
6. **Cross-program comparability of the score (D3).** An AD comparing football (protein-weighted) vs
   track (hydration-weighted) on one platform-default scale. Only possible because the formula is
   platform-owned.

## 9. "Which features create CONSUMER delight?"

Consumer delight = what makes the *athlete* (and secondarily the individual trainer/parent) feel the
product *understands and helps* them, not watches them. Ranked by the persona review's "most valuable"
signals:

1. **The AI meal-result coaching screen** — "reads like coaching, not a food log." Named most valuable
   by the trainer AND the athlete; the single surface that delivers standalone delight. Gated on real
   analysis + confidence labels (the headline gap).
2. **The Daily Game Plan + Projected ("Finish-Today") Development Score** — "I know exactly how to win
   today," and the projection turns a grade into a still-reachable target. Forward-looking, not a
   post-mortem. This is the signature (§20).
3. **The fast, respectful onboarding + immediate Starting Score + a first-meal +3 challenge** — the loop
   *works* in the first five minutes (persona review, Jayden). Activation delight.
4. **Honest voice that never fakes hype** ("You're behind today," not confetti) — earns trust, which for
   a teenager is itself delight (nobody is performing for them).
5. **Goal-aware adaptation (§11b)** — "this app understands me," not "this is an athlete app." Same
   screens, different brain, per Context.
6. **Recognition/celebration tied to *execution*, not logins** — the dopamine the accountability spine
   currently lacks (Constitution §7). Reward finishing the plan, not opening the app (Rule #4).

The tension with §2 (never a surveillance toy): every delight item must be *athlete-first framed*
("you control who sees this"), or it converts to dread. Delight and surveillance are the same data with
opposite framing; the copy is load-bearing.

## 10. "Which features should be REMOVED?"

Per Constitution §8 and the persona review's "kill all fabricated data," removed now:

- **All demo/"Sample" data anywhere a real user can see it (Rule #10).** The single most-cited persona
  problem ("nothing on screen is real"). The hardcoded 92% retention, `weightScore=95`, uniform +7 lb /
  12-day streak, the static `EAGLES24` code, the 4-item meal lookup, canned AI summaries. This is not a
  feature cut; it is a credibility gate. **Highest priority removal.**
- **Prominent PR / performance-tracking from the headline score (Ratified D3).** PRs stay on a separate
  page; they never fold into the daily Accountability Score. Keep performance minimal and decoupled.
- **The default-on leaderboard / squad surface.** Rated ≤4; "can distract from execution" and ranking
  pressure can shame (violates Rule #4). Ship opt-in, off by default, execution-metrics-only — or cut.
- **Unrestricted real-time chat / messaging as a launch feature.** Risk-laden (minor safety, moderation,
  legal); reserved behind a flag + relationship-gated RLS (D10). Not in the wedge.
- **Any AI surface that asserts confident conclusions off thin data** ("1-on-1 before Friday" regardless
  of roster; the templated team summary). Derive it from real signals or remove it (Rule #8).
- **Dead interactive affordances** (the no-op macro steppers / "Re-analyze") — an uncorrectable wrong
  number is a liability (Dana, RD). Either make them real or remove them.

## 11. "Which features should WAIT until after product-market fit?"

PMF = the wedge cohort retains the core loop (Rule #11). Until then, these wait — each with a reserved
seam so the wait is cheap (cross-ref `11-strategy-risks-decisions.md` §6):

| Waits until PMF | Why it waits | Reserved seam |
|---|---|---|
| Multi-org workspace switcher UI | 99% have one membership today | `ActiveWorkspace` ships inert (D5) |
| Full programs/groups/invitations tree | No multi-program customer yet | `org_memberships.scope_kind` models it as data |
| Bulk roster / SIS import | Zero department customers | `accept_invitation` dedupe path is the real seam |
| SSO / SCIM / public API | Zero enterprise customers | `identity_providers` / `api_clients` shapes reserved |
| Org branding beyond logo + accent | Enterprise v3 | `org_branding` accent token only |
| Consumer IAP rail (RevenueCat) | B2B-coach-led wedge | `billing_rail` column reserved (s6) |
| Vector/semantic AI memory | Safety risk; typed facts suffice | `retrieveForTask()` interface unchanged |
| Learned "who falls behind" predictor | No labeled outcome data yet | deterministic trend behind the same signature |
| Server-side score recompute / anti-tamper | No gaming threat; formula is pure | frozen `explain` blob is the seam |
| Wearable recovery into the score (D8) | Changes what the number means | `blendRecovery` pure seam, inert |
| Real two-way messaging delivery (D7/D10) | Legal review is the gate | `deliverMessage` inert behind `isBackendLive` |

**The one thing that must NOT wait:** the real meal-analysis vision model wired into the existing
`analyze-meal` seam. It is the headline of the consumer-delight pillar and the most-cited gap. It is not
a "wait"; it is the Phase-B unlock. (Architecture 05 already designs the Authority Boundary + confidence
floor + correction flywheel around it.)

## 12. "How do we become INDISPENSABLE to TRAINERS?"

**The "can't run my business without it" hook: between-session retention intelligence — the trainer
knows, the morning after, exactly which clients drifted and sends the right outreach in one tap, with a
documented trail.** A trainer's business *is* retention; clients churn in the gap between sessions where
the trainer is blind. We turn that gap from invisible to a ranked "who's slipping → nudge" list. The
day a trainer's renewal rate measurably rises because they caught the three drifting clients before they
quit, the product is load-bearing revenue, not a tool. (Persona: Marcus rated the triage shape his
exact workflow; the gap is making the data real + the action richer than a canned nudge.) **Requires:**
real data, a non-athlete `general` scoring profile (D9 Part B), and an action richer than a blind nudge
(an attachable note/message + trail).

## 13. "How do we become INDISPENSABLE to COACHES?"

**The hook: roster-wide accountability at a 3-second glance — the coach sees WHO needs help across 40
athletes without chasing anyone, and the athletes know the coach is watching, which changes behavior
before the coach lifts a finger.** A coach is accountable for the whole roster and has no time; the
Needs-Attention dashboard *is* how they triage. Indispensability is two-sided: the coach gets visibility
(the dashboard), and the athlete gets *watched accountability* (the behavior change). The coach can't go
back to flying blind once they've seen the one athlete slipping before it cost a game. **Requires:** real
roster ingestion, position-group segmentation + a "who hasn't logged today" view (persona: Tucker/Reyes
flagged scale + segmentation as the gap), and a lighter compliance signal than 40 teens photographing
every meal daily.

## 14. "How do we become INDISPENSABLE to GYMS?"

**The hook: the gym is an ORGANIZATION whose owner sees execution across every member and every trainer
on one contract — the facility's accountability layer becomes its retention engine and a differentiator
it markets.** "Everything is an org" (D2) means a gym is just a facility-scoped org: the owner sees
roll-ups across trainers, each trainer sees their book, and members get the daily loop. A gym's churn is
its existential threat; a facility that can *prove* it keeps members accountable between visits retains
better and can charge for it. The gym can't run its retention program without the layer once members
expect the daily plan and trainers run their books through it. **Requires:** the org roll-up view (the
Starter/Growth/Performance participant tiers, D4), trainer-scoped sub-rosters, and facility branding
(accent token only at first).

## 15. "How do we become INDISPENSABLE to NUTRITIONISTS?"

**The hook: the RD authors the plan and watches adherence between visits without attaching her license to
an AI number she didn't set — the platform enforces that her plan outranks the AI's general guidance, and
every macro is labeled estimate/confidence/correctable.** A dietitian's scarcest asset is her license and
her liability exposure (persona: Dana, the sharpest "no"). The scoring contract (§11a) is *built for her*:
she owns the plan; the AI is scoped to education that *defers to her plan* ("if a nutritionist set your
plan, theirs comes first," already shipped in D9); the formula is platform-owned so she's never blamed for
a weighting. Indispensable when her clients' between-session adherence is visible and *correctable* under
her authority — she can't get that liability-safe visibility anywhere else. **Requires:** real, editable,
confidence-labeled macros (the headline gap + Dana's hard requirement) and per-client plan/target authoring.

## 16. "What makes a customer say 'I can't imagine running my business without AthleteOS'?"

**When the Development Score becomes the shared language their operation runs on, and the between-session
visibility becomes a number on their P&L.** Concretely, the irreversible moment is when a coach/trainer/gym
runs their *weekly review* off our dashboard ("who's below 70, who slipped, who to call") — at that point
we are not a tool they use, we are the *operating procedure*, and removing us means re-inventing their
workflow. The deeper lock is economic: when a trainer can point to a retention lift or a coach to a
measurable development trend that *they can prove to a parent/AD/recruiter*, the product is tied to their
revenue and their credibility, not their convenience. The phrase we are engineering for is not "I like
this app" — it is "**this is how we run accountability here**," said about us the way a team says it about
their CRM.

## 17. "Which product decisions TODAY save us years of rebuilding later?"

These map 1:1 to the seven RATIFIED keystone decisions — that mapping is the point: the architecture team
already identified the irreversible decisions, the founder ratified them, and this is the strategic
restatement of *why each one saves years*:

1. **Athlete-owned data forever; orgs own access only (D1).** The keystone. An org-stamp would make
   transfer/graduation O(history) data copies and the portable-credential moat unbuildable — a full
   product rebuild. Saving: the entire moat (§3) and every multi-org scenario.
2. **One `org_memberships` grant as the single access primitive (D2).** Without it, every new relationship
   type is a schema migration + RLS edit + test sweep. Saving: the access model never fragments; "everything
   is an org" stays one code path.
3. **Platform-owns-the-formula scoring integrity, no per-coach re-weighting (D3).** A per-coach formula kills
   comparability and the Proof pillar irreversibly (reputationally). Saving: the score stays a credential
   (§3 multiplier), which is the thing the whole §5 credential network effect rests on.
4. **Org-keyed entitlements, pricing-as-data (D4).** Person/athlete-keyed billing breaks transfer + multi-org
   + department purchasing and double-bills; pricing-in-code means an app release per price change. Saving:
   live-billing re-migration (the one data you can't afford to get wrong) and FTC/ARL agility.
5. **Athlete picks ONE primary plan that drives the score (D5).** Resolves "whose plan governs" across
   conflicting orgs with one rule, server-validated narrowing. Saving: three inconsistent implementations of
   "which plan governs" and a privilege-escalation hole.
6. **DB-enforced immutable audit (D6).** App-enforced append-only is one bug from a rewritten audit trail in a
   minor-facing health product. Saving: a legal/trust catastrophe and a retrofit nightmare.
7. **Fail-closed, per-org consent; verifier ≠ viewer (D7).** A UI-only or global consent gate is a COPPA
   violation waiting for any non-UI path. Saving: regulatory existential risk; consent re-prompts on transfer.

**The meta-decision (the eighth):** keep `src/core` pure and every new capability an inert seam first (the
`consent.ts`/`subscription.ts` discipline). This is the decision that makes every "wait" in §11 a flag flip
instead of a rebuild. It is not a keystone decision in the memo, but it is the practice that *protects* all
seven.

## 18. "Which assumptions is the founder making that are WRONG?" — Where we push back (the heart of the mandate)

We owe the founder bluntness, not agreement. Five assumptions we believe are wrong or dangerously risky,
each with a recommended alternative:

**A. WRONG: that nutrition logging (especially daily teen meal-photo logging) will sustain the core loop at
HS scale.** The persona review's most load-bearing finding (Tucker, Jayden): the entire engine assumes 40
teenagers voluntarily photograph every meal daily — *which will not happen.* If the loop depends on it, the
HS wedge's dashboard is empty by week two. **Recommended alternative:** the primary daily execution signal
must be a **lightweight, sub-30-second commitment/check-the-plan action** (did you hit your plan today: yes/
no/partial + optional photo), with meal-photo analysis as the *rich, optional* layer for motivated athletes
and the trainer/RD segments. Design the score so it's *honest at low logging volume* (incomplete reads as
incomplete, already a principle) and so a coach gets a usable roster signal even when only 60% logged richly.
Otherwise we have built a Ferrari engine that needs a fuel the wedge won't pour.

**B. RISKY: that the consumer / "everyone" market is a near-term opportunity (the §11b "design for many"
instinct over-applied).** The Goal-Aware architecture is *correctly* built to flex to N user types — but the
founder's enthusiasm for breadth ("AthleteOS is NOT an athlete-only app") risks being read as a GTM mandate.
It is not. **Recommended alternative:** hold "design for many, ship two" (Rule #14) as *architecture only*.
Going wide before the coach-led wedge retains burns CAC against free incumbents with no network effect. Win
one segment so completely it becomes the reference case; let breadth be *pulled* by the wedge buyer (a trainer
with a mixed book), never *pushed*. We push back specifically on any roadmap item justified by "but the
architecture supports it" — capability is not strategy.

**C. WRONG: that the Development Score can be both a rich performance credential AND honest today.** The
athlete and both sport coaches called the current score a *bait-and-switch*: sold as performance/development,
delivered as protein + meals + a mood slider + a frozen weight stub. There is a real contradiction between
"own the development-score *category*" (the §20 ambition) and "the score honestly measures only nutrition
execution today." **Recommended alternative:** **rename what we measure to match what it is, and grow the name
with the substance.** Brand it precisely — "**Execution Score**" or "**Nutrition Development Score**" — until
real performance/recovery signals earn the broader "Development Score." Owning a *narrow, honest* category
("nutrition execution") and expanding it beats claiming a broad category we can't yet back — because the first
fabricated authority is where trust cracks (the Daily-Game-Plan guardrail says this exactly). We can plant
"Development Score" as the *destination word* in marketing while the *in-product number* is honestly scoped.
This is the sharpest disagreement in the doc (see §closing).

**D. RISKY: that coaches won't demand per-coach scoring control, and that holding the line costs us nothing.**
The founder ratified no-per-coach-formula (D3) — correct, and we defend it. But the assumption that it's
*costless* is wrong: real coaches *will* ask "why can't I weight it my way," and some will walk. **Recommended
alternative:** accept the cost explicitly and arm the sales motion: lead with "your '84' means the same thing
a college recruiter will read" (the integrity *is* the value prop), give coaches the maximum *legitimate*
control we already have (targets, profile, on/off relevance, weights within rails), and be willing to lose the
coach who wants a vanity formula. We push back on any pressure to soften D3 under sales objection — that is the
§5↔§6 tension, and we resolve it *in favor of integrity, every time.*

**E. RISKY: under-pricing the org tiers and over-trusting the "athlete never pays" model as a growth lever
without a conversion engine.** Org pricing is solid as *structure* (active-participant metering, D4). But
"athletes never pay while attached to an active org" + "individual $14.99" creates a **graduation cliff**: the
moment an athlete leaves the org, they either pay $14.99 or churn — and we have no proven conversion motion for
that hand-off. **Recommended alternative:** treat the **graduated/transferred athlete as a distinct, designed
conversion surface** (the portable record is the hook — "keep your history, keep your score"), and price/package
that moment deliberately rather than assuming the org model covers it. The portable-data moat is *also* our best
consumer conversion lever; we're currently leaving it as an architecture fact instead of a revenue motion.

## 19. "If we only had 12 FLAGSHIP features for the next five years, what should they be?" — and why

Twelve, each mapped to a **pillar** and the **segment it wins**. (Pillars per Constitution §2:
Accountability, Decision/Intelligence, Human Connection, Proof.) This is the five-year flagship set the
Roadmap doc must protect against feature creep.

| # | Flagship feature | Pillar | Segment it wins | Why it makes the list |
|---|---|---|---|---|
| 1 | **The Development Score (platform-owned, portable, watched)** | Accountability + Proof | All | The signature credential; the moat made visible (§3, D1/D3). |
| 2 | **The Daily Game Plan + Finish-Today projection** | Accountability + Decision | Athlete | The signature ritual; "how to win today," forward-looking (§20). |
| 3 | **Real meal-photo → analysis (vision + confidence + correction flywheel)** | Intelligence | Athlete + RD + trainer | The headline consumer-delight surface; the data flywheel's fuel; the most-cited gap. |
| 4 | **The intervention dashboard (Needs-Attention → one-tap action + trail)** | Accountability + Human Connection | Coach + trainer + gym | The 3-second triage; the indispensability hook for every pro segment (§12–14). |
| 5 | **Coach plan authoring + targets/relevance within evidence rails** | Human Connection | Coach + RD | The coach owns the plan (§11a); the labor that creates switching cost (§4). |
| 6 | **Lightweight daily execution commitment (the low-friction loop signal)** | Accountability | Coach (HS scale) | Fixes the §18-A logging-dependence flaw; keeps the dashboard alive at teen scale. |
| 7 | **The Decision Engine (eat-anywhere: restaurants → gas station → travel → pantry)** | Decision + Intelligence | Athlete + consumer | "What do I eat *here*"; the daily decision-fatigue killer; expands the Restaurant Coach. |
| 8 | **Portable multi-org profile + workspace switcher** | Accountability (continuity) | Athlete + multi-org | The compounding moat made usable; unlimited orgs, one profile (D1/D2). |
| 9 | **Goal-Aware Context engine (one app, many brains)** | Intelligence | All segments | Same interface, personalized intelligence (§11b); the breadth seam, populated as proof lands. |
| 10 | **Recognition / execution-streak engine (dopamine for finishing the plan)** | Accountability + Human Connection | Athlete | The missing reward layer (§9); rewards execution not logins (Rule #4). |
| 11 | **The Proof / outcomes engine (does a rising score predict development?)** | Proof | College + program (enterprise) | The credential's substantiation; the enterprise/credential-market asset (§8, §5). |
| 12 | **Org governance + consent + audit + role-scoped staff access** | (cross-cutting) | Enterprise (program/gym/college) | The procurement-clearing layer; enterprise value (§8, D2/D6/D7). |

Deliberately **not** on the list (so the Roadmap can cite the exclusions): real-time chat, leaderboards,
SSO/API, wearables-as-score, bulk SIS import, custom per-org roles — all valuable, all `[DON'T BUILD YET]`,
all reserved seams (§11).

## 20. "What should become the SIGNATURE experience everyone associates with AthleteOS?"

**The morning Daily Game Plan built around your Development Score — and specifically the Finish-Today
projection: every morning the app tells you the one number, the one focus, and exactly how to still win
*today*, and you know the person invested in you is watching you do it.** We argue for this over the two
alternatives:

- *Why not the meal-photo analysis?* It is the most *delightful* surface (§9) and the headline feature — but
  it is reactive (it tells you about a meal you already ate), it is a moment many *competitors* also own (every
  tracker has a log screen), and it is not yet real. A signature must be *ours alone* and *forward-looking*.
- *Why not the intervention dashboard?* It is the indispensability hook for *pros* (§13) — but the signature
  must be the thing the *whole market* associates with us, and a coach-only dashboard isn't seen by athletes,
  parents, or the public. The signature has to live where the brand-defining emotion lives: the athlete's morning.

The Daily Game Plan wins because it is the only experience that is simultaneously: **(a) forward-looking**
(how to win today, not how you did yesterday — the Whoop-Recovery-style reframe), **(b) ours by construction**
(it's built on the platform-owned Development Score nobody else can replicate, §3), **(c) watched** (the
visibility to the invested human *is* the accountability that changes behavior — the moat and the emotion in
one), and **(d) the home of the loop** (Plan → Execute → Reflect → Connect → Prove starts here every day). We
plant one word in the market — **the Development Score** — the way Whoop planted "Recovery," and the one
unforgettable moment is: *"Every morning AthleteOS tells me exactly how to win the day, and my coach is
watching me do it."* (Honest-naming caveat from §18-C applies: in-product, the number is precisely named to its
current substance; "Development Score" is the destination brand we grow into, not a claim we make before the
signals back it.)

---

## The five decisions that matter most (distilled from the 20)

1. **Athlete-owned, portable data and score history is the company.** It is the #1 moat (§3), the deepest
   switching cost (§4), the compounding network effect (§5), and the keystone architecture decision (§17/D1).
   Everything else is downstream. Never stamp athlete data with an org; never let the score be non-portable.

2. **Win the competitive-sport coach / performance-trainer wedge so completely it becomes the reference case —
   and ignore everyone else on purpose, with reserved seams.** One segment, dominated; breadth *pulled*, never
   *pushed* (§6, §7, §18-B). Capability is not strategy.

3. **Protect the score's integrity as a credential over any single sales deal.** Platform owns the formula; no
   per-coach re-weighting; rename the number to match its honest substance and grow the name with the signals
   (§3, §18-C, §18-D, D3). The score that means the same thing everywhere is the entire long-term game.

4. **Fix the loop's fuel before widening: replace fragile daily teen meal-photo dependence with a low-friction
   daily execution commitment, and make the meal analysis real.** The wedge dies if the dashboard goes empty
   (§18-A, §11, flagship #3/#6). This is the gating product fix between today and PMF.

5. **The signature is the morning Daily Game Plan + Finish-Today projection, watched by the invested human.**
   Forward-looking, ours by construction, and the home of the loop (§20). Plant "the Development Score" the way
   Whoop planted "Recovery."

---

### Cross-doc dependencies the other founding docs MUST honor

- **Constitution doc:** must carry §18-C forward — the in-product number is named to its honest substance
  ("Execution / Nutrition Development Score") while "Development Score" is the destination brand. This sharpens,
  does not contradict, Constitution §3/Rule #9.
- **Architecture doc:** must treat §17's mapping as canon (the seven keystone decisions = the irreversible set)
  and §11's reserved-seam table as the "don't build yet" contract; must add the **low-friction daily execution
  commitment** (§18-A, flagship #6) as a first-class score input alongside meal logging.
- **Pricing/GTM doc:** must (a) honor org-keyed pricing-as-data (D4) and the wedge order in §6; (b) design the
  **graduated/transferred-athlete conversion surface** as a deliberate revenue motion off the portable record
  (§18-E), not assume the org model covers it; (c) hold the "ignore" list in §7 as GTM scope, with each ignored
  market's un-ignore trigger.
- **Roadmap doc:** must protect the 12 flagship features (§19) against creep, sequence them behind the
  Phase A/B/C discipline (`11-strategy-risks-decisions.md` §8), and gate every §11 "wait" item on the named
  trigger — meal-analysis-real and the low-friction loop signal are Phase-B unlocks, not "waits."
