// Is the model's meal report actually usable? — pure logic, shared by analyze-meal's read,
// its two retries, and the second-pass verifier.
//
// WHY THIS EXISTS. MEAL_TOOL's report is the longest structured output the analyzer asks for:
// per-food macro attribution for a whole plate plus a multi-sentence analysis. When the model runs
// out of output tokens mid-report, the API still returns a `tool_use` block — but its `input` is
// partial or empty. Nothing downstream noticed. The function spread that empty object into
// `{kind:'result'}`, the app wrote protein/carbs/fat/kcal as 0, cleared `pending`, and the athlete
// was left looking at "~0g protein · high confidence" on a plate the AI had clearly seen. Worse,
// the meal was then unrecoverable: corrections scale the stored numbers, and scaling zero is zero.
//
// THE RULE. A read we cannot trust must fail loudly, never quietly become zeros. Every path that
// adopts a tool_use input runs it past this first; a false answer means 502, which is the client's
// failure path — it retries, then offers the athlete "Read it again".
//
// A retry is held to the SAME bar. Adopting a truncated retry over a good first read would turn a
// cosmetic prose problem into a data-loss one, so an incomplete retry is simply not adopted.

/** True when a meal report carries macros we can stand behind and at least one identified food. */
export function validMealInput(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  let macroSum = 0;
  for (const k of ['protein', 'kcal', 'carbs', 'fat'] as const) {
    const raw = r[k];
    // Absent is absent. `Number(null)`, `Number('')` and `Number(false)` are all 0 — finite, and
    // therefore invisible to the check below — so a half-written report would otherwise pass with
    // that macro silently stored as zero. The tool schema declares integers; a numeric string is
    // tolerated because a good read should never be thrown away over its JSON type.
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return false;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return false;
    macroSum += n;
  }
  // All four at zero is the empty read this guard is named for: the model saw a plate and
  // reported nothing on it.
  if (macroSum <= 0) return false;
  // Every real plate has at least one food on it. An empty `detected` means the model never got
  // to the per-food attribution, which also means the client's grounding has nothing to bound.
  return Array.isArray(r.detected) && r.detected.length > 0;
}

/** The telemetry outcome tag for a rejected report — `truncated` when the model hit the token
 *  ceiling, `invalid_tool_input` when it returned something malformed for another reason. Kept
 *  next to the guard so the two can never disagree about what a rejection is called. */
export function rejectionOutcome(stopReason: string | null | undefined): 'truncated' | 'invalid_tool_input' {
  return stopReason === 'max_tokens' ? 'truncated' : 'invalid_tool_input';
}
