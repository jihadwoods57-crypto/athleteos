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

## What's explicitly out of scope here

- **Real de-identified athlete meals** — a separate, compliance-gated future project (consent
  basis, face/EXIF stripping, minor-safety review). The manifest format is source-agnostic, so it
  slots in later without a rewrite.
- **CI automation** — live mode costs money and stays a deliberate manual gate. `--replay` is free
  and could run in CI later, but doesn't yet.
- **Fine-tuning** — the brief sequences this eval strictly before any fine-tuning; none happens here.
