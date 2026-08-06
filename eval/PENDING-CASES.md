# Pending eval cases — need a real photo before they can run

Not wired into `manifest.json` yet: the harness reads `eval/meals/<id>.jpeg` unconditionally on a
live run and treats a missing cached response as fatal on `--replay` (see README's regression-gate
section), so an entry with no photo file would break the eval for everyone, not just warn. These
sit here until a real photo lands in `eval/meals/`, at which point adding the entry below to
`manifest.json` is the whole job.

## known-failure — the Core Power breakfast (2026-08-06)

**Photo needed:** `eval/meals/core-power-breakfast.jpeg` — the plate with the veggie & cheese
omelet, fruit cup, Uncrustables PB&J, and the Fairlife Core Power bottle with "42" printed on the
label. Drop the file in and add this entry to `manifest.json`:

```json
{
  "id": "core-power-breakfast",
  "photo": "core-power-breakfast.jpeg",
  "caseType": "known-failure",
  "expectedFoods": [
    { "foodDbId": "whey-protein", "servings": 1.75 },
    { "foodDbId": "egg", "servings": 3 }
  ],
  "hasSevereAllergen": false,
  "expectVerify": "none",
  "notes": "The failing meal (founder escalation 2026-08-06): the Core Power bottle prints 42g protein; the pre-fix read logged the shake at 14g and the whole breakfast at 44g total. Ground truth here is anchored to the athlete's own confirmed correction: ~72g protein for the full plate (22g omelet + 42g shake + 1g fruit + 7g PB&J). whey-protein (24g/scoop, foodDb.ts) at 1.75 servings approximates the 42g claim for detection-recall scoring only — see the caveat below, this does NOT test the actual fix."
}
```

**Real caveat, not a formality — read this before trusting a green run on this case.** `evalScore.ts`
predates the label-claim/basis work this eval is meant to guard: `scoreDetection`/`expectedMacros`
fuzzy-match detected item *names* against `foodDb.ts` and diff *meal-level* macro totals against a
computed sum. Nothing in the scoring core inspects `detected[i].basis`, `labelClaims`, or whether
the model actually READ "42" off the label versus arriving at 42g by a lucky visual guess. A run
that lands near 72g protein would report `known-failure: pass` even if the model never read the
label at all — same total, wrong reason.

Closing that gap needs one of:
1. A small `evalScore.ts` extension — an optional `expectedLabelBasis: {item, minConfidence}` field
   checked against the response's `detected[i].basis === 'label'`, or
2. Accepting that end-to-end eval verifies the *outcome* (right macros) while the *mechanism*
   (label-claim override, not luck) stays covered by the deterministic unit tests instead
   (`supabase/functions/_shared/meal-verify.test.ts` — asserts the claim-contradiction/repair path
   directly against this exact scenario), which is cheaper and more precise for that specific claim
   anyway. Recommend (2): keep the eval case as an outcome smoke test, let the unit tests own the
   mechanism assertion.

## poor-image — needed, no photo yet

A dark, blurry, or partially-cropped real plate photo. `expectVerify: "accuracy"` — the harness
should prove the low-confidence read actually triggers the item-6 accuracy re-detect, not just
score it.

## allergen — needed, no photo yet

A real plate with a severe declared restriction visible and a low-confidence read.
`hasSevereAllergen: true`, `expectVerify: "allergen"` — proves the allergen re-scan trigger fires.

## packaged — worth adding once any label-claim photo exists

Not in `run-eval.ts`'s `REQUIRED_CASES` (only clear/poor-image/known-failure/allergen are gated),
but the README's own case-type checklist lists it, and it's exactly the surface this whole rebuild
targeted. Any clean photo of one or two packaged products with readable nutrition claims — doesn't
need to be a failure case, just real coverage that the label-reading step runs at all outside the
one known-failure meal.
