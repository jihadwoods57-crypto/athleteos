# Recovery Check-In — Ranked Teardown (Audit only, no app code changed)

**Phase:** Fable 5 Audit (Opus) · **Branch:** `fable5/2026-07-12-founder-worklist`
**Scope of this doc:** the daily Recovery Check-In — 25% of the OnStandard Score. Pass 1 sized the
chips; this pass tears down the **projection / feedback surface** and the confirm payoff.
**Files:** `proto/redesign-2026-07/js/screens/recovery.js` (form + `recoveryConfirm`),
`js/state.js` (`get recovery`, `checkinProjection`, `submitRecovery`, `nextMove`, exec routing),
`css/screens.css` (`.rec-field/.chips5/.c5/.confirm-wrap/.big-check/.score-move`),
`css/flows.css` (`.tier-chip/.day-done/.sidebox/.state-demo`).
**Live smoke:** 390×844, seeded `qa-user` athlete, `#recovery` + `#recovery-confirm`.
Screenshot: `.fable5/shots/2026-07-12-worklist/recovery-teardown-form.png`.

**Integrity note:** every item below is PRESENTATION-only. The 1–5 chips are the real scoring
inputs (`n*2` → engine 0–10, recovery.js:112-117) and none of these fixes alter answers, weights,
or `checkinProjection` math. Nothing here is founder-gated (no data/score-logic change, no dropped
function). D1 removes duplicate copy only.

---

## RANKED (highest impact first — daily surface, 25% of score)

### 1. R1 — Form doesn't hide the tab bar → FAB + tabs collide with Submit (mobile-first breakage)
`recoveryConfirm` sets `hideTabs:true` (recovery.js:7) but the **form** (default export, recovery.js:56)
does not. Live-measured at 390×844: Submit button bottom = **760**, tab bar top = **748**, camera FAB
spans **y743–805 / x164–226** — the FAB sits **on top of** the primary Submit, and the
"Coach can see your update" caption (y772–787) renders **behind the tab bar** (confirmed occluded).
The confirm screen already hides tabs; a focused single-task check-in should too.
**Fix:** add `hideTabs:true` to the form (mirrors its own confirm) or reserve bottom padding.

### 2. A1 / D1 — Coachless athletes are told "Coach can see your update" (dishonest, live-confirmed)
Caption at recovery.js:99 is **unconditional**, while the sidebox (recovery.js:92) and the confirm
subtitle (recovery.js:16) both branch on `S.coach.hasCoach`. In the QA state the sidebox rendered the
**no-coach** branch ("It keeps Recovery — 25% of your score — honest.") yet the caption still said
"Coach can see your update." **Fix:** branch the caption on `hasCoach`, or delete it and let the
already-correct sidebox carry the coach line (D1 — pure duplicate copy, drops nothing real).

### 3. A2 — `recovery-confirm` false-celebrates / mis-attributes via the GLOBAL `lastMove`
recovery.js:9 reads `RT.lastMove || {from:S.score,to:S.score,gain:0}`. Two real failures:
(a) land with `lastMove` null (reload, deep-link) → "Check-In Submitted · 0 → 0 · +0 pts" — a
celebration of a non-move (live-reproduced). (b) `lastMove` is the **last action of any kind**
(`logMeal` sets it too, state.js:263; `submitRecovery` at :277), and exec routes a **completed**
recovery to `recovery-confirm` (state.js:1119). So revisiting the check-in after logging a later meal
shows the **meal's** delta mislabeled "Recovery refreshed." **Fix:** snapshot the recovery move on
submit (or guard: render the honest already-submitted `state-demo` when the stored move isn't a
recovery move).

### 4. A3 — Projection is points-only; a coach-visible READINESS check shows the athlete no readiness read-out
The only feedback is `#rec-gain` = "Worth +30 tonight → 30" (recovery.js:91,120). For a check whose
whole purpose is readiness the coach reads, the athlete gets no readiness summary and **no signal that
a low answer is a concern** (e.g. Energy=1). State already computes a `readiness` value (state.js:1373)
that is never surfaced here. **Fix:** add a lightweight readiness/low-answer acknowledgement beside the
points so honesty has a human payoff, not just a number.

### 5. U1 — 1–5 chips read as an arbitrary pick, not a magnitude
`.c5` single-select highlights exactly one purple box (screens.css:170-176; single `.on`,
recovery.js:82,114). A 1–5 intensity scale conventionally fills 1..n or emphasizes the anchor ends;
one lone box gives no sense of "how much." **Fix:** cumulative/intensity fill or stronger end-anchor
treatment — visual only, selection value unchanged.

### 6. U3 — Confirm celebration color-forks the flow (green number + green halo inside a purple flow)
`.score-move .to` is hardcoded `--green-bright` (screens.css:128 → rgb74,222,128 live) while this flow's
accent is purple; the moon core is overridden **inline** to purple (recovery.js:14) but `.big-check`'s
halo stays green (screens.css:115) → a purple core in a green halo. **Fix:** drive the confirm accent
from one token so recovery reads purple end-to-end (or intentionally green, but pick one).

### 7. U4 / U5 — Coach mentioned up to 3×; the projection payoff is visually underweighted
Coach appears in the sidebox, the (buggy) caption, and the confirm sub — collapse to one. And the "+30"
payoff sits in a small sidebox dwarfed by the big purple Submit; the reward for answering honestly is
lighter than the CTA. **Fix:** single coach line; give the projection more weight adjacent to Submit.

### 8. U2 — Soreness polarity is invisible (latent, ciConfig-gated)
Only 4 of 6 anchors render here (Energy/Recovery/Sleep/Confidence); Soreness+Motivation are filtered by
`DAY.ciConfig` (state.js:1360). When Soreness is enabled, chip 5 = "Very sore" = **bad**, but the purple
`.on` looks identical to a "good" high rating (state.js:1355 notes the engine inverts it). **Fix:** when
a reversed-polarity field is shown, signal good/bad direction so a high pick doesn't read as positive.

### 9. A4 / A5 — Positive-only projection; no completeness affordance
`checkinProjection` clamps gain at 0 (state.js:220) and the sidebox falls back to generic copy when
gain≤0 (recovery.js:91,121) — "already refreshed / no more points" is indistinguishable from "nothing
answered." Submit is always enabled regardless of how many fields are set. **Fix:** distinguish the
honest zero-gain state; consider a soft "answer all N" affordance.

### 10. R2 — Reorder answer → payoff → commit
The honesty disclaimer sits **between** the card and the projection sidebox (recovery.js:86-93),
pushing the motivating "+30" payoff away from Submit. **Fix:** keep disclaimer with the fields; place
the projection adjacent to Submit for a tighter answer→payoff→commit read.

---

## Buckets at a glance
- **ADD:** A1 coach-conditional caption · A2 confirm move guard/snapshot · A3 readiness feedback ·
  A4 honest zero-gain state · A5 completeness affordance.
- **UPGRADE:** U1 intensity-scale chips · U2 reversed-polarity signal · U3 unify confirm accent ·
  U4 dedupe coach copy · U5 weight the projection payoff.
- **REARRANGE:** R1 hide tabs on the form (kills the FAB/Submit collision) · R2 disclaimer/projection order.
- **DELETE:** D1 the unconditional "Coach can see your update" caption (duplicate + wrong; not gated).

## Grounding
- Code: recovery.js:7,9,14,16,56,82,91-99,112-121; state.js:220,263,277,1119,1355,1360,1373;
  screens.css:115,128,170-176; flows.css:28,217.
- Live (390×844): Submit bottom 760 / tabbar top 748 / FAB y743–805 → collision; caption y772 occluded;
  sidebox = no-coach branch while caption = "Coach can see your update"; `recovery-confirm` with null
  `lastMove` → "0 → 0 · +0 pts"; `.score-move .to` = rgb(74,222,128) green; confirm `hideTabs` = true,
  form = false.
