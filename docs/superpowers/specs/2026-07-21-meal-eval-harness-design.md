# Meal-Pipeline Eval Harness + Dataset — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending spec review
**Scope:** Build-brief AI-architecture item (7) — the initial eval dataset + a runner that scores a pipeline change against it before it ships. Compliance-free (no athlete data).
**Builds on:** item 6 (`shouldVerify`/`analysisAgreesWithBand`/`weightedConfidence`), 8a (`ai_model_prices` for cost), 8b (`ai_verify_effectiveness` for the live tuning signal), and `src/core/foodDb.ts` (labeled macro source).

---

## 1. Goal & the one boundary that matters

Give the meal pipeline an **offline regression gate**: a fixed, labeled set of meal photos and a runner that answers "did this change make detection / portions / the verifier better or worse?" — cheaply enough (~$0.20/run) to run before every meaningful change, per the brief's "test changes before fine-tuning."

**Compliance boundary (decided):** the initial dataset is **curated + team-captured only** — stock photos and staff photographing their own meals. **No athlete data, no de-identification, no consent flow, no minor-safety exposure.** Because the person who ate the meal labels it, ground truth is *known*, not guessed. The dataset is therefore committable to the repo. The "real de-identified athlete meals" expansion is a separate, compliance-gated future project (see §8).

## 2. The dataset (`eval/meals/`)

Photo files + a `manifest.json`. Each entry:

```json
{
  "id": "clear-01",
  "photo": "clear-01.jpeg",
  "caseType": "clear",
  "expectedFoods": [{ "foodDbId": "salmon", "servings": 1.5 }, { "foodDbId": "white-rice", "servings": 1 }],
  "hasSevereAllergen": false,
  "expectMemoryTrigger": false,
  "notes": "well-lit single plate"
}
```

- **`caseType`** ∈ `clear | mixed | smoothie | restaurant | packaged | poor-image | known-failure` (the brief's case list).
- **Ground-truth macros are computed**, never stored: sum `FOOD_DB[foodDbId].per × servings` over `expectedFoods`. So they stay correct if the food DB is retuned, and labeling a meal is just "list what's on the plate + rough servings."
- **`hasSevereAllergen`** / poor-image / known-failure cases are chosen to exercise item 6's verify triggers (§5, design constraint #3).

## 3. The harness (`eval/run-eval.mjs`)

Node ESM script, run deliberately (it can make real paid calls). Two modes:

**Live mode (default):** for each meal, POST the photo to a **configurable** `analyze-meal` URL — `--url` defaults to prod, or point it at a local `supabase functions serve` to test a candidate prompt/model change *before* deploying. Save each raw response to `eval/responses/<id>.json`, then score it (§4).

**`--replay` mode (free):** skip the network entirely; re-score the saved `eval/responses/*.json` through the deterministic pipeline. Testing a scoring / grounding / verify-threshold change costs **$0 and runs in seconds** — most changes are this kind. Only a prompt or model change needs a fresh (paid) live run.

**Grounding parity:** the harness scores using the app's **pure** functions — `groundMealFromFoods`/`groundMealTotals` (`nutrition.js`), `mealQualityScore`/`qualityBand`/`analysisAgreesWithBand`/`weightedConfidence`/`shouldVerify` (`meal-intel.js`), `FOOD_DB` (`foodDb.ts`). It does **not** import `groundResult` (which lives in `state.js` and is coupled to browser runtime state). Those pure functions are the exact math `groundResult` delegates to, so the metrics match prod; only `groundResult`'s display-shaping (which doesn't affect any metric) is omitted. A future refactor could extract a shared pure `groundCore()` used by both — noted, not required for v1.

## 4. What it measures (only what's automatable against labels)

Per meal and aggregated per `caseType` + overall:
- **Detection accuracy** — resolve the response's detected foods to `FOOD_DB` (same alias/name matching the app uses) and compare to `expectedFoods`: precision + recall.
- **Macro error** — median |estimated − ground-truth| for protein / carbs / fat / total kcal (absolute + % of truth).
- **Score-copy contradiction** — `analysisAgreesWithBand(analysis, band)` on the output; report the contradiction rate.
- **Verify-trigger correctness** — run `shouldVerify` on each result and compare to the case's intent: does it fire on poor-image / known-failure / allergen cases and stay quiet on clear ones? Precision/recall on the trigger.
- **Latency + cost** — from the response timing + the `ai_model_prices` rates (mirrors the 8a table so eval cost matches live cost).

**Deliberately out of scope** (need runtime or human raters, not an offline labeled set): contamination rate, correction rate, satisfaction, coach-agreement — those are the *live* signals 8a/8b already cover.

## 5. Design constraint #3 — the seed cases validate item 6

The verify thresholds shipped in item 6 (weighted-confidence 0.75/0.35, `quality < 50`) were chosen by judgment. The seed set is **deliberately built to exercise them**: at least one clear case (trigger must stay quiet), one poor-image + one known-failure (accuracy trigger should fire), and one `hasSevereAllergen` + low-confidence case (allergen trigger should fire). So the harness validates the verifier on day one, and its trigger-precision output — paired with the live `ai_verify_effectiveness` catch-rate — is how the thresholds get tuned.

## 6. Regression diff — folded-in upgrade #1

Every live run writes its aggregate scorecard to `eval/baselines/<ISO-date>.json` and updates `eval/baselines/latest.json`. Each run then **diffs against `latest.json`** and prints deltas ("restaurant detection recall −11%, mixed macro-error +9%"), flagging any metric that regressed beyond a small threshold. This is what turns the harness from a one-time readout into a gate that catches "this prompt change quietly degraded portions on mixed plates." `--no-baseline` skips writing (for throwaway experiments).

## 7. Seed set + growth (`eval/README.md`)

I label the three real in-repo meal photos (`a1-meal.jpeg`, `a1-zoom.jpeg`, `a1-home.jpeg` where a plate) as the first entries so the harness runs immediately, and write a one-page "how to add a meal" doc (photograph a plate → list its foods + servings from `FOOD_DB` → drop the file + manifest entry). The team grows it toward ~2–4 per case type (~20 meals) with their own meals — no code change to add a meal.

## 8. Explicitly NOT now

- **Real de-identified athlete meals** — the mature dataset; separate compliance-gated project. The manifest format is source-agnostic, so it slots in later behind a de-identification + consent review.
- **Live-failure → eval promotion** — once traffic flows, 8b's outliers (score-delta spikes, text-conflicts, low-confidence meals) are the hardest real cases; promoting a de-identified one into the eval is the natural next step, gated with §8's real-meal work. Architecture supports it; not built.
- **CI automation** — the live (paid) mode stays a deliberate manual gate. `--replay` is free and *could* run in CI later, but that's not part of v1.
- **Fine-tuning** — the brief sequences the eval strictly before any fine-tuning; none here.

## 9. Files

- Create — dataset: `eval/manifest.json`, `eval/meals/*.jpeg` (seed), `eval/README.md`.
- Create — runner: `eval/run-eval.ts` (POST photos to the configurable URL, save raw responses, invoke the scoring core, write + diff baselines, print the scorecard). Executed via the repo's TS/ESM tooling — `npx tsx eval/run-eval.ts` — because the proto modules are ESM and are otherwise only loaded through jest's transform or the browser; **the exact runner invocation + module resolution is validated in the implementation plan (run it, don't assume it).**
- Create — scoring core: `src/core/evalScore.ts` (pure: detection match, macro error, contradiction, verify-trigger classification, cost from the `ai_model_prices` rates). Shared by live + replay; imports the app's pure functions. Lives in `src/core` so jest tests it natively (existing tests already import proto `.js` modules the same way).
- Generated (git-ignored): `eval/responses/*.json`, `eval/baselines/*.json` — except `eval/baselines/latest.json`, which IS committed so the regression diff has a shared reference.
- Reuse (no change): `proto/redesign-2026-07/js/nutrition.js`, `.../meal-intel.js`, `src/core/foodDb.ts`.
- Test: `src/core/evalScore.test.ts` — jest unit tests for the scoring core (detection match, macro error, trigger classification) against hand-built fixtures, so the harness's own logic is trustworthy.
