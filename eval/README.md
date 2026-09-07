# Meal-pipeline eval harness

Offline regression gate for the meal-analysis AI pipeline (build-brief item 7: "test changes
before fine-tuning"). Compliance-free — **no athlete data**. The dataset is curated + team-
captured meals only: stock photos or staff photographing their own plates. Because the person who
ate the meal labels it, ground truth is known, not guessed, and macros are computed from
`src/core/foodDb.ts` — never measured or estimated by hand.

## Run it

Free, offline — re-scores the last saved responses through the deterministic pipeline. Use this
after any change to scoring, grounding, or the item-6 verify thresholds:

```bash
npm run eval -- --replay
```

Live — makes a real paid call per meal (~$0.01 each). Use this after a prompt or model change.
Needs the project's anon key:

```bash
EVAL_ANON_KEY=$(supabase projects api-keys --project-ref ftwrvylzoyznhbzhgism -o json | \
  python -c "import sys,json;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))") \
  EVAL_STAMP=$(date +%F) npm run eval
```

Point at a local `supabase functions serve` candidate instead of prod with `--url=http://127.0.0.1:54321/functions/v1/analyze-meal`.

Every live run writes `eval/baselines/<EVAL_STAMP>.json` and updates `eval/baselines/latest.json`
(committed), then diffs the new run against it — flagging any metric that got worse
(`⚠ kcal_err_pct: 0.08 → 0.15 (+0.07)`). Pass `--no-baseline` for a throwaway experiment you don't
want to become the new reference point.

### It exits non-zero

This is a gate, so it can fail. `npm run eval` exits 1 when a metric regresses past the threshold,
when a manifest case has no response (that meal contributed nothing, so the aggregate silently
described a smaller set than the manifest claims), or when zero meals were measured. All of these
used to print a warning into a run that exited 0, which in CI is indistinguishable from a pass.

### Coverage is reported every run

The run ends with which of the required case types below the set actually exercises. **Three of the
four are currently uncovered** — the set is one clean plate. A green run today means "the one clean
plate still works", not "the pipeline is safe", and the run now says so out loud instead of implying
the stronger claim.

Closing that needs real photographed plates (see *Add a meal*), which is a team task — a run cannot
conjure them, and synthesizing them would make the gate lie in the more dangerous direction. So the
gap is reported loudly but is **not** fatal: it must not block the deterministic `--replay` that
contributors do rely on today.

## What it measures

Only what's checkable against a label, per meal and rolled up by `caseType` and overall:

- **Detection accuracy** — precision/recall of detected foods vs. the labeled `expectedFoods`.
- **Macro error** — % error per macro + total kcal vs. the computed ground truth.
- **Score-copy contradiction rate** — does the AI's prose ever disagree with the computed band?
- **Verify-trigger accuracy** — does the item-6 second-pass verifier fire exactly when the case
  expects it to (`expectVerify`), and stay quiet otherwise?
- **Latency** — measured in-harness.
- **Cost** — NOT in the response (no token counts come back from analyze-meal). Read it from 8a's
  `ai_cost_daily` for the run window instead — every eval call is recorded there as `mode='meal'`.

Deliberately **not** measured here (these need live traffic or human raters, not an offline
labeled set): contamination rate, correction rate, athlete satisfaction, coach agreement — see
8a/8b for those.

## Add a meal

1. Photograph a real plate (yours, a teammate's — never an athlete's).
2. Drop the file in `eval/meals/<id>.jpeg`.
3. Add a manifest entry: list what's on the plate as `{foodDbId, servings}` pairs from
   `src/core/foodDb.ts` (search it for the closest match if an exact food isn't there — note the
   substitution, like `clear-01`'s entry does for asparagus/dinner-roll). Set `caseType` and
   `expectVerify` (see below).
4. Run `EVAL_ANON_KEY=... npm run eval` once to cache a response, then iterate for free with
   `--replay`.

See `PENDING-CASES.md` for cases that are fully specified (ground truth, manifest JSON ready to
paste in) but blocked on step 1 — a real photo. Check there first before writing a new one from
scratch.

### Case-type checklist

Aim for 2–4 labeled meals per case type as the set grows:

`clear` · `mixed` · `smoothie` · `restaurant` · `packaged` · `poor-image` · `known-failure`

**Make sure the set includes cases that exercise the item-6 verify triggers**, not just clear
photos:
- At least one **`poor-image`** or **`known-failure`** meal with `"expectVerify": "accuracy"` —
  the harness proves whether the accuracy re-detect trigger actually fires when it should.
- At least one meal from an athlete with a **severe declared restriction**
  (`"hasSevereAllergen": true`) low-confidence read, with `"expectVerify": "allergen"` — proves
  the allergen re-scan trigger fires.
- Keep several confident `clear` cases with `"expectVerify": "none"` — proves the verifier stays
  quiet (and cheap) on meals that don't need it.

## Weighing a plate

Every `expectedFoods` entry in this manifest is an **estimate somebody typed in**. That is the
biggest caveat on every number this harness prints, and it is now printed on every run
(`=== GROUND TRUTH ===`).

Why it matters, concretely. On 2026-09-07 `steak-potatoes` returned 32g of protein against a 64g
answer key, identically on two independent live runs. Read one way that is a 50% model error. Read
the other way the answer key is wrong: it asserts `sirloin-steak x1.75` servings and the model reads
about one serving. **Nobody put that steak on a scale, so neither reading can be ruled out** — the
macro-error metric is measuring the gap between two guesses.

Fixing this does not need code. It needs an afternoon, a kitchen scale, and this protocol:

1. **Weigh each component raw or as-served, in grams, before it goes on the plate.** Write the
   number down as you go; do not reconstruct it afterwards from memory.
2. **Photograph the assembled plate the way an athlete actually would** — phone camera, held above
   the plate, ordinary kitchen or restaurant light. Do not stage it. A pin-sharp overhead studio
   shot tests a photograph nobody takes.
3. **Convert each weight to `foodDbId` + `servings`** using the `per` serving size in
   `src/core/foodDb.ts` (`servings = grams / grams-per-serving`). Keep one decimal.
4. **Add the entry with `"truthSource": "weighed"`** and put the raw gram weights in `notes`, so a
   later disagreement can be re-derived instead of re-argued.
5. Re-run `npm run eval` and read the macro error again. On weighed plates it now means what it
   says.

Fifteen to twenty plates would do it, and they should span the case types below — including at
least one deliberately bad photograph, since a well-lit plate can never exercise either verify
trigger (both require the model to return a low-confidence food).

Until then: treat `protein_err_pct` and `kcal_err_pct` as directional, not as accuracy.

### The metrics are noisy — size your conclusions accordingly

Two identical live runs on 2026-09-07 (same prompt, same photos, twenty minutes apart) moved
`protein_err_pct` from 0.278 to 0.198 while `kcal_err_pct` moved the other way. One sample per photo
cannot resolve a change smaller than that swing. The regression gate now uses measured per-metric
noise floors (see `NOISE` in `run-eval.ts`) instead of a flat 0.02 that fired on randomness.

To actually settle an accuracy question, sample more than once:

```
npm run eval -- --repeat=3
```

The aggregate then averages N x plates rather than plates, and costs N times as much. Re-measure the
noise floors after any model change and update the `NOISE` table with what you observed.

## What's explicitly out of scope here

- **Real de-identified athlete meals** — a separate, compliance-gated future project (consent
  basis, face/EXIF stripping, minor-safety review). The manifest format is source-agnostic, so it
  slots in later without a rewrite.
- **CI automation** — live mode costs money and stays a deliberate manual gate. `--replay` is free
  and could run in CI later, but doesn't yet.
- **Fine-tuning** — the brief sequences this eval strictly before any fine-tuning; none happens here.
