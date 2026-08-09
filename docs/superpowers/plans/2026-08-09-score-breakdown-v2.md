# Score Breakdown v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-component daily score with two pillars — Nutrition `.76`, Recovery `.24` (`.12` for submitting tonight's check-in + `.12` for the answers) — removing Daily Commitment and the Weekly Check-In from scoring, with identical numbers on every role's screen.

**Architecture:** `plan-style.js` becomes the single owner of the weights inside the proto; `day.js`, `state.js` and the breakdown model derive from it. The four copies that physically cannot import it (`requirements.js` is import-free by design, `src/core` is a separate runtime, `web/admin` is a separate bundle, and migration `0041` is SQL) are each pinned by a test that fails on drift. Two one-line deletions in `day.js` — the `ciLast` branch in `checkinReal()` and the weekly carry in `recoveryParts()` — do the actual behavioural work.

**Tech Stack:** Vanilla ES modules (proto, no build step) · TypeScript + Jest (`src/core`) · `node --test` (proto + admin) · Postgres/plpgsql (Supabase migrations)

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-09-score-breakdown-v2-design.md`. Every decision in it is founder-approved; do not relitigate.
- **Weights (final, exact):** `athlete { nutrition: 0.76, recovery: 0.12, checkin: 0.12, commitment: 0 }` · `general { nutrition: 0.78, recovery: 0.10, checkin: 0.12, commitment: 0 }` · `gain { nutrition: 0.76, recovery: 0.12, checkin: 0.12, commitment: 0 }`
- **Component key meanings change:** `checkin` now means "a check-in was submitted **today**" (was: any check-in in the trailing 7 days). `recovery` now means "the quality of tonight's answers" with **no weekly carry**.
- **The athlete never sees two Recovery categories.** The engine's `checkin` + `recovery` slots render as ONE card labelled `Recovery`, worth `24`, with two rows inside it.
- **Nothing deploys until every task is done.** Tasks 2, 3 and 4 must land in the same release — a client on the new weights against the old SQL ceiling silently writes 55 where it computed 76. This is data corruption with no visible error.
- **Cutover date constant:** `2026-08-16`. It appears in exactly two places (the SQL trigger in Task 4, the Progress label in Task 6). To change the release date, change those two.
- **`WEIGHT_CAPS` must rise to `{ nutrition: 0.78, recovery: 0.12, checkin: 0.12, commitment: 0 }`.** The old cap of `0.55` would reject every new mix.
- **Do not touch Verified Commitments.** `commitments.js` `WEIGHTS = { ack: 10, arrival: 30, completion: 60 }` is a different feature with its own Accountability score. Only `dailyCommitment` is in scope.
- **Never print a hardcoded percentage.** Use `liveWeightPct(comp)` (`state.js:185`) or `weightPct(comp)` (`requirements.js:36`). Task 10 adds a lint that fails the build on a literal.
- **Verification gate:** `npm run verify` must pass before the final commit of every task that touches `src/` or `proto/`.
- **Commit style:** conventional commits, and `git add <explicit paths>` — never `-A`. Another agent commits to this tree concurrently; re-check `git branch --show-current` before each commit.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `proto/redesign-2026-07/js/plan-style.js` | **Single owner** of `PROFILE_WEIGHTS` + `WEIGHT_CAPS` for the proto |
| `proto/redesign-2026-07/js/day.js` | Engine. Re-exports weights; `checkinReal()` and `recoveryParts()` lose their carry branches |
| `proto/redesign-2026-07/js/state.js` | Derives `WEIGHTS`; owns `liveWeightPct()` display path |
| `proto/redesign-2026-07/js/requirements.js` | Import-free by design; keeps a literal fallback **pinned by a test** |
| `proto/redesign-2026-07/js/breakdown-model.js` | Returns 2 category cards; `reachPlan` drops the commitment row |
| `proto/redesign-2026-07/js/screens/checkin.js` | **Deleted** |
| `src/core/scoringProfiles.ts` | RN weights, pinned to proto by `scoreParity.test.ts` |
| `src/core/scoring.ts` | `SCORE_WEIGHTS` display array derived from `PROFILE_WEIGHTS` |
| `src/core/scoreIntegrity.ts` | Evidence ceiling; `commitmentPresent` stops granting ceiling |
| `supabase/migrations/0193_score_v2_evidence_ceiling.sql` | Replaces 0041's trigger body, date-guarded |
| `web/admin/sections/scoring.js` | Command Center; pinned to proto by a new admin test |

---

## Task 1: One source of truth for the proto weights

Pure refactor. **The weights keep their OLD values in this task** — every existing test must stay green, which is the proof that the refactor changed no behaviour. Doing this first means Task 2 edits exactly one literal.

**Files:**
- Modify: `proto/redesign-2026-07/js/plan-style.js:67-102`
- Modify: `src/core/planStyle.ts:73-101` — **must move in lockstep**, see below
- Modify: `proto/redesign-2026-07/js/day.js:18-22`
- Modify: `proto/redesign-2026-07/js/state.js:188-192`
- Test: `proto/redesign-2026-07/js/weight-sources.test.mjs` (create)

> **`src/core/planStyle.ts` is a full TS mirror of `plan-style.js`** — its own `WEIGHT_CAPS`,
> its own nine-row `STYLE_WEIGHTS`, its own `weightsFor` and `weightsWithinCaps`.
> `src/core/planStyleParity.test.ts` imports BOTH files and asserts the constant tables are
> identical, so the two must change in the SAME commit or `npm test` fails. Every edit this task
> makes to `plan-style.js` must be mirrored into `planStyle.ts` with TS types preserved
> (`STYLE_WEIGHTS: Record<PlanStyle, Record<ScoringProfile, StyleWeights>>` becomes
> `PROFILE_WEIGHTS: Record<ScoringProfile, StyleWeights>`).

**Interfaces:**
- Consumes: nothing.
- Produces: `plan-style.js` exports `PROFILE_WEIGHTS` (object keyed `athlete`/`general`/`gain`, each `{ nutrition, recovery, commitment, checkin }`) and keeps `weightsFor(style, profile) -> weights`. `day.js` re-exports `PROFILE_WEIGHTS`. `state.js` exports `WEIGHTS` derived from it.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/weight-sources.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_WEIGHTS, WEIGHT_CAPS, weightsFor } from './plan-style.js';
import { PROFILE_WEIGHTS as DAY_WEIGHTS } from './day.js';
import { FALLBACK_WEIGHTS } from './requirements.js';

/* There is ONE owner of the weights: plan-style.js. Every other copy in the proto must be
   the same object or provably equal to it. requirements.js is import-free by design, so its
   literal is pinned here instead of imported away. */

test('day.js re-exports plan-style.js weights, it does not redeclare them', () => {
  assert.equal(DAY_WEIGHTS, PROFILE_WEIGHTS, 'day.js must re-export the same object identity');
});

test('requirements.js FALLBACK_WEIGHTS equals the athlete row', () => {
  assert.deepEqual(FALLBACK_WEIGHTS, PROFILE_WEIGHTS.athlete);
});

test('every profile sums to 1 and sits within the caps', () => {
  for (const [name, w] of Object.entries(PROFILE_WEIGHTS)) {
    const sum = w.nutrition + w.recovery + w.commitment + w.checkin;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} sums to ${sum}, not 1`);
    for (const k of ['nutrition', 'recovery', 'commitment', 'checkin']) {
      assert.ok(w[k] <= WEIGHT_CAPS[k] + 1e-9, `${name}.${k} = ${w[k]} exceeds cap ${WEIGHT_CAPS[k]}`);
    }
  }
});

test('weightsFor ignores style and resolves unknown profiles to athlete', () => {
  assert.deepEqual(weightsFor('structured', 'athlete'), PROFILE_WEIGHTS.athlete);
  assert.deepEqual(weightsFor('guided', 'athlete'), PROFILE_WEIGHTS.athlete);
  assert.deepEqual(weightsFor('intuitive', 'gain'), PROFILE_WEIGHTS.gain);
  assert.deepEqual(weightsFor('nonsense', 'nonsense'), PROFILE_WEIGHTS.athlete);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:proto`
Expected: FAIL — `requirements.js` does not export `FALLBACK_WEIGHTS`, and `day.js` declares its own object so the identity assertion fails.

- [ ] **Step 3: Make `plan-style.js` the owner**

Replace `plan-style.js:66-102` (from the `WEIGHT_CAPS` comment through the end of `weightsFor`) with:

```javascript
/** Per-component ceiling, mirroring the migration-0041 successor's slots. NOTHING may exceed these. */
export const WEIGHT_CAPS = { nutrition: 0.55, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

/**
 * Headline mix per goal profile. THE single source of truth for the proto — day.js and state.js
 * re-export this; nothing else may declare a weight literal.
 *
 * Plan style no longer re-weights the score. It shapes HOW nutrition is computed (knobsFor), which
 * is where it earns its keep; the three style rows were already byte-identical for the athlete
 * profile and varied by 2-3 points elsewhere, which bought nothing.
 */
export const PROFILE_WEIGHTS = {
  athlete: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 },
  general: { nutrition: 0.55, recovery: 0.2, commitment: 0.15, checkin: 0.1 },
  gain: { nutrition: 0.55, recovery: 0.25, commitment: 0.1, checkin: 0.1 },
};

/** The headline mix for a (style, profile). `style` is accepted and ignored — the signature is
 *  kept so no call site changes. An unknown profile falls back to athlete, so a bad value can
 *  never produce a weightless or over-weighted day. */
export function weightsFor(style, profile) {
  const p = profile === 'general' || profile === 'gain' ? profile : 'athlete';
  return PROFILE_WEIGHTS[p];
}

/** True when every component is within its cap AND the mix sums to 1 (within float slop).
 *  Exported so the caps test can sweep every preset and every override permutation. */
export function weightsWithinCaps(w) {
  if (!w) return false;
  const keys = ['nutrition', 'recovery', 'commitment', 'checkin'];
  let sum = 0;
  for (const k of keys) {
    const v = w[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return false;
    if (v > WEIGHT_CAPS[k] + 1e-9) return false;
    sum += v;
  }
  return Math.abs(sum - 1) < 1e-9;
}
```

Delete the now-unused `STYLE_WEIGHTS` export.

Now mirror the SAME change into `src/core/planStyle.ts:73-101`, keeping the TS types. Values stay
old; only the shape collapses:

```typescript
/** Per-component ceiling. NOTHING may exceed these. Mirrors proto plan-style.js WEIGHT_CAPS. */
export const WEIGHT_CAPS: StyleWeights = { nutrition: 0.55, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

/** Headline mix per goal profile. Plan style no longer re-weights the score — it shapes HOW
 *  nutrition is computed (knobsFor). MUST equal proto plan-style.js PROFILE_WEIGHTS;
 *  planStyleParity.test.ts asserts the two constant tables are identical. */
export const PROFILE_WEIGHTS: Record<ScoringProfile, StyleWeights> = {
  athlete: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 },
  general: { nutrition: 0.55, recovery: 0.2, commitment: 0.15, checkin: 0.1 },
  gain: { nutrition: 0.55, recovery: 0.25, commitment: 0.1, checkin: 0.1 },
};

/** The headline mix for a (style, profile). `style` is accepted and ignored — the signature is
 *  kept so no call site changes. An unknown profile falls back to athlete. */
export function weightsFor(style: PlanStyle | string | null | undefined, profile: ScoringProfile | string | null | undefined): StyleWeights {
  const p = profile === 'general' || profile === 'gain' ? profile : 'athlete';
  return PROFILE_WEIGHTS[p];
}
```

Leave `weightsWithinCaps` in `planStyle.ts` unchanged. Then grep for stragglers:

```bash
grep -rn "STYLE_WEIGHTS" proto/ src/ web/
```

Update each hit to `PROFILE_WEIGHTS` (drop the style index level). `planStyleParity.test.ts:16`
("constant tables are identical") and `planStyleCaps.test.ts:40,58-59` both sweep these — update
their iteration to the two-level shape, never weaken the assertion.

- [ ] **Step 4: Make `day.js` re-export instead of redeclare**

In `day.js`, replace lines 18-22 with:

```javascript
export { PROFILE_WEIGHTS } from './plan-style.js';
```

`day.js` already imports `weightsFor` from `./plan-style.js` on line 10 — leave that import alone.

- [ ] **Step 5: Derive `state.js`'s copy**

Replace `state.js:188-192` with:

```javascript
/* The athlete-profile mix, kept ONLY as the documented grandfathering baseline and for tests
   that pin it. Derived from the ONE owner (plan-style.js via day.js) so it can never drift.
   Nothing may print a percentage from here; use liveWeightPct(). */
export const WEIGHTS = PROFILE_WEIGHTS.athlete;
```

Add `PROFILE_WEIGHTS` to the existing `day.js` import at the top of `state.js`.

- [ ] **Step 6: Export the requirements fallback so a test can pin it**

In `requirements.js`, change line 29 to export the constant. Keep it a literal — this file is import-free by design:

```javascript
/* Import-free by design (see the exec.test catalog seam), so this is the ONE legal copy of the
   weights outside plan-style.js. weight-sources.test.mjs pins it to the engine's athlete row and
   fails the build if either side moves. */
export const FALLBACK_WEIGHTS = { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 };
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:proto`
Expected: PASS, including all four new assertions.

Run: `npm test`
Expected: PASS — `scoreParity.test.ts` still green, proving the refactor changed no number.

- [ ] **Step 8: Commit**

```bash
git add proto/redesign-2026-07/js/plan-style.js proto/redesign-2026-07/js/day.js proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/requirements.js proto/redesign-2026-07/js/weight-sources.test.mjs src/core/planStyle.ts src/core/planStyleParity.test.ts src/core/planStyleCaps.test.ts
git commit -m "refactor(proto): one owner for the score weights, drift pinned by test

plan-style.js now owns PROFILE_WEIGHTS; day.js and state.js re-export it
and STYLE_WEIGHTS is gone (its three rows were identical for athlete and
varied by 2-3 points elsewhere). requirements.js stays import-free by
design, so its literal is pinned to the engine by weight-sources.test.mjs
instead of imported away.

Values are UNCHANGED. scoreParity.test.ts staying green is the proof."
```

---

## Task 2: The new weights and the two engine deletions

**Files:**
- Modify: `proto/redesign-2026-07/js/plan-style.js` (`PROFILE_WEIGHTS`, `WEIGHT_CAPS`)
- Modify: `src/core/planStyle.ts` (`PROFILE_WEIGHTS`, `WEIGHT_CAPS`) — **same commit, see below**
- Modify: `proto/redesign-2026-07/js/day.js:317-337` (`recoveryParts`, `checkinReal`), `:370-376` (`evidenceCeiling`)
- Modify: `proto/redesign-2026-07/js/requirements.js:29`
- Test: `proto/redesign-2026-07/js/score-v2.test.mjs` (create)

> **`src/core/planStyle.ts` mirrors `plan-style.js` and `planStyleParity.test.ts` asserts the two
> constant tables are identical.** Apply the new `WEIGHT_CAPS` and `PROFILE_WEIGHTS` values to BOTH
> files in this task's commit, or `npm test` fails. The TS file keeps its type annotations; only
> the numbers change.

**Interfaces:**
- Consumes: `PROFILE_WEIGHTS` from Task 1.
- Produces: `checkinReal(day) -> boolean` (true only when `day.ciSubmitted`). `recoveryParts(day) -> { score, isReal }` with no carry branch. `computeComponents` and `scoreFor` keep their signatures.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/score-v2.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFor, computeComponents, checkinReal, PROFILE_WEIGHTS } from './day.js';

/* A day fixture. Protein target 180, four classic slots, all on time. */
function day(over = {}) {
  return {
    date: '2026-08-20',
    meals: {}, mealLoggedAt: {}, slotMacros: {}, quickAdded: [false, false, false],
    proteinTarget: 180, calTarget: 3200, scoringProfile: 'athlete',
    dailyCommitment: null, ci: {}, ciConfig: {}, ciSubmitted: false, ciLast: null,
    ...over,
  };
}
/* All four meals on time with `p` total grams of protein spread evenly. */
function fed(p) {
  const keys = ['breakfast', 'lunch', 'snack', 'dinner'];
  const meals = {}, at = { breakfast: 500, lunch: 800, snack: 1000, dinner: 1200 }, sm = {};
  for (const k of keys) { meals[k] = true; sm[k] = { protein: p / 4 }; }
  return { meals, mealLoggedAt: at, slotMacros: sm };
}
const GOOD_CI = {
  ciSubmitted: true,
  ciConfig: { energy: 1, recovery: 1, sleep: 1, confidence: 1, soreness: 1, motivation: 1 },
  ci: { energy: 9, recovery: 9, sleep: 8, confidence: 9, soreness: 2, motivation: 9 },
};

test('weights are the v2 mix and commitment carries none of it', () => {
  assert.deepEqual(PROFILE_WEIGHTS.athlete, { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
  assert.deepEqual(PROFILE_WEIGHTS.general, { nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 });
  assert.deepEqual(PROFILE_WEIGHTS.gain, { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
});

test('a day with nothing logged and no check-in scores exactly 0', () => {
  assert.equal(scoreFor(day()), 0);
});

test('the daily commitment moves the score by nothing at all', () => {
  const base = day({ ...fed(180), ...GOOD_CI });
  const yes = scoreFor({ ...base, dailyCommitment: 'yes' });
  const no = scoreFor({ ...base, dailyCommitment: 'no' });
  const unanswered = scoreFor({ ...base, dailyCommitment: null });
  assert.equal(yes, no, 'an honest "no" must cost nothing');
  assert.equal(yes, unanswered);
});

test('a check-in from earlier in the week no longer counts today', () => {
  const carried = day({ ...fed(180), ciLast: { date: '2026-08-18', recovery: 90 } });
  assert.equal(checkinReal(carried), false, 'only tonight counts');
  const c = computeComponents(carried);
  assert.equal(c.checkin, 0);
  assert.equal(c.recoveryContribution, 0, 'recovery must not carry either');
});

test('perfect food with no check-in caps at 76, not 100', () => {
  assert.equal(scoreFor(day({ ...fed(180) })), 76);
});

test('effort outranks attendance: full food beats half food plus a check-in', () => {
  const allFoodNoCheckin = scoreFor(day({ ...fed(162) }));            // 90% protein, 4 meals
  const halfFoodGoodCheckin = scoreFor(day({
    meals: { breakfast: true, lunch: true },
    mealLoggedAt: { breakfast: 500, lunch: 800 },
    slotMacros: { breakfast: { protein: 45 }, lunch: { protein: 45 } },
    ...GOOD_CI,
  }));
  assert.ok(allFoodNoCheckin > halfFoodGoodCheckin,
    `${allFoodNoCheckin} must beat ${halfFoodGoodCheckin} — the athlete who ate on standard did more`);
});

test('submitting the check-in is worth 12 guaranteed, before any answer quality', () => {
  const withoutCi = scoreFor(day({ ...fed(180) }));
  const withCi = scoreFor(day({ ...fed(180), ...GOOD_CI }));
  assert.ok(withCi - withoutCi >= 12, `check-in added only ${withCi - withoutCi}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:proto -- --test-name-pattern="v2 mix"`
Expected: FAIL — weights are still `0.5 / 0.25 / 0.15 / 0.1`.

- [ ] **Step 3: Set the new weights and raise the caps**

In `plan-style.js`, replace the `WEIGHT_CAPS` and `PROFILE_WEIGHTS` bodies:

```javascript
/** Per-component ceiling, mirroring the 0193 evidence-ceiling slots. NOTHING may exceed these. */
export const WEIGHT_CAPS = { nutrition: 0.78, recovery: 0.12, commitment: 0, checkin: 0.12 };

/**
 * Headline mix per goal profile — v2. Two pillars the athlete sees, three slots the engine uses:
 *   nutrition — plates logged, protein to target, on time
 *   checkin   — a check-in was submitted TONIGHT (binary, guaranteed)
 *   recovery  — how those answers scored
 * `commitment` is 0: the end-of-day reflection is still captured and still shown to the coach, it
 * just no longer scores, so an honest "no" costs nothing and the coach's data gets truthful.
 */
export const PROFILE_WEIGHTS = {
  athlete: { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 },
  general: { nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 },
  gain: { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 },
};
```

Mirror the same three rows into `requirements.js`'s `FALLBACK_WEIGHTS` (athlete row only):

```javascript
export const FALLBACK_WEIGHTS = { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 };
```

- [ ] **Step 4: Delete the two carry branches in `day.js`**

Replace `recoveryParts` (currently `day.js:317-334`) with:

```javascript
/* v2: no weekly carry. Recovery reflects TONIGHT's answers or it contributes nothing — the score
   is what you did today. The old `ciLast` branch handed Monday's number back all week, which is
   how a day with zero logging still banked ~21 points. */
function recoveryParts(day) {
  if (!day.ciSubmitted) return { score: 86, isReal: false }; // display fallback; contributes 0
  let sum = 0, count = 0;
  for (const key of CI_KEYS) {
    if (!(day.ciConfig && day.ciConfig[key])) continue;
    const raw = day.ci ? day.ci[key] : undefined;
    if (typeof raw !== 'number' || !isFinite(raw)) continue;
    sum += CI_INVERSE[key] ? 10 - raw : raw; // soreness / cravings have inverse polarity
    count++;
  }
  if (count > 0) return { score: clamp(Math.round((sum / (count * 10)) * 100), 0, 100), isReal: true };
  return { score: 86, isReal: false };
}
```

Replace `checkinReal` (currently `day.js:337`) with:

```javascript
/* v2: "checked in TONIGHT", not "sometime this week". The trailing-7-day branch made this a
   seven-day annuity — one check-in on Monday paid every day through Sunday. */
export function checkinReal(day) { return !!day.ciSubmitted; }
```

`withinTrailingWeek` is still used by `dayFromHistoryRow`; leave it defined.

- [ ] **Step 5: Update the client-side evidence ceiling**

Replace `evidenceCeiling` (currently `day.js:370-376`) with:

```javascript
/** Mirror of the 0193 server ceiling: the most the evidence on a row can justify. Nutrition
 *  evidence unlocks 78 (the max across profiles); a real check-in unlocks recovery 12 + check-in
 *  12. A commitment answer unlocks nothing — it no longer scores. */
export function evidenceCeiling(day) {
  const hasNutrition = MEAL_KEYS.some((k) => day.meals && day.meals[k]) ||
    (day.slotMacros && Object.keys(day.slotMacros).length > 0);
  return (hasNutrition ? 78 : 0) + (checkinReal(day) ? 24 : 0);
}
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npm run test:proto`
Expected: PASS for `score-v2.test.mjs` and `weight-sources.test.mjs`.

Other proto suites (`plan-style-awareness.test.mjs`, `requirements.test.mjs`, `tour-plan.test.mjs`, `operator-book.test.mjs`) will fail where they assert old weights. For each failure, confirm the assertion is about a weight value, then update the expected number. **Do not weaken an assertion to make it pass** — if a test asserts behaviour rather than a number, the behaviour change is a bug in this task.

Run: `npm run test:proto`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/plan-style.js src/core/planStyle.ts proto/redesign-2026-07/js/day.js proto/redesign-2026-07/js/requirements.js proto/redesign-2026-07/js/score-v2.test.mjs
git commit -m "feat(proto)!: score v2 — two pillars, nothing carries, nothing self-graded

Nutrition .76, checked-in-tonight .12, answers .12, commitment 0.

Two deletions do the work: checkinReal() drops its ciLast branch, so the
check-in means TONIGHT rather than sometime this week; recoveryParts()
drops the weekly carry that handed Monday's number back all week. A day
with nothing logged now scores 0 instead of banking ~46.

Weights are .76/.12/.12 and not .68/.20/.12 because that mix tied a
perfect food day with no check-in against half the food plus eight
seconds of sliders. Effort has to outrank attendance."
```

---

## Task 3: RN core parity

**Files:**
- Modify: `src/core/scoringProfiles.ts:23-36`
- Modify: `src/core/scoring.ts:146-169`
- Test: `src/core/scoringProfiles.test.ts`, `src/core/scoreParity.test.ts` (existing, must stay green)

**Interfaces:**
- Consumes: the exact weight values from Task 2.
- Produces: `PROFILE_WEIGHTS` (same shape as before, new values), `SCORE_WEIGHTS: ScoreWeight[]` now derived rather than literal.

- [ ] **Step 1: Write the failing test**

Append to `src/core/scoringProfiles.test.ts`:

```typescript
import { PROFILE_WEIGHTS } from './scoringProfiles';
import { SCORE_WEIGHTS } from './scoring';

describe('score v2 weights', () => {
  it('matches the proto engine exactly', () => {
    expect(PROFILE_WEIGHTS.athlete).toEqual({ nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
    expect(PROFILE_WEIGHTS.general).toEqual({ nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 });
    expect(PROFILE_WEIGHTS.gain).toEqual({ nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 });
  });

  it('every profile sums to 1', () => {
    for (const [name, w] of Object.entries(PROFILE_WEIGHTS)) {
      const sum = w.nutrition + w.recovery + w.commitment + w.checkin;
      expect(`${name}:${sum.toFixed(6)}`).toBe(`${name}:${(1).toFixed(6)}`);
    }
  });

  it('SCORE_WEIGHTS is derived from PROFILE_WEIGHTS, never a second literal', () => {
    const byKey = Object.fromEntries(SCORE_WEIGHTS.map((s) => [s.key, s.pct]));
    expect(byKey.nutrition).toBe(Math.round(PROFILE_WEIGHTS.athlete.nutrition * 100));
    expect(byKey.recovery).toBe(Math.round(PROFILE_WEIGHTS.athlete.recovery * 100));
    expect(byKey.checkin).toBe(Math.round(PROFILE_WEIGHTS.athlete.checkin * 100));
  });

  it('drops zero-weight components from the display breakdown', () => {
    expect(SCORE_WEIGHTS.find((s) => s.key === 'commitment')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/core/scoringProfiles.test.ts`
Expected: FAIL — values are still the v1 mix and `commitment` is still in `SCORE_WEIGHTS`.

- [ ] **Step 3: Update `scoringProfiles.ts`**

Replace lines 23-36:

```typescript
export interface ProfileWeights {
  nutrition: number;
  /** Quality of TONIGHT's check-in answers. No weekly carry (v2). */
  recovery: number;
  /** v2: 0. The end-of-day reflection is captured and shown to the coach, but no longer scores. */
  commitment: number;
  /** v2: a check-in was submitted TONIGHT — binary, guaranteed. */
  checkin: number;
}

/** Headline mix per profile — score v2. MUST equal proto plan-style.js PROFILE_WEIGHTS;
 *  scoreParity.test.ts proves the two engines agree. */
export const PROFILE_WEIGHTS: Record<ScoringProfile, ProfileWeights> = {
  athlete: { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 },
  general: { nutrition: 0.78, recovery: 0.10, commitment: 0, checkin: 0.12 },
  gain: { nutrition: 0.76, recovery: 0.12, commitment: 0, checkin: 0.12 },
};
```

- [ ] **Step 4: Derive `SCORE_WEIGHTS` in `scoring.ts`**

Replace lines 155-169:

```typescript
/**
 * Plain-language breakdown of the score, DERIVED from PROFILE_WEIGHTS so it can never drift from
 * the formula it describes. Zero-weight components are omitted — the athlete must not be shown a
 * category worth nothing. Descriptions are honest about which inputs are self-reported.
 */
const SCORE_WEIGHT_COPY: Record<ScoreWeight['key'], { label: string; desc: string }> = {
  nutrition: { label: 'Nutrition', desc: 'Protein and the meals you log each day' },
  recovery: { label: 'Recovery', desc: 'How you answered tonight’s check-in, so this part is self-reported' },
  checkin: { label: 'Checked in', desc: 'Submitting tonight’s check-in at all' },
  commitment: { label: 'Commitment', desc: 'No longer part of your score' },
};

export const SCORE_WEIGHTS: ScoreWeight[] = (['nutrition', 'recovery', 'checkin', 'commitment'] as const)
  .filter((k) => PROFILE_WEIGHTS.athlete[k] > 0)
  .map((k) => ({ key: k, pct: Math.round(PROFILE_WEIGHTS.athlete[k] * 100), ...SCORE_WEIGHT_COPY[k] }));
```

Also fix the stale formula comment on `scoring.ts:158` to `0.76*nutrition + 0.12*recovery + 0.12*checkin`.

- [ ] **Step 5: Mirror the two engine deletions**

In `scoring.ts` around line 346, `ciCarryValid` must no longer grant the check-in or recovery slots. Find the `ciCarryValid` definition and the `checkinScore` line, and change:

```typescript
  // v2: "checked in TONIGHT". The trailing-week carry is gone — see the score v2 spec.
  const checkinScore = s.ciSubmitted ? 100 : 0;
```

Then find where `recoveryContribution` is gated and ensure it is `s.ciSubmitted ? recoveryScore : 0` with no `ciCarryValid` branch. Remove `ciCarryValid` entirely if it has no remaining callers:

```bash
grep -rn "ciCarryValid" src/
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npx jest src/core/scoringProfiles.test.ts src/core/scoreParity.test.ts`
Expected: PASS. **`scoreParity.test.ts` passing is the load-bearing proof that proto and RN agree.**

Run: `npm test`
Expected: PASS. Update `scoring.test.ts`, `planStyleCaps.test.ts`, `planStyleParity.test.ts`, `planStyleEngine.test.ts`, `standardDay.test.ts`, `protoProjectionDecay.test.ts`, `protoStreakGrace.test.ts`, `protoCoachScoreThreading.test.ts`, `protoGalleryScoring.test.ts` and `insights.test.ts` where they assert v1 numbers. Same rule as Task 2: change expected numbers, never weaken an assertion.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/scoringProfiles.ts src/core/scoring.ts src/core/scoringProfiles.test.ts
git commit -m "feat(core)!: score v2 weights in the RN engine, parity held

Mirrors the proto: nutrition .76, checkin .12, recovery .12, commitment 0,
and the same two deletions — checkin means tonight, recovery does not carry.

SCORE_WEIGHTS is now DERIVED from PROFILE_WEIGHTS and drops zero-weight
components, so the 'what's in this score' panel can never describe a
formula the engine isn't using. It was an eighth hardcoded copy, and its
recovery description ('your own weekly check-in answers') was already
wrong before this change.

scoreParity.test.ts green is the proof both engines agree."
```

---

## Task 4: The server evidence ceiling, date-guarded

The riskiest change. A client on v2 weights against 0041's hardcoded `55/35/15` silently writes 55 where it computed 76.

**Files:**
- Modify: `src/core/scoreIntegrity.ts:33-57`
- Create: `supabase/migrations/0193_score_v2_evidence_ceiling.sql`
- Test: `src/core/scoreIntegrity.test.ts`

**Interfaces:**
- Consumes: `PROFILE_WEIGHTS` from Task 3.
- Produces: `evidenceScoreCeiling(ev: ScoreEvidence, rowDate: string) -> number` — **note the new second parameter**. `SCORING_V2_CUTOVER = '2026-08-16'`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/scoreIntegrity.test.ts`:

```typescript
import { evidenceScoreCeiling, SCORING_V2_CUTOVER } from './scoreIntegrity';

describe('score v2 evidence ceiling', () => {
  const nothing = { nutritionPossible: false, checkinPossible: false, commitmentPresent: false };

  it('after cutover: nutrition evidence unlocks 78, a check-in unlocks 24', () => {
    expect(evidenceScoreCeiling({ ...nothing, nutritionPossible: true }, '2026-08-20')).toBe(78);
    expect(evidenceScoreCeiling({ ...nothing, checkinPossible: true }, '2026-08-20')).toBe(24);
    expect(evidenceScoreCeiling({ nutritionPossible: true, checkinPossible: true, commitmentPresent: false }, '2026-08-20')).toBe(100);
  });

  it('after cutover: a commitment answer alone justifies nothing', () => {
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, '2026-08-20')).toBe(0);
  });

  it('BEFORE cutover the old ceiling still applies, so frozen history is never re-clamped', () => {
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, '2026-08-01')).toBe(15);
    expect(evidenceScoreCeiling({ ...nothing, nutritionPossible: true }, '2026-08-01')).toBe(55);
    expect(evidenceScoreCeiling({ ...nothing, checkinPossible: true }, '2026-08-01')).toBe(35);
  });

  it('the cutover date itself is scored under v2', () => {
    expect(evidenceScoreCeiling({ ...nothing, commitmentPresent: true }, SCORING_V2_CUTOVER)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/core/scoreIntegrity.test.ts`
Expected: FAIL — `evidenceScoreCeiling` takes one argument and `SCORING_V2_CUTOVER` does not exist.

- [ ] **Step 3: Update `scoreIntegrity.ts`**

Replace lines 21-57:

```typescript
/**
 * The date score v2 takes effect. Rows dated BEFORE this keep the v1 ceiling: they were earned
 * under a formula with a real 15-point commitment slot, and re-clamping them under v2 would
 * rewrite history the product promised to freeze. Must equal the constant in migration 0193.
 */
export const SCORING_V2_CUTOVER = '2026-08-16';

/** v1 ceiling slots, frozen. Do not derive these from PROFILE_WEIGHTS — they describe a formula
 *  that no longer exists, and must not move when the live weights do. */
const V1_CEILING = { nutrition: 55, checkinAndRecovery: 35, commitment: 15 } as const;

/**
 * The MAXIMUM weight each subscore carries across ALL scoring profiles. Derived from
 * PROFILE_WEIGHTS so it can never silently drift from the engine.
 */
export const MAX_SUBSCORE_WEIGHT = ((): { nutrition: number; recovery: number; commitment: number; checkin: number } => {
  const ws = Object.values(PROFILE_WEIGHTS);
  const maxOf = (k: 'nutrition' | 'recovery' | 'commitment' | 'checkin') => Math.max(...ws.map((w) => w[k]));
  return { nutrition: maxOf('nutrition'), recovery: maxOf('recovery'), commitment: maxOf('commitment'), checkin: maxOf('checkin') };
})();

/** The evidence gates a `days` row carries, each unlocking one weighted slot of the ceiling. */
export interface ScoreEvidence {
  /** A meal slot was logged, OR an active trust pass credits nutrition camera-free. */
  nutritionPossible: boolean;
  /** A real check-in backs the row. v2: submitted that day. v1: submitted or carried <= 6 days. */
  checkinPossible: boolean;
  /** A plan-commitment answer is on the row. v2: unlocks nothing. */
  commitmentPresent: boolean;
}

/**
 * The maximum Development Score the evidence can justify (integer 0..100), for a row on
 * `rowDate` (ISO `YYYY-MM-DD`). A real score is always <= this for the same evidence, so it is
 * safe to clamp a written score down to it.
 */
export function evidenceScoreCeiling(ev: ScoreEvidence, rowDate: string): number {
  if (rowDate < SCORING_V2_CUTOVER) {
    return Math.min(100,
      (ev.nutritionPossible ? V1_CEILING.nutrition : 0) +
      (ev.checkinPossible ? V1_CEILING.checkinAndRecovery : 0) +
      (ev.commitmentPresent ? V1_CEILING.commitment : 0));
  }
  const w = MAX_SUBSCORE_WEIGHT;
  return Math.min(100, Math.round(
    (ev.nutritionPossible ? w.nutrition : 0) * 100 +
    (ev.checkinPossible ? w.recovery + w.checkin : 0) * 100 +
    (ev.commitmentPresent ? w.commitment : 0) * 100));
}

/** Clamp a (possibly client-reported) score down to what the evidence supports. Never raises. */
export function clampScoreToEvidence(score: number, ev: ScoreEvidence, rowDate: string): number {
  return Math.min(score, evidenceScoreCeiling(ev, rowDate));
}
```

Then update `evidenceFromDayRow`'s `checkinPossible` so the v2 path does not honour a carry. Because the same function serves both eras, keep the carry gates but let the ceiling function decide — the gates only ever GRANT, and for a v2 row the carry can no longer come from `ciLast` alone:

```typescript
  return {
    nutritionPossible: anyMealLogged || hasSlotMacros || !!ctx.activeTrustPass,
    checkinPossible: row.date >= SCORING_V2_CUTOVER
      ? submitted
      : (submitted || carryInWindow || !!ctx.priorSubmittedInWeek),
    commitmentPresent: commitment === 'yes' || commitment === 'partial' || commitment === 'no',
  };
```

Fix all callers of the two changed signatures:

```bash
grep -rn "evidenceScoreCeiling\|clampScoreToEvidence" src/
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx jest src/core/scoreIntegrity.test.ts`
Expected: PASS, including the pre-cutover cases.

The existing property test ("a real score is always <= its own evidence ceiling") must still pass. If it fails, the ceiling is too tight and would clamp honest scores — **stop and fix the ceiling, never the property test.**

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0193_score_v2_evidence_ceiling.sql`:

```sql
-- OnStandard — score v2 evidence ceiling. Replaces the 0041 trigger body. Forward-only, idempotent.
--
-- 0041 hardcoded the v1 slots (nutrition 55 / recovery+checkin 35 / commitment 15). Score v2
-- changes the formula to nutrition .76-.78, checkin .12, recovery .12, commitment 0, so the old
-- ceiling would clamp an honest perfect-food day from 76 down to 55 — silent data corruption
-- with no error surfaced.
--
-- DATE-GUARDED. Rows dated before the cutover keep the v1 ceiling. Those days were earned under a
-- formula with a real 15-point commitment slot; re-clamping them under v2 would rewrite history
-- the product promised to freeze, and any future UPDATE touching an old row would trigger it.
--
-- KEEP IN SYNC with src/core/scoreIntegrity.ts (SCORING_V2_CUTOVER, V1_CEILING, MAX_SUBSCORE_WEIGHT).

create or replace function clamp_day_score_to_evidence() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutover   constant date := date '2026-08-16';
  v_nutrition boolean;
  v_checkin   boolean;
  v_commit    boolean;
  v_carry     boolean;
  v_ceiling   int;
begin
  if new.score is null then
    return new;
  end if;

  v_nutrition :=
    exists (select 1 from jsonb_each(coalesce(new.meals, '{}'::jsonb)) e where e.value = 'true'::jsonb)
    or (jsonb_typeof(new.checkin -> 'slotMacros') = 'object' and (new.checkin -> 'slotMacros') <> '{}'::jsonb)
    or exists (
      select 1 from trust_passes tp
      where tp.athlete_id = new.athlete_id
        and tp.ended_at is null
        and tp.granted_date <= new.date
        and new.date < tp.granted_date + tp.length_days
    );

  -- A carry is only evidence for a PRE-cutover row. Under v2 the check-in means tonight.
  v_carry :=
    (case when new.checkin ->> 'ciLast' ~ '^\d{4}-\d{2}-\d{2}$'
          then (new.checkin ->> 'ciLast')::date between new.date - 6 and new.date
          else false end)
    or exists (
      select 1 from days d2
      where d2.athlete_id = new.athlete_id
        and d2.date < new.date
        and d2.date >= new.date - 6
        and (d2.checkin ->> 'submitted') = 'true'
    );

  v_checkin := ((new.checkin ->> 'submitted') = 'true')
               or (new.date < v_cutover and v_carry);

  v_commit := (new.checkin ->> 'commitment') in ('yes', 'partial', 'no');

  if new.date < v_cutover then
    v_ceiling := least(100,
        (case when v_nutrition then 55 else 0 end)
      + (case when v_checkin  then 35 else 0 end)   -- v1: recovery 25 + check-in 10
      + (case when v_commit   then 15 else 0 end)
    );
  else
    v_ceiling := least(100,
        (case when v_nutrition then 78 else 0 end)  -- max nutrition weight across profiles
      + (case when v_checkin  then 24 else 0 end)   -- v2: recovery 12 + check-in 12
      -- commitment unlocks nothing under v2
    );
  end if;

  if new.score > v_ceiling then
    new.score := v_ceiling;
    new.grade := case
      when v_ceiling >= 90 then 'A'
      when v_ceiling >= 80 then 'B'
      when v_ceiling >= 70 then 'C'
      when v_ceiling >= 60 then 'D'
      else 'F'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists days_score_evidence_ceiling on public.days;
create trigger days_score_evidence_ceiling
  before insert or update on public.days
  for each row execute function clamp_day_score_to_evidence();
```

- [ ] **Step 6: Prove no existing row moves**

Run against the linked prod DB (read-only — this is a SELECT):

```bash
supabase db query --linked "select count(*) as would_move from days d where d.score is not null and d.date < date '2026-08-16' and d.score > least(100, (case when exists (select 1 from jsonb_each(coalesce(d.meals,'{}'::jsonb)) e where e.value='true'::jsonb) or (jsonb_typeof(d.checkin->'slotMacros')='object' and (d.checkin->'slotMacros')<>'{}'::jsonb) then 55 else 0 end) + (case when (d.checkin->>'submitted')='true' or (d.checkin->>'ciLast' ~ '^\d{4}-\d{2}-\d{2}\$' and (d.checkin->>'ciLast')::date between d.date-6 and d.date) then 35 else 0 end) + (case when (d.checkin->>'commitment') in ('yes','partial','no') then 15 else 0 end));"
```

Expected: `would_move = 0`. **If it returns anything but 0, stop** — the date guard is not protecting history and the migration must not be applied.

- [ ] **Step 7: Find the rooms that lose the recovery knob**

Task 8 removes the coach's recovery toggle. Identify the affected coaches now so the founder can notify them before cutover:

```bash
supabase db query --linked "select rs.id, rs.team_id, count(distinct r.athlete_id) as athletes from requirement_sets rs left join roster r on r.team_id = rs.team_id where coalesce((rs.config->>'recovery')::boolean, true) = false group by rs.id, rs.team_id order by athletes desc;"
```

Record the result in the PR description under **Founder owes: notify these coaches before 2026-08-16.** If the column shape differs, inspect `requirement_sets` and adjust the JSON path — do not skip this step.

- [ ] **Step 8: Commit**

```bash
git add src/core/scoreIntegrity.ts src/core/scoreIntegrity.test.ts supabase/migrations/0193_score_v2_evidence_ceiling.sql
git commit -m "feat(server)!: score v2 evidence ceiling, date-guarded at 2026-08-16

0041 hardcoded the v1 slots in SQL and clamps every write, so a v2 client
would compute a perfect food day at 76 and have it silently stored as 55.
0193 replaces the trigger body with the v2 slots (nutrition 78, a real
check-in 24, commitment nothing).

Date-guarded: rows before the cutover keep the v1 ceiling. Those days were
earned under a formula with a real commitment slot, and without the guard
any later UPDATE touching an old row would re-clamp it and rewrite the
history we promised to freeze.

Verified against live prod: 0 existing rows move."
```

---

## Task 5: The breakdown model returns two cards

**Files:**
- Modify: `proto/redesign-2026-07/js/breakdown-model.js:69-143` (`maxDay`, `reachPlan`), `:165-326` (`explainCategories`)
- Test: `src/core/breakdownModel.test.ts` (existing)

**Interfaces:**
- Consumes: `dayScoreOf`, `weightsForDay` (unchanged signatures).
- Produces: `explainCategories(day, opts) -> [nutritionCard, recoveryCard]` — exactly two entries, ids `'nutrition'` and `'recovery'`. The recovery card gains `rows` whose first entry is the guaranteed check-in row. `reachPlan(day, opts) -> { rows, maxPossible }` with no `commitment` row.

- [ ] **Step 1: Write the failing test**

Append to `src/core/breakdownModel.test.ts` (follow the fixture helpers already in that file):

```typescript
describe('score v2 breakdown', () => {
  it('returns exactly two categories, nutrition and recovery', () => {
    const cats = explainCategories(emptyDay(), baseOpts());
    expect(cats.map((c) => c.id)).toEqual(['nutrition', 'recovery']);
  });

  it('the recovery card is worth 24 and names the guaranteed part', () => {
    const rec = explainCategories(emptyDay(), baseOpts()).find((c) => c.id === 'recovery')!;
    expect(rec.possible).toBe(24);
    expect(rec.rows[0].label).toBe('Checked in tonight');
    expect(rec.rows[0].value).toBe('+12 on check-in');
  });

  it('reach plan has no commitment row', () => {
    const { rows } = reachPlan(emptyDay(), baseOpts());
    expect(rows.find((r) => r.id === 'commitment')).toBeUndefined();
  });

  it('reach plan rows still sum exactly to maxPossible minus score', () => {
    const d = emptyDay();
    const { rows, maxPossible } = reachPlan(d, baseOpts());
    const total = rows.reduce((a, r) => a + r.gain, 0);
    expect(total).toBe(maxPossible - dayScoreOf(d));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/core/breakdownModel.test.ts`
Expected: FAIL — four categories are returned and a commitment row is present.

- [ ] **Step 3: Drop the commitment from `maxDay` and `reachPlan`**

In `maxDay`, delete the line `if (d.dailyCommitment == null) d.dailyCommitment = 'yes';` (currently `breakdown-model.js:80`).

In `reachPlan`, delete the whole `if (day.dailyCommitment == null) { ... }` block (currently lines 132-141), and reword the recovery row's `sub` (line 127) since there is no separate weekly check-in to refresh:

```javascript
      sub: 'Tonight, before bed. Submitting it is worth 12 on its own',
```

- [ ] **Step 4: Replace the four returned cards with two**

In `explainCategories`, delete the `/* --- Daily Commitment --- */` block (lines 253-264) and the `/* --- Weekly check-in --- */` block (lines 266-272). Then replace the returned array's recovery entry and drop the last two entries entirely:

```javascript
  /* ONE Recovery card worth checkin + recovery. The engine keeps two slots because `checkin` is
     binary and `recovery` is graded, but the athlete must never be shown two categories for one
     action — that duplicate is exactly what v2 removes. */
  const recPossible = Math.round((w.checkin + w.recovery) * 100);
  const recEarned = Math.round(w.checkin * c.checkin + w.recovery * c.recoveryContribution);
  const ciPts = Math.round(w.checkin * 100);
  const ansPts = Math.round(w.recovery * 100);

  return [
    {
      id: 'nutrition', key: 'Nutrition', accent: 'g', weightPct: Math.round(w.nutrition * 100),
      earned: nutriEarned, possible: nutriPossible, note: nutriNote,
      remaining: openSlots.length ? nutriRemaining : 0, remainingKind: 'upTo',
      remainingNote: nutriRemaining <= 0 ? 'Full nutrition points earned.'
        : openSlots.length ? `Up to ${nutriRemaining} points still available. On-time logs that reach your protein target earn it all.`
          : `Settled for today. The ${nutriRemaining}-point gap came from late credit or plate quality on meals already logged — no action can re-earn it tonight. Tomorrow starts at the full ${nutriPossible}.`,
      rows: nutriRows,
    },
    {
      id: 'recovery', key: 'Recovery', accent: 'p', weightPct: recPossible,
      earned: recEarned, possible: recPossible,
      note: day.ciSubmitted
        ? `Checked in tonight · Recovery quality ${c.recovery}%`
        : 'Not checked in yet — tonight’s check-in is the only way to earn this',
      remaining: day.ciSubmitted ? 0 : recPossible,
      remainingKind: day.ciSubmitted ? 'guaranteed' : 'upTo',
      remainingNote: day.ciSubmitted
        ? 'Tonight’s check-in is in. This category is settled for today.'
        : `Submitting tonight’s check-in earns +${ciPts} guaranteed. Your answers set the last ${ansPts}.`,
      rows: [
        {
          label: 'Checked in tonight',
          sub: day.ciSubmitted ? 'Submitted · guaranteed points' : 'Before bed · nothing carries from another day',
          value: day.ciSubmitted ? `${ciPts} of ${ciPts} pts` : `+${ciPts} on check-in`,
          state: day.ciSubmitted ? 'done' : 'open',
        },
        {
          label: 'How you answered',
          sub: day.ciSubmitted ? '' : 'Honest answers cost you almost nothing — a rough night is a few points',
          value: day.ciSubmitted ? `${Math.round(w.recovery * c.recoveryContribution)} of ${ansPts} pts` : `up to +${ansPts}`,
          state: day.ciSubmitted ? 'done' : 'open',
        },
        ...recRows,
      ],
      action: day.ciSubmitted ? null : { label: 'Do check-in', route: 'recovery' },
    },
  ];
```

Delete the now-unused `comPossible` / `comEarned` / `ans` / `comNote` / `comRows` locals and the `wkPossible` / `wkEarned` / `wkIn` locals. In the `/* --- Recovery --- */` block above, delete the `else if (day.ciLast && day.ciLast.date)` carry branch — it can no longer happen.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx jest src/core/breakdownModel.test.ts`
Expected: PASS, including the sum-exactness assertion.

Run: `npm test && npm run test:proto`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/js/breakdown-model.js src/core/breakdownModel.test.ts
git commit -m "feat(proto): the breakdown explains two pillars, not four

explainCategories returns Nutrition and Recovery. The engine keeps two
slots for recovery because checkin is binary and the answers are graded,
but the athlete sees ONE card worth 24 with two rows inside it — showing
two categories for one action is the duplicate v2 exists to remove.

reachPlan drops the commitment row and maxDay stops assuming a 'yes'.
Rows still sum exactly to maxPossible minus score."
```

---

## Task 6: Athlete-facing surfaces

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/home.js` (score bar segments)
- Modify: `proto/redesign-2026-07/js/screens/log.js:138`
- Modify: `proto/redesign-2026-07/js/screens/progress.js` (cutover label)
- Modify: `proto/redesign-2026-07/js/ob2-meal.js:254`
- Modify: `proto/redesign-2026-07/js/screens/commitment.js` (copy only)
- Test: `proto/redesign-2026-07/js/no-hardcoded-pct.test.mjs` (created in Task 10; this task must not regress it)

**Interfaces:**
- Consumes: `liveWeightPct(comp)` from `state.js`, `S.breakdown` (now two entries).
- Produces: no new exports.

- [ ] **Step 1: Replace the hardcoded percentage in `log.js`**

`log.js:138` currently reads `'Before bed · 20 seconds · Recovery 25%'`. Recovery's displayed weight is now `checkin + recovery`, so a single `liveWeightPct('recovery')` would under-report it. Import `liveWeightPct` and use the sum:

```javascript
        <div class="st"><div class="t">Recovery Check-In</div><div class="s">${recovery.state === 'done' ? 'Submitted tonight' : `Before bed · 20 seconds · Recovery ${liveWeightPct('checkin') + liveWeightPct('recovery')}%`}</div></div>
```

- [ ] **Step 2: Fix the onboarding claim in `ob2-meal.js`**

Line 254 hardcodes `50% of the score`. Replace with the live value:

```javascript
              <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Nutrition</div><div class="cv">${liveWeightPct('nutrition')}% of the score — this meal grades ${r.quality}/100${band ? ' (' + esc(band.label || band.name || '') + ')' : ''}</div></div>
```

If `ob2-meal.js` cannot import `state.js` (check for a cycle), pass the percentage in from the calling screen rather than reintroducing a literal.

- [ ] **Step 3: Collapse the home score bar to two segments**

In `home.js`, find the score-bar renderer that maps `S.breakdown`. It is already data-driven off the breakdown model, which now yields two entries — verify by rendering. Remove any hardcoded four-segment scaffolding and the cyan (`'c'`) Weekly Check-In hue. Accent letters are now only `'g'` (nutrition) and `'p'` (recovery).

```bash
grep -n "breakdown\|'c'\|cyan" proto/redesign-2026-07/js/screens/home.js
```

- [ ] **Step 4: Stop the commitment screen promising points**

In `screens/commitment.js`, remove any copy that states or implies a point value for the reflection. Replace the value proposition with what is now true:

```javascript
'Your coach sees this. It doesn’t change your score — answer it straight.'
```

- [ ] **Step 5: Label the cutover on Progress**

In `screens/progress.js`, where the score history line is rendered, mark the boundary. Add near the top of the module:

```javascript
/* Must equal SCORING_V2_CUTOVER in src/core/scoreIntegrity.ts and the constant in migration 0193.
   Display only — the engine never reads this. */
const SCORING_V2_CUTOVER = '2026-08-16';
```

Render a divider on the first point at or after that date, labelled:

```
Scoring changed — days before this were scored a different way
```

- [ ] **Step 6: Render and check the real screens**

Use the proto headless render recipe to screenshot Home, Score Breakdown, Log, Progress and the Commitment screen in both themes. Confirm: two segments on the bar, one Recovery card worth 24, no "25%" or "50%" anywhere, and the Progress divider present.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:proto && npm run lint:copy && npm run lint:xss`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/js/screens/log.js proto/redesign-2026-07/js/screens/progress.js proto/redesign-2026-07/js/screens/commitment.js proto/redesign-2026-07/js/ob2-meal.js
git commit -m "feat(proto): athlete surfaces read the live weights

Home drops to two bar segments and retires the cyan weekly-check-in hue.
log.js and ob2-meal.js stop printing hardcoded 25%/50% and read
liveWeightPct instead. The reflection screen stops promising points,
because it no longer pays any. Progress labels the cutover so the step in
the line is explained rather than hidden."
```

---

## Task 7: Delete the Weekly Check-In ritual

The screen says "Opens Sunday · 10 Points"; the engine never had a Sunday ritual. v2 removes the component, so the whole surface goes.

**Files:**
- Delete: `proto/redesign-2026-07/js/screens/checkin.js`
- Modify: `proto/redesign-2026-07/js/screens/index.js` (route registration)
- Modify: `proto/redesign-2026-07/js/requirements.js:272` (catalog entry)
- Modify: `proto/redesign-2026-07/js/state.js:4271`
- Test: `proto/redesign-2026-07/js/requirements.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the `checkin` route no longer exists; the `checkin` requirement id is removed from `CATALOG`.

- [ ] **Step 1: Write the failing test**

Append to `proto/redesign-2026-07/js/requirements.test.mjs`:

```javascript
import { CATALOG, IMPACT_LABEL } from './requirements.js';

test('the weekly check-in requirement is gone', () => {
  assert.equal(CATALOG.find((r) => r.id === 'checkin'), undefined,
    'v2 has one check-in: the nightly recovery one');
});

test('no requirement routes to the deleted weekly check-in screen', () => {
  for (const r of CATALOG) {
    assert.notEqual(r.route, 'checkin', `${r.id} still routes to the deleted screen`);
  }
});

test('IMPACT_LABEL has no weekly check-in entry', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(IMPACT_LABEL, 'checkin'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:proto -- --test-name-pattern="weekly check-in"`
Expected: FAIL — the catalog entry and the label both still exist.

- [ ] **Step 3: Remove the catalog entry and its label**

Delete the `checkin:` entry from `CATALOG` (`requirements.js:272`). Delete the `get checkin()` getter from `IMPACT_LABEL` (`requirements.js:41`).

Update the accent comment on `requirements.js:54` — cyan `'c'` was minted for the weekly check-in and is now unused by this catalog.

- [ ] **Step 4: Delete the screen and unregister the route**

```bash
git rm proto/redesign-2026-07/js/screens/checkin.js
grep -rn "screens/checkin\|'checkin'\|\"checkin\"" proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/router.js
```

Remove the import and the route registration. **Careful:** `'checkin'` also appears as an engine component key and as `day.checkin` jsonb. Only remove route/screen registrations — never a `computeComponents` key.

- [ ] **Step 5: Remove the "Opens Sunday" copy**

Delete the `state.js:4271` branch that produces `'Open today · worth 10 points'` / `'Opens Sunday · worth 10 points'`, along with the requirement row it feeds.

- [ ] **Step 6: Prove no dead links remain**

```bash
grep -rn "#/checkin\|route: 'checkin'\|routeTo('checkin')\|'checkin'" proto/redesign-2026-07/js/screens/ | grep -v "comp: 'checkin'"
```

Expected: no hits that navigate to a screen.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `npm run test:proto`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -u proto/redesign-2026-07/js/screens/checkin.js
git add proto/redesign-2026-07/js/requirements.js proto/redesign-2026-07/js/state.js proto/redesign-2026-07/js/screens/index.js proto/redesign-2026-07/js/requirements.test.mjs
git commit -m "feat(proto)!: delete the Weekly Check-In ritual

The screen promised 'Opens Sunday · 10 Points'. The engine paid for ANY
check-in in the trailing seven days and never had a Sunday ritual —
breakdown-model.js already carried a comment warning the copy must not
invent one. The app has been telling two stories; v2 removes the
component, so the screen, its requirement, its route and its copy go with
it. The nightly recovery check-in is the only check-in in the product."
```

---

## Task 8: Coach, trainer and parent surfaces; remove the recovery knob

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/coach.js:1034-1036`
- Modify: `proto/redesign-2026-07/js/screens/ob2-client.js:214`
- Modify: `proto/redesign-2026-07/js/screens/ob2-parent.js`, `screens/guardian.js` (audit)
- Test: `proto/redesign-2026-07/js/operator-book.test.mjs`

**Interfaces:**
- Consumes: `liveWeightPct`.
- Produces: the coach standard's `KNOB` object loses its `recovery` and `checkin` fields.

- [ ] **Step 1: Remove both toggles from the coach standard editor**

Replace `coach.js:1034-1036`:

```javascript
        ${modHead('moon', 'std-ic-p', 'Recovery', 'Part of the standard — every athlete closes the day')}
        <div class="std-help">The nightly check-in is ${liveWeightPct('checkin') + liveWeightPct('recovery')}% of the score. You set what it asks; you don't set whether it counts.</div>
```

The `Weekly check-in · Sundays` toggle is deleted outright — that component no longer exists.

- [ ] **Step 2: Remove `recovery` and `checkin` from the knob model**

`coach.js:717` declares `KNOB = { key, meals, lifts, weigh, recovery, checkin }`. Remove both fields, and every read of `KNOB.recovery` / `KNOB.checkin`:

```bash
grep -n "KNOB.recovery\|KNOB.checkin\|k.recovery\|k.checkin" proto/redesign-2026-07/js/screens/coach.js
```

At `coach.js:836` the recovery requirement is pushed conditionally (`if (k.recovery)`). Make it unconditional:

```javascript
  items.push({ id: 'recovery', title: 'Recovery Check-In', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } });
```

At `coach.js:975` the summary chip is conditional (`${KNOB.recovery ? sumChip(...) : ''}`) — make it unconditional too.

- [ ] **Step 3: Handle stored standards that have the knob off**

Existing `requirement_sets` rows may carry `recovery: false`. Where `KNOB` is hydrated from a stored config (`coach.js:912-913`), ignore any stored `recovery`/`checkin` value so an old row cannot resurrect a component. Add a comment naming the reason:

```javascript
    /* v2: recovery is part of the standard and is never read from a stored config. Rooms saved
       before the cutover may carry recovery:false; honouring it would score those athletes on a
       formula nobody else is on. See the score v2 spec §15. */
```

- [ ] **Step 4: Fix the trainer onboarding claim**

`ob2-client.js:214` states the four old weights. Replace:

```javascript
          ${row('bars', 'One Daily Score', `Nutrition ${liveWeightPct('nutrition')} · recovery ${liveWeightPct('checkin') + liveWeightPct('recovery')}`)}
```

- [ ] **Step 5: Audit the parent and guardian surfaces**

```bash
grep -rn "score\|Nutrition\|Recovery\|Commitment\|check-in" proto/redesign-2026-07/js/screens/ob2-parent.js proto/redesign-2026-07/js/screens/guardian.js
```

Fix every description of the score's composition to read from `liveWeightPct`, or remove the composition claim entirely. A parent cannot check a stale claim against the app, so a wrong one is worse here than anywhere else.

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npm run test:proto`
Expected: PASS. Update `operator-book.test.mjs` where it asserts the knob shape.

Render the coach standard editor, the trainer onboarding and the parent view using the operator render harness (mock the REST layer, seed `RT` — `CD` is getter-backed and cannot be assigned). Confirm no stale percentage and no orphaned toggle.

- [ ] **Step 7: Commit**

```bash
git add proto/redesign-2026-07/js/screens/coach.js proto/redesign-2026-07/js/screens/ob2-client.js proto/redesign-2026-07/js/screens/ob2-parent.js proto/redesign-2026-07/js/screens/guardian.js proto/redesign-2026-07/js/operator-book.test.mjs
git commit -m "feat(proto)!: recovery is part of the standard, not a coach knob

A coach could switch recovery off; under v2 that orphans 24 points, and
redistributing them would score that room 100% on food logging — a 94
there would not mean what a 94 means next door, under a claim that says
it does. The platform owns the weights, the professional owns the targets.

The Sundays weekly-check-in toggle is deleted with its component. Stored
standards carrying recovery:false are ignored on hydration so an old row
cannot resurrect a formula nobody else is on.

FOUNDER OWES: notify the coaches identified in Task 4 step 7 before the
cutover — their athletes have never been asked for a check-in."
```

---

## Task 9: The Command Center reads the engine

**Files:**
- Modify: `web/admin/sections/scoring.js:11-64`
- Test: `web/admin/sections/scoring.test.mjs` (create)

**Interfaces:**
- Consumes: `PROFILE_WEIGHTS` from `proto/redesign-2026-07/js/plan-style.js`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `web/admin/sections/scoring.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_WEIGHTS as ADMIN_WEIGHTS } from './scoring.js';
import { PROFILE_WEIGHTS as ENGINE_WEIGHTS } from '../../../proto/redesign-2026-07/js/plan-style.js';

/* The Command Center exists to make the formula INSPECTABLE. An admin reading stale weights is
   worse than no page at all, so this pins it to the shipped engine. */
test('the admin scoring page shows the engine\'s real weights', () => {
  assert.deepEqual(ADMIN_WEIGHTS, ENGINE_WEIGHTS);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:admin`
Expected: FAIL — `scoring.js` does not export `PROFILE_WEIGHTS`, and its literal is the v1 mix.

- [ ] **Step 3: Import the engine instead of redeclaring it**

Replace `web/admin/sections/scoring.js:11-14` with a re-export:

```javascript
/* THE weights, imported from the shipped engine — never a second literal. The whole point of this
   page is that the formula is inspectable, so a stale copy here is worse than no page. */
export { PROFILE_WEIGHTS } from '../../../proto/redesign-2026-07/js/plan-style.js';
import { PROFILE_WEIGHTS } from '../../../proto/redesign-2026-07/js/plan-style.js';
```

If the admin bundle cannot resolve that relative path at runtime, keep the literal and let the new test be the guard — but say so in a comment naming the constraint.

- [ ] **Step 4: Update the ceiling and rules copy**

Line 20 — the guarded-risk row:

```javascript
  ['A perfect score despite missed requirements', 'Guarded — the server evidence ceiling (0193) clamps score DOWN to what evidence supports (nutrition 78 / a real check-in 24). Rows before 2026-08-16 keep the v1 ceiling (55 / 35 / 15) so frozen history is never re-clamped.'],
```

Line 36 — drop the commitment bar, since it is worth nothing:

```javascript
    bar('Nutrition', w.nutrition), bar('Checked in tonight', w.checkin), bar('Answers', w.recovery),
```

Line 52 — the ceiling rows:

```javascript
    row('Nutrition (max)', '78'), row('Real check-in (max)', '24'), row('Commitment (max)', '0 — no longer scored'),
```

Line 56 — replace the commitment rule with the truth:

```javascript
    row('Daily reflection', 'Captured and shown to the coach · worth 0 points'),
```

Line 59 — the missing-data rule:

```javascript
    row('Missing data', 'recovery and check-in only count when a check-in was submitted TODAY — nothing carries (86 is a display fallback = 0)'),
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm run test:admin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/admin/sections/scoring.js web/admin/sections/scoring.test.mjs
git commit -m "feat(admin): Command Center reads the engine's weights, pinned by test

This page exists to make the formula inspectable, and every number on it
was a hardcoded v1 copy — the sixth of eight. It now imports the shipped
weights, and a test fails the build if the two ever disagree. Ceiling copy
names 0193 and the pre-cutover v1 fallback."
```

---

## Task 10: Published claims, and a lint that stops this recurring

**Files:**
- Create: `proto/redesign-2026-07/tools/lint-score-pct.mjs`
- Modify: `package.json` (`lint:score` + add to `verify`)
- Modify: `.agents/product-marketing.md:80`, `docs/marketing/aso-listing.md:113,143`, `docs/marketing/content-and-aiseo-plan.md:168`, `docs/marketing/articles/athlete-accountability-guide.md:47`, `docs/marketing/articles/the-other-167-hours.md:75`, `web/landing/athletes.html:274`, `web/landing/index.html`, `web/marketing-src/cards.html:668`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint:score` exits non-zero on a hardcoded score percentage in `proto/` or `web/`.

- [ ] **Step 1: Write the lint**

Create `proto/redesign-2026-07/tools/lint-score-pct.mjs`:

```javascript
#!/usr/bin/env node
/* Fails on a hardcoded score percentage. The weights were written down EIGHT times before v2 and
   that is why a coach and an athlete could read different numbers for the same day. Print them
   with liveWeightPct(comp) / weightPct(comp) or don't print them. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['proto/redesign-2026-07/js', 'web/landing', 'web/marketing-src', 'web/admin'];
const EXT = new Set(['.js', '.mjs', '.html']);
const ALLOW = /lint-score-pct|\.test\.|weight-sources|score-v2/;
/* "50% of score", "25% of the score", "Nutrition 50", "check-in 10%" */
const PATTERNS = [
  /\b\d{1,3}\s*%\s*of\s+(the\s+)?score\b/i,
  /\b(nutrition|recovery|commitment|check-?in)\s+\d{1,3}\s*%/i,
];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(p))) yield p;
  }
}

let bad = 0;
for (const root of ROOTS) {
  let files;
  try { files = [...walk(root)]; } catch { continue; }
  for (const f of files) {
    if (ALLOW.test(f)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const re of PATTERNS) {
        if (re.test(line)) {
          console.error(`${f}:${i + 1}  hardcoded score percentage — use liveWeightPct()\n    ${line.trim()}`);
          bad++;
        }
      }
    });
  }
}
if (bad) { console.error(`\n${bad} hardcoded score percentage(s).`); process.exit(1); }
console.log('lint:score — no hardcoded score percentages');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node proto/redesign-2026-07/tools/lint-score-pct.mjs`
Expected: FAIL, listing the landing page and any surface Tasks 6-9 missed.

- [ ] **Step 3: Wire it into `verify`**

In `package.json`:

```json
    "lint:score": "node proto/redesign-2026-07/tools/lint-score-pct.mjs",
    "verify": "npm run lint:xss && npm run lint:copy && npm run lint:type && npm run lint:score && npm run typecheck && npm run test && npm run test:proto && npm run test:admin && npm run bundle",
```

- [ ] **Step 4: Fix every published claim**

Replace the composition sentence everywhere it appears. Canonical new wording:

```
Nutrition 76%, Recovery 24% (12 for closing the day out, 12 for how you answered).
```

- `.agents/product-marketing.md:80` — **do this one first.** It generates future marketing; leaving it stale reprints the old formula on every new asset.
- `docs/marketing/aso-listing.md:113,143` — App Store listing copy. Flag in the PR: **requires a store submission, not a deploy.**
- `docs/marketing/content-and-aiseo-plan.md:168` — the canonical AI-SEO definition.
- `docs/marketing/articles/athlete-accountability-guide.md:47` and `articles/the-other-167-hours.md:75` — published articles.
- `web/landing/athletes.html:274` — update the graphic's `aria-label` **and** the graphic itself if it renders the four weights.
- `web/landing/index.html`, `web/marketing-src/cards.html:668`.

The claim "one fixed, published formula" stays true and stays in the copy — only the numbers move.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm run lint:score`
Expected: PASS.

Run: `npm run verify`
Expected: PASS end to end.

- [ ] **Step 6: Commit**

```bash
git add proto/redesign-2026-07/tools/lint-score-pct.mjs package.json .agents/product-marketing.md docs/marketing/ web/landing/athletes.html web/landing/index.html web/marketing-src/cards.html
git commit -m "feat(lint): fail the build on a hardcoded score percentage; fix published claims

The weights were written down eight times, which is why roles could quote
different numbers for the same day. lint:score joins verify and rejects
any literal percentage in proto/ or web/ — print it with liveWeightPct or
don't print it.

Updates every published claim to Nutrition 76% / Recovery 24%.
product-marketing.md first, because it generates future assets.

FOUNDER OWES: the App Store listing needs a store submission, not a
deploy — it is on its own timeline."
```

---

## Task 11: Ship it

**Files:**
- Modify: `proto/redesign-2026-07/PROTO_VERSION` + `src/protoVersion.ts` (build artifacts)
- Modify: `assets/proto.zip` (build artifact)

- [ ] **Step 1: Full verification**

Run: `npm run verify`
Expected: PASS. Do not proceed on any failure.

- [ ] **Step 2: Apply the migration**

```bash
supabase db push --linked
supabase db query --linked "select proname from pg_proc where proname = 'clamp_day_score_to_evidence';"
```

Expected: the function exists. Re-run the Task 4 step 6 query and confirm it still returns `would_move = 0`.

- [ ] **Step 3: Rebuild the proto bundle**

```bash
npm run build-proto-zip
```

The OTA ships `assets/proto.zip`, **not** the loose files. `src/protoVersion.ts` is the second build artifact — commit both or the OTA changes nothing.

- [ ] **Step 4: Commit the artifacts**

```bash
git add assets/proto.zip src/protoVersion.ts proto/redesign-2026-07/PROTO_VERSION
git commit -m "chore(proto): stamp PROTO_VERSION for score v2"
```

- [ ] **Step 5: Send the OTA and verify it carried the proto**

```bash
eas update --branch production --environment production --message "score v2"
```

Then fetch the LIVE `u.expo.dev` manifest and grep for the `proto.zip` md5. `expo export` writes no `assetmap.json` — assets are `assets/<md5>`. Do not report the update as shipped until the md5 in the live manifest matches the local `assets/proto.zip`.

- [ ] **Step 6: Post-cutover check**

The morning after the cutover date, confirm on live prod:

```bash
supabase db query --linked "select count(*) filter (where score = 0) as zero_days, count(*) as total, round(avg(score),1) as avg_score from days where date = date '2026-08-16';"
```

Expected: a visible rise in zero-days versus the prior week (empty days no longer bank ~46) and a lower average. A **flat** average means the client did not pick up the new weights — investigate before assuming success.

---

## Founder owes (carry into the PR description)

1. **Notify the coaches** identified in Task 4 step 7, before 2026-08-16. Their athletes have never been asked for a check-in and their scores will drop.
2. **App Store listing** update is a store submission on its own timeline.
3. **Confirm the cutover date** `2026-08-16`, or change it in the two places named in Global Constraints.

---

## Self-Review

**Spec coverage.** §2-3 model → Tasks 2, 3. §4 deletions → Task 2. §5 weights → Task 2. §6 unscored reflection → Tasks 2, 6. §7 empty morning → Task 5 (`reachPlan` sum-exactness) + Task 6. §8 frozen history → Task 4 date guard + Task 6 label. §9 bands → unchanged, no task needed (`score-band.js` untouched by design). §10 server trigger → Task 4. §11 blast radius → Tasks 5-9. §14.1 seven copies → Tasks 1, 3, 9, 10 (the eighth, `SCORE_WEIGHTS`, is Task 3). §14.2 athlete → Task 6. §14.3 coach → Task 8. §14.4 trainer → Task 8. §14.5 parent → Task 8 step 5. §14.6 admin → Task 9. §14.7 weekly ritual → Task 7. §14.8 marketing → Task 10. §15 recovery knob → Task 8. §16 success criteria → covered across Tasks 1-11, with the no-hardcoded-percentage criterion enforced by Task 10's lint.

**Placeholder scan.** No TBDs. Two steps are explicitly investigative rather than prescriptive — Task 6 step 3 (home bar) and Task 8 step 5 (parent audit) — because the exact lines depend on what the grep returns; both name the grep, the acceptance criterion, and the rule to apply.

**Type consistency.** `evidenceScoreCeiling` and `clampScoreToEvidence` gain a `rowDate: string` second parameter in Task 4; both call-site sweeps are in that task. `explainCategories` returns two entries from Task 5, which Task 6 consumes. `PROFILE_WEIGHTS` has the identical shape in `plan-style.js`, `scoringProfiles.ts` and `scoring.js` (admin). `checkinReal(day)` keeps its signature. `SCORE_WEIGHTS` keeps the `ScoreWeight[]` type while losing its commitment entry — the `key` union still includes `'commitment'`, so `SCORE_WEIGHT_COPY` is typed over the full union and filtered at runtime.
