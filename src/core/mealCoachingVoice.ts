// OnStandard core — meal-coaching VOICE guard (doc-05 §9, Phase 4). PURE, framework-agnostic.
//
// The bounded athlete-facing AI win: warm the deterministic coaching sentence (coaching.ts /
// adherence.planMealNote) in the org's voice — WITHOUT ever changing a number. Same discipline as
// nutritionMemoryVoice: the model may only rephrase prose; if any figure drifts, the rephrase is
// rejected and the deterministic sentence stands. No chat, no free generation, numbers locked.

/** Every numeric token in a string (units stay in the prose; only the figures are compared). */
function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).slice().sort();
}

/**
 * A rephrase is safe ONLY if it carries exactly the same multiset of numbers as the source. A model
 * that adds, drops, or changes any figure fails the guard.
 */
export function coachingRephraseIsSafe(source: string, rephrase: string): boolean {
  const a = numbersIn(source);
  const b = numbersIn(rephrase);
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/**
 * Return the model's rephrase only when it is non-empty AND preserves every number; otherwise the
 * deterministic source. The numbers can never drift, and an unconfigured/failed model just yields
 * the engine's own sentence — the athlete always gets correct coaching.
 */
export function mergeCoachingVoice(source: string, rephrase: string | null | undefined): string {
  if (!rephrase || !rephrase.trim()) return source;
  const candidate = rephrase.trim();
  return coachingRephraseIsSafe(source, candidate) ? candidate : source;
}
