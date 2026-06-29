# 05 — Synthesis & Challenges (the founding capstone)

> **Status:** FOUNDING CAPSTONE — the document that stands on top of the other four founding docs,
> states the company in one page, gives the reading order for the whole founding set, consolidates the
> red-team into one place, resolves the cross-doc tensions on the record, and names the *strategic*
> decisions the founder must still make. Authored 2026-06-29 in the voice of the **Founder + the VC
> partner**, ratified by the executive team. It does not re-derive any of the four docs below it; it
> **integrates** them and **judges** them.
>
> **What this doc adds that the others don't:** the other four each argue *their slice*
> (strategy / charter / architecture / commerce / sequence). This one is the only doc that asks
> *"do they all add up, where do they fight each other, and what is still un-decided?"* — and answers
> in the founder's own mandate: **be a board, not a yes-man.** The seven RATIFIED keystone decisions
> (`docs/architecture/DECISION-MEMO.md`, D1–D7) are canon and are never relitigated here; this doc
> challenges the **strategic** assumptions *around* them, which is a different and still-open surface.

---

## A. The company in one page (the executive thesis)

**Category.** AthleteOS is not a nutrition app and must never be priced, benchmarked, or pitched as
one. It is the **execution-and-accountability operating system** — the system of record for *"did the
plan a trusted human set actually get done, and did it work."* Trackers (MyFitnessPal, Cronometer,
MacroFactor) own *measurement*; team software (TeamSnap, Hudl, Teamworks, Trainerize) owns the *org's
record*; we own the gap nobody owns and nobody can copy without rebuilding their data model: **the
athlete's portable execution credential and the coach→athlete→org graph that carries it.**

**The moat (ranked, because "everything matters" is useless).** **#1 — the portable, athlete-owned
profile + score history that compounds across every org an athlete ever joins.** It is the only moat
that gets stronger every day for every athlete *even when we ship nothing*, because a competitor would
have to own the athlete's *past* — which their org-stamped model structurally cannot (architecturally
locked by Ratified **D1**, the keystone). **#2 — the org graph** (one coach brings 30 athletes; one
athlete in six orgs is six switching costs) — copyable in principle, uncopyable in practice because it
rides on top of moat #1. **#3 (the multiplier, not a standalone moat) — the platform-owned formula**
(D3): without it an "84" is relative and gameable, and a portable score that means nothing is portable
*nothing*. The formula is the integrity that makes the data moat *bankable*.

**The wedge.** The **competitive-sport coach and the sports-performance / strength facility (the gym)**
running a roster of ~15–40 athletes, sold a **nutrition-accountability + retention tool**, explicitly
NOT a performance system. The within-wedge order: **(1) private performance/strength facilities** (the
owner is the buyer, the sale is one conversation, no procurement, clients often 18+ so consent isn't
the gate) → **(2) HS competitive programs** (the credential story begins, consent becomes load-bearing)
→ **(3) college / department** (procurement, FERPA; pulled, never pushed). The gym is the
beachhead-of-the-beachhead *and* the distribution channel into the consumer market we refuse to acquire
head-on.

**The 5-year bet.** That we can grow **one narrow, honest number** ("Execution Score" / "Nutrition
Development Score" today) into a **portable development credential** that people who never installed the
product cite — the day a college recruiter asks for an athlete's AthleteOS score history the way they
ask for a transcript or a 40 time, we are infrastructure, not an app. We earn that by winning the
coach/gym wedge so completely it becomes the reference case, protecting the score's integrity over
every single sales deal, and letting breadth be **pulled** by customers, never **pushed** by a roadmap.
**The one line that governs the decade:** *AthleteOS turns a trusted human's plan into a person's daily
execution — and proves it worked.*

---

## B. The founding set — index & reading order

The founding set (`docs/founding/`) is five documents at **board altitude**. Beneath them sit two
deeper layers: the **operative engineering rulebook** (`docs/PRODUCT-CONSTITUTION.md` — exact pillar
weights, the §11a Scoring Contract, §11b Context model, the 14 Founder Rules) and the **10-year slice
architecture** (`docs/architecture/00`–`11` + `DECISION-MEMO.md` + `PHASE-A-LOG.md`). The founding set
**elevates and integrates**; it never overrides the rulebook and never re-derives the slices.

**Reading order (for a new exec, board member, or investor):**

| Order | Doc | What it answers | Read it when you need… |
|---|---|---|---|
| **0** | **`05` — this doc** | Does it all add up? What's still un-decided? | The 15-minute "what is this company and what's the fight." |
| **1** | `01_PRODUCT_CONSTITUTION` | What *is* AthleteOS; what will it never be? | The vision, mission, pillars, and the bright-line non-negotiables. |
| **2** | `00_STRATEGIC_QUESTIONS` | The 20 load-bearing strategic *calls* | Why the wedge, the moat ranking, the ignore-list, the 12 flagships, the signature. |
| **3** | `02_ENTERPRISE_ARCHITECTURE` | How is it built to last 10 years? | The one access primitive, the one formula, the one ownership split; gyms-as-orgs; the scale cliffs. |
| **4** | `03_PRICING_AND_GTM` | Who do we sell to, in what order, at what price? | The tiers-as-data, the buyer/user/payer split, the gym channel, the graduation conversion. |
| **5** | `04_PRODUCT_ROADMAP` | What ships when, and what gates the next phase? | The MVP→Beta→V1→V2→V3 gate ladder and the honest human critical path. |

**How the founding set relates downward.** `01` (charter) is the *preamble* to
`docs/PRODUCT-CONSTITUTION.md` (the *rulebook*) — cite the rulebook for the exact weights and the §11a
mechanics. `02` (architecture synthesis) is the board-readable abstraction of
`docs/architecture/00`–`11`; the seven keystone decisions (D1–D7) and seven invariants (I1–I7) flow up
from `DECISION-MEMO.md` and are treated as canon everywhere. The dependency arrows run **strategy →
constitution → architecture → pricing → roadmap**, and every doc closes with the cross-doc
dependencies it imposes on the others — those are the contract this capstone enforces in §D.

---

## C. The consolidated red-team (the heart of the mandate)

This is the founder's explicit demand made into one section: the **sharpest challenges to the founder's
own assumptions**, gathered from all five docs and stated in the VC partner's voice. Each is: the
**assumption**, **why it may be wrong**, the **recommended alternative**, and the **cost of getting it
wrong**. These are *strategic* challenges — they sit **on top of** the seven ratified keystone
decisions (which we defend), not against them. Where a doc already raised a version of the challenge,
this consolidates and sharpens it; where the docs were silent, this adds it.

### RT-1 — "Nutrition is a big enough first domain to build a category-defining company on." *(NEW — the one the docs danced around)*
- **Assumption:** that nutrition accountability is a large enough beachhead to support the
  infrastructure ambition — that we can be a venture-scale company on "did you eat your plan."
- **Why it may be wrong:** the docs are internally honest that nutrition is "domain one," but **none of
  them sizes the wedge.** A roster of 15–40 athletes at $5–$8/athlete/mo is a *small ACV*; the gym tier
  tops out at $799/mo. If the multi-org density (the compounding network effect) is slower to arrive
  than assumed — and it will be, because density requires *years* of athletes accumulating across orgs
  — the company could spend its entire runway in a market that is real but **not yet venture-sized**,
  with the credential endgame (the thing that justifies the valuation) still 4–5 years out.
- **Recommended alternative:** be explicit that **the bet is on the credential, not the nutrition TAM**
  — and therefore **instrument the leading indicator of credential value from MVP**: multi-org density
  (what % of new athletes are *already on the platform*). If that curve is flat at 18 months, the moat
  is not compounding and the strategy must be revisited *before* the runway demands it. Treat the
  nutrition wedge as the *cash engine* that funds the *credential bet*, and never conflate the two in a
  board deck.
- **Cost of getting it wrong:** raising and spending against a category ("operating system for human
  performance") whose first domain can't sustain the burn, then discovering the network effect is a
  decade-flow not a year-flow — the classic "great moat, wrong clock" death.

### RT-2 — "Daily teen meal-photo logging will sustain the core loop." *(from `00` §18-A, `04` §7-C — escalated to #2)*
- **Assumption:** that the engine can rely on 40 teenagers voluntarily photographing every meal daily.
- **Why it may be wrong:** they will not. This is the single most load-bearing product risk in the
  entire set, and three docs flag it. If the loop depends on rich logging, the coach's dashboard is
  **empty by week two** and the MVP gate fails *for the wrong reason* (no signal, not no value).
- **Recommended alternative (the docs already commit this — we make it non-negotiable):** the
  **low-friction daily execution commitment** (did you hit your plan: yes/no/partial, sub-30s) is the
  **PRIMARY** loop signal; meal-photo analysis is the **rich, optional** layer for motivated athletes
  and the trainer/RD segments. The score must read **honestly at low logging volume** (incomplete =
  incomplete) so a coach gets a usable roster signal at 60% rich-logging.
- **Cost of getting it wrong:** we ship a Ferrari engine that needs a fuel the wedge won't pour, the
  beta dies of an empty dashboard, and we mis-diagnose a *fuel* problem as a *value* problem and start
  adding features instead of fixing the signal — burning the beta cohort we cannot easily re-recruit.

### RT-3 — "The Development Score can be both a rich development credential AND honest today." *(from `00` §18-C — the sharpest naming call)*
- **Assumption:** that we can call the in-product number a "Development Score" now.
- **Why it may be wrong:** today it measures protein + meal consistency + hydration + a mood slider —
  *nutrition execution*, not development. The athlete and both sport coaches called the current framing
  a **bait-and-switch**. The first fabricated authority is exactly where a minor-facing trust brand
  cracks.
- **Recommended alternative:** **name the in-product number to its honest substance** — "Execution
  Score" / "Nutrition Development Score" — and **grow the name with the signals.** "Development Score"
  is the *destination brand* we plant in marketing and earn at V3 when real performance/recovery
  signals back it. Owning a *narrow, honest* category and expanding it beats claiming a broad one we
  can't yet substantiate.
- **Cost of getting it wrong:** the credential — the entire 5-year bet — dies of a credibility crack
  in year one, and a credential brand cannot recover from "the number lied."

### RT-4 — "Breadth is a near-term opportunity because the architecture supports it." *(from `00` §18-B, `01` Push-back ②)*
- **Assumption:** that "AthleteOS is NOT an athlete-only app" + Goal-Aware architecture = a mandate to
  go after weight-loss / general-wellness consumers soon.
- **Why it may be wrong:** **capability is not strategy.** Going wide before the coach-led wedge retains
  burns CAC against free incumbents (MFP, Noom, Whoop) with no network effect and no coach to anchor
  retention — the consumer graveyard.
- **Recommended alternative:** hold "design for many, ship two" as **architecture only.** Win one
  segment so completely it becomes the reference case; let breadth be **pulled** by a wedge buyer (a
  trainer with a mixed book) and the **gym channel**, never **pushed** by a roadmap item justified by
  "the architecture supports it." Reject any roadmap item whose only rationale is capability.
- **Cost of getting it wrong:** runway spent acquiring consumers we can't retain, the wedge under-won,
  and a diffuse product that is second-best at everything and reference-case at nothing.

### RT-5 — "Holding the no-per-coach-formula line (D3) is costless." *(from `00` §18-D, `04` §7-E)*
- **Assumption:** that coaches won't demand per-coach scoring control, or that refusing it costs us
  nothing.
- **Why it may be wrong:** real coaches **will** ask "why can't I weight it my way," and some **will
  walk** — and the pressure peaks exactly when we're trying to hit a beta-recruitment number.
- **Recommended alternative:** **accept the cost explicitly and arm the sales motion.** Lead with the
  integrity *as* the value prop — "your '84' means the same thing a college recruiter will read." Give
  coaches the maximum *legitimate* control (targets, profile, on/off relevance, weights within rails)
  and **be willing to lose the coach who wants a vanity formula.** Never soften D3 under a sales
  objection.
- **Cost of getting it wrong:** the moment we ship one per-coach formula, the score is comparable to
  nothing, the credential is dead, and moats #1 and #3 collapse together — an irreversible reputational
  loss to win one deal.

### RT-6 — "The graduation cliff is covered by the org model." *(from `00` §18-E, `03` §5.4/§7-D, `04` §7-D)*
- **Assumption:** that "athletes never pay while attached, $14.99 if they leave" is a strategy.
- **Why it may be wrong:** it's a **cliff, not a strategy.** Every graduating senior is a 100% churn
  event — and seniors hold the **longest, most valuable records** (the moat at peak value, walking out
  the door) with **no proven conversion motion** for the hand-off.
- **Recommended alternative:** build the **graduated/transferred-athlete conversion surface** as a
  first-class, funded revenue motion — loss-aversion on the record they already own ("keep your history,
  keep your score"), triggered on the lifecycle event, on the IAP rail. It is the **lowest-CAC,
  highest-intent** consumer conversion we will ever have and the *only* consumer motion the strategy
  sanctions. The roadmap **gates V1→V2 on a measured attach rate.**
- **Cost of getting it wrong:** we monetize a beautiful B2B core and leave the moat's most valuable
  cohort as an unmonetized churn statistic — and we never get the consumer-funnel proof that un-ignores
  the consumer market.

### RT-7 — "The $14.99 individual price reflects the value of a portable, irreplaceable credential." *(from `03` §7-A)*
- **Assumption:** that $14.99 is the right price for the graduated-athlete plan.
- **Why it may be wrong:** $14.99 is suspiciously close to MFP Premium — it **anchors to the tracker
  shelf we swore never to stand on.** If this plan is what an athlete pays to keep a multi-year,
  irreplaceable, portable record **no competitor can offer at any price**, $14.99 underprices our single
  most differentiated consumer asset.
- **Recommended alternative:** hold $14.99 as the *introductory / graduation* price (low-friction at the
  hand-off), but **architect a second price point** (~$24.99 `individual_plus`) that unlocks the
  *portable-credential* framing (shareable scholarship/NIL card, full multi-org history). Price the
  continuity of an irreplaceable record like the moat it is. The catalog already supports two prices on
  a plan — it's a row, not a rebuild.
- **Cost of getting it wrong:** we permanently anchor our one uncopyable consumer asset at tracker
  parity and leave the highest-margin consumer revenue in the company on the table.

### RT-8 — "The org tiers and the 50-client Professional cap are priced right." *(from `03` §7-B/§7-C)*
- **Assumption:** that $124.99-for-50-clients and $249/$499/$799 org tiers are correctly drawn.
- **Why it may be wrong:** the 50-client cap **over-includes for the solo trainer** (most run 15–35 and
  may balk at $124.99 for the 20 they have — suppressing the exact PLG conversion that is our growth
  engine) and **under-includes for the busy practice** (needs 80). The org tiers price *retention*
  (LTV in the hundreds-to-thousands) like *software seats* ($5–$8/athlete) — generous to the buyer.
- **Recommended alternative:** **split Professional** into `professional_solo` (~$59–$79 / 25 clients,
  the real PLG entry) and `professional` ($124.99 / 50, the practice/power user); price the floor to the
  *current* book and let metering capture *growth*. Hold the org tiers low for the **land phase** but
  **build the value-metric story now** (retained members, score-to-outcome proof) so the price anchor
  can be raised later from a position of proven ROI, with `grandfathered` protecting early believers.
- **Cost of getting it wrong:** an under-converted PLG top-of-funnel (the literal source of all
  expansion) and org prices we can never raise because we never instrumented the ROI that justifies it.

### RT-9 — "Gym leaderboards / TV-mode / rewards are a V1 sparkle worth shipping." *(from `02` §12-A)*
- **Assumption:** that the gym demo should sparkle with TV-mode and a rewards loop in V1.
- **Why it may be wrong:** TV-mode is a presentation surface with **real privacy edges** (whose name
  appears on a public facility screen, who consented, what happens when a sliding member sees themselves
  last) and rewards introduce a **points economy that is gameable the moment it has value** — directly
  threatening I3 (score integrity) if rewards ever attach to the score.
- **Recommended alternative:** ship the **opt-in, execution-metrics-only leaderboard seam** (the
  already-built math) as the gym's V1 community surface; treat **TV-mode as a thin opt-in projection** of
  that board only after a real gym asks; hold **rewards behind a hard rule** — they may only ever attach
  to *executing the plan*, never to the score and never to a ranking — and even then, post-PMF.
- **Cost of getting it wrong:** a minor-adjacent health brand gets burned on a privacy edge, or a
  rewards economy quietly corrupts the one number the whole company rests on.

### RT-10 — "The code is done, so we are close to launch." *(from `04` §7-B — the founder-facing reality check)*
- **Assumption:** that ~1001 green tests and a built loop means we're near a market milestone.
- **Why it may be wrong:** we are close to a **build** milestone and far from a **market** one. The
  honest distance to revenue is a **human** chain: a lawyer (COPPA/FERPA sign-off), a VPC
  parent-verification vendor, an email sender, a real device + Apple's review queue, and **recruiting
  the coaches** — none of which is code, and later steps depend on earlier ones.
- **Recommended alternative:** the founder's single highest-leverage action **this quarter** is not
  reviewing features — it is **starting Phase 0 today** (lawyer + VPC vendor + email sender in motion).
  Every week those three don't move is a week the entire roadmap is stalled regardless of code velocity.
- **Cost of getting it wrong:** months of new speculative code on top of an unvalidated loop, while the
  one thing gating *all* of it (legal + vendors) sits untouched — velocity theater.

---

## D. The consistency pass (resolving the cross-doc tensions on the record)

The five docs are deliberately consistent on the keystones (D1–D7, I1–I7, the wedge, the moat ranking,
the anti-tracker discipline). But integrating them surfaces **three genuine tensions** that a capstone
must resolve explicitly rather than leave for a reader to trip over.

### Tension 1 — The leaderboard / vanity-metric contradiction (the gym thread vs. the Constitution)
- **The fight:** the Constitution (`01` §6.7 non-negotiable: *no vanity metrics, never ship a default-on
  leaderboard that shames*) and `00` §10 (default-on leaderboard = a **removal** candidate) sit directly
  against the gym thread (`02` §10, `03` §6), where a leaderboard / challenge / community surface is a
  **core retention mechanic** the gym is literally buying.
- **The resolution (ratified here):** **Goal-Aware Intelligence is the reconciliation — the *same*
  primitive is legitimate or harmful depending on the context it runs in.** The rule, on the record:
  - A leaderboard is **OFF by default, opt-in, execution-metrics-only** (consistency / plan adherence —
    **never** raw weight, never PRs, never the kid instead of the execution), and reads the **one
    platform-owned score** (no second number, no fan-out, computed on read — so it can never drift).
  - For **minors (HS team):** default **off**; enabling requires **guardian** opt-in, not just the
    athlete's — because a coach's authority makes a "voluntary" ranking coercive and ranking a 15-year-old
    below teammates can shame (Rule #4 violation).
  - For **adults (gym community):** opt-in is a **real, freely-given choice** — members *chose* a
    community gym for exactly this social energy; here the leaderboard *is* the execution-aligned
    motivator they bought.
  - An org may **enable** a board but can **never force an athlete onto it** — athletes own their
    visibility (I1). **TV-mode and rewards are post-PMF**, on the same opt-in seam, with rewards forever
    barred from attaching to the score or a ranking (RT-9).
  - **There is no contradiction once context is the gate, not a per-feature flag.** The Constitution's
    skepticism is correct *for the minor team*; the gym's leaderboard is legitimate *for the consenting
    adult community*. Same code, opposite default, decided by context. This is the canonical statement
    that supersedes any reading of the two docs as in conflict.

### Tension 2 — "Operating system for human performance" (scope) vs. "nutrition execution, narrowly" (focus)
- **The fight:** the vision language reaches for "the operating system for human execution / human
  performance" (`00` §1, `01` §1) while the Constitution's own Push-back ① warns that "human performance"
  is **too broad to be a real constitution** — a filter you can justify *any* feature against says no to
  nothing.
- **The resolution (ratified here):** **the broad phrase is the DESTINATION (vision); the narrow phrase
  is the FILTER (the present-tense test).** They are not in conflict because they operate at different
  altitudes and answer different questions:
  - **As ambition (the 5-year bet, the board deck, the brand):** "the operating system for human
    execution, starting in nutrition" is *correct and load-bearing* — it sets the credential endgame and
    the multi-domain arc (nutrition → training → recovery → return-to-play → academics).
  - **As a feature filter (today, the thing we say *no* with):** a feature must strengthen one of the
    five pillars **within the active execution domain (nutrition)**; *"it's part of human performance"
    is NOT an admissible justification.* New domains arrive **one at a time, pulled by proof**, each as a
    reserved seam populated when a real customer pulls it — never a speculative build.
  - **The bright line that resolves it:** *the name is broad to set ambition; the filter is narrow so it
    can do its only job — say no.* Anyone who cites "human performance" to green-light wearables-as-score,
    sleep, academics, or mental-health surfaces *today* is misusing the vision as a filter. This is the
    canonical reconciliation.

### Tension 3 — "Win one segment so completely" (focus) vs. the gym-as-channel breadth ambition
- **The fight:** `00`/`01` insist breadth is **pulled, never pushed** and we win **one** segment first —
  yet `03` §6 makes the **gym a deliberate distribution channel into the consumer market**, which reads
  like pushing breadth.
- **The resolution (ratified here):** **the gym channel is a *pull* mechanism, not a *push* into a new
  segment.** We do **not** acquire consumers head-on (forbidden by `00` §7). Instead, the gym — a
  *wedge* customer we win on its own retention ROI — produces consumers as a **byproduct**: a gym member
  with a real record becomes a graduated-athlete conversion *when their gym membership ends*, on the
  gym's CAC, not ours. This is consumer **density pulled by a B2B sale**, which is precisely the §00.7
  un-ignore trigger ("a solo-buyer funnel is independently proven") being *generated as a byproduct of
  B2B revenue.* The discipline holds: we still win one segment (the coach/gym wedge) completely first;
  the consumer market is *pulled into existence by that win*, never chased. No contradiction.

**One smaller consistency note for the record:** the docs use both "5 pillars" (founder framing:
Intelligence, Accountability, Decision Making, Human Coaching, Measurable Results) and the engineering
rulebook's 4-pillar grouping. `01` §4 already maps them 1:1 (Intelligence + Decision Making are *one
system seen twice*; Accountability wins ties). That mapping is canon; no further reconciliation needed.

---

## E. The decisions the founder must make NEXT (the strategic, still-open set)

These are **distinct from the seven ratified keystone decisions** (D1–D7, which are settled). The
keystones decided the *irreversible architecture*; these decide the *strategy* — and they are still
open. Each is decision-forcing: a default recommendation, and the cost of dithering.

| # | The open strategic decision | The board's recommendation | Why it can't wait |
|---|---|---|---|
| **SD-1** | **The beachhead-of-the-beachhead: gym-first or coach-first?** Both are "the wedge," but the *first dollar* comes from one. | **Gym (private performance/strength facility) first** — owner is the buyer, one-conversation sale, no procurement, clients often 18+ so consent isn't the gate, and the gym is also the channel. Coach/HS is step 2. | The beachhead choice determines the MVP cohort, the first sales script, and whether consent is on the critical path for revenue. Pick wrong and the first sale needs a lawyer + a VPC vendor before it can close. |
| **SD-2** | **The gym bet timing: is the gym a launch wedge or a V1 expansion?** The architecture makes it free; the *focus* cost is not free. | **Launch wedge** — but ship only the **org roll-up + opt-in leaderboard seam** (RT-9); **defer TV-mode/rewards to post-PMF.** The gym rides existing `program_*` architecture; the only new GTM is the ROI story and the channel motion. | If the gym is the first dollar (SD-1), its timing *is* the launch timing. Deferring it to V1 contradicts SD-1; over-building it (TV-mode/rewards) at launch contradicts focus. The narrow gym ships now; the sparkle waits. |
| **SD-3** | **The price points (the catalog seed).** The numbers are data, but the *opening anchor* is a strategic call: the Professional split, the second individual price, the org-tier anchor. | **Adopt the RT-7/RT-8 recommendations:** split `professional_solo` (~$59–$79/25) from `professional` ($124.99/50); add `individual_plus` (~$24.99) for the credential framing while holding $14.99 as the graduation intro price; hold org tiers low for the land phase but instrument ROI to raise later. All catalog rows, zero schema change. | The pricing decision **unblocks the queued checkout build** (Task #6) and the V1 paid gate. Until the seed is set, the compliance/checkout UI can't render trial terms and the V1 revenue gate has no price to test. This is the single fastest-to-unblock decision on the list. |
| **SD-4** | **The signature experience — confirm it and protect it.** Is the morning Daily Game Plan + Finish-Today projection *the* thing we are known for? | **Yes — ratify it as the signature and ship it at MVP, non-deferrable.** It is forward-looking (the Whoop-Recovery reframe), ours by construction (built on the platform-owned score nobody can replicate), watched (the visibility *is* the accountability), and the home of the loop. Plant "the Development Score" the way Whoop planted "Recovery" — while the in-product number stays honestly named (RT-3). | The signature is the home of the loop; you cannot prove the loop retains without the experience that opens it every morning. Deferring it means the MVP has no center of gravity and the brand has no single memorable moment. |
| **SD-5** | **The honest-naming call — commit to "Execution / Nutrition Development Score" in-product.** | **Commit.** In-product the number is named to its honest substance until V3 signals earn "Development Score"; "Development Score" is the marketing destination word. | Every screen, every coach conversation, and the App Store copy depend on the name. Shipping "Development Score" in-product today is the bait-and-switch the athlete and both coaches already flagged (RT-3) — a year-one credibility crack the credential bet cannot survive. |
| **SD-6** | **Start the human critical path — the non-code launch chain.** Not a strategy choice so much as a *forcing function* the founder alone can unblock. | **Start Phase 0 this week:** engage counsel (COPPA/FERPA + hosted policies), select a VPC parent-verification vendor, select an email sender, decide the minor-messaging posture with counsel. | Every phase on the roadmap sits *downstream* of this human chain (`04` §6). Until a real coach's real roster runs the real loop, every line of new code is speculative. This is the actual next milestone, and only the founder can start it. |

---

## F. The single most important strategic decision — and why

Of everything above, **the one decision that dominates all others is SD-1/SD-2 fused: commit, now, to
the gym/performance-facility as the launch beachhead, ship it narrowly (org roll-up + opt-in
execution-only leaderboard, no TV-mode, no rewards), and let it be the channel — while refusing every
temptation to widen before the loop retains.**

Here is why it outranks even the price points and the signature: **it is the decision that the other
four founding docs all converge on but none of them is empowered to *make*.** The strategy doc names
the wedge; the architecture doc proves the gym is free to build; the pricing doc proves the gym is the
channel; the roadmap proves the gym ships on existing rails — but *committing the company's focus to it
as the first dollar* is a founder call, and it sets the MVP cohort, the first sales script, whether
consent is on the revenue critical path, the pricing that must be seeded, and the signature's first
audience. Get this right and every downstream decision has a clear owner and a clear default. Get it
wrong — chase HS-and-procurement-and-consumer breadth at once because "the architecture supports it" —
and we burn the runway being second-best at everything, the network effect never reaches the density
that justifies the credential bet (RT-1), and the moat that is the entire company compounds too slowly
to matter.

**The whole strategy reduces to one sentence the founder must be willing to say no with:** *Win the
gym-and-coach wedge so completely it becomes the reference case, protect the one honest number over
every single deal, and let everything else — consumers, colleges, new domains — be pulled into
existence by that win, never pushed.* The day we break that sentence to win a quarter is the day we
become the team-trapping, vanity-metric, tracker-shelf incumbent we exist to displace.

---

### Cross-doc dependencies this capstone enforces on the others

- **`01` Constitution:** carries the **honest-naming lock** (RT-3 / SD-5) and **Push-back ①** (the
  narrow filter) as non-negotiables; the **leaderboard reconciliation in §D-Tension-1** is the canonical
  reading of §6.7 — context-gated opt-in, not a blanket ban.
- **`02` Architecture:** the **opt-in execution-only leaderboard seam** is the gym's V1 community surface;
  **TV-mode + rewards are post-PMF** (RT-9); the two design-now scale items (`scope_path` S1, event
  partitioning S4) ship at table creation; the **low-friction daily commitment** (RT-2) is a first-class
  score input, not a wait.
- **`03` Pricing/GTM:** seed the **`professional_solo` split** and the **`individual_plus`** price point
  (RT-7/RT-8 / SD-3); own the **graduated-athlete conversion surface** (RT-6) as a funded motion; hold
  the **gym-as-channel** as a *pull*, never a consumer-push (§D-Tension-3).
- **`04` Roadmap:** **gate V1→V2 on the graduation conversion attach rate** (RT-6); keep flagships #3
  (meal analysis) and #6 (commitment) as **MVP loop-fuel**, not waits; sequence the gym's narrow surface
  at launch and TV-mode/rewards post-PMF; and treat **Phase 0 (the human chain, SD-6)** as the real next
  milestone.
- **All docs:** the seven keystone decisions (D1–D7) and seven invariants (I1–I7) remain canon; this
  capstone challenges the **strategy around them**, never the keystones themselves. *Every operation
  changes only the access half; the profile half is permanent, org-free, athlete-owned, and never moves.
  That is AthleteOS.*
