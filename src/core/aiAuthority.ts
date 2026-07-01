// OnStandard core — AI Authority arbiter (doc-05 §8). PURE, framework-agnostic.
//
// The rule (Constitution §11a, Founder Rule #3 & #13): the deterministic engine + the coach's plan
// are the source of truth; the AI is only a language layer. If the AI disagrees with the coach,
// THE COACH WINS. The `assist` edge function runs every model-proposed value through `arbitrate()`
// before it can touch anything, so an AI value can never silently become the effective value.
//
// The hierarchy (highest authority first):
//   1. Safety floor   — medical/scope bounds, minor calorie minimums, allergy constraints. ABSOLUTE;
//                       overrides even the coach. Deterministic, never the model's opinion.
//   2. Coach's plan   — the active plan version (targets, windows, profile). Wins over the AI, always.
//   3. Engine default — when the coach hasn't set a value, the deterministic engine's value stands.
//   4. AI language    — may only be RECORDED as a suggestion; never becomes the effective value here.
//
// Disagreement is surfaced, never silently resolved: when the AI differs from the plan, `conflict`
// is true and `aiSuggested` carries the AI value so the UI can show "AI suggests X; your plan is Y".

/** A hard bound the coach cannot cross (e.g. a minor's minimum calories). Numeric fields only. */
export interface SafetyBound {
  min?: number;
  max?: number;
  reason: string;
}

export interface AuthorityDecision {
  /** The value that actually takes effect. Always the plan value or a safety-clamped value — NEVER the AI value. */
  effectiveValue: unknown;
  source: 'coach_plan' | 'safety_floor' | 'engine';
  /** What the AI proposed, recorded for transparency. null when the AI proposed nothing. */
  aiSuggested: unknown | null;
  /** True when the AI proposed a value that differs from what took effect. */
  conflict: boolean;
  note: string;
}

/** Structural equality good enough for the scalar/small-object values arbitrated here. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Arbitrate one field. `planValue` is the coach's plan value (may be null when the coach hasn't set
 * it — then the engine default stands). `aiValue` is what the model proposed (may be null/undefined).
 * `safety` is an optional hard bound that outranks even the coach.
 *
 *  - safety present and the plan value violates it  -> effectiveValue = the clamped bound, source 'safety_floor'
 *  - else a coach plan value is present             -> effectiveValue = planValue, source 'coach_plan'
 *  - else                                           -> effectiveValue = planValue (null), source 'engine'
 *
 * In every branch the AI value is recorded but NEVER becomes the effective value (except when it
 * happens to equal the plan). `conflict` flags a real disagreement for the UI to surface.
 */
export function arbitrate(
  field: string,
  planValue: unknown,
  aiValue: unknown,
  safety: SafetyBound | null,
): AuthorityDecision {
  const aiSuggested = aiValue === undefined ? null : aiValue;

  // Safety floor can override even the coach. Only meaningful for numeric plan values.
  if (safety && typeof planValue === 'number') {
    if (safety.min !== undefined && planValue < safety.min) {
      return {
        effectiveValue: safety.min,
        source: 'safety_floor',
        aiSuggested,
        conflict: aiSuggested !== null && !valuesEqual(aiSuggested, safety.min),
        note: `Safety floor: ${field} held at ${safety.min} (${safety.reason}); even the coach cannot go below.`,
      };
    }
    if (safety.max !== undefined && planValue > safety.max) {
      return {
        effectiveValue: safety.max,
        source: 'safety_floor',
        aiSuggested,
        conflict: aiSuggested !== null && !valuesEqual(aiSuggested, safety.max),
        note: `Safety floor: ${field} held at ${safety.max} (${safety.reason}); even the coach cannot exceed it.`,
      };
    }
  }

  const conflict = aiSuggested !== null && !valuesEqual(aiSuggested, planValue);

  if (planValue === null || planValue === undefined) {
    return {
      effectiveValue: planValue ?? null,
      source: 'engine',
      aiSuggested,
      conflict,
      note: conflict
        ? `AI suggests ${JSON.stringify(aiSuggested)}; using the engine default for ${field} until a coach sets it.`
        : `Engine default for ${field}.`,
    };
  }

  return {
    effectiveValue: planValue,
    source: 'coach_plan',
    aiSuggested,
    conflict,
    note: conflict
      ? `AI suggests ${JSON.stringify(aiSuggested)}; the coach's plan (${JSON.stringify(planValue)}) stands.`
      : `Coach plan for ${field}.`,
  };
}
