# Meal Confidence + Conditional Second-Pass Verifier — Design

**Date:** 2026-07-21
**Status:** Approved (design), pending spec review
**Scope:** Build-brief AI-architecture item 6 (confidence + clarification), specifically the *conditional second-pass verifier*, plus two folded-in upgrades.
**Builds on:** `2026-07-09-meal-intelligence-design.md`, the Tier-1 deterministic-quality pass (`c1df580`), and the 8a AI-cost telemetry (`3742641`).

---

## 1. Context — what already exists (do NOT rebuild)

Most of the brief's "confidence + clarification" is already shipped. This design must *reuse* it, not duplicate it:

- **Per-food confidence**: `MEAL_TOOL.detected[].confidence: 'high'|'medium'|'low'` (required) — `analyze-meal/index.ts:266`.
- **Overall confidence**: `estimateConfidence(source, detected)` — `meal-intel.js:137` (currently: low if ANY food low, medium if ANY medium).
- **Honest ranges by confidence**: `estRange()` widens ±10/18/28% for high/med/low — `meal-intel.js:126`.
- **Low-confidence UI flags**: "?" + "AI is unsure — confirm or remove" on low foods — `meal.js:217`.
- **Clarifying questions**: analyze→ask→finalize flow (`ASK_TOOL`), bounded by `CLARIFY_BUDGET` (margin guardrail) — `analyze-meal/index.ts:303,728`.
- **Allergen/restriction check**: deterministic match of detected foods vs saved restrictions; loud pre-confirm alert that names the allergen + its uncertainty, never guarantees safety — `meal.js:236`.
- **Score-language conflict detector**: `analysisAgreesWithBand(text, band)` — `meal-intel.js:655`; on conflict today the app falls back to deterministic copy + a `meal_text_conflict` event.
- **Trigger inputs already computed**: `classifyMealEvent({quality, detected, source, restrictionHits, correctionDelta, ...})` — `meal-intel.js:674` — already evaluates low-confidence, values-off (quality<50), big-correction (≥15), allergen, no-photo.
- **Cost telemetry (8a)**: every paid call lands in `ai_calls` priced by `ai_call_costs`; a verify call is captured automatically as `fn='analyze-meal', mode='verify'`.

**Conclusion:** the ONE genuine gap is the brief's *conditional second-pass verifier* as an actual second AI call. Everything else is polish on top.

## 2. Goal & invariants

Add a **narrow, budgeted, pre-log second AI pass** that fires only on the two highest-stakes triggers, plus two upgrades that make it precise and provable.

Invariants preserved (non-negotiable, from the brief):
- **AI detects; deterministic code sets every number.** The verify pass re-*detects* (foods/portions/allergen presence); macros are recomputed by the existing `groundMacros` against the food DB. The AI never writes a macro or a score.
- **No silent override.** The verifier runs **pre-log** (before the athlete confirms/saves), so it only improves the estimate a human is about to review. The athlete still reviews and confirms exactly as today. No new "accept the AI's correction" UI.
- **Meal-session isolation.** The verify pass reuses the same session's photo; it introduces no cross-meal state.
- **Never blocks a log.** Best-effort: on error/timeout/over-budget the meal proceeds on the first read + free deterministic guards — no worse than today.

## 3. Triggers (locked)

Evaluated client-side after the first analyze result returns (the client already computes these inputs). Fire the verify pass iff a trigger holds AND the athlete's verify budget allows:

- **(a) Safety re-scan** — the athlete has a declared **severe** restriction AND **any** detected food is low-confidence. (Uses per-food low confidence, not the weighted overall — safety must stay sensitive; a single low-confidence item can hide an allergen.)
- **(b) Accuracy re-detect** — the **weighted** overall confidence (see §5) is low AND values look off (`quality < 50`).

Everything else → today's free deterministic guards, unchanged.

## 4. The verify pass — server (`analyze-meal`, new `phase: 'verify'`)

A new phase on the existing `meal` mode, dispatched by which trigger fired (client sends the trigger kind + the first result + the same photo):

- **Safety re-scan** (`trigger: 'allergen'`): focused prompt — "Re-examine this photo ONLY for these declared allergens: [list]. Report presence + confidence for each; do not re-score the meal." Returns `{allergen, present, confidence}[]`. If it finds one the first pass missed → the existing loud pre-confirm allergen alert (same UX; still never a safety guarantee).
- **Accuracy re-detect** (`trigger: 'accuracy'`): "The first read was low-confidence — look again carefully and re-identify foods and portions." Returns a refined `detected[]` (same `MEAL_TOOL` shape) → re-grounded via the existing `groundMacros` → improved pre-log estimate the athlete then reviews.

Model: **Sonnet 5** (vision tier, same as the first pass). Same tool-forced, structured-output discipline as the existing paths.

## 5. Upgrade #2 — weighted confidence (folded in)

Change `estimateConfidence` so the **accuracy** trigger reflects *material* uncertainty, not a trivial garnish:

- Weight each food's confidence by its **calorie share** of the meal; classify the weighted score into low/medium/high by thresholds (tuned so a small low-confidence side item does not drag a well-read plate to "low").
- Keep the current display behavior intact (`estRange`, per-food dots/flags stay per-food).
- **Safety is unaffected** — the safety trigger continues to use per-food low confidence (§3a), never the weighted overall.
- Pure function; unit-tested in the proto suite (parity with existing `meal-intel` tests).

## 6. Upgrade #1 — verify-effectiveness capture (folded in)

Make the second paid call **prove it earns its keep**. Add a nullable `outcome text` column to `ai_calls` (migration **0106**, tiny) and let `recordAiCall` accept an optional `outcome`. The verify pass computes the outcome *before* recording:

- `'no_change'` — re-detect/re-scan matched the first read (nothing moved, no allergen found).
- `'macros_moved'` — re-grounded macros differ from the first read beyond a threshold.
- `'allergen_caught'` — safety re-scan found an allergen the first pass missed.

Because `outcome` sits on the same row as the call's cost, one query answers "the verifier fired N times, cost $X, and changed the read Y% of the time (Z allergens caught)" — the data to keep, tune, or kill it. Feeds directly into item 8b.

## 7. Upgrade #3 — score-language regen (folded in, independently toggleable)

When `analysisAgreesWithBand` fails today, the app drops to canned deterministic copy — correct but voiceless on exactly the meals where feedback matters. Add a **Haiku, text-only** regen: "Rewrite this coaching line to match a {low|good} band; change no numbers." Recorded as `fn='analyze-meal', mode='regen'` (~$0.001). The deterministic fallback **remains** as the safety net if regen fails or is disabled. Gated by env `VERIFY_REGEN_ENABLED` (default on) so it can be switched off without a deploy of the trigger logic.

## 8. Budget & telemetry

- New env **`VERIFY_DAILY_BUDGET`** per athlete (default ~3), **separate** from `CLARIFY_BUDGET`, enforced by the existing per-user daily-cap machinery; every verify call also counts against the **global** backstop.
- 8a captures verify (`mode='verify'`) and regen (`mode='regen'`) automatically → visible in `ai_cost_daily` / `ai_cost_per_meal` on day one, so the budget is tuned from real numbers.

## 9. Components & files

**Server** (`supabase/functions/analyze-meal/index.ts`): new `phase:'verify'` branch (two trigger shapes) + the `regen` path; verify-outcome computed and passed to `recordAiCall`.
**Telemetry** (`supabase/functions/_shared/ai-telemetry.ts` + migration `0106_ai_calls_outcome.sql`): optional `outcome` field + nullable column.
**Client** (`proto/redesign-2026-07/js/`): `meal-intel.js` — weighted `estimateConfidence`, a pure `shouldVerify(result, restrictions, budget)` gate, verify-result merge; `screens/meal.js` — call the verify pass when the gate fires, surface an allergen catch via the existing alert, fold a re-detect into the pre-log estimate.

## 10. Testing

- **Pure, unit-tested** (proto suite): weighted `estimateConfidence`; `shouldVerify` trigger logic (each trigger, budget exhaustion, no-restriction athlete); verify-result merge; outcome classification (`no_change`/`macros_moved`/`allergen_caught`).
- **Server** `verify`/`regen` phases: hand-review + `deno check` (repo convention for edge functions — outside the tsc/vitest include path).
- **Migration 0106**: applied + verified like 0105 (structural check via `db query`).

## 11. Rollout

Server + migration first (verify phase is inert until the client calls it); then the client gate. Budget starts conservative (~3/athlete/day); tune from `ai_cost_daily`. `VERIFY_REGEN_ENABLED` and `VERIFY_DAILY_BUDGET` allow dialing scope without a code change.

## 12. Explicitly NOT in scope (YAGNI)

- Broadening triggers beyond the two locked ones (the free guards already cover the rest).
- Any post-log/silent correction (violates the no-override invariant).
- A meal/session id for exact per-meal attribution (separate; ships with a client build — flagged in 8a).
- Surfacing an overall confidence *number* to the athlete (per-food flags + honest ranges already convey it).
