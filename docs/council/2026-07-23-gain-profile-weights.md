# Council Ruling: `gain` scoring profile — v1 weights ratified

**Date:** 2026-07-23
**Decision type(s):** Accountability science
**Status:** Founder-ratified default. No RD formally on retainer; this documents the nutrition-science
rationale a real RD review would check against, so the profile ships as a reasoned default rather than
an open question. Companion to `2026-07-23-general-profile-weights.md`. Revisit if/when a licensed RD
is engaged.

## The question
`scoringProfiles.ts` shipped `gain` (goal = build muscle) weights as an unreviewed v1 guess — the
comment only justified the recovery weight ("matters more for hypertrophy"), not the calorie-floor
curve or the nutrition sub-weights. Does the default hold up?

## What was checked

1. **`calorieFloorAdherence` window** — full credit at or above the surplus target, linear falloff to 0
   credit at 60% of the *total target calories* (not 60% of the surplus alone). In absolute terms: for a
   typical lean-bulk target, 60% of total target calories lands well below maintenance, so a client
   eating at or near maintenance (under-surplusing but not starving) still earns roughly half credit
   rather than zero. That's the correct shape — it distinguishes "not eating enough to grow" (partial
   credit, still a real day) from "barely eating" (zero credit), and never penalizes going over the
   surplus, which is the deliberate one-sided design (over-eating on a bulk isn't the failure mode;
   under-eating is).
2. **Nutrition sub-weights (calorie floor 40 / protein 35 / meals 25)** — protein carries more weight
   here (35) than in `athlete` (proportionally) or `general` (25), which is correct: protein intake is
   one of the strongest independent levers for muscle protein synthesis, arguably competitive with total
   surplus for a training client. Leading with the calorie floor (40) while keeping protein close behind
   avoids the score being "just eat a lot of anything" — both levers matter for growth.
3. **Top-level mix vs. `athlete` (nutrition 0.55 vs 0.5, recovery 0.25 unchanged, commitment 0.1 vs
   0.15, checkin 0.1 unchanged)** — recovery is deliberately held at the athlete-level weight rather than
   lowered (unlike `general`): hypertrophy is driven by the repair/rest cycle, so recovery still matters
   as much as it does for a performance athlete. The 0.05 shifted into nutrition comes out of commitment,
   not recovery — consistent with a bulk being primarily won or lost on consistent surplus + protein, not
   on the behavioral one-tap.

## Ruling
**No change.** All three numbers are consistent with hypertrophy-nutrition guidance (surplus
consistency, protein leading calories, recovery held at athlete-level importance) and none present a
safety or gaming risk. The `gain` profile ships as a ratified v1 default, not an open guess — remove the
"unreviewed" framing from the code.

## Open question for the founder
None blocking. If a licensed RD is engaged later, hand them both this doc and the `general` ruling as
the starting rationale to confirm or revise against real client data.
