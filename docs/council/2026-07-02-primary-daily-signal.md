# Council Ruling: Primary daily logging signal — disciplined hybrid (C)

**Date:** 2026-07-02
**Decision type(s):** Product & features (primary) + Accountability science
**Council seats:** Athlete end-user, Product strategist / moat-keeper, Behavior / habit-science expert, Coach / trainer end-user — judged by head of product
**Vote:** 4–1 for C (the behavior expert's demand that the commitment earn an ≥80 streak on its own was rejected and conceded in cross-examination)

## The question
Today the athlete's main daily action is **meal-photo logging** (`MealCapture`) + AI quick-adds + a static task checklist; the nutrition sub-score only moves when meals are logged. OnStandard's own founding docs call photo-dependency **"the single most load-bearing product risk"** ("won't happen" at HS scale; dashboard empties by week 2), and the roadmap mandates a sub-30-second **"did you hit your plan? yes/no/partial"** commitment as a first-class MVP feature — but it's **unbuilt** (verified: 0 refs in `src`) and has no build ticket. What is the primary daily signal for beta?

- **A — Keep meal-photo logging primary** (status quo): richest/most honest, highest friction.
- **B — Make the low-friction commitment the primary score driver**: max completion, but a self-report toggle is gameable.
- **C — Hybrid**: a guaranteed daily commitment as the floor; photo logging stays the only path to the top score.

## Evidence gathered
Three parallel audits of the real repo (HEAD `5c04ec1`) — product/UX, core/backend, strategy docs — cited to file:line/doc. **Controller-verified** the two load-bearing claims: (1) no commitment mechanic exists (grep = 0 hits); (2) the static checklist ships fake — `defaultState.ts` tasks **1, 5, 6 = `done: true`** on ship, un-editable, disconnected from any plan. No live-app walkthrough or competitor teardown (habit-app patterns reasoned from model knowledge, flagged unverified). 4 opening positions, 4 cross-exam, judge resolved.

## Vision
The daily loop must survive at high-school scale **without** surrendering the one asset a group text lacks: a green day means a kid actually executed, and it's provable to a parent. A two-signal loop — a near-zero-friction daily commitment that keeps the board full and the athlete returning, and photo logging that remains the **only** road to an on-standard (≥80) day. Participation is guaranteed; "on standard" stays earned. One build, one scoring mix, no floor, no threshold change, engines OFF.

## The decision — C (disciplined hybrid)
A sub-30-second **"Did you hit YOUR plan today? yes / partial / no"** becomes the guaranteed daily minimum (top-of-screen, first action, engines OFF). Photo-logged nutrition (weight `0.5`, `= 0` with no meals) stays the sole path to ≥80.

**How it feeds the score honestly:**
1. **Retire the static 6-item checklist** as a scored input (verified fake) and repurpose its **`0.15` weight** into the commitment — the commitment's *entire* score contribution.
2. **Hard cap by construction:** nutrition's `0.5` is untouched and `= 0` with no meals, so a bare "yes" + zero food is mathematically locked out of 80. No threshold change, no reweight, no participation floor — founder ruling D‑B (`scoring.ts:213-217`) survives.
3. **Honesty asymmetry:** an honest "no/partial" must **never** score below a dishonest "yes" — both sit in the same capped "showed-up" band; the coach acts on the **claim-vs-photo delta**, not the toggle value. This trains honesty instead of punishing it.

**Two streaks, one score:** (a) **on-standard** streak = day ≥ 80 (`COMPLIANCE_THRESHOLD`, `history.ts:131`), photo-earned only — coherent with the 2026‑07‑02 streak ruling; (b) **showed-up** streak = commitment answered. Rendered as visually distinct marks (gold "on standard" dot vs plain "showed up" dot); one can never masquerade as the other.

**What the coach sees (engines off):** said-yes + logged = earned green; said-yes + logged nothing = "claims compliant, unverified" (intervention band); silent = missed check-in = first call.

**Migration:** the commitment is stored as **plan-adherence** bound (for beta) to referents that already exist (protein target + meals-logged), so it upgrades cleanly when `adherence.ts`/engines flip on post-beta — no rewrite. It lives as a dumb top-level prompt **outside** the Accountability Engine.

## Feature priorities
| # | Feature | Why | Motivated by |
|---|---|---|---|
| 1 | Sub-30s daily commitment prompt (yes/partial/no), top-of-screen, engines OFF | The keystone habit must be the most prominent, lowest-friction ask or it never becomes automatic | `04_PRODUCT_ROADMAP §2/§7-C`; verified 0 refs; unanimous |
| 2 | Retire the static checklist as a scored input; move its 0.15 weight to the commitment | Un-authored, hardcoded `done:true` rows are the "this is fake" smell; killing it funds the commitment with no new primitive | verified `defaultState.ts:75-81`; `scoring.ts:292-293` |
| 3 | Two distinct streaks: on-standard (≥80, photo-earned) vs showed-up (answered) | A single 80-gated streak gives the honest-but-can't-photo kid a dead zero-streak → churn | `history.ts:131`; 2026-07-02 streak ruling |
| 4 | Three coach states: earned-green / claims-compliant-unverified / silent | The coach intervenes on the gap between claim and proof | Coach must-have; `adherence.ts:54,93` |
| 5 | Store commitment as plan-adherence bound to existing protein-target + meals-logged | "Your plan" is a mood check if every kid has the same hardcoded plan; real referents make it meaningful engines-OFF | Constitution #13; engines-OFF keystone |
| 6 | Honesty asymmetry: honest "no/partial" never scores below dishonest "yes" | If honesty costs more than lying, you train lying | behavior expert's surviving hold, adopted |

## Phase plan
1. **Phase 1 — Commitment MVP (pre-beta, blocks beta).** Top-level sub-30s yes/partial/no prompt (not an engine card); retire the checklist and move its 0.15 weight; store as plan-adherence bound to existing referents; add a `scoring.test.ts` case asserting yes + zero meals < 80; ship the showed-up streak.
2. **Phase 2 — Coach three-state view (pre-beta).** Dashboard renders earned-green / claims-compliant-unverified / silent; two distinct streak marks; wire the miss to the existing streak-alert copy (`adherence.ts:93`) or an engine-off equivalent.
3. **Phase 3 — Beta hardening.** Fix the recovery-fallback inflation (`scoring.ts:241-242`) so the ~50 "showed-up" band renders as "claimed, unverified" not an earned score; enforce + test the honest-no ≥ dishonest-yes rule; persona re-review for "this is fake" smell.
4. **Phase 4 — Engines-on upgrade (post-beta, deferred).** Flip `adherence.ts`/engines on; the stored plan-adherence upgrades to engine-computed adherence with no rewrite; coach-authored plan pipeline; photo-verification of the "yes"; richer partial credit.

## Cut list
Hard cuts for beta: (1) Option A alone (ships the named #1 risk unmitigated); (2) Option B (self-report as THE score driver = moat-killer); (3) the static checklist as a scored signal; (4) any threshold/reweight letting a bare "yes" reach on-standard (the conceded dissent); (5) any path where the commitment auto-populates or replaces real logging; (6) rendering the commitment as an Accountability-Engine card (engines stay OFF). Deferred (not cut): coach-authored plan pipeline, macro/barcode depth beyond protein+slots, AI photo-analysis polish, photo-verification of the "yes", richer partial-credit.

## Open questions for the founder
1. **Recovery-fallback leak:** `scoring.ts:241-242` seeds `recoveryScore = 86` before any real check-in, and `checkin = 100` on submit — so a no-meal "yes" day scores partly on an **unearned** recovery number (band ~mid-40s–50, not purely the commitment). Exclude fallback recovery from `athleteScore` until a real check-in backs it (tighter, band ~mid-30s), or keep it (friendlier, partly unearned)? The cap against 80 holds either way.
2. **Showed-up streak visibility:** equal visual billing with the on-standard streak, or deliberately quieter so ≥80 stays aspirational?
3. **Coach alert on the unverified band:** should "said-yes + logged nothing" fire a coach notification, or only silent days?
- **Recorded dissent:** the behavior/habit-science expert opened insisting the commitment must *earn* an on-standard streak day on its own (requiring the ≥80 math to change). Rejected 4–1 and conceded. Preserved as the pressure point to revisit **if** beta shows catastrophic churn on the "showed-up ≠ green" framing — but by making the showed-up streak more rewarding, **not** by lowering 80.

## Next step
Write the single missing build ticket the strategy docs mandated but engineering never filed: **"Daily plan commitment (yes/partial/no) + retire static checklist."** Scope to Phase 1 exactly — top-level sub-30s prompt, move the 0.15 weight from tasks to the commitment, store as plan-adherence bound to existing protein-target + meals-logged, add the `scoring.test.ts` assertion that yes + zero-meals < 80, ship the showed-up streak. Smallest, highest-leverage change; it closes the strategy-vs-engineering gap that *is* this decision, and must exist before the beta cohort opens the app.
