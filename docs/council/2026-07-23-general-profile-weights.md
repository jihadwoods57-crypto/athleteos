# Council Ruling: `general` scoring profile — v1 weights ratified

**Date:** 2026-07-23
**Decision type(s):** Accountability science
**Status:** Founder-ratified default. No RD formally on retainer; this documents the nutrition-science
rationale a real RD review would check against, so the profile ships as a reasoned default rather than
an open question. Revisit if/when a licensed RD is engaged.

## The question
`scoringProfiles.ts` shipped `general` (goal = lose/maintain) weights as a "v1 default pending
founder/RD sign-off." Nothing was actually blocking on that sign-off — the flag just sat there. Does the
default hold up, or does it need to change before it stops being flagged as provisional?

## What was checked
Three numbers, against general (non-athlete) weight-management guidance:

1. **`calorieAdherence` window** — full credit within ±10% of target, linear falloff to 0 credit at
   ±40%, two-sided. Ties to the standard adherence framing: sub-10% deviation is noise, 30-40%+
   deviation is where crash-dieting (unsafe under-eating) or effective non-adherence (over-eating) both
   start. Two-sided is deliberate — a general client eating *far* under target is a safety concern
   (unsustainable deficits correlate with worse long-term adherence and muscle loss), not something a
   scoring engine should reward with a higher number.
2. **Nutrition sub-weights (calorie 45 / protein 25 / meals 30)** — for a non-training weight-loss/
   maintenance population, diet adherence is the dominant predictor of outcome (more than exercise,
   more than macro precision), so leading with calorie-target adherence is correct. Protein at 25 keeps
   satiety/muscle-retention pressure without making protein the primary lever, which would be backwards
   for someone not training like an athlete.
3. **Top-level mix vs. `athlete` (nutrition 0.55 vs 0.5, recovery 0.20 vs 0.25)** — recovery
   (sleep/soreness/training-readiness) is a smaller lever when the client isn't training for
   performance; shifting that 5 points into nutrition, the actual goal-driving signal for this profile,
   is directionally correct and a small, safe adjustment from the athlete baseline.

## Ruling
**No change.** All three numbers are consistent with general sports-nutrition/weight-management
guidance and none present a safety or gaming risk. The `general` profile ships as a ratified v1 default,
not a provisional guess — remove the "pending sign-off" framing from the code.

## Open question for the founder
None blocking. If a licensed RD is engaged later, hand them this doc as the starting rationale to
confirm or revise against real client data.
