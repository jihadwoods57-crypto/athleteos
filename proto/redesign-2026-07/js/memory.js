/* Athlete memory — how corrections teach the AI about THIS athlete.
 *
 * WHY THIS EXISTS. The AI has been reading every plate cold. `athlete_memory_facts` (migration
 * 0019) has been live on production the whole time and is read by exactly nothing: the loop that
 * wrote it existed only in the React Native app, which is deleted. So an athlete could correct
 * "that's two scoops, not one" every single morning and the next morning's read would make the
 * same mistake. Corrections were a complaint box, not a teacher.
 *
 * This module turns a correction into a durable fact about the athlete. Ported from
 * src/core/memory.ts (which stays as the reference implementation and the parity oracle) plus the
 * mapping from OnStandard's own structured correction kinds, which the TS reference never had.
 *
 * THE SAFETY RULE, preserved verbatim from the reference: an INFERRED safety fact is never trusted.
 * Removing mushrooms from one plate is weak evidence of a dislike and no evidence of an allergy, so
 * it lands as `pending_confirmation` and only binds when the athlete taps yes. Nothing the model or
 * an inference produces can bypass that gate — which is why the server load (memory-load.ts) reads
 * `status = 'active'` only.
 *
 * Pure and Node-importable: no DOM, no storage, no network.
 */

/** Kinds where a wrong guess is harmful, not merely annoying. Inferred ones need confirmation. */
export const SAFETY_KINDS = ['allergy', 'dislike'];
export const isSafetyKind = (k) => SAFETY_KINDS.includes(k);

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/**
 * THE VALIDATION GATE. Decide the status a proposed fact may be written with.
 *   athlete-stated                     -> active (the athlete owns their own facts)
 *   inferred/coach-stated safety kind  -> pending_confirmation (never binds unconfirmed)
 *   inferred non-safety                -> active, low confidence, accrues over time
 */
export function admitCandidate(candidate) {
  if (!candidate) return null;
  if (candidate.source === 'athlete_stated') return { ...candidate, status: 'active' };
  if (isSafetyKind(candidate.kind)) return { ...candidate, status: 'pending_confirmation' };
  return { ...candidate, status: 'active' };
}

/**
 * Food-level inference: a detected food the athlete removed is a possible dislike (safety →
 * confirmation); a food they added that the AI missed is a possible favourite (accrues freely).
 */
export function candidateFactsFromFoodChange(beforeNames, afterFoods) {
  const before = new Set((beforeNames || []).map(norm).filter(Boolean));
  // Compare case-insensitively, but STORE a favourite with the athlete's own capitalisation —
  // "Greek yogurt" is what they typed and what should read back to them. Dislikes come off the
  // detected list, which is already normalized. (Matches src/core/memory.ts exactly; the parity
  // test caught this the first time it ran.)
  const after = (afterFoods || [])
    .map((f) => (typeof f === 'string' ? f : f && f.name))
    .map((n) => String(n == null ? '' : n).trim())
    .filter(Boolean);
  const kept = new Set(after.map(norm));
  const out = [];
  for (const d of before) {
    if (!kept.has(d)) out.push(admitCandidate({ kind: 'dislike', value: d, confidence: 0.3, source: 'inferred_correction', evidence_n: 1 }));
  }
  for (const a of after) {
    if (!before.has(norm(a))) out.push(admitCandidate({ kind: 'favorite_food', value: a, confidence: 0.3, source: 'inferred_correction', evidence_n: 1 }));
  }
  return out;
}

/**
 * Structured-correction inference — the part with the most value, and no counterpart in the TS
 * reference.
 *
 * When an athlete says "portion was double" they are not describing one plate; they are describing
 * how the AI reads THEM. Repeated, that becomes a calibration prior — the single most useful thing
 * memory can carry into a vision prompt, because it corrects a systematic bias rather than
 * recording a preference.
 *
 * `behavior_pattern` is deliberately NOT in 0019's coach-readable kind list (mem_coach_rd), so a
 * portion prior stays between the athlete and the model. A coach seeing "consistently underestimates
 * portions" would read as a judgement about honesty; it is a fact about the camera.
 */
export function factsFromCorrection(kind, value) {
  const v = norm(value);
  switch (kind) {
    case 'portion':
      // half / three-quarters => the AI read HIGH. larger / double => it read LOW.
      if (v === 'half' || v === 'three-quarters') return [prior('portion_overread')];
      if (v === 'larger' || v === 'double') return [prior('portion_underread')];
      return [];
    case 'cooking':
      if (v === 'oil' || v === 'butter') return [prior('cooks_with_' + v)];
      return [];
    case 'drink':
    case 'side':
      return v && v !== 'none' ? [admitCandidate({ kind: 'favorite_food', value: v, confidence: 0.3, source: 'inferred_correction', evidence_n: 1 })] : [];
    default:
      return [];
  }
}

function prior(pattern) {
  return admitCandidate({ kind: 'behavior_pattern', value: pattern, confidence: 0.3, source: 'inferred_correction', evidence_n: 1 });
}

/** Accrue evidence: the same observation recurring raises confidence and the evidence count. */
export function promoteFact(existing, observation) {
  if (!existing) return observation;
  return {
    ...existing,
    evidence_n: (Number(existing.evidence_n) || 1) + 1,
    confidence: Math.min(1, (Number(existing.confidence) || 0.3) + 0.15),
  };
}

/** Two facts are the same fact when kind and normalized value match. */
export function sameFact(a, b) {
  return !!a && !!b && a.kind === b.kind && norm(a.value) === norm(b.value);
}

/**
 * Ranking for the bounded set handed to the model: safety first (it changes what may be said),
 * then calibration priors (they change the numbers), then taste. Within a tier, better-evidenced
 * facts win.
 */
const KIND_RANK = { allergy: 0, dislike: 1, behavior_pattern: 2, meal_timing: 3, favorite_food: 4, favorite_restaurant: 5 };
export function rankFacts(facts) {
  return (facts || []).slice().sort((a, b) => {
    const ka = KIND_RANK[a.kind] == null ? 9 : KIND_RANK[a.kind];
    const kb = KIND_RANK[b.kind] == null ? 9 : KIND_RANK[b.kind];
    if (ka !== kb) return ka - kb;
    const ea = Number(a.evidence_n) || 1, eb = Number(b.evidence_n) || 1;
    if (ea !== eb) return eb - ea;
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });
}

/** Confirmed avoid-list — ACTIVE safety facts only. Never includes pending ones. */
export function avoidFoodsFromFacts(facts) {
  const seen = new Set();
  for (const f of facts || []) {
    if (f && f.status === 'active' && isSafetyKind(f.kind)) {
      const v = norm(f.value);
      if (v) seen.add(v);
    }
  }
  return [...seen];
}
