# Meal Confidence + Conditional Second-Pass Verifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow, budgeted, pre-log second AI pass that fires only on two high-stakes triggers (allergen-uncertain, low-confidence-and-values-off), plus weighted confidence and per-call effectiveness capture.

**Architecture:** Pure trigger/merge logic lives in the client proto (`meal-intel.js`, Jest-tested); the second AI call is a new `phase:'verify'` in the `analyze-meal` edge function that re-detects (AI) and re-grounds (deterministic `groundMacros`); a nullable `outcome` column on `ai_calls` records whether the call changed anything. Everything runs before the athlete confirms, so no result is ever silently overridden.

**Tech Stack:** Deno edge function + `@anthropic-ai/sdk`, Supabase Postgres migrations, browser JS proto (`proto/redesign-2026-07/js`), Jest (`src/core/*.test.ts`).

## Global Constraints

- **AI detects; deterministic code sets every number.** The verify pass returns detections only; macros come from `groundMacros`. Never let the model write a macro or score.
- **No silent override.** Verify runs pre-log (before confirm/save); it only improves the estimate the athlete is about to review. No new "accept correction" UI.
- **Never blocks a log.** Verify is best-effort: on error/timeout/over-budget, proceed on the first read + existing deterministic guards.
- **Meal-session isolation.** Verify reuses the same session's photo; introduces no cross-meal state.
- **Model:** vision paths use `MODEL` (`claude-sonnet-5`); the regen path uses `TEXT_MODEL` (`claude-haiku-4-5-20251001`). Never change routing.
- **Migrations 0104 is un-applied — apply 0106 directly via `supabase db query --linked -f`, keep it idempotent** (matches how 0105 was applied; a later `db push` re-runs it harmlessly).
- **Edge functions are outside tsc/jest** — verify them with `deno check` + hand review (repo convention). Pure proto functions get real Jest TDD.
- Run a single Jest file: `npx jest src/core/mealIntel.test.ts`. Run all: `npm test`.

---

### Task 1: Migration 0106 — `outcome` column + `recordAiCall` optional field

**Files:**
- Create: `supabase/migrations/0106_ai_calls_outcome.sql`
- Modify: `supabase/functions/_shared/ai-telemetry.ts` (add `outcome` to `AiCallRecord` + the insert)

**Interfaces:**
- Produces: `ai_calls.outcome text` (nullable); `AiCallRecord.outcome?: string | null` consumed by Task 5.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0106_ai_calls_outcome.sql`:

```sql
-- 0106_ai_calls_outcome.sql — records whether a paid AI call changed anything.
-- Used by the meal verifier (mode='verify') to prove the second call earns its keep:
-- 'no_change' | 'macros_moved' | 'allergen_caught'. Nullable; null for every non-verify call.
alter table public.ai_calls add column if not exists outcome text;
```

- [ ] **Step 2: Add `outcome` to the helper**

In `supabase/functions/_shared/ai-telemetry.ts`, add to the `AiCallRecord` interface (after `errorCode`):

```ts
  outcome?: string | null;   // verifier effectiveness: 'no_change'|'macros_moved'|'allergen_caught'
```

And in the `insert({...})` object in `recordAiCall`, add (after `error_code`):

```ts
      outcome: rec.outcome ?? null,
```

- [ ] **Step 3: Type-check the helper**

Run: `deno check supabase/functions/_shared/ai-telemetry.ts`
Expected: `Check supabase/functions/_shared/ai-telemetry.ts` (no errors).

- [ ] **Step 4: Apply + verify the migration on prod**

Run:
```bash
supabase db query --linked -f supabase/migrations/0106_ai_calls_outcome.sql
supabase db query --linked -o table "select column_name from information_schema.columns where table_name='ai_calls' and column_name='outcome';"
```
Expected: the second query returns one row, `outcome`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0106_ai_calls_outcome.sql supabase/functions/_shared/ai-telemetry.ts
git commit -m "feat(ai): ai_calls.outcome column for verifier effectiveness (0106)"
```

---

### Task 2: Weighted confidence (`weightedConfidence`)

Add a NEW pure function for the accuracy trigger. Leave `estimateConfidence` untouched so display behavior is unchanged (per spec §5: keep display intact).

**Files:**
- Modify: `proto/redesign-2026-07/js/meal-intel.js` (add `weightedConfidence` next to `estimateConfidence`, ~line 146)
- Test: `src/core/mealIntel.test.ts`

**Interfaces:**
- Produces: `weightedConfidence(detected): 'low'|'medium'|'high'` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/mealIntel.test.ts`:

```ts
// @ts-ignore
import { weightedConfidence } from '../../proto/redesign-2026-07/js/meal-intel.js';

describe('weightedConfidence', () => {
  test('a low-confidence garnish does not drag a well-read plate to low', () => {
    // 700 kcal high-confidence chicken+rice, 20 kcal low-confidence garnish
    const detected = [
      { name: 'chicken', kcal: 400, confidence: 'high' },
      { name: 'rice', kcal: 300, confidence: 'high' },
      { name: 'garnish', kcal: 20, confidence: 'low' },
    ];
    expect(weightedConfidence(detected)).toBe('high');
  });

  test('low confidence on the calorie-dominant food is low overall', () => {
    const detected = [
      { name: 'mystery stew', kcal: 600, confidence: 'low' },
      { name: 'bread', kcal: 100, confidence: 'high' },
    ];
    expect(weightedConfidence(detected)).toBe('low');
  });

  test('empty or missing kcal falls back to medium (never crashes)', () => {
    expect(weightedConfidence([])).toBe('medium');
    expect(weightedConfidence([{ name: 'x', confidence: 'low' }])).toBe('low');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/core/mealIntel.test.ts -t weightedConfidence`
Expected: FAIL — `weightedConfidence is not a function`.

- [ ] **Step 3: Implement**

In `proto/redesign-2026-07/js/meal-intel.js`, after `estimateConfidence` (line ~146), add:

```js
/** Calorie-share-weighted overall confidence, for the accuracy verify trigger.
 *  Each food contributes a numeric weight (high=1, medium=0.5, low=0) scaled by its
 *  kcal share; the weighted mean maps back to a band. A small low-confidence item can't
 *  drag a well-read plate down. Foods without kcal are weighted equally as a fallback. */
export function weightedConfidence(detected) {
  const rich = Array.isArray(detected) ? detected.filter(Boolean) : [];
  if (!rich.length) return 'medium';
  const score = (c) => (c === 'high' ? 1 : c === 'medium' ? 0.5 : 0);
  const kcalOf = (d) => Math.max(0, Number(d.kcal) || 0);
  const totalKcal = rich.reduce((s, d) => s + kcalOf(d), 0);
  const weight = (d) => (totalKcal > 0 ? kcalOf(d) / totalKcal : 1 / rich.length);
  const mean = rich.reduce((s, d) => s + score(d.confidence) * weight(d), 0);
  if (mean >= 0.75) return 'high';
  if (mean >= 0.35) return 'medium';
  return 'low';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/core/mealIntel.test.ts -t weightedConfidence`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/meal-intel.js src/core/mealIntel.test.ts
git commit -m "feat(meal): calorie-weighted confidence for the verify accuracy trigger"
```

---

### Task 3: Trigger gate (`shouldVerify`)

**Files:**
- Modify: `proto/redesign-2026-07/js/meal-intel.js` (add `shouldVerify`)
- Test: `src/core/mealIntel.test.ts`

**Interfaces:**
- Consumes: `weightedConfidence` (Task 2).
- Produces: `shouldVerify({ detected, quality, source, severeRestrictions, budgetLeft }): { fire: boolean, trigger: 'allergen'|'accuracy'|null }` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/mealIntel.test.ts`:

```ts
// @ts-ignore
import { shouldVerify } from '../../proto/redesign-2026-07/js/meal-intel.js';

describe('shouldVerify', () => {
  const base = { detected: [{ name: 'chicken', kcal: 500, confidence: 'high' }], quality: 80, source: 'photo', severeRestrictions: [], budgetLeft: 3 };

  test('severe-restriction athlete + any low-confidence food -> allergen', () => {
    const r = shouldVerify({ ...base, detected: [{ name: 'sauce', kcal: 50, confidence: 'low' }], severeRestrictions: ['peanut'] });
    expect(r).toEqual({ fire: true, trigger: 'allergen' });
  });

  test('weighted-low confidence + quality<50 -> accuracy', () => {
    const r = shouldVerify({ ...base, detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40 });
    expect(r).toEqual({ fire: true, trigger: 'accuracy' });
  });

  test('no fire when confident + on-plan', () => {
    expect(shouldVerify(base)).toEqual({ fire: false, trigger: null });
  });

  test('no fire when budget exhausted', () => {
    const r = shouldVerify({ ...base, detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40, budgetLeft: 0 });
    expect(r).toEqual({ fire: false, trigger: null });
  });

  test('allergen takes precedence over accuracy', () => {
    const r = shouldVerify({ detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40, source: 'photo', severeRestrictions: ['dairy'], budgetLeft: 3 });
    expect(r).toEqual({ fire: true, trigger: 'allergen' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/core/mealIntel.test.ts -t shouldVerify`
Expected: FAIL — `shouldVerify is not a function`.

- [ ] **Step 3: Implement**

In `proto/redesign-2026-07/js/meal-intel.js`, after `weightedConfidence`, add:

```js
/** Pure gate for the second-pass verifier. Fires on exactly two high-stakes cases:
 *  (a) allergen: the athlete has a severe restriction AND any food is low-confidence
 *      (per-food, so a single uncertain item that could hide an allergen still fires);
 *  (b) accuracy: calorie-weighted confidence is low AND the read looks off (quality<50).
 *  allergen wins ties. No fire when the photo source isn't a photo, or budget is spent. */
export function shouldVerify({ detected, quality, source, severeRestrictions, budgetLeft } = {}) {
  const none = { fire: false, trigger: null };
  if (source !== 'photo') return none;
  if (!(Number(budgetLeft) > 0)) return none;
  const foods = Array.isArray(detected) ? detected.filter(Boolean) : [];
  const anyLow = foods.some((d) => d.confidence === 'low');
  const hasSevere = Array.isArray(severeRestrictions) && severeRestrictions.length > 0;
  if (hasSevere && anyLow) return { fire: true, trigger: 'allergen' };
  const q = Number(quality);
  if (weightedConfidence(foods) === 'low' && isFinite(q) && q < 50) {
    return { fire: true, trigger: 'accuracy' };
  }
  return none;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/core/mealIntel.test.ts -t shouldVerify`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/meal-intel.js src/core/mealIntel.test.ts
git commit -m "feat(meal): shouldVerify trigger gate (allergen + accuracy)"
```

---

### Task 4: Verify-outcome classifier (`classifyVerifyOutcome`)

**Files:**
- Modify: `proto/redesign-2026-07/js/meal-intel.js` (add `classifyVerifyOutcome`)
- Test: `src/core/mealIntel.test.ts`

**Interfaces:**
- Produces: `classifyVerifyOutcome(first, second): 'no_change'|'macros_moved'|'allergen_caught'` — used server-side (Task 5 mirrors this logic) and client-side (Task 7).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/mealIntel.test.ts`:

```ts
// @ts-ignore
import { classifyVerifyOutcome } from '../../proto/redesign-2026-07/js/meal-intel.js';

describe('classifyVerifyOutcome', () => {
  test('allergen found in second read but not first -> allergen_caught', () => {
    const first = { kcal: 500, protein: 40, allergensFound: [] };
    const second = { kcal: 500, protein: 40, allergensFound: ['peanut'] };
    expect(classifyVerifyOutcome(first, second)).toBe('allergen_caught');
  });

  test('kcal moved beyond 15% -> macros_moved', () => {
    expect(classifyVerifyOutcome({ kcal: 500, protein: 40 }, { kcal: 700, protein: 40 })).toBe('macros_moved');
  });

  test('protein moved beyond 15% -> macros_moved', () => {
    expect(classifyVerifyOutcome({ kcal: 500, protein: 40 }, { kcal: 500, protein: 60 })).toBe('macros_moved');
  });

  test('within tolerance and no allergen -> no_change', () => {
    expect(classifyVerifyOutcome({ kcal: 500, protein: 40 }, { kcal: 520, protein: 41 })).toBe('no_change');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/core/mealIntel.test.ts -t classifyVerifyOutcome`
Expected: FAIL — `classifyVerifyOutcome is not a function`.

- [ ] **Step 3: Implement**

In `proto/redesign-2026-07/js/meal-intel.js`, after `shouldVerify`, add:

```js
/** What the second pass actually did, for effectiveness telemetry (ai_calls.outcome).
 *  allergen_caught if the re-scan flagged an allergen the first read didn't; else
 *  macros_moved if kcal or protein shifted >15%; else no_change. */
export function classifyVerifyOutcome(first, second) {
  const firstAllergens = (first && Array.isArray(first.allergensFound)) ? first.allergensFound : [];
  const secondAllergens = (second && Array.isArray(second.allergensFound)) ? second.allergensFound : [];
  if (secondAllergens.some((a) => !firstAllergens.includes(a))) return 'allergen_caught';
  const moved = (a, b) => {
    const x = Number(a) || 0, y = Number(b) || 0;
    const denom = Math.max(1, x);
    return Math.abs(y - x) / denom > 0.15;
  };
  if (moved(first && first.kcal, second && second.kcal)) return 'macros_moved';
  if (moved(first && first.protein, second && second.protein)) return 'macros_moved';
  return 'no_change';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/core/mealIntel.test.ts -t classifyVerifyOutcome`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/meal-intel.js src/core/mealIntel.test.ts
git commit -m "feat(meal): classifyVerifyOutcome for verifier effectiveness"
```

---

### Task 5: Server `phase:'verify'` in analyze-meal

Adds the second AI pass. Two shapes dispatched on `req.verifyTrigger`. Edge convention: `deno check` + hand review (no jest).

**Files:**
- Modify: `supabase/functions/analyze-meal/index.ts`

**Interfaces:**
- Consumes: `AiCallRecord.outcome` (Task 1), request field `verifyTrigger: 'allergen'|'accuracy'`, `severeRestrictions: string[]`, `firstResult: { kcal, protein }`.
- Produces: response `{ kind:'verify', trigger, ...grounded }` (accuracy) or `{ kind:'verify', trigger:'allergen', allergensFound: string[] }` (allergen).

- [ ] **Step 1: Add the verify budget + request fields**

Near the other `posIntCap` budgets (after `CLARIFY_BUDGET`, ~line 79), add:

```ts
// Per-athlete daily ceiling on the SECOND-PASS verify call, separate from the clarify budget.
const VERIFY_BUDGET = posIntCap('VERIFY_DAILY_BUDGET', 3);
```

In the `AnalyzeReq` interface, add these optional fields:

```ts
  verifyTrigger?: 'allergen' | 'accuracy';
  severeRestrictions?: string[];
  firstResult?: { kcal?: number; protein?: number };
```

- [ ] **Step 2: Add `isVerify` dispatch + budget claim**

After `const isFinalize = ...` (~line 631), add:

```ts
  const isVerify = isMeal && req?.phase === 'verify' && (req.verifyTrigger === 'allergen' || req.verifyTrigger === 'accuracy');
```

After the per-caller cap block (~line 715), before the model-call section, add a verify-specific claim (verify is a meal photo call, so it also needs `photoBase64`):

```ts
  if (isVerify) {
    if (typeof req.photoBase64 !== 'string' || !req.photoBase64) {
      return new Response(JSON.stringify({ error: 'photo required for verify' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const vkey = userId ? `verify_user:${userId}` : `verify_ip:${clientIp(request)}`;
    if (!(await withinKeyCap(vkey, VERIFY_BUDGET, /* failOpen */ false))) {
      return new Response(JSON.stringify({ error: 'verify budget reached' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
```

- [ ] **Step 3: Add the ALLERGEN_TOOL + VERIFY system prompts**

Near the other tool/system constants, add:

```ts
const ALLERGEN_TOOL = {
  name: 'report_allergens',
  description: 'Report whether each named allergen is present in the photo. Detection only — do not score or estimate macros.',
  input_schema: {
    type: 'object',
    properties: {
      allergens: {
        type: 'array',
        description: 'One entry per allergen asked about.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            present: { type: 'boolean' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['name', 'present', 'confidence'],
        },
      },
    },
    required: ['allergens'],
  },
} as const;

const VERIFY_ALLERGEN_SYSTEM =
  'You re-examine an athlete meal photo ONLY to check for specific declared allergens. ' +
  'For each allergen, say whether it is visibly present and your confidence. Detection only: never score the meal, never estimate macros, never guarantee safety.';
const VERIFY_ACCURACY_SYSTEM = SYSTEM +
  '\n\nThis is a SECOND look: the first read was low-confidence. Re-identify the foods and portions carefully. Detection only — the app computes the numbers.';
```

- [ ] **Step 4: Branch the model call + records for verify**

In the handler, BEFORE the existing `const system = isMemory ? ... : SYSTEM;` line (~line 717), add a self-contained verify branch that returns before the normal path:

```ts
  if (isVerify) {
    const t0v = Date.now();
    try {
      const client = new Anthropic({ apiKey: key });
      if (req.verifyTrigger === 'allergen') {
        const names = (Array.isArray(req.severeRestrictions) ? req.severeRestrictions : []).map(String).slice(0, 12);
        const msg = await client.messages.create({
          model: MODEL,
          max_tokens: 512,
          system: [{ type: 'text', text: VERIFY_ALLERGEN_SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: [{ ...ALLERGEN_TOOL, cache_control: { type: 'ephemeral' } }],
          tool_choice: { type: 'tool', name: ALLERGEN_TOOL.name },
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: photoMime, data: req.photoBase64 } },
            { type: 'text', text: `Check ONLY for these allergens: ${names.join(', ')}` },
          ] }],
        });
        const used = msg.content.find((b) => b.type === 'tool_use');
        const rows = used && used.type === 'tool_use' && Array.isArray((used.input as { allergens?: unknown }).allergens)
          ? (used.input as { allergens: Array<{ name?: string; present?: boolean }> }).allergens : [];
        const allergensFound = rows.filter((a) => a && a.present === true).map((a) => String(a.name)).filter(Boolean);
        await recordAiCall({ fn: 'analyze-meal', mode: 'verify', phase: 'allergen', userId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0v, ok: true, outcome: allergensFound.length ? 'allergen_caught' : 'no_change' });
        return new Response(JSON.stringify({ kind: 'verify', trigger: 'allergen', allergensFound }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      // accuracy: re-detect, then re-ground with the existing deterministic path
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: VERIFY_ACCURACY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...MEAL_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: MEAL_TOOL.name },
        messages: [{ role: 'user', content: userContent(req, photoMime) }],
      });
      const used = msg.content.find((b) => b.type === 'tool_use');
      if (!used || used.type !== 'tool_use') throw new Error('no structured output');
      const grounded = groundMacros(used.input) as Record<string, unknown>;
      const first = req.firstResult || {};
      const outcome = classifyVerifyOutcomeServer(first, grounded);
      await recordAiCall({ fn: 'analyze-meal', mode: 'verify', phase: 'accuracy', userId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0v, ok: true, outcome });
      return new Response(JSON.stringify({ kind: 'verify', trigger: 'accuracy', ...grounded }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (e) {
      await recordAiCall({ fn: 'analyze-meal', mode: 'verify', phase: req.verifyTrigger, userId, model: MODEL, latencyMs: Date.now() - t0v, ok: false, errorCode: 'upstream_error' });
      console.error('analyze-meal verify error:', e);
      return new Response(JSON.stringify({ error: 'verify unavailable' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
```

Add a small server-local copy of the outcome classifier (edge functions can't import the proto module) near the top helpers:

```ts
// Mirror of proto classifyVerifyOutcome (accuracy path only — allergen is decided inline above).
function classifyVerifyOutcomeServer(first: { kcal?: number; protein?: number }, second: Record<string, unknown>): string {
  const moved = (a: unknown, b: unknown) => {
    const x = Number(a) || 0, y = Number(b) || 0;
    return Math.abs(y - x) / Math.max(1, x) > 0.15;
  };
  if (moved(first.kcal, second.kcal)) return 'macros_moved';
  if (moved(first.protein, second.protein)) return 'macros_moved';
  return 'no_change';
}
```

- [ ] **Step 5: Type-check**

Run: `deno check supabase/functions/analyze-meal/index.ts`
Expected: only the pre-existing `TS2769` (as-const tools). No error referencing `isVerify`, `VERIFY_*`, `classifyVerifyOutcomeServer`, `ALLERGEN_TOOL`.

- [ ] **Step 6: Hand-review checklist** (record in the commit body)

Confirm: verify path returns before the normal path; allergen path never estimates macros; accuracy re-grounds via `groundMacros`; both record via `recordAiCall` with `mode='verify'`; failure path records `ok:false` and 502s; budget claim fails closed.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/analyze-meal/index.ts
git commit -m "feat(meal): analyze-meal phase:verify (allergen re-scan + accuracy re-detect)"
```

---

### Task 6: Server `regen` path (score-language, Haiku, toggleable)

**Files:**
- Modify: `supabase/functions/analyze-meal/index.ts`

**Interfaces:**
- Consumes: request `{ mode:'regen', band:'low'|'good', text:string }`.
- Produces: `{ text: string }` (rewritten) or falls through to the caller's deterministic copy on failure.

- [ ] **Step 1: Add the env toggle + REGEN tool/system**

Near the constants:

```ts
const REGEN_ENABLED = (Deno.env.get('VERIFY_REGEN_ENABLED') ?? 'true') !== 'false';
const REGEN_TOOL = {
  name: 'rewrite_coaching',
  description: 'Rewrite a coaching line to match the meal band. Change no numbers.',
  input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
} as const;
const REGEN_SYSTEM =
  'You rewrite one short coaching line so its tone matches the meal band. Keep every number identical. ' +
  'A low band must not sound like praise; a good band must not sound damning. Output only the rewritten line.';
```

- [ ] **Step 2: Add the `isRegen` dispatch**

After `const isVerify = ...`:

```ts
  const isRegen = req?.mode === 'regen';
```

In `AnalyzeReq`, add: `band?: 'low' | 'good'; text?: string;`

- [ ] **Step 3: Handle regen (before the normal path, after the verify branch)**

```ts
  if (isRegen) {
    if (!REGEN_ENABLED) return new Response(JSON.stringify({ error: 'regen disabled' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });
    const src = String(req.text ?? '').slice(0, 1200);
    if (!src || (req.band !== 'low' && req.band !== 'good')) return new Response(JSON.stringify({ error: 'bad regen request' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    const t0g = Date.now();
    try {
      const client = new Anthropic({ apiKey: key });
      const msg = await client.messages.create({
        model: TEXT_MODEL,
        max_tokens: 300,
        system: [{ type: 'text', text: REGEN_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [{ ...REGEN_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: REGEN_TOOL.name },
        messages: [{ role: 'user', content: `Band: ${req.band}. Rewrite: ${src}` }],
      });
      const used = msg.content.find((b) => b.type === 'tool_use');
      const text = used && used.type === 'tool_use' ? String((used.input as { text?: unknown }).text ?? '') : '';
      await recordAiCall({ fn: 'analyze-meal', mode: 'regen', userId, model: msg.model ?? TEXT_MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0g, ok: true });
      if (!text) throw new Error('empty regen');
      return new Response(JSON.stringify({ text }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch (e) {
      await recordAiCall({ fn: 'analyze-meal', mode: 'regen', userId, model: TEXT_MODEL, latencyMs: Date.now() - t0g, ok: false, errorCode: 'upstream_error' });
      console.error('analyze-meal regen error:', e);
      return new Response(JSON.stringify({ error: 'regen unavailable' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
```

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/analyze-meal/index.ts`
Expected: only the pre-existing `TS2769`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/analyze-meal/index.ts
git commit -m "feat(meal): analyze-meal regen path (band-matched coaching, Haiku, toggleable)"
```

---

### Task 7: Client wiring — fire verify from the meal screen

Wire the gate into the pre-log flow. Keep pure logic in `meal-intel.js` (tested in Tasks 2-4); `screens/meal.js` is the thin DOM/async glue (hand-reviewed).

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/meal.js` (call verify after the first analyze result; merge)
- Modify: `proto/redesign-2026-07/js/nutrition.js` or the AI client module that calls `analyze-meal` (add a `verifyMeal()` caller) — locate the existing analyze caller first with: `grep -rn "functions/v1/analyze-meal\|mode: 'memory'\|analyzeMeal" proto/redesign-2026-07/js`

**Interfaces:**
- Consumes: `shouldVerify`, `classifyVerifyOutcome` (proto), the deployed verify phase (Task 5).
- Produces: an improved pre-log estimate + allergen alert; no new persisted state.

- [ ] **Step 1: Locate the analyze caller**

Run: `grep -rn "analyze-meal\|analyzeMeal\|kind === 'result'\|kind: 'questions'" proto/redesign-2026-07/js | head -20`
Note the module + function that POSTs to `analyze-meal` and where the first `{kind:'result'}` is handled.

- [ ] **Step 2: Add a `verifyMeal` caller**

In the same module that calls `analyze-meal`, add a function that POSTs `{ mode:'meal', phase:'verify', verifyTrigger, photoBase64, severeRestrictions, firstResult:{kcal,protein}, mealType }` and returns the parsed `{kind:'verify', ...}` or `null` on any non-200 (best-effort — never throw).

- [ ] **Step 3: Wire the gate after the first result**

Where the first `{kind:'result'}` is handled (pre-log, before the athlete confirms): compute the athlete's `severeRestrictions` (from saved profile) and `budgetLeft` (client-tracked count of verify calls today), call:

```js
const gate = shouldVerify({ detected: result.detected, quality: result.quality, source: 'photo', severeRestrictions, budgetLeft });
if (gate.fire) {
  const v = await verifyMeal(gate.trigger, photoBase64, severeRestrictions, { kcal: result.kcal, protein: result.protein }, mealType);
  if (v && v.trigger === 'allergen' && v.allergensFound && v.allergensFound.length) {
    // surface via the EXISTING allergen alert path (meal.js ~line 236), naming the allergen + uncertainty
  } else if (v && v.trigger === 'accuracy' && typeof v.kcal === 'number') {
    // replace the pre-log estimate with v (re-detected + re-grounded); athlete reviews as normal
  }
}
```

- [ ] **Step 4: Headless smoke test (both themes, seeded RT)**

Follow the proto headless render recipe (seed `RT` by module mutation after boot). Render the meal screen with a low-confidence seeded result and confirm no console error and the allergen alert / re-detected estimate renders. (This is a smoke check, not a unit test — the gate/merge logic is already unit-tested in Tasks 2-4.)

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/screens/meal.js proto/redesign-2026-07/js/nutrition.js
git commit -m "feat(meal): fire second-pass verify from the pre-log meal flow"
```

---

### Task 8: Deploy + verify + budget note

**Files:** none (ops)

- [ ] **Step 1: Deploy the function**

Run: `supabase functions deploy analyze-meal`
Expected: `Deployed Functions ... analyze-meal`.

- [ ] **Step 2: Live smoke — accuracy verify**

POST a `phase:'verify', verifyTrigger:'accuracy'` request (anon key, a small test image, `firstResult` with a kcal that will move) and confirm HTTP 200 + `{kind:'verify', trigger:'accuracy', ...}`. Then:

Run: `supabase db query --linked -o table "select mode, phase, model, outcome, cost_usd from public.ai_call_costs where mode='verify' order by created_at desc limit 3;"`
Expected: a row with `mode=verify`, an `outcome` value, and a priced `cost_usd`. Delete the test row afterward.

- [ ] **Step 3: Commit any doc/note updates + set the budget**

Confirm `VERIFY_DAILY_BUDGET` (default 3) and `VERIFY_REGEN_ENABLED` (default true) are the intended prod values; set the secret only if changing from default:
`supabase secrets set VERIFY_DAILY_BUDGET=3` (only if a non-default is wanted).

---

## Self-Review

**Spec coverage:** §3 triggers → Task 3; §4 verify pass → Task 5; §5 weighted confidence → Task 2; §6 effectiveness/`outcome` → Task 1 + Task 5; §7 regen → Task 6; §8 budget/telemetry → Task 5 (budget) + 8a (auto); §9 files → Tasks 1/5/6/7; §10 testing → Tasks 2-4 (jest) + 5/6 (deno) + 8 (live); §11 rollout → Task 8. All spec sections mapped.

**Placeholder scan:** Task 7 intentionally locates the analyze caller at execution time (Step 1) rather than hard-coding a line number, because the exact caller module wasn't read during planning — this is a *discovery step with a concrete command*, not a placeholder. All code steps show real code.

**Type consistency:** `weightedConfidence` → `shouldVerify` (both proto); `shouldVerify` returns `{fire,trigger}` consumed in Task 7; `classifyVerifyOutcome` (proto, Task 4) mirrored as `classifyVerifyOutcomeServer` (Deno, Task 5) — names intentionally distinct because Deno can't import the proto module; both use the same >15% rule. `AiCallRecord.outcome` defined in Task 1, used in Task 5.
