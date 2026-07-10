# Meal Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the post-log meal experience into one unified thread page — Execution Summary → Meal Breakdown → Team Discussion → Next Action — with a derived AI opening message on every meal, grounded follow-up Q&A via a new `meal-chat` edge function, coach emoji reactions, and richer honest analysis data (per-food confidence, fiber, highlights).

**Architecture:** A pure `meal-intel.js` module (tested like `ob-helpers`/`exec`) owns message derivation, detected-food normalization, reaction grouping, and chat-context building. The `analyze-meal` tool schema gains confidence/fiber/highlights with backward-compatible client grounding. The AI opening is derived (never stored, unforgeable); athlete follow-ups persist as `role='athlete'` comments and the AI reply is written server-side by `meal-chat` (service role, `role='ai'`) after a JWT ownership check. `meal-confirm` + `meal-detail` merge into one `meal-thread` screen powered by the exec engine.

**Tech Stack:** Vanilla JS ES modules (proto in WebView), Jest via proto-ESM imports, Deno edge functions (Anthropic SDK pattern from `assist`), Supabase RLS + authored-only migrations.

**Spec:** `docs/superpowers/specs/2026-07-09-meal-intelligence-design.md` (approved; §5/§6 corrected for 0046 RLS on 2026-07-09).

## Global Constraints

- **Tone rule (binding):** the Execution Summary celebrates the act of logging regardless of meal quality — no red, no shame; "Logged late · still counts" framing everywhere. Nutrition coaching educates, never punishes.
- **Numbers are immutable post-log** (score-integrity): foods/macros editable pre-log only; nothing in this cycle writes or recomputes score math (D3) — `S.exec`, `S.score`, `RT.lastMove` are read-only inputs.
- **Unforgeable AI:** clients can never insert `role='ai'` rows (0046 policy stands untouched). The opening message is derived client-side from stored meal data; AI replies are written only by `meal-chat` via service role after verifying (caller-JWT, RLS-scoped select on `meals`) that the meal belongs to the caller.
- **`meal-chat` guards:** per-athlete daily cap default **10/day** (env `MEAL_CHAT_DAILY_CAP`; the free opening message never counts), global cap via `claim_ai_usage_key`, per-IP/min rate limit, CORS allowlist, prompt caching, 8KB context cap (client clamps first, server re-checks), model `claude-sonnet-5` (env `ANTHROPIC_MODEL`). Reply ≤ ~150 words, prose only, coach voice, no em dashes, may only reference numbers present in the provided context. Errors: `{error: 'limit'|'unauthorized'|'bad_request'|'unavailable'}`.
- **Data depth:** `detected` items carry `confidence: 'high'|'medium'|'low'` (legacy plain strings parse as high); `fiber` integer grams clamp ≤ 60; `highlights` ≤ 3 strings, `<>` stripped, ≤ 120 chars each. All estimated figures labeled estimated. Fiber/highlights persist in the day's `slotMacros` meta (jsonb — **no `meals`-table migration**).
- **Migrations authored only** (founder applies at go-live): just `meal_comments.kind text not null default 'message' check (kind in ('message','reaction'))`.
- **Degradation never blocks logging:** no mealId → opening renders locally + composer disabled with "syncs when connected"; `meal-chat` failure → athlete's message stays + quiet "Couldn't reach your AI coach — try again"; thread fetch failure → breakdown stands alone.
- Proto conventions: `esc` from `components.js` on any server/user-traceable string into innerHTML; gen-counter guards on async repaints of shared containers; restore-don't-clobber on re-entry; screens `{tab?, hideTabs?, render({sub}), mount(root, {sub})?}` registered in `screens/index.js`.
- Verify after each task: `npm run typecheck && npm run test` (currently 132 suites / 1632 tests, must stay green). Commit per task. Working dir: `c:\Users\Administrator\Downloads\athleteos`.

---

### Task 1: Pure meal-intelligence helpers (`meal-intel.js`)

**Files:**
- Create: `proto/redesign-2026-07/js/meal-intel.js`
- Test: `src/core/mealIntel.test.ts`

**Interfaces:**
- Consumes: nothing (pure; no imports).
- Produces (later tasks import these exact names):
  - `normalizeDetected(detected) → [{ name, confidence: 'high'|'medium'|'low' }]` (legacy strings → high; cap 8; `<>` stripped; empty names dropped)
  - `groundExtras(raw) → { fiber, highlights, detectedRich, detectedNames }` (fiber int clamp 0–60; highlights ≤3, cleaned, ≤120 chars; names for legacy consumers)
  - `openingMessage({ name, quality, note, goal, coachTargets, late }) → string` (coach voice; late/on-time line first; note; goal tie; coach-target deference; improvement when quality < 75, praise when ≥ 75; ≤ 600 chars)
  - `reactionGroups(comments) → [{ emoji, count }]` and `threadMessages(comments) → comments` (splits `kind === 'reaction'` rows from message rows; missing `kind` = message)
  - `contextForChat({ meal, plan, exec, recentMeals, thread }) → object` (shape below, clamped so `JSON.stringify(result).length <= 8192` by dropping oldest `recentMeals` first, then oldest `thread` entries)

- [ ] **Step 1: Write the failing test**

Create `src/core/mealIntel.test.ts`:

```ts
// Proto is plain ESM JS (allowJs) — same import pattern as obHelpers/exec tests.
// @ts-ignore
import { normalizeDetected, groundExtras, openingMessage, reactionGroups, threadMessages, contextForChat } from '../../proto/redesign-2026-07/js/meal-intel.js';

describe('normalizeDetected', () => {
  test('legacy strings become high-confidence entries', () =>
    expect(normalizeDetected(['Chicken', 'Rice'])).toEqual([
      { name: 'Chicken', confidence: 'high' }, { name: 'Rice', confidence: 'high' },
    ]));
  test('rich objects pass through; bad confidence coerces to high', () =>
    expect(normalizeDetected([{ name: 'Kale', confidence: 'low' }, { name: 'Beef', confidence: 'sure' }]))
      .toEqual([{ name: 'Kale', confidence: 'low' }, { name: 'Beef', confidence: 'high' }]));
  test('strips markup, drops empties, caps at 8', () => {
    const out = normalizeDetected(['<b>Egg</b>', '', ...Array(10).fill('x')]);
    expect(out[0].name).toBe('bEgg/b'.includes('<') ? 'FAIL' : 'bEgg/b');
    expect(out.length).toBeLessThanOrEqual(8);
  });
  test('non-array input yields empty', () => expect(normalizeDetected(undefined)).toEqual([]));
});

describe('groundExtras', () => {
  test('fiber clamps to 0..60 and rounds', () => {
    expect(groundExtras({ fiber: 200 }).fiber).toBe(60);
    expect(groundExtras({ fiber: -3 }).fiber).toBe(0);
    expect(groundExtras({ fiber: 7.6 }).fiber).toBe(8);
  });
  test('highlights capped at 3, cleaned, length-limited', () => {
    const g = groundExtras({ highlights: ['<i>Iron</i> source', 'a'.repeat(300), 'ok', 'dropped'] });
    expect(g.highlights).toHaveLength(3);
    expect(g.highlights[0]).not.toContain('<');
    expect(g.highlights[1].length).toBeLessThanOrEqual(120);
  });
  test('detectedRich + detectedNames derive together', () => {
    const g = groundExtras({ detected: [{ name: 'Oats', confidence: 'medium' }, 'Banana'] });
    expect(g.detectedRich).toEqual([{ name: 'Oats', confidence: 'medium' }, { name: 'Banana', confidence: 'high' }]);
    expect(g.detectedNames).toEqual(['Oats', 'Banana']);
  });
  test('missing fields yield safe defaults', () =>
    expect(groundExtras({})).toEqual({ fiber: 0, highlights: [], detectedRich: [], detectedNames: [] }));
});

describe('openingMessage', () => {
  const base = { name: 'Chicken & Rice', quality: 82, note: 'Solid protein anchor.', goal: 'gain', coachTargets: null, late: false };
  test('on-time celebration first, note included, praise for quality >= 75', () => {
    const m = openingMessage(base);
    expect(m).toMatch(/on time/i);
    expect(m).toContain('Solid protein anchor.');
    expect(m).not.toMatch(/next time/i);
  });
  test('late meal celebrated as still counting — never shamed', () => {
    const m = openingMessage({ ...base, late: true });
    expect(m).toMatch(/counts/i);
    expect(m).not.toMatch(/fail|bad|shame/i);
  });
  test('quality < 75 adds exactly one practical improvement', () => {
    const m = openingMessage({ ...base, quality: 60 });
    expect(m).toMatch(/next time/i);
  });
  test('goal tie adapts per goal and tolerates null goal', () => {
    expect(openingMessage({ ...base, goal: 'perform' })).not.toBe(openingMessage(base));
    expect(openingMessage({ ...base, goal: null }).length).toBeGreaterThan(20);
  });
  test('coach targets earn a deference line', () =>
    expect(openingMessage({ ...base, coachTargets: { protein: 180 } })).toContain('180'));
  test('caps at 600 chars', () =>
    expect(openingMessage({ ...base, note: 'x'.repeat(700) }).length).toBeLessThanOrEqual(600));
});

describe('reaction split', () => {
  const rows = [
    { role: 'coach', kind: 'reaction', text: '🔥' }, { role: 'coach', kind: 'reaction', text: '🔥' },
    { role: 'coach', kind: 'reaction', text: '💪' }, { role: 'coach', text: 'Nice plate' },
    { role: 'athlete', kind: 'message', text: 'Thanks' },
  ];
  test('reactionGroups counts per emoji', () =>
    expect(reactionGroups(rows)).toEqual([{ emoji: '🔥', count: 2 }, { emoji: '💪', count: 1 }]));
  test('threadMessages drops reactions, keeps kindless rows', () =>
    expect(threadMessages(rows).map((r: any) => r.text)).toEqual(['Nice plate', 'Thanks']));
});

describe('contextForChat', () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Meal ${i}`, protein: 40, kcal: 700, quality: 70 }));
  test('passes the five sections through', () => {
    const c = contextForChat({ meal: { name: 'Lunch' }, plan: { goal: 'gain' }, exec: { met: 2 }, recentMeals: big(3), thread: [{ role: 'athlete', text: 'hi' }] });
    expect(c.meal.name).toBe('Lunch');
    expect(c.recentMeals).toHaveLength(3);
  });
  test('clamps to 8192 bytes, dropping oldest recentMeals then oldest thread', () => {
    const c = contextForChat({
      meal: { name: 'Dinner' }, plan: {}, exec: {},
      recentMeals: big(200),
      thread: Array.from({ length: 40 }, (_, i) => ({ role: 'athlete', text: `q${i} ` + 'y'.repeat(200) })),
    });
    expect(JSON.stringify(c).length).toBeLessThanOrEqual(8192);
    // newest entries survive
    expect(JSON.stringify(c)).toContain('q39');
  });
});
```

Note on the third `normalizeDetected` assertion: it must assert markup is GONE — write it as `expect(out[0].name).toBe('bEgg/b')` only if your clean strips just `<` and `>` (matching `groundResult`'s existing convention: `replace(/[<>]/g, '')` leaves inner text `bEgg/b`). Keep that exact convention.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/mealIntel.test.ts`
Expected: FAIL — cannot find module `meal-intel.js`.

- [ ] **Step 3: Write the implementation**

Create `proto/redesign-2026-07/js/meal-intel.js`:

```js
/* OnStandard — Meal Intelligence helpers (pure; no DOM, no state, no imports).
   Owns: detected-food normalization + the new analysis extras, the DERIVED AI
   opening message (never stored — both athlete and coach threads render it from
   the same meal data, so it can't be forged and costs nothing), reaction/message
   splitting, and the meal-chat context builder with its 8KB clamp. */

const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);

/** Legacy string arrays and rich {name, confidence} arrays both normalize to rich. */
export function normalizeDetected(detected) {
  if (!Array.isArray(detected)) return [];
  return detected.slice(0, 8).map((d) => {
    if (typeof d === 'string') return { name: clean(d), confidence: 'high' };
    const c = d && d.confidence;
    return { name: clean(d && d.name), confidence: c === 'low' || c === 'medium' ? c : 'high' };
  }).filter((d) => d.name);
}

/** Ground the new analysis extras (fiber / highlights / detected) to honest bounds. */
export function groundExtras(raw) {
  const r = raw || {};
  const fiber = Math.max(0, Math.min(60, Math.round(Number(r.fiber) || 0)));
  const highlights = (Array.isArray(r.highlights) ? r.highlights : [])
    .slice(0, 3).map((h) => clean(h).slice(0, 120)).filter(Boolean);
  const detectedRich = normalizeDetected(r.detected);
  return { fiber, highlights, detectedRich, detectedNames: detectedRich.map((d) => d.name) };
}

/* Goal ties — why this meal matters for THEIR objective, athlete and client goals both. */
const GOAL_TIE = {
  gain: 'keeps the calorie floor and the protein climbing',
  lose: 'keeps you inside the window without starving the work',
  maintain: 'holds the line, and consistency is the whole game',
  perform: 'fuels the next session and speeds recovery',
  build: 'keeps the build fueled, never under',
  health: 'buys steady energy and habits that hold',
};

/**
 * The AI Nutritionist's opening message — DERIVED from stored meal data, never persisted.
 * Execution is celebrated first regardless of food quality (binding tone rule); nutrition
 * coaching educates after. Returns a plain string (render through esc()).
 */
export function openingMessage({ name, quality, note, goal, coachTargets, late } = {}) {
  const parts = [];
  parts.push(late ? 'Logged. Late still beats missing, and it counts.' : "Captured on time. That's the standard.");
  if (note) parts.push(clean(note));
  const tie = GOAL_TIE[goal];
  if (tie && quality != null) {
    parts.push(quality >= 75 ? `A plate like this ${tie}.` : `Tightening this plate up ${tie}.`);
  }
  if (coachTargets && coachTargets.protein) {
    parts.push(`Coach's bar is ${coachTargets.protein}g protein on the day, and every meal moves it.`);
  }
  if (quality != null) {
    parts.push(quality >= 75
      ? `Strong plate${name ? ` — keep ${clean(name)} in rotation` : ''}.`
      : 'One upgrade next time: add a protein or a vegetable and this score jumps.');
  }
  return parts.filter(Boolean).join(' ').slice(0, 600);
}

/** Reaction rows (kind='reaction') grouped as [{emoji, count}], insertion-ordered. */
export function reactionGroups(comments) {
  const counts = new Map();
  for (const c of comments || []) {
    if (c && c.kind === 'reaction' && c.text) counts.set(c.text, (counts.get(c.text) || 0) + 1);
  }
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

/** Message rows only (reactions excluded; rows without kind are messages). */
export function threadMessages(comments) {
  return (comments || []).filter((c) => c && c.kind !== 'reaction');
}

const CONTEXT_MAX = 8192;

/** Client-composed deterministic context for meal-chat. Clamped to 8KB by dropping
    oldest recentMeals first, then oldest thread messages — newest context survives. */
export function contextForChat({ meal, plan, exec, recentMeals, thread } = {}) {
  const ctx = {
    meal: meal || {},
    plan: plan || {},
    exec: exec || {},
    recentMeals: Array.isArray(recentMeals) ? recentMeals.slice() : [],
    thread: Array.isArray(thread) ? thread.slice(-20) : [],
  };
  const size = () => JSON.stringify(ctx).length;
  while (size() > CONTEXT_MAX && ctx.recentMeals.length) ctx.recentMeals.shift();
  while (size() > CONTEXT_MAX && ctx.thread.length > 1) ctx.thread.shift();
  return ctx;
}
```

- [ ] **Step 4: Run tests until green**

Run: `npx jest src/core/mealIntel.test.ts` → PASS. Then `npm run typecheck && npm run test` → clean (133 suites).

- [ ] **Step 5: Commit**

```bash
git add proto/redesign-2026-07/js/meal-intel.js src/core/mealIntel.test.ts
git commit -m "feat(meal): pure meal-intel helpers — detected normalization, derived AI opening, reactions, chat context"
```

---

### Task 2: Analysis schema extension + client grounding

**Files:**
- Modify: `supabase/functions/analyze-meal/index.ts` (MEAL_TOOL schema + prompt lines)
- Modify: `proto/redesign-2026-07/js/state.js` (`groundResult`)
- Modify: `src/core/macroGrounding.ts` (defensive rich-detected mapping)
- Test: extend `src/core/macroGrounding.test.ts` if it exists, else add the case to `src/core/mealIntel.test.ts`

**Interfaces:**
- Consumes: `groundExtras`, `normalizeDetected` from `../meal-intel.js` (Task 1 — note `state.js` imports with `./meal-intel.js`).
- Produces: `MEAL.result` gains `fiber` (int), `highlights` (string[]), `detectedRich` ([{name, confidence}]) while `detected` REMAINS a plain string[] of names (legacy consumers: `S.logging.foods`, `mealDetail().foods`, coach screen). `logMeal`'s persisted meta gains `fiber`, `highlights`, `detectedRich` (into `DAY.slotMacros[slot]` — jsonb, no migration).

- [ ] **Step 1: Extend the edge-function tool schema**

In `supabase/functions/analyze-meal/index.ts`, in `MEAL_TOOL.input_schema.properties`, replace the `detected` property and add two more:

```ts
      detected: {
        type: 'array',
        description: 'Foods identified in the photo, each with your confidence in the identification.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The food, e.g. "Grilled chicken".' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high = clearly visible; medium = probable; low = uncertain, the athlete should confirm.' },
          },
          required: ['name', 'confidence'],
        },
      },
      fiber: { type: 'integer', description: 'Estimated grams of dietary fiber. 0 when negligible.' },
      highlights: {
        type: 'array', items: { type: 'string' },
        description: 'Up to 3 short micronutrient highlights ONLY when clearly present (e.g. "Strong iron source, supports oxygen delivery"). Empty when nothing stands out. Never fabricate.',
      },
```

Add `'fiber'` to the `required` array (keep `detected` required as-is; `highlights` stays optional). In the meal system prompt (the numbered instructions block near the `report_meal_analysis` mention), append one guidance line:

```
Confidence honesty: mark a detected food "low" whenever the photo alone cannot confirm it (obscured, ambiguous, or inferred from the athlete note). Fiber and highlights are estimates from what is visible; when nothing is clearly notable, return highlights as an empty array.
```

- [ ] **Step 2: Extend client grounding in `state.js`**

Add the import at the top: `import { groundExtras } from './meal-intel.js';`

In `groundResult(d)`, replace the `detected` line and extend the return:

```js
  const extras = groundExtras(d);
  return {
    name: clean(d.name) || 'Meal', quality: clampN(d.quality, 100),
    protein, carbs, fat, kcal,
    fiber: extras.fiber,
    highlights: extras.highlights,
    detected: extras.detectedNames,      // legacy consumers keep plain names
    detectedRich: extras.detectedRich,   // confidence-aware renderers use this
    note: clean(d.note),
  };
```

In `act.logMeal`, extend the analyzed-meta branch so the new fields persist with the plate:

```js
    const meta = MEAL.result
      ? { quality: MEAL.result.quality, foods: MEAL.result.detected, note: MEAL.result.note, name: MEAL.result.name || MEAL.mealType,
          fiber: MEAL.result.fiber || 0, highlights: MEAL.result.highlights || [], detectedRich: MEAL.result.detectedRich || [] }
      : { name: MEAL.mealType || cap(slot) };
```

- [ ] **Step 3: Defensive rich-detected mapping in `macroGrounding.ts`**

In `groundMealResult`, the detected list may now arrive as rich objects. Change the call:

```ts
export function groundMealResult(mr: MealResult): MealResult {
  // detected may be legacy strings or rich {name, confidence} objects — ground on names either way
  const names = (mr.detected ?? []).map((d: unknown) => (typeof d === 'string' ? d : (d as { name?: string })?.name ?? '')).filter(Boolean);
  const g = groundMealMacros(mr, names);
  return { ...mr, protein: g.protein, kcal: g.kcal, carbs: g.carbs, fat: g.fat, confidence: g.confidence };
}
```

Add a regression test (in `src/core/macroGrounding.test.ts` if present, else a new `describe` in `mealIntel.test.ts` importing from `./macroGrounding`):

```ts
import { groundMealResult } from './macroGrounding';

test('groundMealResult tolerates rich detected objects', () => {
  const mr = { name: 'Bowl', quality: 70, protein: 40, kcal: 700, carbs: 60, fat: 20,
    detected: [{ name: 'chicken breast', confidence: 'high' }] as never, note: '' } as never;
  expect(() => groundMealResult(mr)).not.toThrow();
});
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test` → green.

```bash
git add supabase/functions/analyze-meal/index.ts proto/redesign-2026-07/js/state.js src/core/macroGrounding.ts src/core/macroGrounding.test.ts src/core/mealIntel.test.ts
git commit -m "feat(meal): per-food confidence + fiber + highlights — schema, grounding, persisted meta"
```

---

### Task 3: `meal-chat` edge function

**Files:**
- Create: `supabase/functions/meal-chat/index.ts`

**Interfaces:**
- Consumes: env `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5`), `MEAL_CHAT_DAILY_CAP` (default 10), `MEAL_CHAT_GLOBAL_CAP` (default 2000), `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MIN`; RPCs `claim_ai_usage` / `claim_ai_usage_key` — **read `supabase/functions/analyze-meal/index.ts` first and mirror its exact invocation pattern for both RPCs** (same arg names, same fail-open handling); the `assist` function for the CORS/rate-limit helpers to copy.
- Produces: POST `{ mealId, question, context }` → `{ reply }` | `{ error: 'limit'|'unauthorized'|'bad_request'|'unavailable' }`. On success, inserts the reply into `meal_comments` (`role: 'ai'`, `author_id = athlete_id = caller`, `kind: 'message'`) via service role. Task 5's client calls `sb.functions.invoke('meal-chat', { body })`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/meal-chat/index.ts` (copy the CORS helper, per-IP limiter, and global-cap helper verbatim from `supabase/functions/assist/index.ts`, and the per-athlete `claim_ai_usage` invocation pattern from `analyze-meal` — do not invent RPC signatures):

```ts
// OnStandard — meal-chat Edge Function. The Team Discussion's AI half.
//
// Authority boundary (doc-05 discipline, same as assist): the model DISCUSSES the
// deterministic context the client hands it — it never fetches coaching data, never
// computes or alters a number, and may only repeat figures already present in the
// provided context. The function's only reads are AUTHORIZATION: an RLS-scoped select
// (caller's JWT) proving the meal belongs to the caller. On success the reply is
// persisted into meal_comments as role 'ai' via the service role — 0046 deliberately
// forbids clients from writing 'ai' rows, so AI messages can never be forged.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Math.max(1, Math.floor(Number(Deno.env.get('MEAL_CHAT_DAILY_CAP') ?? '10')) || 10);
const GLOBAL_CAP = Math.max(1, Math.floor(Number(Deno.env.get('MEAL_CHAT_GLOBAL_CAP') ?? '2000')) || 2000);
const CONTEXT_MAX = 8192;

// [COPY VERBATIM from assist/index.ts]: corsFor(req), rateLimited(req), and the
// withinGlobalCap() helper — change only the global-cap key to 'meal_chat_global'
// and the limit to GLOBAL_CAP.

const REPLY_TOOL = {
  name: 'reply',
  description: 'Reply to the athlete inside their meal thread.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Coach-voiced reply, 150 words max, plain prose, no em dashes. Reference only numbers present in the provided context. Encourage consistency first; educate, never shame.' },
    },
    required: ['message'],
  },
} as const;

const SYSTEM = `You are the OnStandard AI Nutritionist inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Coach voice: specific, encouraging, practical. Consistency is praised before choices are critiqued. Never shame food, weight, or a late log.
3. When coach guidance appears in the context, defer to it explicitly.
4. Answer the athlete's question for THEIR goal and plan, not generic nutrition advice.
5. 150 words maximum. No em dashes. No markdown headers.`;

function bad(status: number, error: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return bad(405, 'bad_request', cors);
  try {
    if (rateLimited(req)) return bad(429, 'limit', cors);

    const body = await req.json().catch(() => null);
    const mealId = body?.mealId;
    const question = String(body?.question ?? '').trim().slice(0, 500);
    const context = body?.context;
    if (!mealId || !question || !context) return bad(400, 'bad_request', cors);
    if (JSON.stringify(context).length > CONTEXT_MAX) return bad(400, 'bad_request', cors);

    // ---- authorization: the caller must own this meal (RLS does the work) ----
    const auth = req.headers.get('authorization') ?? '';
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return bad(401, 'unauthorized', cors);
    const { data: mealRow } = await userClient.from('meals').select('id, athlete_id').eq('id', mealId).maybeSingle();
    if (!mealRow || mealRow.athlete_id !== callerId) return bad(403, 'unauthorized', cors);

    // ---- caps: per-athlete daily (fail-open) + global ceiling ----
    // [MIRROR analyze-meal's claim_ai_usage invocation EXACTLY, with the feature key
    //  'meal_chat' and limit DAILY_CAP; on a denied claim return bad(429, 'limit', cors).]
    if (!(await withinGlobalCap())) return bad(429, 'limit', cors);

    // ---- the model call: prose only, forced tool ----
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [REPLY_TOOL],
      tool_choice: { type: 'tool', name: 'reply' },
      messages: [{
        role: 'user',
        content: `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nAthlete's question: ${question}`,
      }],
    });
    const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: { message?: string } } | undefined;
    const reply = String(tool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
    if (!reply) return bad(502, 'unavailable', cors);

    // ---- persist as the unforgeable 'ai' row (service role) ----
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await service.from('meal_comments').insert({
      meal_id: mealId, athlete_id: callerId, author_id: callerId, role: 'ai', text: reply, kind: 'message',
    });

    return new Response(JSON.stringify({ reply }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch {
    return bad(503, 'unavailable', cors);
  }
});
```

Implementation notes for the two `[COPY/MIRROR]` markers: they reference concrete code in this repo (`assist/index.ts` helpers; `analyze-meal/index.ts` per-athlete cap invocation) — transcribe those blocks, do not reinvent them. If the `kind` column doesn't exist yet on a pre-0049 database, the insert fails silently server-side — acceptable pre-go-live, but code it as: attempt the insert WITH `kind`, and on error retry once WITHOUT the `kind` field so replies still persist on a pre-migration DB.

- [ ] **Step 2: Static verification**

No Deno toolchain in `npm run verify`. Verify by re-reading against the contract: every branch returns JSON with CORS; no branch fetches coaching data (only the ownership select); the reply is capped; the service-role insert only ever writes `role='ai'` for the verified caller's own meal. Run `npm run typecheck && npm run test` once (unaffected, must stay green). Optional if the Supabase CLI + local stack exist: `supabase functions serve meal-chat` + a curl smoke; note in the commit body if not run.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/meal-chat/index.ts
git commit -m "feat(backend): meal-chat edge function — grounded coach-voiced Q&A, JWT ownership check, server-written ai rows"
```

---

### Task 4: Migration 0049 (reaction kind) + RLS tests

**Files:**
- Create: `supabase/migrations/0049_meal_comment_kinds.sql`
- Modify: `supabase/tests/rls_authz_test.sql` (insert before the scoreboard, after the 0048 section)

**Interfaces:**
- Consumes: 0046's `meal_comments` policies (unchanged).
- Produces: `meal_comments.kind text not null default 'message' check (kind in ('message','reaction'))` — the exact column Tasks 3/5/6 write/read.

- [ ] **Step 1: Write the migration**

```sql
-- OnStandard — meal comment kinds (spec docs/superpowers/specs/2026-07-09-meal-intelligence-design.md §5).
-- Reactions (🔥 💪 👏 👍) are meal_comments rows with kind='reaction' so the coach's one-tap
-- acknowledgment rides the exact same RLS surface as comments. 0046's policies already allow
-- coach-authored rows; nothing about who-may-write changes here. AI rows stay service-role-only.
--
-- GUARDRAIL: authored only; the founder applies this at go-live (like 0004+). Additive; the
-- meal-chat function retries its insert without `kind` on a pre-migration DB.

alter table meal_comments add column if not exists kind text not null default 'message';
alter table meal_comments add constraint meal_comments_kind_check check (kind in ('message', 'reaction'));

comment on column meal_comments.kind is
  'message = a thread bubble; reaction = a one-tap emoji acknowledgment rendered as a strip, not a bubble.';
```

- [ ] **Step 2: Add RLS checks**

In `supabase/tests/rls_authz_test.sql`, after the 0048 section and before the scoreboard, add (cast per the suite: athlete A `aaaaaaaa-0000-0000-0000-000000000001`, coach_1 `11111111-0000-0000-0000-000000000001`; the suite seeds meals — reuse an existing seeded meal id variable if one exists; otherwise seed one for athlete A as superuser first, following the file's seeding idiom):

```sql
-- ---------------------------------------------------------------- 0049: meal comment kinds
select _superuser();
insert into meals (id, athlete_id, day_date, type) values
  ('cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', current_date, 'lunch')
  on conflict (id) do nothing;
select _as('11111111-0000-0000-0000-000000000001');
select _ok(_try($$insert into meal_comments (meal_id, athlete_id, author_id, role, text, kind)
                 values ('cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
                         '11111111-0000-0000-0000-000000000001', 'coach', '🔥', 'reaction')$$) = 'ok',
           '0049: linked coach posts an emoji reaction');
select _as('aaaaaaaa-0000-0000-0000-000000000001');
select _ok(_try($$insert into meal_comments (meal_id, athlete_id, author_id, role, text)
                 values ('cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'aaaaaaaa-0000-0000-0000-000000000001', 'ai', 'fake ai message')$$) like 'denied%',
           '0049: athlete still cannot forge an ai row (0046 boundary holds)');
select _ok(_try($$insert into meal_comments (meal_id, athlete_id, author_id, role, text, kind)
                 values ('cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'aaaaaaaa-0000-0000-0000-000000000001', 'athlete', 'hi', 'invalid-kind')$$) like 'denied%',
           '0049: kind is constrained to message|reaction');
```

Adapt the `meals` insert columns to the actual `meals` table definition (read its migration first — include any other not-null columns it requires). If the suite already seeds a meal for athlete A, reuse that id instead of inserting.

- [ ] **Step 3: Run if possible, commit**

`npm run test:rls` if a migrated local DB exists (expected unavailable — statically re-check against harness conventions and note in the commit body). `npm run typecheck && npm run test` → green.

```bash
git add supabase/migrations/0049_meal_comment_kinds.sql supabase/tests/rls_authz_test.sql
git commit -m "feat(backend): 0049 — meal_comments.kind for reactions (authored only); RLS checks incl. ai-forgery negative"
```

---

### Task 5: The unified meal-thread page + pre-log confidence UI

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/meal.js` (major rework: `confirm` + `detail` merge into a new `thread`; `analysis` gains confidence UI)
- Modify: `proto/redesign-2026-07/js/screens/index.js` (register `meal-thread`; alias `meal-confirm` and `meal-detail` to the same module)
- Modify: `proto/redesign-2026-07/css/screens.css` (append)

**Interfaces:**
- Consumes: `S.exec` (ExecState: `now/next/met/total/score/possible/celebration`, items with `countdown/dueLabel/route/icon/title/proof`); `RT.lastMove {from,to,gain,what}`; `mealDetail(slot)` from state.js (extend its return with the new meta fields); `openingMessage/reactionGroups/threadMessages/contextForChat/normalizeDetected` from `../meal-intel.js`; `roles.fetchMealComments(mealId)`, `roles.postMealComment(mealId, athleteId, authorId, role, text, kind?)` (kind param added in Task 6 — this task calls the 5-arg form), `roles.fetchRecentMeals(athleteId, sinceISO)`, `roles.daysAgoISO(n)`, `roles.signedMealPhotoUrl(path)`; `sb.functions.invoke('meal-chat', ...)` (Task 3 contract); `S.planTargets`, `RT.profile.baseGoal`, `RT.allergies`.
- Produces: route `#meal-thread/<slot>` (plus the two aliases); the four-section page every later QA references.

- [ ] **Step 1: Extend `mealDetail` in state.js**

Add the new meta fields to the returned object (after `note`):

```js
    fiber: meta.fiber || 0,
    highlights: Array.isArray(meta.highlights) ? meta.highlights : [],
    detectedRich: Array.isArray(meta.detectedRich) && meta.detectedRich.length
      ? meta.detectedRich
      : (foods || []).map((f) => ({ name: f, confidence: 'high' })),
```

- [ ] **Step 2: Append the CSS**

```css
/* ---- meal thread page ---- */
.mt-exec{background:linear-gradient(160deg,var(--green-surface),transparent 60%),var(--surface-1);border:1px solid var(--green-border);border-radius:22px;padding:18px 16px;text-align:center}
.mt-exec .bigcheck{width:56px;height:56px;border-radius:50%;background:linear-gradient(150deg,var(--green-bright),#0d9459);color:#04150c;display:grid;place-items:center;margin:0 auto 10px}
.mt-exec .t{font-size:20px;font-weight:800;letter-spacing:var(--title-tight)}
.mt-exec .s{font-size:12.5px;color:var(--text-2);margin-top:4px}
.mt-move{display:flex;align-items:baseline;justify-content:center;gap:10px;margin:12px 0 2px;font-variant-numeric:tabular-nums}
.mt-move .from{font-size:22px;font-weight:800;color:var(--text-3)}
.mt-move .to{font-size:34px;font-weight:800;color:var(--green-bright);letter-spacing:var(--num-tight)}
.conf-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
.conf-dot.high{background:var(--green-bright)} .conf-dot.medium{background:var(--amber-bright)} .conf-dot.low{background:var(--text-3)}
.foodchip .q{margin-left:5px;font-weight:800;color:var(--amber-bright);cursor:default}
.hl-row{display:flex;align-items:flex-start;gap:9px;padding:8px 0;font-size:12.5px;color:var(--text-2);line-height:1.45}
.hl-row .ic{color:var(--green-bright);flex:0 0 auto;margin-top:1px}
.rx-strip{display:flex;gap:8px;margin:2px 0 10px;flex-wrap:wrap}
.rx{display:flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--hairline);border-radius:999px;padding:4px 11px;font-size:13px;font-weight:700}
.rx .n{font-size:11px;color:var(--text-3)}
.mt-retry{font-size:12px;font-weight:700;color:var(--amber-bright);cursor:pointer;padding:6px 2px}
```

- [ ] **Step 3: Rework `meal.js`**

Keep `analyzing` as-is. Add imports: `import { openingMessage, reactionGroups, threadMessages, contextForChat } from '../meal-intel.js';` and `import { esc } from '../components.js';` (already imported — verify).

**`analysis` (pre-log) confidence upgrade:** replace the detected-chips block with confidence-aware chips (low-confidence chips carry a "?" and the existing Edit mode's removal affordance — editing stays pre-log only):

```js
    <div class="eyebrow">Detected <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· estimated from photo</span> <span class="link" id="edit-foods">Edit</span></div>
    <div class="foodchips" id="foods">
      ${(MEAL.result && MEAL.result.detectedRich ? MEAL.result.detectedRich : L.foods.map((f) => ({ name: f, confidence: 'high' }))).map((d) => `
        <span class="foodchip"><span class="conf-dot ${d.confidence}"></span>${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI is unsure — confirm or remove">?</span>' : ''}</span>`).join('')}
    </div>
```

(The existing edit-mode `mount` wiring keeps working — chips still carry `.foodchip`.)

**Replace `confirm` and `detail` with one `thread` module** (export `thread`; keep `export const confirm = thread; export const detail = thread;` at the bottom so old imports/routes stay valid):

```js
export const thread = {
  tab: 'home',
  render({ sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    const e = S.exec;

    if (!M.logged) {
      return `
      ${backHead(M.name, 'Not logged yet', 'home')}
      <div class="state-demo">
        <div class="sd-ic">${icon('camera', 24)}</div>
        <div class="sd-t">${esc(M.name)} isn't logged yet</div>
        <div class="sd-s">Log it with a photo and its full breakdown — foods, macros, your team's take — lives here.</div>
      </div>
      <button class="btn green" data-go="camera/${M.slot}">${icon('camera', 18)} Log ${esc(M.name)}</button>
      <div style="height:10px"></div>`;
    }

    // ---- 1. EXECUTION SUMMARY (celebrates the act of logging; never shames) ----
    const justLogged = RT.lastMove && !RT.lastMove._played && (RT.lastMove.what || '').toLowerCase() === M.slot;
    const timing = M.late ? 'Logged late · still counts' : 'Captured on time';
    const execTop = `
    <section class="mt-exec">
      <div class="bigcheck">${icon('check', 26)}</div>
      <div class="t">${esc(M.name)} Logged</div>
      <div class="s">${timing} · Counted toward Nutrition (50%) · Coach can see it</div>
      ${justLogged ? `
      <div class="mt-move"><span class="from" data-anim-from>${RT.lastMove.from}</span><span style="color:var(--text-3)">${icon('arrowRight', 20)}</span><span class="to" data-anim-to>${RT.lastMove.to}</span></div>
      <div class="s">OnStandard Score · +${RT.lastMove.gain} pts</div>
      ${tier(RT.lastMove.to).name !== tier(RT.lastMove.from).name ? `<div class="pill" style="margin-top:8px;background:var(--amber-surface);border-color:var(--amber-border);color:var(--amber-bright)">▲ ${esc(tier(RT.lastMove.to).name)}</div>` : ''}` : ''}
      <div style="height:12px"></div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
      <div class="s" style="margin-top:6px">${e.met} of ${e.total} in today${S.streakDays > 0 ? ` · ${S.streakDays} day streak` : ''}</div>
    </section>`;

    // ---- 2. MEAL BREAKDOWN (objective, honest, estimated) ----
    const T = S.planTargets || {};
    const bars = [
      ['Protein', M.macros.protein, T.protein, 'g'],
      ['Carbs', M.macros.carbs, null, 'g'],
      ['Fat', M.macros.fat, null, 'g'],
      ['Fiber', M.fiber, null, 'g'],
      ['Calories', M.macros.cals, T.calories, ''],
    ];
    const coachLine = T.protein
      ? `<div class="hl-row"><span class="ic">${icon(M.macros.protein * 4 >= T.protein ? 'check' : 'clock', 14)}</span>Coach's day bar: ${esc(String(T.protein))}g protein — this plate carries ${M.macros.protein}g of it.</div>`
      : '';
    const breakdown = `
    <div class="eyebrow" style="margin-top:16px">Meal Breakdown <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· estimated from photo</span></div>
    <div class="photo-hero" id="meal-hero" style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))">
      <img id="meal-photo" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta"><div><div class="ph-t">${esc(M.name)}</div><div class="ph-s">Logged ${esc(M.loggedAt || 'today')}</div></div>
      ${M.score != null ? `<div class="scorechip"><span class="v">${M.score}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>
    <div class="foodchips">
      ${M.detectedRich.map((d) => `<span class="foodchip"><span class="conf-dot ${esc(d.confidence)}"></span>${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI was unsure about this one">?</span>' : ''}</span>`).join('')}
    </div>
    <section class="card pad" style="margin-top:10px">
      ${bars.map(([k, v, target, u]) => `
        <div class="cons-row" style="margin-bottom:10px">
          <span class="k" style="width:64px">${k}</span>
          <div class="track"><div class="fillb" style="width:${target ? Math.min(100, Math.round((v / target) * 100)) : Math.min(100, Math.round((v / (k === 'Calories' ? 900 : 60)) * 100))}%;background:linear-gradient(90deg,#16a34a,var(--green-bright))"></div></div>
          <span class="v" style="width:96px">${v}${u}${target ? ` <small style="color:var(--text-3)">/ ${target}${u} day</small>` : ''}</span>
        </div>`).join('')}
      ${T.protein ? '' : `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No coach targets set yet — these are this meal's estimated totals.</div>`}
    </section>
    ${coachLine}
    ${(() => { // goal-alignment verdict (spec §4) — presentation only, no new math
      const g = RT.profile && RT.profile.baseGoal;
      if (!g || M.score == null) return '';
      const GOAL_LABEL = { gain: 'gaining', lose: 'leaning out', maintain: 'maintaining', perform: 'performing', build: 'building', health: 'your health goals' };
      return `<div class="hl-row"><span class="ic">${icon(M.score >= 75 ? 'check' : 'target', 14)}</span>${M.score >= 75 ? `Aligned with ${GOAL_LABEL[g] || 'your goal'} — this is the kind of plate that gets you there.` : `Workable for ${GOAL_LABEL[g] || 'your goal'} — the thread below has the one upgrade that matters.`}</div>`;
    })()}
    ${M.highlights.length ? M.highlights.map((h) => `<div class="hl-row"><span class="ic">${icon('sparkle', 14)}</span>${esc(h)}</div>`).join('') : ''}
    <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--green-surface);border:1px solid var(--green-border);margin-top:8px">
      ${icon('shield', 15)} <span style="font-size:12.5px;font-weight:700;color:var(--green-bright)">Guardian: checked against your restrictions (${RT.allergies.length ? esc(RT.allergies.join(', ')) : 'none declared'})</span>
    </div>`;

    // ---- 3. TEAM DISCUSSION ----
    const discussion = `
    <div class="eyebrow" style="margin-top:18px">Team Discussion</div>
    <div class="rx-strip" id="rx-strip"></div>
    <div class="thread" id="meal-thread">
      <div class="msg">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">OnStandard AI</div>
        <div class="bubble">${esc(openingMessage({ name: M.name, quality: M.score, note: M.note, goal: RT.profile && RT.profile.baseGoal, coachTargets: S.planTargets, late: M.late }))}</div></div>
      </div>
      <div class="msg-status" id="thread-status">${M.mealId ? 'Loading the thread…' : 'Syncs when connected — your coach sees this log either way.'}</div>
    </div>
    ${M.mealId ? `
    <div class="composer">
      <input id="meal-msg" placeholder="Ask about this meal…" />
      <div class="send" id="meal-send">${icon('arrowUp', 19)}</div>
    </div>
    <div id="chat-note" style="min-height:18px"></div>` : ''}`;

    // ---- 4. NEXT ACTION (the exec engine's NOW) ----
    const n = e.now;
    const next = e.celebration ? `
    <div class="day-done" style="margin-top:16px">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">That's everything. You're OnStandard at ${e.score}.</div>
      <div class="ts">All requirements in. Day ${S.streakDays + 1} locks at midnight.</div></div>
    </div>` : n ? `
    <div class="eyebrow" style="margin-top:16px">Next Action</div>
    <div class="xrow-item" data-go="${n.route}">
      <div class="xico sm ${n.color}">${icon(n.icon, 17)}</div>
      <div class="xr"><div class="xa">${esc(n.title)}</div><div class="xb">${n.countdown ? `⏱ ${esc(n.countdown)} · ` : ''}${esc(n.dueLabel)} · ${e.score} → ${e.possible}</div></div>
      <span class="xpill ${n.color}">${n.pill}</span>
    </div>` : '';

    return `${backHead(M.name, timing, 'home')}${execTop}${breakdown}${discussion}${next}
    <div style="height:12px"></div>
    <div class="btn-row"><button class="btn ghost sm" style="flex:1" data-go="home">Back Home</button></div>
    <div style="height:10px"></div>`;
  },

  async mount(root, { sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    // score count-up plays once per log
    const to = root.querySelector('[data-anim-to]');
    if (to) {
      const target = +to.textContent; const from = +root.querySelector('[data-anim-from]').textContent; const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 900); to.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      // in-memory played flag only; worst case the count-up replays once after a reload — acceptable
      if (RT.lastMove) RT.lastMove._played = true;
    }
    if (!M.logged) return;
    const roles = await import('../roles.js');
    // photo (property assignment, no injection)
    const photo = root.querySelector('#meal-photo');
    if (photo) {
      let url = M.img;
      if (!url && RT.userId) url = await roles.signedMealPhotoUrl(`${RT.userId}/${DAY.date}/${M.slot}.jpg`);
      if (url) { photo.src = url; photo.style.display = 'block'; }
    }
    if (!M.mealId) return;

    const threadEl = root.querySelector('#meal-thread');
    const strip = root.querySelector('#rx-strip');
    const statusEl = root.querySelector('#thread-status');
    let gen = 0; // stale-response guard, same convention as onboarding step 2
    let comments = [];

    const paint = () => {
      if (!threadEl) return;
      const msgs = threadMessages(comments);
      const openingHtml = threadEl.querySelector('.msg') ? threadEl.querySelector('.msg').outerHTML : '';
      threadEl.innerHTML = openingHtml + (msgs.length ? msgs.map((c) => `
        <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
          ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
          <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
          <div class="bubble">${esc(c.text)}</div></div>
        </div>`).join('') : `<div class="msg-status">No replies yet. Ask a question — your AI coach answers from YOUR plan.</div>`);
      if (strip) strip.innerHTML = reactionGroups(comments).map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('');
      threadEl.scrollTop = threadEl.scrollHeight;
    };
    const refresh = async () => {
      const myGen = ++gen;
      const fetched = await roles.fetchMealComments(M.mealId);
      if (myGen !== gen) return;
      comments = fetched; if (statusEl) statusEl.remove(); paint();
    };
    await refresh();

    // composer: post athlete message → invoke meal-chat with client-composed context
    const input = root.querySelector('#meal-msg');
    const send = root.querySelector('#meal-send');
    const note = root.querySelector('#chat-note');
    const setNote = (t, retry) => { if (note) note.innerHTML = t ? `<div class="mt-retry" ${retry ? 'id="chat-retry"' : ''}>${esc(t)}</div>` : ''; };
    let busy = false;
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text || busy) return;
      busy = true; setNote('');
      input.value = '';
      await roles.postMealComment(M.mealId, RT.userId, RT.userId, 'athlete', text);
      await refresh();
      try {
        const recent = await roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(7)).catch(() => []);
        const e = S.exec;
        const context = contextForChat({
          meal: { name: M.name, slot: M.slot, foods: M.detectedRich, macros: M.macros, fiber: M.fiber, quality: M.score, late: M.late, note: M.note },
          plan: { goal: RT.profile && RT.profile.baseGoal, targets: S.planTargets, allergies: RT.allergies },
          exec: { met: e.met, total: e.total, score: e.score, possible: e.possible, next: e.now && e.now.title },
          recentMeals: (recent || []).map((m) => ({ type: m.type, protein: m.protein, kcal: m.kcal, quality: m.quality, date: m.day_date })),
          thread: threadMessages(comments).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
        });
        const { data, error } = await window.sb.functions.invoke('meal-chat', { body: { mealId: M.mealId, question: text, context } });
        if (error || !data || data.error) {
          setNote(data && data.error === 'limit' ? "You've hit today's AI coaching limit — back tomorrow. Your coach still sees this." : "Couldn't reach your AI coach — tap to try again.", true);
        } else {
          await refresh();
        }
      } catch { setNote("Couldn't reach your AI coach — tap to try again.", true); }
      busy = false;
      const retry = root.querySelector('#chat-retry');
      if (retry) retry.addEventListener('click', () => { input.value = text; setNote(''); submit(); });
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') submit(); });
  },
};

export const confirm = thread;
export const detail = thread;
```

Delete the old `confirm` and `detail` bodies entirely (the aliases above replace them). `tier` stays imported (the tier-up chip uses it); remove any other imports nothing references anymore. Two adaptation notes: (a) verify the exact field names `mealDetail` returns today (`score`/`late`/`loggedAt`/`img`/`mealId`/`macros.cals`) against `state.js` and use its real names — the render code above assumes them; (b) verify `tier()`'s return shape (`.name` vs a string) in `state.js`/`components.js` and adapt the comparison.

- [ ] **Step 4: Register the route**

In `screens/index.js`: the import line for meal.js becomes `import { analyzing, analysis, confirm, detail, thread } from './meal.js';` and the registry adds `'meal-thread': thread,` (keep `'meal-confirm': confirm` and `'meal-detail': detail` — they now render the same module).

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run test` → green. Manual sanity: the `_played` flag note in mount is deliberate (worst case a replayed animation) — do not add new state plumbing for it.

```bash
git add proto/redesign-2026-07/js/screens/meal.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/state.js proto/redesign-2026-07/css/screens.css
git commit -m "feat(meal): unified meal-thread page — execution summary, honest breakdown, team discussion with AI Q&A, next action"
```

---

### Task 6: Coach surface — reaction bar + derived AI opening

**Files:**
- Modify: `proto/redesign-2026-07/js/roles.js` (`postMealComment` gains optional `kind`)
- Modify: `proto/redesign-2026-07/js/screens/coach.js` (`coachMeal`: reaction bar, reaction strip, derived AI opening, reactions excluded from bubbles)

**Interfaces:**
- Consumes: `openingMessage`, `reactionGroups`, `threadMessages` from `../meal-intel.js`; the meals row fields the coach already fetches (`quality`, `note`, `detected`, `type`, `protein`).
- Produces: `postMealComment(mealId, athleteId, authorId, role, text, kind = 'message')` — Task 5's 5-arg calls keep working (default).

- [ ] **Step 1: Extend `postMealComment`**

```js
export async function postMealComment(mealId, athleteId, authorId, role, text, kind = 'message') {
  const c = sb(); if (!c || !mealId || !authorId) return false;
  try {
    const row = { meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text };
    if (kind !== 'message') row.kind = kind;
    const { error } = await c.from('meal_comments').insert(row);
    if (!error) return true;
    // pre-0049 DB: retry without kind so plain messages still post
    if (kind === 'message') return false;
    const { error: e2 } = await c.from('meal_comments').insert({ meal_id: mealId, athlete_id: athleteId, author_id: authorId, role, text });
    return !e2;
  } catch { return false; }
}
```

(Note the deliberate shape: `kind` is only sent when non-default, so a pre-migration DB accepts every plain message with zero retries, and reactions degrade to a plain coach message containing the emoji — still meaningful.)

- [ ] **Step 2: Upgrade `coachMeal`**

In `screens/coach.js`, add `import { openingMessage, reactionGroups, threadMessages } from '../meal-intel.js';` to the imports. In `coachMeal.render`, replace the Conversation block with:

```js
    <div class="eyebrow">Conversation</div>
    ${(() => {
      const rx = reactionGroups(MC.comments);
      const msgs = threadMessages(MC.comments);
      const opening = meal ? openingMessage({ name: title, quality: meal.quality, note: meal.note, goal: null, coachTargets: null, late: false }) : '';
      return `
      ${rx.length ? `<div class="rx-strip">${rx.map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('')}</div>` : ''}
      <div class="thread">
        ${opening ? `
        <div class="msg">
          <div class="av">${icon('sparkle', 15)}</div>
          <div><div class="who">OnStandard AI · what the athlete was told</div>
          <div class="bubble">${esc(opening)}</div></div>
        </div>` : ''}
        ${msgs.map((c) => `
          <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
            ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
            <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
            <div class="bubble">${esc(c.text)}</div></div>
          </div>`).join('')}
        ${!msgs.length ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:2px 2px 8px">No comments yet. React or say something — the athlete sees it on the log.</div>` : ''}
      </div>`;
    })()}
    <div class="rx-strip" id="rx-bar" style="margin-top:4px">
      ${['🔥', '💪', '👏', '👍'].map((e2) => `<span class="rx" data-rx="${e2}" style="cursor:pointer;font-size:16px;padding:6px 14px">${e2}</span>`).join('')}
    </div>
    <div class="composer">
      <input id="cm-input" placeholder="Comment on this meal…" />
      <div class="send" id="cm-send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
```

In `coachMeal.mount`, after the existing composer wiring, add the reaction taps:

```js
    root.querySelectorAll('#rx-bar [data-rx]').forEach((btn) => btn.addEventListener('click', async () => {
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) return;
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', btn.getAttribute('data-rx'), 'reaction');
      if (ok) roles.nudgePush(athleteId, `Coach reacted to your ${meal ? cap(meal.type) : 'meal'}`, btn.getAttribute('data-rx'));
      await loadMealComments(sub, true);
    }));
```

(The `.rx-strip`/`.rx` CSS classes ship in Task 5's append — no new CSS needed. Note `meal.detected` on the coach side may now contain rich objects for new meals; where `coachMeal` renders detected chips, map through `typeof f === 'string' ? f : f.name` before `esc`.)

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm run test` → green.

```bash
git add proto/redesign-2026-07/js/roles.js proto/redesign-2026-07/js/screens/coach.js
git commit -m "feat(coach): one-tap meal reactions + derived AI opening on the coach thread"
```

---

### Task 7: Full verification + browser QA + docs closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-meal-intelligence-design.md` (Status line)
- Modify: `proto/redesign-2026-07/BUILD-NOTES.md` (dated entry)

- [ ] **Step 1: Full verify**

Run: `npm run verify` — typecheck clean, all suites green, bundle exports. Fix anything that fails.

- [ ] **Step 2: Browser QA** (Playwright MCP; serve the proto at `http://localhost:8124` via `npx serve proto/redesign-2026-07 -l 8124`; Playwright blocks `file:` URLs; if the browser profile is locked, `browser_close` then kill ONLY chrome processes whose command line matches `mcp-chrome-profile|ms-playwright`)

Walk and record pass/fail: log a meal via console (`__act.captureManual({protein:40,kcal:650,carbs:60,fat:18},['Chicken','Rice'],'lunch'); __act.logMeal('lunch'); location.hash='#meal-thread/lunch'`) → the four sections render in order; execution summary shows the count-up once and the still-counts line for a late slot (no red anywhere in section 1); breakdown shows confidence dots + fiber row + "estimated from photo" labels + honest no-targets line; discussion shows the derived AI opening; composer posts and shows the graceful "Couldn't reach your AI coach" retry line offline (edge fn undeployed — expected); revisit `#meal-detail/lunch` renders the same page settled (no replayed count-up... acceptable if it replays once per the noted `_played` caveat — record actual behavior); `#meal-confirm` aliases to the page; Next Action reflects `S.exec.now`; pre-log analysis screen shows confidence chips with "?" on low + Edit still removes chips. Fix real defects in the owning file (small fixes only; BLOCKED if architectural).

- [ ] **Step 3: Docs + commit**

Spec Status → `**Status:** Implemented 2026-07-09 (plan docs/superpowers/plans/2026-07-09-meal-intelligence.md); meal-chat function + 0049 await go-live deploy/apply; voice notes, participants, long-term memory deferred.` BUILD-NOTES: dated entry naming `meal-intel.js`, the unified `meal-thread` page, the derived opening, `meal-chat`, reactions, and the schema extension.

```bash
git add docs/superpowers/specs/2026-07-09-meal-intelligence-design.md proto/redesign-2026-07/BUILD-NOTES.md
git commit -m "docs: meal intelligence closeout — spec status + build notes"
```
