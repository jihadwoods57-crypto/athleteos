// OnStandard core — AI Memory (doc-05 §5). PURE, framework-agnostic.
//
// Structured, typed facts are the system of record (no vector DB yet). The CARDINAL RULE: the LLM
// (or an inference) may only PROPOSE a candidate fact; the deterministic pipeline here validates it,
// and for SAFETY kinds (allergy/dislike) a proposed/inferred fact is NEVER auto-written — it is
// routed to the athlete to confirm. The LLM never writes the store. Corrections supersede, never
// edit (append-only provenance), and inferred facts get "smarter every month" by accruing evidence.

import type { MealResult } from './content';
import type { EditableFood } from './mealEdit';
import type { AssistTask } from './assist';

export type MemoryFactKind =
  | 'allergy'
  | 'dislike'
  | 'favorite_food'
  | 'favorite_restaurant'
  | 'budget'
  | 'meal_timing'
  | 'travel'
  | 'hydration_habit'
  | 'skipped_meal'
  | 'motivation_style'
  | 'coach_preference'
  | 'behavior_pattern'
  | 'goal_note';

export type MemorySource = 'athlete_stated' | 'coach_stated' | 'inferred_correction' | 'inferred_log';
export type MemoryStatus = 'active' | 'superseded' | 'rejected' | 'pending_confirmation';

export interface MemoryFact {
  id: string;
  kind: MemoryFactKind;
  value: unknown;
  confidence: number; // 0..1 (1 = stated)
  source: MemorySource;
  evidenceN: number;
  status: MemoryStatus;
}

/** Kinds that are HARD constraints on recommendations and can never be auto-written from inference. */
export const SAFETY_KINDS: readonly MemoryFactKind[] = ['allergy', 'dislike'];
export function isSafetyKind(kind: MemoryFactKind): boolean {
  return SAFETY_KINDS.includes(kind);
}

export interface SafetyConstraint {
  kind: 'allergy' | 'dislike';
  value: unknown;
  reason: string;
}

export function activeFacts(all: MemoryFact[]): MemoryFact[] {
  return all.filter((f) => f.status === 'active');
}

/** The hard filters a recommender must honor — only from CONFIRMED (active) safety facts. */
export function safetyConstraints(facts: MemoryFact[]): SafetyConstraint[] {
  return activeFacts(facts)
    .filter((f) => f.kind === 'allergy' || f.kind === 'dislike')
    .map((f) => ({ kind: f.kind as 'allergy' | 'dislike', value: f.value, reason: `athlete ${f.kind}` }));
}

/**
 * THE VALIDATION GATE. Given a proposed candidate fact, decide the status it may be written with.
 *  - athlete-stated            -> active (the athlete owns their own facts)
 *  - stated but a safety kind from the COACH, or ANY inferred safety kind -> pending_confirmation
 *    (a safety fact is never trusted without the athlete confirming it)
 *  - inferred non-safety        -> active but low-confidence (it can accrue evidence over time)
 * The LLM cannot bypass this: a `memory_extract` candidate arrives here before it can ever be stored.
 */
export function admitCandidate(candidate: MemoryFact): MemoryFact {
  const stated = candidate.source === 'athlete_stated' || candidate.source === 'coach_stated';
  if (candidate.source === 'athlete_stated') {
    return { ...candidate, status: 'active' };
  }
  if (isSafetyKind(candidate.kind)) {
    // coach-stated OR inferred safety fact -> must be confirmed by the athlete before it binds.
    return { ...candidate, status: 'pending_confirmation' };
  }
  return { ...candidate, status: stated ? 'active' : 'active' };
}

/** Propose (never commit) candidate facts from a meal correction. Low confidence, inferred. */
export function candidateFactsFromCorrection(before: MealResult, after: EditableFood[]): MemoryFact[] {
  const detected = new Set((before.detected ?? []).map((d) => d.toLowerCase()));
  const kept = new Set(after.map((f) => f.name.toLowerCase()));
  const facts: MemoryFact[] = [];

  // A detected food the athlete removed/replaced -> a possible dislike (SAFETY kind -> confirmation).
  for (const d of detected) {
    if (!kept.has(d)) {
      facts.push({ id: `cand:dislike:${d}`, kind: 'dislike', value: d, confidence: 0.3, source: 'inferred_correction', evidenceN: 1, status: 'pending_confirmation' });
    }
  }
  // A food the athlete added that wasn't detected -> a possible favorite (non-safety, can accrue).
  for (const f of after) {
    if (!detected.has(f.name.toLowerCase())) {
      facts.push({ id: `cand:favorite_food:${f.name.toLowerCase()}`, kind: 'favorite_food', value: f.name, confidence: 0.3, source: 'inferred_correction', evidenceN: 1, status: 'active' });
    }
  }
  return facts;
}

/** Accrue evidence: the same pattern recurring raises confidence + evidenceN (deterministic). */
export function promoteFact(existing: MemoryFact | undefined, observation: MemoryFact): MemoryFact {
  if (!existing) return observation;
  const evidenceN = existing.evidenceN + 1;
  const confidence = Math.min(1, existing.confidence + 0.15);
  return { ...existing, evidenceN, confidence };
}

const KIND_PRIORITY: Partial<Record<MemoryFactKind, number>> = {
  allergy: 100, dislike: 90, budget: 40, favorite_food: 30, favorite_restaurant: 30, meal_timing: 20,
};

/**
 * Deterministic relevance ranking (kind + confidence + evidence) — the "RAG" without a vector DB.
 * Safety facts always lead so the model can never miss an allergy. Returns at most `limit`.
 */
export function retrieveForTask(facts: MemoryFact[], _task: AssistTask, _ctx: unknown, limit = 12): MemoryFact[] {
  return activeFacts(facts)
    .slice()
    .sort((a, b) => {
      const pa = KIND_PRIORITY[a.kind] ?? 10;
      const pb = KIND_PRIORITY[b.kind] ?? 10;
      if (pb !== pa) return pb - pa;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.evidenceN - a.evidenceN;
    })
    .slice(0, limit);
}
