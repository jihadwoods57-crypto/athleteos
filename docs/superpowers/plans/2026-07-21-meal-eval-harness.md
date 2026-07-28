# Meal-Pipeline Eval Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A compliance-free, labeled meal-photo eval set + a runner that scores an analyze-meal change (live, ~$0.20) or a deterministic-layer change (`--replay`, free) against it, with a regression diff vs a committed baseline.

**Architecture:** A pure scoring core in `src/core/evalScore.ts` (jest-tested, reuses the app's pure functions). A `npx tsx eval/run-eval.ts` runner that POSTs photos to a configurable analyze-meal URL, saves raw responses, scores them, and diffs a baseline. Ground truth = food-DB ids + servings → computed macros. No athlete data.

**Tech Stack:** Node 24 (native `fetch`), `tsx` (proven: it resolves the proto ESM `.js` imports + `foodDb.ts` from a TS file — the spike ran `shouldVerify`/`matchFood`/`FOOD_DB` clean), Jest.

## Global Constraints

- **No athlete data.** Dataset is curated + team-captured; committable to the repo.
- **The runner reuses the app's PURE functions** (`matchFood` — `nutrition.js`; `mealQualityScore`/`qualityBand`/`analysisAgreesWithBand`/`shouldVerify` — `meal-intel.js`; `FOOD_DB` — `src/core/foodDb.ts`). It does NOT import `groundResult` (browser-coupled in `state.js`).
- **Runner invocation is `npx tsx eval/run-eval.ts` — proven working in the spike.** Do not switch to bare `node` (repo is CommonJS; proto `.js` are ESM — bare node errors on `export`).
- **Cost is NOT in the response** (no token counts). The harness measures **latency** in-process; the run's actual **cost** is read from 8a's `ai_cost_daily` for the run window (every eval call is recorded as `mode=meal`).
- **Live mode makes real paid calls** — deliberate/manual only, never CI. `--replay` is free.
- Jest import pattern for proto modules: `// @ts-ignore` + `import {...} from '../../proto/redesign-2026-07/js/<mod>.js'` (existing tests do this).

---

### Task 1: Scoring core (`src/core/evalScore.ts`) + jest tests

**Files:**
- Create: `src/core/evalScore.ts`
- Test: `src/core/evalScore.test.ts`

**Interfaces:**
- Produces: `expectedMacros`, `scoreDetection`, `scoreMacroError`, `scoreContradiction`, `scoreVerifyTrigger`, `scoreMeal`, and the `ManifestEntry` / `MealResponse` types — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/core/evalScore.test.ts`:

```ts
import { expectedMacros, scoreDetection, scoreMacroError, scoreVerifyTrigger } from './evalScore';

describe('expectedMacros', () => {
  test('sums food-db macros times servings', () => {
    // chicken-breast per = protein35/kcal187/carbs0/fat4; 2 servings
    const m = expectedMacros([{ foodDbId: 'chicken-breast', servings: 2 }]);
    expect(m).toEqual({ protein: 70, kcal: 374, carbs: 0, fat: 8 });
  });
  test('unknown ids are skipped, not crashed', () => {
    expect(expectedMacros([{ foodDbId: 'nope', servings: 1 }])).toEqual({ protein: 0, kcal: 0, carbs: 0, fat: 0 });
  });
});

describe('scoreDetection', () => {
  test('precision/recall against expected foods', () => {
    const d = scoreDetection([{ name: 'grilled chicken' }, { name: 'white rice' }], [{ foodDbId: 'chicken-breast', servings: 1 }]);
    expect(d.recall).toBe(1);       // chicken found
    expect(d.expectedCount).toBe(1);
    expect(d.detectedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('scoreMacroError', () => {
  test('absolute + pct error per macro', () => {
    const e = scoreMacroError({ protein: 40, kcal: 600, carbs: 50, fat: 20 }, { protein: 50, kcal: 500, carbs: 50, fat: 20 });
    expect(e.protein.abs).toBe(10);
    expect(e.protein.pct).toBeCloseTo(0.2);
    expect(e.kcal.abs).toBe(100);
  });
});

describe('scoreVerifyTrigger', () => {
  test('accuracy trigger expected + fires', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40 },
      { id: 'x', photo: 'x', caseType: 'known-failure', expectedFoods: [], expectVerify: 'accuracy' });
    expect(r).toEqual({ expected: 'accuracy', fired: 'accuracy', correct: true });
  });
  test('clear case expects none, stays quiet', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'chicken', kcal: 500, confidence: 'high' }], quality: 85 },
      { id: 'y', photo: 'y', caseType: 'clear', expectedFoods: [], expectVerify: 'none' });
    expect(r.correct).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/core/evalScore.test.ts`
Expected: FAIL — `Cannot find module './evalScore'`.

- [ ] **Step 3: Implement `src/core/evalScore.ts`**

```ts
// Pure scoring core for the meal eval harness. Reuses the app's own pure functions so the
// metrics match what ships. Jest-tested; also imported by eval/run-eval.ts (via tsx).
// @ts-ignore - proto ESM js, resolved by jest transform / tsx
import { matchFood } from '../../proto/redesign-2026-07/js/nutrition.js';
// @ts-ignore
import { mealQualityScore, qualityBand, analysisAgreesWithBand, shouldVerify } from '../../proto/redesign-2026-07/js/meal-intel.js';
import { FOOD_DB } from './foodDb';

export interface ExpectedFood { foodDbId: string; servings: number }
export interface ManifestEntry {
  id: string; photo: string; caseType: string; expectedFoods: ExpectedFood[];
  hasSevereAllergen?: boolean; expectVerify?: 'accuracy' | 'allergen' | 'none'; notes?: string;
}
export interface MealResponse {
  detected?: Array<{ name?: string; confidence?: string; protein?: number; kcal?: number; carbs?: number; fat?: number }>;
  protein?: number; kcal?: number; carbs?: number; fat?: number; quality?: number; fiber?: number; analysis?: string;
}

const FOOD_BY_ID = new Map<string, any>((FOOD_DB as any[]).map((f) => [f.id, f]));

export function expectedMacros(foods: ExpectedFood[]) {
  const t = { protein: 0, kcal: 0, carbs: 0, fat: 0 };
  for (const { foodDbId, servings } of foods) {
    const f = FOOD_BY_ID.get(foodDbId); if (!f) continue;
    const s = Number(servings) || 0;
    t.protein += f.per.protein * s; t.kcal += f.per.kcal * s; t.carbs += f.per.carbs * s; t.fat += f.per.fat * s;
  }
  return { protein: Math.round(t.protein), kcal: Math.round(t.kcal), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

export function scoreDetection(detected: MealResponse['detected'], expected: ExpectedFood[]) {
  const detectedIds = new Set<string>();
  for (const d of detected || []) { const m = matchFood(d && d.name); if (m && m.id) detectedIds.add(m.id); }
  const expectedIds = new Set(expected.map((e) => e.foodDbId));
  let matched = 0; for (const id of expectedIds) if (detectedIds.has(id)) matched++;
  return {
    precision: detectedIds.size ? matched / detectedIds.size : 0,
    recall: expectedIds.size ? matched / expectedIds.size : 0,
    matched, detectedCount: detectedIds.size, expectedCount: expectedIds.size,
  };
}

export function scoreMacroError(resp: MealResponse, truth: { protein: number; kcal: number; carbs: number; fat: number }) {
  const err = (a: number | undefined, b: number) => { const x = Number(a) || 0, abs = Math.abs(x - b); return { abs, pct: b ? abs / b : 0 }; };
  return { protein: err(resp.protein, truth.protein), carbs: err(resp.carbs, truth.carbs), fat: err(resp.fat, truth.fat), kcal: err(resp.kcal, truth.kcal) };
}

// true = CONTRADICTION (the AI's analysis tone disagrees with the computed band).
export function scoreContradiction(resp: MealResponse): boolean {
  const q = mealQualityScore({ macros: { protein: resp.protein, carbs: resp.carbs, fat: resp.fat, kcal: resp.kcal }, fiber: resp.fiber, detected: resp.detected, minutesLate: 0 });
  const band = qualityBand(q);
  return band ? !analysisAgreesWithBand(resp.analysis || '', band) : false;
}

export function scoreVerifyTrigger(resp: MealResponse, entry: ManifestEntry) {
  const expected = entry.expectVerify || 'none';
  const severe = (entry.expectVerify === 'allergen' || entry.hasSevereAllergen) ? ['sim'] : [];
  const gate = shouldVerify({ detected: resp.detected, quality: resp.quality, source: 'photo', severeRestrictions: severe, budgetLeft: 3 });
  const fired = gate.fire ? gate.trigger : 'none';
  return { expected, fired, correct: fired === expected };
}

export function scoreMeal(resp: MealResponse, entry: ManifestEntry) {
  const truth = expectedMacros(entry.expectedFoods);
  return {
    id: entry.id, caseType: entry.caseType,
    detection: scoreDetection(resp.detected, entry.expectedFoods),
    macroError: scoreMacroError(resp, truth),
    contradiction: scoreContradiction(resp),
    verify: scoreVerifyTrigger(resp, entry),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/core/evalScore.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/core/evalScore.ts src/core/evalScore.test.ts
git commit -m "feat(eval): pure scoring core for the meal eval harness (item 7)"
```

---

### Task 2: The runner (`eval/run-eval.ts`) + tooling

**Files:**
- Create: `eval/run-eval.ts`, `eval/.gitignore`
- Modify: `package.json` (add `tsx` devDep + an `eval` script)

**Interfaces:**
- Consumes: `src/core/evalScore.ts` (Task 1), `eval/manifest.json` (Task 3).

- [ ] **Step 1: Add tsx + npm script**

Run: `npm install -D tsx`
Then in `package.json` `scripts`, add: `"eval": "tsx eval/run-eval.ts"`.

- [ ] **Step 2: Create `eval/.gitignore`**

```
responses/
baselines/*
!baselines/latest.json
```

- [ ] **Step 3: Write the runner**

Create `eval/run-eval.ts`:

```ts
// Meal-pipeline eval runner. Live (paid): POST each photo to analyze-meal, save the raw response,
// score it. Replay (free): re-score saved responses through the deterministic scoring core.
// Writes a baseline and diffs the previous one. Run: `npm run eval -- [--url=..] [--replay] [--no-baseline]`
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMeal, type ManifestEntry, type MealResponse } from '../src/core/evalScore';

const DIR = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : (process.argv.includes(`--${k}`) ? '' : d); };
const URL = arg('url', 'https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/analyze-meal')!;
const REPLAY = process.argv.includes('--replay');
const NO_BASELINE = process.argv.includes('--no-baseline');
const ANON = process.env.EVAL_ANON_KEY || '';

const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const respDir = join(DIR, 'responses'); if (!existsSync(respDir)) mkdirSync(respDir, { recursive: true });

async function getResponse(e: ManifestEntry): Promise<{ resp: MealResponse | null; ms: number }> {
  const cache = join(respDir, `${e.id}.json`);
  if (REPLAY) return { resp: existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : null, ms: 0 };
  const b64 = readFileSync(join(DIR, 'meals', e.photo)).toString('base64');
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ mode: 'meal', mealType: 'Dinner', photoBase64: b64, phase: 'analyze' }),
  });
  const ms = Date.now() - t0;
  const data = await res.json().catch(() => null) as any;
  const resp = data && data.kind === 'result' ? data as MealResponse : null;
  if (resp) writeFileSync(cache, JSON.stringify(resp, null, 2));
  return { resp, ms };
}

function aggregate(scored: ReturnType<typeof scoreMeal>[]) {
  const n = scored.length || 1;
  const mean = (f: (s: any) => number) => scored.reduce((a, s) => a + f(s), 0) / n;
  return {
    meals: scored.length,
    detection_recall: +mean((s) => s.detection.recall).toFixed(3),
    detection_precision: +mean((s) => s.detection.precision).toFixed(3),
    kcal_err_pct: +mean((s) => s.macroError.kcal.pct).toFixed(3),
    protein_err_pct: +mean((s) => s.macroError.protein.pct).toFixed(3),
    contradiction_rate: +mean((s) => (s.contradiction ? 1 : 0)).toFixed(3),
    verify_trigger_accuracy: +mean((s) => (s.verify.correct ? 1 : 0)).toFixed(3),
  };
}

(async () => {
  if (!REPLAY && !ANON) { console.error('Set EVAL_ANON_KEY for a live run (or use --replay).'); process.exit(1); }
  const scored: ReturnType<typeof scoreMeal>[] = [];
  let totalMs = 0, calls = 0;
  for (const e of manifest) {
    const { resp, ms } = await getResponse(e);
    totalMs += ms; if (!REPLAY && resp) calls++;
    if (!resp) { console.warn(`  ${e.id}: no response (${REPLAY ? 'no cached response — run live first' : 'call failed'})`); continue; }
    scored.push(scoreMeal(resp, e));
  }
  const agg = aggregate(scored);
  console.log('\n=== AGGREGATE ==='); console.table(agg);
  console.log(`latency: avg ${scored.length ? Math.round(totalMs / Math.max(calls, 1)) : 0}ms/call over ${calls} live calls`);
  if (!REPLAY) console.log('cost: read ai_cost_daily for this run window (8a records every eval call as mode=meal).');

  // per-case breakdown
  const byCase: Record<string, ReturnType<typeof scoreMeal>[]> = {};
  for (const s of scored) (byCase[s.caseType] ||= []).push(s);
  console.log('\n=== BY CASE ==='); console.table(Object.fromEntries(Object.entries(byCase).map(([k, v]) => [k, aggregate(v)])));

  // baseline diff (upgrade #1)
  const baseDir = join(DIR, 'baselines'); if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const latest = join(baseDir, 'latest.json');
  if (existsSync(latest)) {
    const prev = JSON.parse(readFileSync(latest, 'utf8')).aggregate;
    console.log('\n=== VS BASELINE ===');
    for (const k of Object.keys(agg)) {
      const d = (agg as any)[k] - (prev[k] ?? 0);
      const worse = /err_pct|contradiction/.test(k) ? d > 0.02 : d < -0.02;
      if (Math.abs(d) >= 0.001) console.log(`  ${worse ? '⚠ ' : '  '}${k}: ${prev[k]} → ${(agg as any)[k]} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
    }
  }
  if (!NO_BASELINE && !REPLAY) {
    const stamp = process.env.EVAL_STAMP || 'run';
    const rec = { aggregate: agg, meals: scored.length };
    writeFileSync(join(baseDir, `${stamp}.json`), JSON.stringify(rec, null, 2));
    writeFileSync(latest, JSON.stringify(rec, null, 2));
    console.log(`\nbaseline written → eval/baselines/latest.json`);
  }
})();
```

> Note: `Date.now()`/`new Date()` are fine here — this is a plain Node script, not a Workflow script. Pass `EVAL_STAMP` (a date string) from the shell for a dated baseline file since the runner shouldn't hardcode one.

- [ ] **Step 4: Verify replay path on a hand-made fixture**

Create `eval/responses/_smoke.json` won't match a manifest id, so instead: after Task 3's manifest exists, run `npm run eval -- --replay`. For now verify the file type-checks:
Run: `npx tsc --noEmit eval/run-eval.ts 2>&1 | grep -v "node_modules" | head` (expect no errors from run-eval itself; module-resolution errors about `.js` imports are the known proto pattern and don't block `tsx`).
Actual end-to-end replay + live are exercised in Task 4.

- [ ] **Step 5: Commit**

```bash
git add eval/run-eval.ts eval/.gitignore package.json package-lock.json
git commit -m "feat(eval): tsx runner — live + replay + baseline diff (item 7)"
```

---

### Task 3: Seed dataset + README

**Files:**
- Create: `eval/manifest.json`, `eval/meals/*.jpeg`, `eval/README.md`

- [ ] **Step 1: Copy the seed photos**

```bash
mkdir -p eval/meals
cp a1-meal.jpeg eval/meals/clear-01.jpeg
```
(Inspect `a1-zoom.jpeg` / `a1-home.jpeg`; include any that show a real plate as `mixed-01.jpeg` etc. `a1-home.jpeg` is a home screen — skip if not a meal.)

- [ ] **Step 2: Write the manifest**

Create `eval/manifest.json` — label the real photo, and include **synthetic-response-free** entries only for photos that exist. Label `clear-01` by what's actually on the plate (open `eval/meals/clear-01.jpeg`, list its foods from `FOOD_DB`, estimate servings). Example shape (fill `expectedFoods` from the real photo):

```json
[
  {
    "id": "clear-01",
    "photo": "clear-01.jpeg",
    "caseType": "clear",
    "expectedFoods": [{ "foodDbId": "salmon", "servings": 1.5 }, { "foodDbId": "white-rice", "servings": 1 }, { "foodDbId": "asparagus", "servings": 1 }],
    "hasSevereAllergen": false,
    "expectVerify": "none",
    "notes": "well-lit single plate — verify must stay quiet"
  }
]
```

> Design constraint #3: as team photos are added, ensure the set includes at least one `known-failure`/`poor-image` entry with `"expectVerify": "accuracy"` and one `hasSevereAllergen: true` + `"expectVerify": "allergen"` entry, so the harness validates the item-6 triggers. The seed (one clear photo) covers the "stays quiet" case; the README instructs adding the trigger cases.

- [ ] **Step 3: Write `eval/README.md`**

Document: what the harness is; `npm run eval -- --replay` (free) vs live (`EVAL_ANON_KEY=... npm run eval`); how to add a meal (photograph a plate → drop `eval/meals/<id>.jpeg` → add a manifest entry listing foods from `src/core/foodDb.ts` + servings → `expectVerify` intent); the case-type checklist (#3); and that live runs cost ~$0.01/meal and their cost shows in `ai_cost_daily`.

- [ ] **Step 4: Commit**

```bash
git add eval/manifest.json eval/meals eval/README.md
git commit -m "feat(eval): seed dataset (real photo) + how-to-add doc (item 7)"
```

---

### Task 4: First live run + committed baseline

**Files:** Create `eval/baselines/latest.json` (committed)

- [ ] **Step 1: Live run against prod**

```bash
EVAL_ANON_KEY=$(supabase projects api-keys --project-ref ftwrvylzoyznhbzhgism -o json | python -c "import sys,json;print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))") \
EVAL_STAMP=2026-07-21 npm run eval
```
Expected: an aggregate + by-case table, latency line, and `baseline written`. Confirm the `clear-01` verify column is `correct` (trigger stayed quiet).

- [ ] **Step 2: Verify replay is free + deterministic**

Run: `npm run eval -- --replay`
Expected: same aggregate as the live run (re-scored from the saved response), no network, no "VS BASELINE" regressions.

- [ ] **Step 3: Confirm cost landed in 8a**

Run: `supabase db query --linked -o table "select fn, mode, count(*), round(sum(cost_usd),4) from public.ai_call_costs where created_at > now() - interval '1 hour' and mode='meal' group by 1,2;"`
Expected: rows for the eval's meal calls, priced — proving the eval's cost is visible in the 8a surface.

- [ ] **Step 4: Commit the baseline**

```bash
git add eval/baselines/latest.json
git commit -m "chore(eval): first committed baseline for the meal eval harness (item 7)"
```

---

## Self-Review

**Spec coverage:** §2 dataset → Task 3; §3 runner (live/replay/parity) → Task 2 + Task 1; §4 metrics → Task 1 (evalScore) + Task 2 (aggregate/latency) + Task 4 Step 3 (cost via 8a); §5 verify-validation (#3) → Task 1 `scoreVerifyTrigger` + Task 3 manifest/README constraint; §6 baseline diff (#1) → Task 2 runner; §7 seed + README → Task 3; §8 out-of-scope respected (no real-meal, no CI, no fine-tuning). All mapped.

**Placeholder scan:** Task 3 `expectedFoods` is filled from the *real photo's actual contents* at implementation time (the labeler opens the image) — this is a data-entry step against a concrete image, not a code placeholder. All code steps show complete code.

**Type consistency:** `ManifestEntry`/`MealResponse` defined in Task 1, imported by Task 2's runner; `scoreMeal` return shape consumed by `aggregate()` field-by-field (`detection.recall`, `macroError.kcal.pct`, `verify.correct`) — matches Task 1's definitions. `matchFood` returns item-or-undefined (guarded with `m && m.id`). Cost deliberately absent from `evalScore` (response has no tokens) — sourced from 8a, consistent across spec §4 refinement and Task 4.
