# 01 — The Product Constitution (the founding charter)

> **Status:** FOUNDING CHARTER — the board-level document that states what OnStandard *is*, why it
> exists, and the principles and non-negotiables every other document and every feature is tested
> against. Authored 2026-06-29 in the voice of the executive leadership team, ratified on the record.
>
> **Relationship to the existing `docs/PRODUCT-CONSTITUTION.md` (READ THIS FIRST):** the existing
> Product Constitution is the **engineering rulebook the crew codes against** — its 5 pillars, the
> §11a Scoring Contract, §11b Goal-Aware Intelligence, the §12 Product Principles, the 14 Founder
> Rules, and the feature-to-pillar matrix are the operative law of the product, and **nothing in this
> charter overrides them.** This charter sits one altitude above: it is the *constitutional preamble*
> — the vision, mission, philosophy, the *meaning* of the pillars, the company principles, and the
> bright-line non-negotiables — that the rulebook implements. Where this document and the engineering
> rulebook touch the same subject, **this elevates and subsumes; it does not contradict.** When a
> reader needs "what do we believe and what will we never do," they read this. When an engineer needs
> "what exactly do I build and how is the score weighted," they read `docs/PRODUCT-CONSTITUTION.md`.
> This charter also inherits the 20 strategic calls in `docs/founding/00_STRATEGIC_QUESTIONS.md` and
> the seven RATIFIED keystone decisions in `docs/architecture/DECISION-MEMO.md` as canon.

---

## 0. Why this document exists

A constitution's real job is to be **the thing you say *no* with.** A company with no charter ships
whatever the loudest customer, the newest competitor, or the most exciting demo demands — and becomes
a pile of features with no center of gravity. This document gives OnStandard a center of gravity that
survives founders changing their minds, investors pushing for breadth, and engineers who can build
anything. Everything below is a *filter*, not a *menu*. If a proposed feature, deal, or pivot cannot
pass these filters, the correct answer is no — even when it is convenient, even when it is profitable
this quarter, even when "the architecture supports it."

---

## 1. Vision

**OnStandard becomes the operating system for human execution — the system of record for *"did the
plan get done, and did it work,"* starting in nutrition.**

The endgame, stated as a test rather than a slogan: **a college recruiter one day asks for an
athlete's OnStandard execution history the way they ask for a transcript or a 40 time.** We have won
when the *number we own* is cited by people who never installed our product — when a portable,
athlete-owned execution credential follows a person from an 8th-grade strength coach to a Power-5
program to a pro front office, the way a credit score follows a consumer or a Whoop Recovery score
follows a body. (`00_STRATEGIC_QUESTIONS.md` §1.)

We are not building an app that people open. We are building **infrastructure that people cite.**

## 2. Mission

**OnStandard exists to ensure people consistently EXECUTE the plans created by the people invested in
their success.** This is the founder's canon and it is the whole company in one sentence.

Everyone an athlete trusts — coach, parent, dietitian, trainer — creates plans. Almost nobody ensures
they get *done.* OnStandard is the layer between **intention and execution**: it makes the right next
action obvious, makes doing it rewarding, and makes execution **visible to the people invested in that
athlete.** Trackers own *measurement*; we own *did-the-plan-get-done — and can you prove it.*

**Nutrition is execution domain ONE** — not the mission, the *beachhead*. Nutrition is daily,
measurable, and emotional: the perfect proving ground for a system that will eventually govern
training, recovery, return-to-play, and beyond. The mission is execution; nutrition is where we earn
the right to it.

## 3. Product Philosophy — *familiar interface, changing intelligence*

Three beliefs define how OnStandard is built. They are the soul of the product.

### 3.1 The plan is not the product. Executing the plan is.
We do not compete on plan *creation* (coaches, RDs, and trainers already do that brilliantly) or on
*measurement* (MyFitnessPal and Apple Health already won "log it"). We compete on the gap nobody owns:
the distance between a plan a trusted human set and a human actually doing it, day after day, with
proof. Every feature must move **execution.** A smart recommendation that doesn't get executed is
worthless to us.

### 3.2 One codebase, many brains — the interface stays familiar, the intelligence changes.
This is the philosophical heart, and it is the successor to "is this an athlete app or an everyone
app?" The answer: **the same screens for everyone; a different brain underneath.** A 16-year-old
linebacker, a busy professional, a weight-loss client, and a college track athlete all see the same
interface (Today / Log / Progress / Coach) — but the coaching language, the recommendations, the
accountability emphasis, the education, and which cards surface all **adapt to who the user is and what
they're trying to do.** The user must never think *"this is an athlete app."* They must think *"this
app understands me."* (This is the operative content of the engineering rulebook's §11b Goal-Aware
Intelligence and the Context model; this charter declares it a founding philosophy.)

The discipline that protects this: **design for many, ship two.** The architecture flexes to N user
types as *data* (add a profile entry, never a code path); we *populate* only the profiles the current
wedge needs — today, athlete + general. **Breadth is an architecture property, never a go-to-market
mandate.** (Founder Rule #14.) See §7 push-back B: capability is not strategy.

### 3.3 Context-aware, never context-free.
Every adaptive surface reads from **one** context object — who the user is, their goal, who guides
them, the plan they're on, today's state. Scoring, copy, recommendations, and card selection all read
the *same* context, so they can never disagree about who the user is. Intelligence that doesn't know
the user's context is not intelligence; it's a generic chatbot, and we are explicitly not that.

## 4. The Product Pillars — what each MEANS and how a feature is tested against it

These are the five pillars of the engineering rulebook, elevated here with a **definition** and a
**concrete test.** A feature earns its place only by strengthening at least one. The pillars are
ranked: **when two conflict, the higher one wins.**

> **Naming reconciliation (load-bearing).** The engineering rulebook names the second pillar
> "Decision Engine & Intelligence" (one capability seen twice) and the third "Human Connection." This
> charter uses the founder's five-name framing — **Intelligence, Accountability, Decision Making,
> Human Coaching, Measurable Results** — and maps them explicitly so the two documents never drift:
>
> | Charter pillar (founder's five) | Engineering-rulebook pillar | Hierarchy rank |
> |---|---|---|
> | **Accountability** | Accountability — *the spine* | **1 (wins ties)** |
> | **Intelligence** | Intelligence (the capability half of the engine) | 2 |
> | **Decision Making** | Decision Engine (the applied-output half of the engine) | 2 |
> | **Human Coaching** | Human Connection — *the moat & distribution* | 3 |
> | **Measurable Results** | Proof — *the endgame* | 4 |
>
> Intelligence and Decision Making are **one system seen twice**: Intelligence is the capability,
> Decision Making is its applied output ("what do I do *now?*"). They share rank 2 and exist to *serve*
> Accountability.

### 4.1 ACCOUNTABILITY — the spine (rank 1, wins all ties)
**Means:** the product makes execution *visible* to the person invested in the athlete, and rewards
the *doing* of the plan — not the perfection of it, not the opening of the app. Accountability is the
mission made mechanical.
**Test:** *Does this feature increase the odds that the plan actually gets done today, OR make whether
it got done visible to someone who cares?* If neither, it is not an accountability feature, whatever it
claims. (Reward executing the plan, not logging in — Founder Rule #4.)

### 4.2 INTELLIGENCE — the engine's capability (rank 2)
**Means:** the smartest nutrition (and later, execution) intelligence ever built, getting smarter
every day from real execution data — but **never** a model that invents the plan, the score, or a
safety-bounded number. Intelligence *phrases and refines*; it does not *dictate*.
**Test:** *Does this make the system understand the user or the domain better — derived from real
signal, with honest confidence — without ever asserting a confident conclusion off thin data?* An
intelligence feature that hallucinates fails the test by definition. (Never call it AI until a model is
actually doing the work — Rule #8.)

### 4.3 DECISION MAKING — the engine's output (rank 2)
**Means:** eliminate decision fatigue. Answer exactly one question — *"what do I do next, here, now?"*
— with one clear, easy action. The Decision Engine is Intelligence surfaced in context (the restaurant,
the gas station, the travel day, the pantry), not a separate tab.
**Test:** *Does this reduce the number of decisions the user has to make, and end with exactly ONE
obvious next action?* If a feature *adds* choices, it fails — even a "helpful" one. (Reduce decisions,
never add choices — Rule #5; every screen answers "what's next?" — Rule #7.)

### 4.4 HUMAN COACHING — the moat and the distribution (rank 3)
**Means:** strengthen the athlete↔coach↔parent↔RD relationship, and **amplify** the human — never
replace them. This is also *how we spread* (one coach brings a whole roster) and *how we retain* (the
relationship is the anchor). The AI is the coach's amplifier, never their substitute.
**Test:** *Does this make the invested human more present, more effective, or more able to act — without
ever standing in for their judgment?* Any feature that replaces a human coach's decision (sets a minor's
target, overrides an RD's plan) fails categorically. (Never replace the coach — Rule #3.)

### 4.5 MEASURABLE RESULTS (PROOF) — the endgame (rank 4)
**Means:** become the evidence engine behind athlete development — proof that a rising execution score
predicts real development. Weakest today (near-zero outcome data), deepest defensibility long-term.
**Proof is *earned* by running the loop with real people — it cannot be built in a sprint.**
**Test:** *Does this contribute to a defensible, outcome-linked body of evidence — or is it a vanity
metric that looks like proof?* A number that goes up but predicts nothing fails. (Validate the loop
before you widen it — Rule #11.)

### The Product Decision Filter (apply to every request)
> Does it make OnStandard **smarter** (Intelligence), **improve accountability**, **reduce decision
> fatigue** (Decision Making), **strengthen the coaching relationship** (Human Coaching), or **produce
> measurable results** (Proof)? **If the answer is "no" to all five — do not build it.** (Rule #1.)

## 5. Company Principles (how we operate as a company)

1. **Become infrastructure, not an app.** We optimize for the number people cite, not the MAU we
   report. We measure success in *credentialed history*, not *meals logged*.
2. **Win one segment so completely it becomes the reference case.** Breadth is *pulled* by a customer,
   never *pushed* by a roadmap. Capability is not strategy. (`00` §6, §18-B.)
3. **Make the right "no" cheap.** Every market and feature we defer gets a *reserved seam* (a column, a
   flag, an inert interface) so re-entry is a populate-the-table, never a rebuild. We keep `src/core`
   pure and ship every new capability as an inert seam first. (`00` §17 meta-decision.)
4. **Honesty is positioning.** We never fake data, never fake AI, never inflate a number, never
   manufacture hype. "You're behind today" beats confetti. Trust is the product; the first fabricated
   authority is where it cracks. (Rules #8, #10.)
5. **Optimize for long-term competitive advantage over short-term convenience.** We will lose
   individual deals rather than fragment the score, take the slower honest build over the faster
   fragile one, and protect the moat over the quarter. (Founder mandate.)
6. **Be a board, not a yes-man.** Every founding document names the assumptions we believe are wrong
   and gives the alternative. Agreement-by-default is a failure of duty. (§7 below.)
7. **When in doubt, do the smaller thing exceptionally well.** (Rule #12.)

## 6. The NON-NEGOTIABLES (the bright lines)

These cannot be traded away for a deal, a quarter, or a pivot. They are the constitution's teeth. Each
is locked to a ratified decision so it is architecture, not aspiration.

1. **Athletes own their data FOREVER; organizations own ACCESS only.** No org may trap, copy, delete,
   or inherit an athlete's history. Graduation and transfer lose *nothing*. The day an org can own an
   athlete on its behalf, we have become the team-software incumbent we exist to displace. *(Ratified
   D1 — the keystone. `00` §2, §3, §17.)*

2. **Scoring integrity is sacred: the coach owns the PLAN, the platform owns the FORMULA, the AI
   RECOMMENDS.** The coach/trainer/RD sets targets, the scoring profile, and which components are
   relevant. The **platform** owns the weights, the 0–100 scale, and the band language — customizable
   *only within evidence-based rails* (Protein 10–40, Meal Consistency 20–40, Hydration 10–25, Recovery
   10–25, Coach Compliance 10–40, Sport-specific 0–20). **No per-coach formula. Ever.** An "84" must
   mean "84% execution of *your* plan" for everyone, or it means nothing. The athlete picks **ONE
   primary plan** that drives their score. *(Ratified D3/D5; engineering rulebook §11a. `00` §3, §18-D.)*

3. **AI recommends; the human decides. The model never invents a number a person acts on.** The AI
   phrases and refines coaching over real context; it never sets a minor's calorie target, never
   re-weights the formula, never overrides a professional's plan. Target *recommendation* stays
   evidence-based deterministic math. The moment a model hallucinates a number a 15-year-old acts on,
   the brand is over. *(Rules #3, #8, #13; engineering rulebook §11a/§11b.)*

4. **Consent is fail-closed and per-organization; the verifier is never the viewer.** Absent explicit,
   per-org, COPPA/FERPA-valid consent, access is **denied** — there is no UI-only or global gate, and no
   non-UI path around it. *(Ratified D7; `00` §8.)*

5. **The audit trail is immutable, DB-enforced.** Append-only enforced in the database, not the app —
   one bug must never be able to rewrite history in a minor-facing health product. *(Ratified D6.)*

6. **Execution over perfection.** We reward *finishing the plan*, not being flawless and not opening the
   app. The score must be **honest at low logging volume** (incomplete reads as incomplete) so a coach
   gets a usable signal even when not every athlete logged richly. *(Rules #4, #11; `00` §18-A.)*

7. **No vanity metrics. One number, protected.** One hero number, not four. We never fold performance/PRs
   into the daily score, never ship a default-on leaderboard that shames, never reward logins, and never
   let a metric that predicts nothing masquerade as proof. *(Rules #4, #9; engineering rulebook §8.)*

8. **Demo data never touches a real user.** Fabricated data anywhere a real user can see it is a
   credibility breach, not a placeholder. *(Rule #10.)*

9. **Honest naming of the score (the §18-C lock).** The *in-product* number is named to its honest
   current substance — **"Execution Score" / "Nutrition Development Score"** — until real
   performance/recovery signals earn the broader claim. **"Development Score" is the destination brand we
   grow into, planted in marketing, not a claim the in-product number makes before the signals back it.**
   *(`00` §18-C, §20; sharpens engineering rulebook §3/Rule #9 — does not contradict it.)*

## 7. Where we push back (the heart of the mandate)

The founder explicitly demands we challenge, not agree. The full five push-backs live in
`00_STRATEGIC_QUESTIONS.md` §18 and are inherited here. The two that bear directly on this *charter's*
framing — because they concern what OnStandard *says it is* — are restated and sharpened below.

### Push-back ① — "operating system for human performance" is scope creep, not focus.
**The founder's framing under challenge:** that OnStandard is the "operating system for human
performance" (or "human execution" stretched to mean everything a person does). **Our position: as a
*filter*, that phrase is too broad to be a real constitution** — a phrase you can justify *any* feature
against is a phrase that says no to nothing, and a constitution that says no to nothing is not a
constitution. "Human performance" would green-light wearables-as-score, sleep tracking, academics, and
mental-health surfaces tomorrow, each defensible, none focused.

**Our recommended alternative — the focusing distinction:** OnStandard is the operating system for
**execution and accountability** — *"did the plan get done, and did it work"* — and the **first
execution domain is nutrition.** "Human execution / many execution domains" is the **vision** (§1) —
the *destination* we expand into one domain at a time, *pulled by proof.* It is **not** a present-tense
license to build across performance. The bright line: a feature must strengthen one of the five pillars
**within the active execution domain (nutrition today)**; "it's part of human performance" is *not* an
admissible justification. We name the destination broadly to set ambition; we scope the *filter*
narrowly so it can do its only job — say no.

### Push-back ② — "OnStandard is NOT an athlete-only app" must stay an *architecture* statement, not a GTM one.
**The founder's framing under challenge:** the (correct) Goal-Aware insight that the product flexes to
many user types risks being read as a mandate to *go wide* — to chase weight-loss and general-wellness
consumers because "the architecture supports it." **Our position: capability is not strategy.** Going
broad before the coach-led wedge retains burns CAC against free incumbents (MFP, Noom, Whoop) with no
network effect and no coach to anchor retention — the consumer graveyard.

**Our recommended alternative:** hold "design for many, ship two" (Rule #14) as **architecture only.**
Win the competitive-sport coach / performance-trainer wedge (`00` §6) so completely it becomes the
reference case; let breadth be *pulled* by a wedge buyer (a trainer with a mixed book asking for it),
never *pushed* by a roadmap item justified by "the architecture supports it." We will reject any roadmap
item whose only rationale is capability.

> The remaining three inherited push-backs (briefly, so this charter is self-contained): **(A)** daily
> teen meal-photo logging will *not* sustain the loop at HS scale — add a **low-friction daily execution
> commitment** as a first-class score input (`00` §18-A). **(D)** holding the no-per-coach-formula line is
> *not costless* — arm sales to defend it; we lose the coach who wants a vanity formula rather than
> fragment the score (`00` §18-D). **(E)** the "athletes never pay" model has a **graduation cliff** —
> design the graduated/transferred athlete as a deliberate conversion surface off the portable record
> (`00` §18-E).

## 8. The Long-Term Vision — nutrition as the first of many execution domains

The decade arc, stated so the roadmap can protect it from both creep and timidity:

- **Domain 1 — Nutrition (now).** The beachhead: daily, measurable, emotional. We win the coach/trainer
  wedge, make the loop real, and earn the first execution-and-outcome data. The in-product number is the
  honestly-named **Execution / Nutrition Development Score** (§6.9).
- **Domain 2+ — Training, then Recovery, then Return-to-Play, then Academics/Eligibility.** Each is a new
  *execution domain* the same OS governs — *pulled in by proof*, not pushed by ambition. Each arrives as a
  reserved seam populated when a real customer pulls it, never a speculative build. (`00` §7, §11.)
- **The compounding asset across all domains — the portable, athlete-owned credential.** As domains
  accrete, the athlete's portable record deepens from a nutrition-execution history into a full
  development credential. **This is the moat that gets stronger every day for every athlete even when we
  ship nothing** (`00` §3), and it is the thing a recruiter eventually asks for by name (§1).

**The one line that governs the decade:** *OnStandard is the system that turns a trusted human's plan into
a person's daily execution — and proves it worked.*

---

### Cross-doc dependencies the other founding docs MUST honor

- **All docs:** treat the §6 NON-NEGOTIABLES as inviolable; treat §4's pillar **definitions + tests** as
  the Product Decision Filter; and carry §6.9 — the **in-product number is honestly named (Execution /
  Nutrition Development Score); "Development Score" is the destination brand**, not a present in-product
  claim (sharpens, never contradicts, the engineering rulebook §3 / Rule #9).
- **Architecture / Roadmap docs:** honor Push-back ① — a feature must strengthen a pillar **within the
  active execution domain (nutrition)**; "it's human performance" is not an admissible justification.
  Honor inherited Push-back A — the **low-friction daily execution commitment** is a first-class score
  input alongside meal logging (this charter ratifies execution-over-perfection at low logging volume,
  §6.6).
- **Pricing / GTM docs:** honor Push-back ② — breadth is architecture, not GTM; the consumer market is
  *pulled*, never *pushed*. Design the **graduation-cliff conversion surface** off the portable record
  (inherited Push-back E).
- **All docs:** this charter is the *preamble*; `docs/PRODUCT-CONSTITUTION.md` is the operative
  *rulebook*. Cite the rulebook for exact pillar weights, the §11a Scoring Contract mechanics, the §11b
  Context model, the matrix, and the 14 Rules. Do not duplicate them; build on them.
