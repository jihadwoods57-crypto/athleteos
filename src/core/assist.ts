// OnStandard core — the assist() seam contract (doc-05 §3). PURE: no RN / Supabase / network.
//
// This is the ONE door every AI surface goes through. It is deliberately pure — it defines the
// request shape (a deterministic ContextPack the model is allowed to see) and the deterministic
// FALLBACK for every task, so an unconfigured or failed model never blocks the app. The network
// call lives in src/lib/ai/assist.ts; on `isAiConfigured === false` or any failure it returns
// `assistFallback(...)` directly, exactly as `analyzeMeal` does today.
//
// Invariant (doc-05 §3): every AI surface is a pure function of a deterministic ContextPack plus a
// model that may only PHRASE / DRAFT / SUMMARIZE / RETRIEVE — never decide. The numbers (score,
// targets, safety bounds, at-risk ranking, the plan) are produced by src/core and are IMMUTABLE
// inputs to the model. If the model output disagrees with the deterministic source, the
// deterministic source wins (see aiAuthority.arbitrate) — never here.

import type { PersonalityStyle } from './personality';

export type AssistTask =
  | 'meal_analysis'    // vision -> MealResult + confidence
  | 'meal_coaching'    // phrase the coaching over deterministic mealCoaching()
  | 'copilot_query'    // coach Q&A over RLS-scoped roster signals
  | 'copilot_artifact' // draft a message / report / summary
  | 'memory_extract';  // turn a correction/log into candidate memory facts

/** Confidence below this floor means a meal estimate must ask before it asserts (doc-05 §9.2). */
export const CONFIDENCE_FLOOR = 0.6;

/**
 * The non-negotiable context the caller attaches for the model. Everything here is already
 * authorization- and consent-filtered upstream (allowed() + realDataConsent) — the model never
 * receives an athlete the viewer can't see, nor a photo/PHI it doesn't need.
 *
 * `scoring` / `profile` / `memory` / `signals` are typed loosely for now: their canonical shapes
 * are owned by later slices (ScoringContext = doc-03, PerformanceProfileView = §4/S11,
 * MemoryFact = §5/S9, AccountabilitySignals = doc-04). This seam only needs their presence; a later
 * slice can tighten these field types to the real interfaces without changing the contract.
 */
export interface ContextPack {
  scoring: unknown;               // doc-03 ScoringContext — the ONE source of plan/targets/goals
  profile: unknown;               // §4 PerformanceProfileView (read-only projection)
  memory: readonly unknown[];     // §5 MemoryFact[] (retrieved, athlete-owned)
  signals: unknown;               // doc-04 AccountabilitySignals (already computed)
  personality: PersonalityStyle;  // §7 — the org posture token (already clamped for the audience)
  guardrails: Guardrails;         // disclaimers, scope note, minor flag, confidence floor
}

/** Safety context that rides on every pack and can never be phrased away by personality. */
export interface Guardrails {
  isMinor: boolean;
  confidenceFloor: number;
  /** Medical / scope / body-image notes (from coaching.ts) that must appear regardless of style. */
  disclaimers: readonly string[];
}

export interface AssistRequest {
  task: AssistTask;
  pack: ContextPack;
  input: unknown;
}

/** The shape every assist call returns — model-backed or deterministic fallback, same shape. */
export interface AssistResult {
  task: AssistTask;
  /** The task payload. On fallback this is the deterministic value; the caller renders it identically. */
  output: unknown;
  /** True when no model output was used (unconfigured, failed, refused, or a guardrail rejection). */
  usedFallback: boolean;
  note: string;
}

/** Default guardrails for an audience; the caller fills `disclaimers` from coaching.ts. */
export function defaultGuardrails(isMinor: boolean, disclaimers: readonly string[] = []): Guardrails {
  return { isMinor, confidenceFloor: CONFIDENCE_FLOOR, disclaimers };
}

/**
 * The deterministic fallback for EVERY task, so an unconfigured/failed/refused model never blocks
 * the loop. It never invents anything: it returns the deterministic `input` (the value the app
 * already computed) as the output and marks `usedFallback`. Later slices give each task a richer
 * deterministic default (e.g. the engine's own coaching sentence); until then this passthrough is
 * the honest floor — the app runs exactly as it does with AI off.
 */
export function assistFallback(task: AssistTask, _pack: ContextPack, input: unknown): AssistResult {
  return {
    task,
    output: input ?? null,
    usedFallback: true,
    note: `Deterministic fallback for ${task}; no model output used.`,
  };
}
