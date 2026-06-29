# Reconciliation: the new founding-session prompt vs. the ratified founding set

**Date:** 2026-06-29 · **For:** the founder · **From:** the leadership crew (board, not yes-man)
**Subject:** A new "AthleteOS Founding Documentation Session" prompt was proposed (generate 10 founding
docs from scratch). This note reconciles it against the founding set that already exists and was
**ratified on 2026-06-29** (`05_SYNTHESIS_AND_CHALLENGES.md`, `STRATEGIC-DECISIONS.md`, the seven
keystone decisions in `docs/architecture/DECISION-MEMO.md`).

## Bottom line

**Do not regenerate the 10 documents.** You already have a board-grade founding set that is more
rigorous than the new prompt, and you ratified six strategic decisions against it today. The new prompt
is roughly:

- **~80% already covered** (often more sharply) by the existing set.
- **~15% in direct conflict with decisions you already ratified.** Regenerating from the prompt would
  silently reverse them. This is the dangerous part and the whole reason for this note.
- **~5% genuinely new** and worth harvesting into the existing docs (gated, not as launch features).

The right move is **harvest the few new ideas into the existing docs, consciously re-decide anything you
actually want to overturn, and keep one source of truth.** Two competing founding sets is the failure
mode the constitution exists to prevent.

## Where the new prompt CONTRADICTS a ratified decision (read this part)

These are not style differences. The new prompt would undo calls you signed off on.

| # | New prompt says | You ratified the opposite | Why the ratified call wins |
|---|---|---|---|
| C-1 | "The **Development Score** becomes AthleteOS' signature product." Names a doc `00_ATHLETEOS_CONSTITUTION` around it. | **SD-5 / RT-3:** name the in-product number to its honest substance ("Execution / Nutrition Score") **today**; "Development Score" is the *marketing destination*, earned at V3. | Real users (the athlete and both coaches) already called "Development Score" a bait-and-switch for a number that today measures protein + meals + hydration + a mood slider. A credential brand cannot survive "the number lied" in year one. Shipping "Development Score" in-product is the exact year-one credibility crack the whole 5-year bet can't take. |
| C-2 | Org-everything at once: trainers + gyms + nutritionists + HS + colleges + athletic departments + families + "future industries," plus a multi-domain engine (hydration, recovery, sleep, mobility, rehab, supplements, habits) framed as near-term. | **RT-4 + Tension-2 + SD-1:** breadth is **pulled, never pushed**; win the **gym/coach wedge** completely first; "human performance" is the *vision/destination*, NOT an admissible feature filter. New domains arrive one at a time, pulled by a paying customer. | Capability is not strategy. Going wide before the wedge retains burns runway being second-best at everything, and the network effect never reaches the density that justifies the credential bet (RT-1, "great moat, wrong clock"). The architecture supporting a domain is not a reason to build it. |
| C-3 | Pricing: Individual **$14.99**, Professional **$124.99 / 50 clients**, Org $249/$499/$799. (The original numbers.) | **SD-3 / RT-7 / RT-8:** split `professional_solo` (~$59-79 / 25 clients, the real PLG entry) from `professional` ($124.99/50); add `individual_plus` (~$24.99) for the credential framing while keeping $14.99 as the graduation intro; hold org tiers low for the land phase but instrument ROI. | The $124.99/50 plan is mispriced for the solo trainer (15-35 clients) who is the PLG growth engine, and $14.99-only anchors the one uncopyable consumer asset to the MyFitnessPal tracker shelf you swore never to stand on. Regenerating the old numbers reverts a pricing improvement you approved. |

A softer fourth: the new prompt's "Organizations may customize weighting within evidence-based
guardrails" is *compatible* with **D3 / RT-5** only if "guardrails" means weights-within-rails and never a
per-coach formula. Keep the bright line: no per-coach scoring formula, ever. One score, comparable across
every org, is the integrity that makes the data moat bankable.

## What's genuinely NEW and worth harvesting (gated)

These are the parts of the prompt that add something the existing set is thinner on. Fold them into the
existing docs at the right altitude. Do not treat any as launch features.

1. **The gym business-intelligence layer, productized.** The prompt articulates Member Risk Score,
   Challenge Analytics, ROI Reporting, "members likely to cancel," "trainer performance," "revenue
   opportunities" more concretely than `02`/`03` do. **Harvest into `04_GYM_STRATEGY` as a post-PMF
   roadmap section**, explicitly behind RT-9's guardrails (opt-in only, execution-metrics only, rewards
   may never attach to the score or a ranking, TV-mode is a thin opt-in projection after a real gym asks).
   Caveat to keep honest: "nutrition adherence predicts gym churn" is a **hypothesis**, not a fact. It is
   the single most important thing the beta should test before any BI/ROI feature is built.
2. **The "execution engine generalizes across domains" abstraction.** A clean way to state the multi-domain
   arc (nutrition -> hydration -> recovery -> ...). **Harvest as vision language into `01`/`00`**, bound by
   the same rule already on the record: broad as ambition, pulled one domain at a time, never a present-tense
   build justification.
3. **The AI capability enumeration** (Intervention Engine, Organization Intelligence, Behavior Prediction
   as named systems). Mostly overlaps the existing moats list; **harvest the naming into `05_AI_STRATEGY`**
   if/when that doc is written, with the AI philosophy guardrail the prompt itself states well: no AI that
   creates no measurable value.
4. **The disordered-eating / scope-of-practice liability angle.** The prompt lists "Registered Sports
   Dietitian" as a persona but, like the existing set, does not fully grapple with nutrition-advice
   liability for 13-17 athletes. This was added to `LAUNCH-CHECKLIST.md` (Phase 0) this session; keep it on
   the legal critical path.

## Recommendation

1. **Keep the existing founding set as the single source of truth.** It is ratified and internally
   consistent (it even resolves the scope-vs-focus and leaderboard tensions on the record in `05` §D).
2. **Harvest the four items above** into the existing docs at the right altitude (gym BI -> gym strategy
   as post-PMF; execution-engine framing -> vision; AI naming -> AI strategy; liability -> legal chain).
3. **If you genuinely want to overturn C-1, C-2, or C-3, do it as a conscious, dated decision** that
   supersedes the 2026-06-29 ratification, not as a side effect of regenerating docs from a prompt. State
   what changed and why. The cost of each reversal is documented in `05` (RT-3, RT-4, RT-7/8).
4. **Do not write the 10 docs.** The two that don't yet exist as standalone files (`04_GYM_STRATEGY`,
   `05_AI_STRATEGY`) can be written *from the ratified set plus the harvest above* when there's a reason,
   not regenerated from a prompt that contradicts the ratified calls.

The prompt's own instruction was "challenge my assumptions, do not become a yes-man, recommend the better
solution." The better solution is: you already did this work, and well. Protect it. Harvest the few new
ideas. Don't trade a ratified strategy for a fresh-but-weaker one.
