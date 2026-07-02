# Meal Plans — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured, coach-authored meal plan (pinned-or-open slots) that the athlete sees as "Today's Prescribed Meals," measured by a plan-compliance read — AI drafts, coach approves — all behind a feature flag.

**Architecture:** Approach C. `CoachPlan` (src/core/coachPlan.ts) gains a `slots: PlanSlot[]` field; that array is the whole feature. A pure-TS deterministic builder produces a plan offline; a `plan-generate` edge function upgrades it with Claude when configured (client always falls back to the deterministic draft, exactly like `analyzeMeal`). Compliance is a pure function matching existing logged `meals` to slots. The day-score formula is unchanged; "plan compliance %" is a display-only read. When no plan is assigned, every surface behaves exactly as today.

**Tech Stack:** Expo/React Native + TypeScript, Zustand store, Supabase (Postgres + Edge Functions/Deno), Jest for pure-core tests, Anthropic SDK (`claude-sonnet-5`) server-side.

## Global Constraints

- **Pure core:** everything in `src/core/` is framework-agnostic — NO React/RN imports. Export new modules from `src/core/index.ts`.
- **Tests colocate:** `src/core/<name>.test.ts`, Jest `describe/it`. Run with `npx jest <path>`.
- **AI proposes, human approves:** the generator NEVER auto-assigns. The client ALWAYS computes a deterministic result locally and treats the model as an optional upgrade; any model failure falls back with no error surfaced to the user.
- **Numbers never invented by the model reach the score:** validate/sanitize any model or DB output through a hand-written guard (house style — see `src/core/validate.ts`, `macroGrounding.ts`). Do NOT add zod (not a dependency here).
- **Day-score formula unchanged:** do not touch `src/core/scoring.ts` weights. Plan compliance is display-only.
- **No schema change to `meals`/`days`.** New tables only.
- **Feature-flagged:** every new UI entry point is gated by `isMealPlansEnabled` (env `EXPO_PUBLIC_MEAL_PLANS_ENABLED`), mirroring `isEnginesEnabled`. OFF by default.
- **Voice:** any athlete/coach-facing copy is direct, encouraging, never shaming, no em dashes (matches the analyze-meal SYSTEM prompt rules).
- **Commit** after each task with the message shown in its final step.

---

### Task 1: Extend `CoachPlan` with slots

**Files:**
- Modify: `src/core/coachPlan.ts`
- Test: `src/core/coachPlan.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `CoachPlan`, `MealKey`, `MealWindow`, `DEFAULT_PLAN`, `mealTarget`.
- Produces:
  - `PlanMeal { name: string; items: string[]; macros: { kcal: number; protein: number; carbs: number; fat: number }; source: 'ai' | 'template' | 'restaurant' }`
  - `PlanSlot { key: MealKey; mode: 'pinned' | 'open'; macros: { kcal: number; protein: number; carbs?: number; fat?: number }; pinnedMeal: PlanMeal | null; options: PlanMeal[]; restaurantAlts: PlanMeal[]; note: string | null; photoRequired: boolean }`
  - `CoachPlan.slots: PlanSlot[]`
  - `emptySlot(key: MealKey): PlanSlot`

- [ ] **Step 1: Write the failing test**

Create/append `src/core/coachPlan.test.ts`:

```ts
import { DEFAULT_PLAN, emptySlot } from './coachPlan';

describe('CoachPlan slots', () => {
  it('DEFAULT_PLAN carries an empty slots array', () => {
    expect(DEFAULT_PLAN.slots).toEqual([]);
  });

  it('emptySlot builds an open slot with no meals and photo not required', () => {
    const s = emptySlot('lunch');
    expect(s.key).toBe('lunch');
    expect(s.mode).toBe('open');
    expect(s.pinnedMeal).toBeNull();
    expect(s.options).toEqual([]);
    expect(s.restaurantAlts).toEqual([]);
    expect(s.note).toBeNull();
    expect(s.photoRequired).toBe(false);
    expect(s.macros).toEqual({ kcal: 0, protein: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/coachPlan.test.ts`
Expected: FAIL — `emptySlot` is not exported / `slots` undefined.

- [ ] **Step 3: Add the types and helper**

In `src/core/coachPlan.ts`, add after the `MealWindow` interface:

```ts
/** One planned meal — a pinned prescription, an approved option, or a restaurant equivalent. */
export interface PlanMeal {
  name: string;
  items: string[];
  macros: { kcal: number; protein: number; carbs: number; fat: number };
  source: 'ai' | 'template' | 'restaurant';
}

/** One meal window's prescription. `pinned` = eat this exact meal; `open` = hit the macros,
 *  pick from `options`. `restaurantAlts` keep a traveling athlete compliant. */
export interface PlanSlot {
  key: MealKey;
  mode: 'pinned' | 'open';
  macros: { kcal: number; protein: number; carbs?: number; fat?: number };
  pinnedMeal: PlanMeal | null;
  options: PlanMeal[];
  restaurantAlts: PlanMeal[];
  note: string | null;
  photoRequired: boolean;
}

/** A blank open slot for a key, used as the editor's starting point. */
export function emptySlot(key: MealKey): PlanSlot {
  return { key, mode: 'open', macros: { kcal: 0, protein: 0 }, pinnedMeal: null, options: [], restaurantAlts: [], note: null, photoRequired: false };
}
```

Add `slots: PlanSlot[]` to the `CoachPlan` interface (after `weightGoalLb`), and `slots: [],` to `DEFAULT_PLAN`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/coachPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/coachPlan.ts src/core/coachPlan.test.ts
git commit -m "feat(plans): add PlanSlot/PlanMeal types + slots on CoachPlan"
```

---

### Task 2: `parsePlanSlots` sanitizer (guards model/DB output)

**Files:**
- Create: `src/core/planValidate.ts`
- Test: `src/core/planValidate.test.ts`
- Modify: `src/core/index.ts` (add `export * from './planValidate';`)

**Interfaces:**
- Consumes: `PlanSlot`, `PlanMeal`, `MealKey` from `./coachPlan`.
- Produces: `parsePlanSlots(raw: unknown): PlanSlot[]` — coerces arbitrary input to a valid `PlanSlot[]`, dropping unknown fields, clamping negatives to 0, defaulting missing fields, and discarding entries without a valid `MealKey`.

- [ ] **Step 1: Write the failing test**

Create `src/core/planValidate.test.ts`:

```ts
import { parsePlanSlots } from './planValidate';

describe('parsePlanSlots', () => {
  it('drops entries with no valid meal key', () => {
    const out = parsePlanSlots([{ key: 'brunch', mode: 'open' }, { key: 'lunch', mode: 'open' }]);
    expect(out.map((s) => s.key)).toEqual(['lunch']);
  });

  it('defaults missing fields and strips unknown keys', () => {
    const [s] = parsePlanSlots([{ key: 'breakfast', mode: 'pinned', hacker: true, macros: { kcal: 600, protein: 40 } }]);
    expect(s.mode).toBe('pinned');
    expect(s.options).toEqual([]);
    expect(s.restaurantAlts).toEqual([]);
    expect(s.photoRequired).toBe(false);
    expect(s.note).toBeNull();
    expect((s as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('clamps negative macros to 0 and coerces meal items to strings', () => {
    const [s] = parsePlanSlots([
      { key: 'dinner', mode: 'open', macros: { kcal: -5, protein: -2 }, options: [{ name: 'X', items: ['rice', 7], macros: { kcal: -1, protein: 10, carbs: 5, fat: 3 }, source: 'ai' }] },
    ]);
    expect(s.macros).toEqual({ kcal: 0, protein: 0 });
    expect(s.options[0].items).toEqual(['rice']);
    expect(s.options[0].macros.kcal).toBe(0);
  });

  it('returns [] for non-array input', () => {
    expect(parsePlanSlots(null)).toEqual([]);
    expect(parsePlanSlots('nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/planValidate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/planValidate.ts`:

```ts
// OnStandard — sanitize arbitrary plan-slot input (model output or a DB jsonb blob) into a
// trusted PlanSlot[]. House style: a hand-written guard, next to the scoring authority, so no
// unvalidated shape ever reaches the compliance read or the UI. No zod dependency.
import type { MealKey } from './types';
import type { PlanMeal, PlanSlot } from './coachPlan';

const KEYS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function parseMeal(raw: unknown, fallbackSource: PlanMeal['source']): PlanMeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const m = (r.macros ?? {}) as Record<string, unknown>;
  const source = r.source === 'template' || r.source === 'restaurant' || r.source === 'ai' ? r.source : fallbackSource;
  return {
    name: str(r.name),
    items: strList(r.items),
    macros: { kcal: num(m.kcal), protein: num(m.protein), carbs: num(m.carbs), fat: num(m.fat) },
    source,
  };
}

function parseMeals(raw: unknown, fallbackSource: PlanMeal['source']): PlanMeal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => parseMeal(m, fallbackSource)).filter((m): m is PlanMeal => m !== null);
}

export function parsePlanSlots(raw: unknown): PlanSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!KEYS.includes(r.key as MealKey)) continue;
    const macros = (r.macros ?? {}) as Record<string, unknown>;
    out.push({
      key: r.key as MealKey,
      mode: r.mode === 'pinned' ? 'pinned' : 'open',
      macros: { kcal: num(macros.kcal), protein: num(macros.protein), ...(macros.carbs != null ? { carbs: num(macros.carbs) } : {}), ...(macros.fat != null ? { fat: num(macros.fat) } : {}) },
      pinnedMeal: parseMeal(r.pinnedMeal, 'ai'),
      options: parseMeals(r.options, 'ai'),
      restaurantAlts: parseMeals(r.restaurantAlts, 'restaurant'),
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
      photoRequired: r.photoRequired === true,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/planValidate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/planValidate.ts src/core/planValidate.test.ts src/core/index.ts
git commit -m "feat(plans): parsePlanSlots sanitizer for model/DB slot input"
```

---

### Task 3: Deterministic plan draft builder (offline fallback + macro split)

**Files:**
- Create: `src/core/planDraft.ts`
- Test: `src/core/planDraft.test.ts`
- Modify: `src/core/index.ts` (add `export * from './planDraft';`)

**Interfaces:**
- Consumes: `CoachPlan`, `PlanSlot`, `mealTarget`, `emptySlot` from `./coachPlan`; `EngineGoal` from `./restaurantCoach`.
- Produces: `buildPlanDraft(plan: CoachPlan, goal: EngineGoal): PlanSlot[]` — one open slot per plan window, macros split via `mealTarget`, each slot seeded with one generic `PlanMeal` option. This is BOTH the offline fallback for the generator AND the default when a coach opens the editor with no plan yet.

- [ ] **Step 1: Write the failing test**

Create `src/core/planDraft.test.ts`:

```ts
import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

describe('buildPlanDraft', () => {
  it('creates one slot per window, keyed to the windows', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    expect(slots.map((s) => s.key)).toEqual(DEFAULT_PLAN.windows.map((w) => w.key));
  });

  it('slot macros roughly sum to the plan protein target (required-weighted)', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    const totalProtein = slots.reduce((n, s) => n + s.macros.protein, 0);
    // required meals carry a full share, snack a half — total lands near the plan target, not above it.
    expect(totalProtein).toBeGreaterThan(DEFAULT_PLAN.proteinTarget * 0.6);
    expect(totalProtein).toBeLessThanOrEqual(DEFAULT_PLAN.proteinTarget + 5);
  });

  it('every slot has one seeded option in open mode', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'maintain');
    for (const s of slots) {
      expect(s.mode).toBe('open');
      expect(s.options).toHaveLength(1);
      expect(s.options[0].source).toBe('ai');
      expect(s.options[0].macros.protein).toBe(s.macros.protein);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/planDraft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/planDraft.ts`:

```ts
// OnStandard — deterministic meal-plan draft. Splits the CoachPlan's macro targets across its
// windows (via mealTarget) into open slots, each seeded with one generic option. Pure + offline:
// it is the fallback the client uses whenever the plan-generate model call is unavailable, so a
// coach always gets an editable starting plan.
import type { CoachPlan, PlanSlot, PlanMeal } from './coachPlan';
import { emptySlot, mealTarget } from './coachPlan';
import type { EngineGoal } from './restaurantCoach';
import type { MealKey } from './types';

const SLOT_LABEL: Record<MealKey, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

function seedMeal(key: MealKey, goal: EngineGoal, kcal: number, protein: number): PlanMeal {
  const carbs = Math.round((kcal * 0.45) / 4);
  const fat = Math.round((kcal * 0.25) / 9);
  const lead = goal === 'gain' ? 'High-calorie' : goal === 'lose' ? 'Lean' : 'Balanced';
  return { name: `${lead} ${SLOT_LABEL[key]}`, items: [], macros: { kcal, protein, carbs, fat }, source: 'ai' };
}

export function buildPlanDraft(plan: CoachPlan, goal: EngineGoal): PlanSlot[] {
  return plan.windows.map((w) => {
    const t = mealTarget(plan, w.key);
    const slot = emptySlot(w.key);
    slot.macros = { kcal: t.calories, protein: t.protein };
    slot.options = [seedMeal(w.key, goal, t.calories, t.protein)];
    slot.photoRequired = w.required;
    return slot;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/planDraft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/planDraft.ts src/core/planDraft.test.ts src/core/index.ts
git commit -m "feat(plans): deterministic buildPlanDraft (macro split + offline fallback)"
```

---

### Task 4: `planCompliance` pure read

**Files:**
- Create: `src/core/planCompliance.ts`
- Test: `src/core/planCompliance.test.ts`
- Modify: `src/core/index.ts` (add `export * from './planCompliance';`)

**Interfaces:**
- Consumes: `CoachPlan`, `PlanSlot` from `./coachPlan`; `MealKey` from `./types`.
- Produces:
  - `type SlotComplianceState = 'completed' | 'partial' | 'missed' | 'upcoming'`
  - `interface SlotCompliance { key: MealKey; state: SlotComplianceState }`
  - `interface PlanComplianceResult { slots: SlotCompliance[]; completedRequired: number; requiredTotal: number; compliancePct: number }`
  - `planCompliance(plan: CoachPlan, logged: Partial<Record<MealKey, { protein: number; kcal: number }>>, now?: Date): PlanComplianceResult`

Rules: a slot is **completed** when it's logged and logged protein ≥ 85% of the slot's protein target; **partial** when logged but under; **missed** when unlogged and the window deadline has passed; **upcoming** otherwise. `requiredTotal`/`completedRequired` count only slots whose matching window is `required`. `compliancePct = round(completedRequired / requiredTotal * 100)` (100 when no required slots).

- [ ] **Step 1: Write the failing test**

Create `src/core/planCompliance.test.ts`:

```ts
import { planCompliance } from './planCompliance';
import { buildPlanDraft, DEFAULT_PLAN } from './coachPlan';

const at = (h: number, m = 0) => new Date(2026, 6, 2, h, m);

function planWithSlots() {
  return { ...DEFAULT_PLAN, slots: buildPlanDraft(DEFAULT_PLAN, 'gain') };
}

describe('planCompliance', () => {
  it('marks a slot completed when logged protein meets 85% of its target', () => {
    const plan = planWithSlots();
    const bfast = plan.slots.find((s) => s.key === 'breakfast')!;
    const logged = { breakfast: { protein: Math.ceil(bfast.macros.protein * 0.9), kcal: bfast.macros.kcal } };
    const r = planCompliance(plan, logged, at(10));
    expect(r.slots.find((s) => s.key === 'breakfast')!.state).toBe('completed');
  });

  it('marks a logged-but-short slot partial', () => {
    const plan = planWithSlots();
    const bfast = plan.slots.find((s) => s.key === 'breakfast')!;
    const logged = { breakfast: { protein: Math.floor(bfast.macros.protein * 0.4), kcal: 200 } };
    expect(planCompliance(plan, logged, at(10)).slots.find((s) => s.key === 'breakfast')!.state).toBe('partial');
  });

  it('marks an unlogged past-deadline slot missed, a future one upcoming', () => {
    const plan = planWithSlots();
    const r = planCompliance(plan, {}, at(12, 30)); // breakfast deadline 9:30 passed; dinner future
    expect(r.slots.find((s) => s.key === 'breakfast')!.state).toBe('missed');
    expect(r.slots.find((s) => s.key === 'dinner')!.state).toBe('upcoming');
  });

  it('compliancePct counts only required slots', () => {
    const plan = planWithSlots(); // breakfast/lunch/dinner required, snack optional
    const logged = {
      breakfast: { protein: 999, kcal: 999 },
      lunch: { protein: 999, kcal: 999 },
      dinner: { protein: 999, kcal: 999 },
    };
    const r = planCompliance(plan, logged, at(21));
    expect(r.requiredTotal).toBe(3);
    expect(r.completedRequired).toBe(3);
    expect(r.compliancePct).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/planCompliance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/planCompliance.ts`:

```ts
// OnStandard — plan compliance read (pure). Matches what the athlete actually logged against the
// prescribed slots. DISPLAY ONLY: this never feeds the day score (Constitution Rule #13); it is the
// "did you eat the plan?" number the athlete + coach see alongside the unchanged Execution Score.
import type { CoachPlan } from './coachPlan';
import type { MealKey } from './types';

export type SlotComplianceState = 'completed' | 'partial' | 'missed' | 'upcoming';
export interface SlotCompliance {
  key: MealKey;
  state: SlotComplianceState;
}
export interface PlanComplianceResult {
  slots: SlotCompliance[];
  completedRequired: number;
  requiredTotal: number;
  compliancePct: number;
}

const MET = 0.85; // logged protein must reach 85% of the slot target to count as completed

export function planCompliance(
  plan: CoachPlan,
  logged: Partial<Record<MealKey, { protein: number; kcal: number }>>,
  now: Date = new Date(),
): PlanComplianceResult {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const windowByKey = new Map(plan.windows.map((w) => [w.key, w]));

  const slots: SlotCompliance[] = plan.slots.map((slot) => {
    const hit = logged[slot.key];
    if (hit) {
      const target = slot.macros.protein;
      const state: SlotComplianceState = target <= 0 || hit.protein >= target * MET ? 'completed' : 'partial';
      return { key: slot.key, state };
    }
    const w = windowByKey.get(slot.key);
    const past = w ? nowMin > w.deadlineMin : false;
    return { key: slot.key, state: past ? 'missed' : 'upcoming' };
  });

  const requiredKeys = new Set(plan.windows.filter((w) => w.required).map((w) => w.key));
  const requiredSlots = slots.filter((s) => requiredKeys.has(s.key));
  const requiredTotal = requiredSlots.length;
  const completedRequired = requiredSlots.filter((s) => s.state === 'completed').length;
  const compliancePct = requiredTotal > 0 ? Math.round((completedRequired / requiredTotal) * 100) : 100;

  return { slots, completedRequired, requiredTotal, compliancePct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/planCompliance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/planCompliance.ts src/core/planCompliance.test.ts src/core/index.ts
git commit -m "feat(plans): planCompliance pure read (display-only, does not touch score)"
```

---

### Task 5: Feature flag + store state and actions

**Files:**
- Modify: `src/lib/features.ts`
- Modify: `src/store/useStore.ts`
- Test: `src/core/planStore.test.ts` (a pure reducer test — see note)

**Interfaces:**
- Consumes: `PlanSlot`, `emptySlot`, `buildPlanDraft`, `activePlan`, `parsePlanSlots` from `@/core`; `EngineGoal`.
- Produces on the store: state `planSlots: PlanSlot[]`; actions
  - `setPlanSlots(slots: PlanSlot[]): void`
  - `updatePlanSlot(key: MealKey, patch: Partial<PlanSlot>): void`
  - `togglePlanSlotMode(key: MealKey): void`
  - `generatePlanDraftLocal(goal: EngineGoal): void` (fills `planSlots` from `buildPlanDraft`)
  - `clearPlan(): void`
  - `isMealPlansEnabled` (exported from features).

Note on testing: the store mixes RN; per repo convention pure logic is tested in `src/core`. Extract the slot-patch logic into a tiny pure helper `applySlotPatch` in `src/core/planStore.ts` and unit-test THAT; the store action calls it. This keeps the reducer honest and testable without RN.

- [ ] **Step 1: Write the failing test**

Create `src/core/planStore.test.ts`:

```ts
import { applySlotPatch, toggleMode } from './planStore';
import { buildPlanDraft, DEFAULT_PLAN } from './coachPlan';

describe('applySlotPatch', () => {
  it('patches only the targeted slot', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    const out = applySlotPatch(slots, 'lunch', { note: 'Finish everything', photoRequired: true });
    const lunch = out.find((s) => s.key === 'lunch')!;
    expect(lunch.note).toBe('Finish everything');
    expect(lunch.photoRequired).toBe(true);
    expect(out.find((s) => s.key === 'breakfast')!.note).toBeNull();
  });
});

describe('toggleMode', () => {
  it('flips pinned <-> open for one slot', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain'); // all open
    const out = toggleMode(slots, 'dinner');
    expect(out.find((s) => s.key === 'dinner')!.mode).toBe('pinned');
    expect(toggleMode(out, 'dinner').find((s) => s.key === 'dinner')!.mode).toBe('open');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/planStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure helper**

Create `src/core/planStore.ts`:

```ts
// OnStandard — pure slot-list reducers shared by the store actions (kept in core so they're
// unit-tested without RN). The store's plan actions are thin wrappers over these.
import type { PlanSlot } from './coachPlan';
import type { MealKey } from './types';

export function applySlotPatch(slots: PlanSlot[], key: MealKey, patch: Partial<PlanSlot>): PlanSlot[] {
  return slots.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

export function toggleMode(slots: PlanSlot[], key: MealKey): PlanSlot[] {
  return slots.map((s) => (s.key === key ? { ...s, mode: s.mode === 'pinned' ? 'open' : 'pinned' } : s));
}
```

Add `export * from './planStore';` to `src/core/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/planStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the feature flag**

Append to `src/lib/features.ts`:

```ts
// Master switch for the Meal Plans feature (structured prescribed meals + plan compliance).
// OFF by default so the prove-the-loop beta is untouched; flip with EXPO_PUBLIC_MEAL_PLANS_ENABLED=true.
export const isMealPlansEnabled = process.env.EXPO_PUBLIC_MEAL_PLANS_ENABLED?.trim() === 'true';
```

- [ ] **Step 6: Wire the store**

In `src/store/useStore.ts`: add `planSlots: PlanSlot[]` to the state interface and initial state (`planSlots: []`); import the helpers + types from `@/core`. Add action signatures to the interface and implementations:

```ts
setPlanSlots: (slots) => set({ planSlots: parsePlanSlots(slots) }),
updatePlanSlot: (key, patch) => set((s) => ({ planSlots: applySlotPatch(s.planSlots, key, patch) })),
togglePlanSlotMode: (key) => set((s) => ({ planSlots: toggleMode(s.planSlots, key) })),
generatePlanDraftLocal: (goal) => set((s) => ({ planSlots: buildPlanDraft(activePlan(s), goal) })),
clearPlan: () => set({ planSlots: [] }),
```

Add `planSlots: s.planSlots,` to the `partialize` return (near the existing `planInstructions:` line ~1272) so the plan persists.

- [ ] **Step 7: Verify typecheck + tests**

Run: `npx tsc --noEmit && npx jest src/core/planStore.test.ts`
Expected: no type errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/features.ts src/store/useStore.ts src/core/planStore.ts src/core/planStore.test.ts src/core/index.ts
git commit -m "feat(plans): isMealPlansEnabled flag + store plan state/actions"
```

---

### Task 6: `plan-generate` edge function

**Files:**
- Create: `supabase/functions/plan-generate/index.ts`

**Interfaces:**
- Request body: `{ goal: 'gain'|'lose'|'maintain'|'performance'; prompt?: string; protocol: { currentWeight?: number; targetWeight?: number; calories?: number; protein?: number; mealsPerDay?: number; position?: string; deadline?: string }; windows: { key: string; label: string; required: boolean }[] }`
- Response body: `{ slots: PlanSlot[] }` (the model fills a forced `report_meal_plan` tool; the client re-sanitizes with `parsePlanSlots`).

This mirrors `analyze-meal/index.ts`: reuse its CORS (`corsFor`), per-IP rate limit (`rateLimited`), per-user daily cap (`resolveUserId` + `withinDailyCap`), and `ANTHROPIC_MODEL` default. Copy those helpers verbatim (they are self-contained) rather than importing, matching how the repo keeps each function standalone.

- [ ] **Step 1: Create the function**

Create `supabase/functions/plan-generate/index.ts`. Reuse the boilerplate block (imports, `MODEL`, `DAILY_CAP`, `resolveUserId`, `withinDailyCap`, `corsFor`, `rateLimited`) copied from `analyze-meal/index.ts`, then:

```ts
const PLAN_TOOL = {
  name: 'report_meal_plan',
  description: 'Report a full day meal plan as an array of slots, one per meal window given.',
  input_schema: {
    type: 'object',
    properties: {
      slots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
            mode: { type: 'string', enum: ['pinned', 'open'] },
            macros: {
              type: 'object',
              properties: { kcal: { type: 'integer' }, protein: { type: 'integer' }, carbs: { type: 'integer' }, fat: { type: 'integer' } },
              required: ['kcal', 'protein'],
            },
            pinnedMeal: { type: ['object', 'null'], description: 'The single prescribed meal when mode is pinned, else null.' },
            options: { type: 'array', description: '2-3 approved meal choices when mode is open.', items: { type: 'object' } },
            restaurantAlts: { type: 'array', description: '2-3 restaurant equivalents (Chipotle, Publix, Wawa) that keep the athlete on target while traveling.', items: { type: 'object' } },
            note: { type: ['string', 'null'], description: 'One short coach note shown when this meal arrives, or null. No em dashes.' },
            photoRequired: { type: 'boolean' },
          },
          required: ['key', 'mode', 'macros', 'options', 'restaurantAlts', 'photoRequired'],
        },
      },
    },
    required: ['slots'],
  },
} as const;

const PLAN_SYSTEM = `You are the OnStandard sports nutritionist DRAFTING a one-day meal plan for a coach to
review and edit. You never assign; you propose. Build exactly one slot per meal window you are given,
using the athlete's goal and targets. For each slot: set realistic macros that add up close to the daily
targets; provide 2-3 approved options (each a real meal with an items list) when the slot should be
flexible, or a single pinnedMeal when one specific meal is best; always include 2-3 restaurant equivalents
(Chipotle, Publix, Wawa or similar) that hit the same macros for a traveling athlete; add a short coach
note only when it matters. Voice: direct, encouraging, never hype, no em dashes. Every meal must be real
food an athlete would actually eat. Return by calling report_meal_plan.`;
```

Handler: after the shared guards, require `Array.isArray(req.windows) && req.windows.length > 0` (400 `windows required`); build a text prompt from `goal`, `protocol`, `windows`, and the optional free-text `prompt`; call `client.messages.create` with `tools: [PLAN_TOOL]`, `tool_choice: { type: 'tool', name: 'report_meal_plan' }`, `max_tokens: 2048`; return `JSON.stringify(used.input)` (i.e. `{ slots: [...] }`). On any error return 502 `{ error }` — the client falls back to the local draft.

- [ ] **Step 2: Manual verification (no Deno test harness in repo)**

Deploy to a dev project and curl it:

```bash
supabase functions deploy plan-generate
curl -s -X POST "$SUPABASE_URL/functions/v1/plan-generate" \
  -H "Content-Type: application/json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -d '{"goal":"gain","prompt":"5,200 cal, 6 meals, 2 shakes, 290lb OL","protocol":{"currentWeight":290,"calories":5200,"protein":250,"mealsPerDay":6},"windows":[{"key":"breakfast","label":"Breakfast","required":true},{"key":"lunch","label":"Lunch","required":true},{"key":"dinner","label":"Dinner","required":true}]}' | jq '.slots | length'
```

Expected: prints `3` (one slot per window), each with `macros`, `options`, `restaurantAlts`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/plan-generate/index.ts
git commit -m "feat(plans): plan-generate edge function (Claude drafts, forced tool output)"
```

---

### Task 7: `planGenerate` client seam (always falls back to the local draft)

**Files:**
- Create: `src/lib/ai/planGenerate.ts`

**Interfaces:**
- Consumes: `supabase` client, `parsePlanSlots`, `buildPlanDraft`, `activePlan`, `PlanSlot`, `CoachPlan`, `EngineGoal` from `@/core`.
- Produces: `generatePlan(args: { plan: CoachPlan; goal: EngineGoal; prompt?: string; protocol?: Record<string, unknown> }): Promise<PlanSlot[]>` — calls the edge function; on ANY failure or when unconfigured, returns `buildPlanDraft(plan, goal)`. Always returns a valid, sanitized `PlanSlot[]`.

- [ ] **Step 1: Write the module**

Create `src/lib/ai/planGenerate.ts`, following `src/lib/ai/assist.ts` (endpoint from `EXPO_PUBLIC_SUPABASE_URL`, `apikey`/bearer headers, `AbortController` 20s timeout):

```ts
import { activePlan, buildPlanDraft, parsePlanSlots, type CoachPlan, type EngineGoal, type PlanSlot } from '@/core';
import { supabase } from '@/lib/supabase/client';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/plan-generate` : '';
export const isPlanGenerateConfigured = Boolean(ENDPOINT && anonKey);

export async function generatePlan(args: { plan: CoachPlan; goal: EngineGoal; prompt?: string; protocol?: Record<string, unknown> }): Promise<PlanSlot[]> {
  const fallback = buildPlanDraft(args.plan, args.goal);
  if (!isPlanGenerateConfigured) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey ?? '', Authorization: `Bearer ${token ?? anonKey ?? ''}` },
      body: JSON.stringify({
        goal: args.goal,
        prompt: args.prompt ?? '',
        protocol: args.protocol ?? {},
        windows: args.plan.windows.map((w) => ({ key: w.key, label: w.label, required: w.required })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { slots?: unknown };
    const slots = parsePlanSlots(json.slots);
    return slots.length > 0 ? slots : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/planGenerate.ts
git commit -m "feat(plans): generatePlan client seam with deterministic fallback"
```

---

### Task 8: Coach author flow — Generate + slot editor in `CoachPlanEditor`

**Files:**
- Modify: `src/screens/overlays/CoachPlanEditor.tsx`

**Interfaces:**
- Consumes: store `planSlots`, `setPlanSlots`, `updatePlanSlot`, `togglePlanSlotMode`, `generatePlanDraftLocal`, `baseGoal`; `generatePlan` from `@/lib/ai/planGenerate`; `isMealPlansEnabled`.
- Produces: no new exports (screen wiring only).

Gate the whole new block with `isMealPlansEnabled` so a flag-off build renders exactly today's editor.

- [ ] **Step 1: Add the Generate card + slot list**

Below the existing "Daily targets" card, add (only when `isMealPlansEnabled`) a "Prescribed meals" `Card`:
- A **"Generate plan"** `Btn` that calls `generatePlan({ plan: activePlan(s), goal, prompt })` (map `s.baseGoal` to an `EngineGoal`; treat `'performance'` as `'maintain'` for the split), then `s.setPlanSlots(result)`. Show a spinner while awaiting. On empty result the seam already returns the local draft, so the list always fills.
- For each slot in `s.planSlots`: a row showing `slot.key` label, a pinned/open toggle (`s.togglePlanSlotMode(slot.key)`), the macro summary (`{slot.macros.protein}g · {slot.macros.kcal} cal`), a photo-required toggle (`s.updatePlanSlot(slot.key, { photoRequired: !slot.photoRequired })`), and a `TextInput` for `note` (`onChangeText` → `s.updatePlanSlot(slot.key, { note })`). When `mode === 'open'`, list `slot.options` names; when `pinned`, show `slot.pinnedMeal?.name`. Show `restaurantAlts` names under a small "Traveling?" label.

Use existing primitives (`Card`, `Row`, `Txt`, `Pressable`, `Btn`, `Icon`) and `useColors` exactly as the current file does.

- [ ] **Step 2: Manual verification**

Run the app with the flag on:

```bash
EXPO_PUBLIC_MEAL_PLANS_ENABLED=true npx expo start
```

Open a coach account → PersonDetail → Coach Plan. Tap **Generate plan** → slots appear. Toggle a slot pinned↔open, flip photo-required, type a note → the row updates and persists after closing/reopening the overlay.
Then run with the flag OFF and confirm the editor looks identical to before (no Prescribed-meals card).

- [ ] **Step 3: Commit**

```bash
git add src/screens/overlays/CoachPlanEditor.tsx
git commit -m "feat(plans): coach author flow — generate + edit prescribed slots"
```

---

### Task 9: Athlete consumption — "Today's Prescribed Meals" in `Nutrition.tsx`

**Files:**
- Modify: `src/screens/athlete/Nutrition.tsx`
- Create: `src/core/planView.ts` (pure view-model joining slots + compliance + logged rows)
- Test: `src/core/planView.test.ts`

**Interfaces:**
- Consumes: `planCompliance`, `PlanSlot`, `SlotComplianceState`, `activePlan`, `mealRowsFor` inputs.
- Produces: `planView(plan, logged, now): { slot: PlanSlot; state: SlotComplianceState; showNote: boolean }[]` — pairs each slot with its compliance state and whether its note should show yet (window open or later). Keeps the screen dumb.

- [ ] **Step 1: Write the failing test**

Create `src/core/planView.test.ts`:

```ts
import { planView } from './planView';
import { buildPlanDraft, DEFAULT_PLAN } from './coachPlan';

const at = (h: number, m = 0) => new Date(2026, 6, 2, h, m);

describe('planView', () => {
  it('returns one entry per slot with a compliance state', () => {
    const plan = { ...DEFAULT_PLAN, slots: buildPlanDraft(DEFAULT_PLAN, 'gain') };
    const v = planView(plan, {}, at(12, 30));
    expect(v.map((e) => e.slot.key)).toEqual(plan.slots.map((s) => s.key));
    expect(v.find((e) => e.slot.key === 'breakfast')!.state).toBe('missed');
  });

  it('shows a note only once its window has opened', () => {
    const plan = { ...DEFAULT_PLAN, slots: buildPlanDraft(DEFAULT_PLAN, 'gain').map((s) => (s.key === 'dinner' ? { ...s, note: 'Extra salt' } : s)) };
    expect(planView(plan, {}, at(8)).find((e) => e.slot.key === 'dinner')!.showNote).toBe(false); // dinner window not open at 8am
    expect(planView(plan, {}, at(18)).find((e) => e.slot.key === 'dinner')!.showNote).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/core/planView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view-model**

Create `src/core/planView.ts`:

```ts
// OnStandard — athlete "Today's Prescribed Meals" view-model (pure). Joins each slot with its
// compliance state and whether its coach note should appear yet (only once the window opens, so
// the athlete sees the right cue at the right time). Keeps Nutrition.tsx declarative.
import type { CoachPlan, PlanSlot } from './coachPlan';
import { planCompliance, type SlotComplianceState } from './planCompliance';
import type { MealKey } from './types';

export interface PlanViewEntry {
  slot: PlanSlot;
  state: SlotComplianceState;
  showNote: boolean;
}

export function planView(
  plan: CoachPlan,
  logged: Partial<Record<MealKey, { protein: number; kcal: number }>>,
  now: Date = new Date(),
): PlanViewEntry[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openByKey = new Map(plan.windows.map((w) => [w.key, nowMin >= w.openMin]));
  const compliance = planCompliance(plan, logged, now);
  const stateByKey = new Map(compliance.slots.map((s) => [s.key, s.state]));
  return plan.slots.map((slot) => ({
    slot,
    state: stateByKey.get(slot.key) ?? 'upcoming',
    showNote: Boolean(slot.note) && (openByKey.get(slot.key) ?? false),
  }));
}
```

Add `export * from './planView';` to `src/core/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/core/planView.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the screen**

In `src/screens/athlete/Nutrition.tsx`, when `isMealPlansEnabled && s.planSlots.length > 0`, render a **"Today's Prescribed Meals"** `Card` at the top of the scroll (above the weekly-goal card). Build the entries with `planView(activePlan(s) with slots: s.planSlots, loggedMap, new Date())` where `loggedMap` is derived from `mealRowsFor(s)`/`d` (protein + kcal per logged slot). Each entry row shows: the slot label, a state chip (🟢 completed / 🟡 upcoming / 🔴 missed / partial), the pinned meal name or the option names, the `restaurantAlts` under a "Traveling?" affordance, and the note when `showNote`. A `photoRequired` slot shows a small camera badge. When `planSlots` is empty OR the flag is off, render nothing new — the existing freeform screen is unchanged.

- [ ] **Step 6: Manual verification**

Run `EXPO_PUBLIC_MEAL_PLANS_ENABLED=true npx expo start`. As an athlete with an assigned plan (set `planSlots` via the coach editor on the same seeded account, or a dev seed): the Prescribed Meals card shows at top, notes appear only for opened windows, logging a meal flips its chip to completed. Turn the flag off → screen identical to today.

- [ ] **Step 7: Commit**

```bash
git add src/core/planView.ts src/core/planView.test.ts src/core/index.ts src/screens/athlete/Nutrition.tsx
git commit -m "feat(plans): athlete Today's Prescribed Meals + planView model"
```

---

### Task 10: Smart substitutions (extend `analyze-meal`)

**Files:**
- Modify: `supabase/functions/analyze-meal/index.ts`
- Modify: the meal-capture client seam that calls it (`src/lib/capture/index.ts` — the caller of analyze-meal; confirm exact path when implementing)
- Modify: `src/screens/overlays/MealDetail.tsx` (surface the swap)

**Interfaces:**
- Request gains optional `slotTarget?: { kcal: number; protein: number }` (the active plan slot's macros for this meal).
- `MEAL_TOOL` gains an optional `substitution` object: `{ suggestion: string; items: string[]; deltaProtein: number; deltaKcal: number }`. The model fills it ONLY when a `slotTarget` was provided AND the plate misses it — a "closest compliant swap," never "bad meal."

- [ ] **Step 1: Extend the tool + prompt**

In `analyze-meal/index.ts`: add to `MEAL_TOOL.input_schema.properties`:

```ts
substitution: {
  type: 'object',
  description: 'ONLY when a slotTarget was given and this plate misses it: the closest compliant swap that hits the target. Supportive, never says the meal is bad. Omit entirely when the meal is on target or no slotTarget was given.',
  properties: {
    suggestion: { type: 'string', description: 'One coach sentence: what to eat instead/added. No em dashes.' },
    items: { type: 'array', items: { type: 'string' }, description: 'The swap foods, e.g. ["grilled chicken","fruit","chocolate milk"].' },
    deltaProtein: { type: 'integer', description: 'Grams of protein the swap adds vs the logged plate.' },
    deltaKcal: { type: 'integer', description: 'Calories the swap adds vs the logged plate.' },
  },
},
```

Add `slotTarget?: { kcal: number; protein: number }` to `AnalyzeReq`. In `userContent`, when `req.slotTarget` is present, append: ` This meal's plan target is ${req.slotTarget.protein}g protein and ${req.slotTarget.kcal} calories. If the plate misses that target, also fill substitution with the closest compliant swap; if it is on target, omit substitution.` Update `SYSTEM` with one line permitting the substitution field under the same honesty rules.

- [ ] **Step 2: Pass the target from the client**

In the meal-capture client seam, when the athlete has an active plan (`planSlots`), find the slot matching `mealType` and pass its `{ kcal, protein }` as `slotTarget` in the analyze-meal request body. Guard with `isMealPlansEnabled`.

- [ ] **Step 3: Surface it**

In `MealDetail.tsx`, when the result carries `substitution`, render a small "Closest compliant swap" card: the `suggestion` line, the `items`, and `+{deltaProtein}g · +{deltaKcal} cal`. Match the existing card styling.

- [ ] **Step 4: Manual verification**

Flag on, athlete with a plan: log a plate that misses a slot's protein target → the swap card appears with a supportive suggestion. Log an on-target plate → no swap card. Flag off or no plan → analyze-meal behaves exactly as today (no `slotTarget` sent, no `substitution` shown).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/analyze-meal/index.ts src/lib/capture/index.ts src/screens/overlays/MealDetail.tsx
git commit -m "feat(plans): smart substitutions — closest compliant swap vs the slot target"
```

---

### Task 11: Backend tables + RLS (migration `0027_meal_plans.sql`)

**Files:**
- Create: `supabase/migrations/0027_meal_plans.sql`

**Interfaces:**
- Tables `meal_plans`, `plan_assignments`, `meal_templates` (templates created now but unused until Wave 3). RLS team-scoped, mirroring the existing `meals`/`days` policies in `0001_schema.sql` and the coach-view policies from later migrations.

Note: this task can land any time after Task 1 (types) since the app persists `planSlots` locally until the backend read/write is wired in Wave 2. It is included here so the schema exists and is reviewed as part of Wave 1.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0027_meal_plans.sql`:

```sql
-- OnStandard — Meal Plans. A plan is authored by a coach/nutritionist and assigned to athletes.
-- plan_json holds the PlanSlot[] (same jsonb-blob discipline as days.meals). RLS: an author manages
-- their own plans; an assigned athlete can read a plan assigned to them.
create table meal_plans (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references profiles(id) on delete cascade,
  athlete_id   uuid references profiles(id) on delete cascade,   -- null = template/master
  name         text not null default 'Meal Plan',
  version      int  not null default 1,
  status       text not null default 'draft',                    -- draft | active | archived
  goal_json    jsonb not null default '{}'::jsonb,               -- protocol-builder inputs the AI received
  plan_json    jsonb not null default '[]'::jsonb,               -- PlanSlot[]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index meal_plans_author on meal_plans(author_id, updated_at desc);
create index meal_plans_athlete on meal_plans(athlete_id, updated_at desc);
create trigger meal_plans_updated before update on meal_plans
  for each row execute function set_updated_at();

create table plan_assignments (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references meal_plans(id) on delete cascade,
  athlete_id   uuid not null references profiles(id) on delete cascade,
  assigned_by  uuid not null references profiles(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  status       text not null default 'active',                   -- active | ended
  unique (plan_id, athlete_id)
);
create index plan_assignments_athlete on plan_assignments(athlete_id, assigned_at desc);

create table meal_templates (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references profiles(id) on delete cascade,
  name        text not null,
  meal_json   jsonb not null default '{}'::jsonb,                 -- a single PlanMeal
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index meal_templates_author on meal_templates(author_id);

alter table meal_plans enable row level security;
alter table plan_assignments enable row level security;
alter table meal_templates enable row level security;

-- Author manages their own plans; an athlete may read a plan currently assigned to them.
create policy meal_plans_author_all on meal_plans
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy meal_plans_athlete_read on meal_plans
  for select using (
    exists (select 1 from plan_assignments a where a.plan_id = meal_plans.id and a.athlete_id = auth.uid() and a.status = 'active')
  );

-- Assigner manages assignments they created; the assigned athlete may read theirs.
create policy plan_assignments_assigner_all on plan_assignments
  for all using (assigned_by = auth.uid()) with check (assigned_by = auth.uid());
create policy plan_assignments_athlete_read on plan_assignments
  for select using (athlete_id = auth.uid());

create policy meal_templates_author_all on meal_templates
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());
```

- [ ] **Step 2: Verify it applies against a dev project**

Run: `supabase db reset` (dev/local) or apply on a scratch project.
Expected: migration runs clean; `\d meal_plans` shows the table + RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0027_meal_plans.sql
git commit -m "feat(plans): 0027 meal_plans + plan_assignments + meal_templates (RLS team-scoped)"
```

---

## Self-Review

**Spec coverage:**
- Layered pinned/open slot → Task 1 (`PlanSlot.mode`). ✓
- AI drafts, human approves → Task 6 (edge fn drafts) + Task 8 (coach reviews/edits, no auto-assign). ✓
- Approach C, single score, freeform floor → Task 9 (additive card, flag+empty guard), Task 4 comment (display-only). ✓
- Prefill from onboarding → Task 8 builds protocol from state; Task 6 accepts `protocol`. ✓ (full prefill wiring is trivial state reads in Task 8.)
- planCompliance pure fn → Task 4. ✓
- Restaurant equivalents → Task 6 (`restaurantAlts` in tool) + Task 8/9 (surfaced). ✓
- Smart substitutions → Task 10. ✓
- Feature flag → Task 5. ✓
- jsonb `plan_json`, `plan_assignments` → Task 11. ✓
- Deferred (bulk assign, templates UI, grocery, calendar, versions) → not in Wave 1 (templates table stubbed only). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. UI tasks (8, 9 step 5, 10 step 3) describe exact store calls, prop names, and guards rather than pasting full JSX, because the repo has no RN render tests — those steps are manually verified, which is the honest boundary of this codebase's test setup. All pure logic is TDD with full code.

**Type consistency:** `PlanSlot`/`PlanMeal`/`CoachPlan.slots` defined in Task 1 and used identically in Tasks 2–10. `planCompliance` signature `(plan, logged, now?)` matches its callers in Tasks 4 and 9. `generatePlan` args match the seam consumed in Task 8. `parsePlanSlots` used in Tasks 5, 7. `buildPlanDraft(plan, goal)` consistent in Tasks 3, 5, 7. Store actions named in Task 5 are the ones called in Tasks 8–9.

**One deliberate spec deviation:** the spec said "zod-validated"; this codebase has no zod and validates with hand-written guards (`core/validate.ts`, `macroGrounding.ts`). Task 2 follows that house style. Flagged in Global Constraints.
