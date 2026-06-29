// AthleteOS — Restaurant Coach voice guard (pure TS, no RN / Supabase imports).
//
// The Restaurant Coach builds a goal-aware order from a curated menu DB; the only PROSE in its
// output is the `why` line on each RecommendedOrder ("Built for size: 42g protein and 850 calories
// to push toward your gain goal..."). When a model is configured it may reword that line in a
// warmer voice (see lib/ai rephraseOrders). The macros, price, item lines, and tags are the
// engine's ground truth and are never sent for rewrite. This module is the deterministic guard
// (sibling of nutritionMemoryVoice / macroGrounding): it accepts a reworded `why` ONLY when it
// provably preserves the original's numbers, and otherwise keeps the engine's `why`. Strict, by
// founder ruling: the multiset of numeric tokens must match EXACTLY (the engine rounds to ints).
import type { RecommendResult, RecommendedOrder } from './restaurantCoach';

/** The model's proposed rewrite of one order, keyed back to its slot ('primary' or an alt label). */
export interface RephrasedOrder {
  id: string;
  why: string;
}

/** Upper bound on a reworded `why` (chars), so a runaway generation can't bloat the card. */
const WHY_MAX = 300;

/** Every run of digits in a string, as integers, ascending (order-independent compare). */
function numericTokens(s: string): number[] {
  const m = s.match(/\d+/g);
  return (m ? m.map((t) => Number(t)) : []).sort((a, b) => a - b);
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether a proposed `why` is safe to show: non-empty after trimming, within the length cap, and
 * carrying exactly the same numbers as the engine's `why` (so no macro/price/portion figure baked
 * into the sentence can change). Strict — any add/drop/change of a number rejects the rewrite.
 */
export function orderRephraseIsSafe(original: RecommendedOrder, proposed: RephrasedOrder): boolean {
  const why = proposed.why?.trim() ?? '';
  if (!why || why.length > WHY_MAX) return false;
  return sameNumbers(numericTokens(original.why), numericTokens(why));
}

/**
 * Merge one model rewrite into one order. Returns a copy with the warmer `why` ONLY when safe;
 * otherwise returns the ORIGINAL object unchanged (same reference — used to detect what landed).
 * Everything that isn't prose — lines, totals, tags — is always the engine's.
 */
export function mergeRephrasedOrder(original: RecommendedOrder, proposed: RephrasedOrder | undefined): RecommendedOrder {
  if (!proposed || !orderRephraseIsSafe(original, proposed)) return original;
  return { ...original, why: proposed.why.trim() };
}

/** The orders to send for rewording, keyed: 'primary' + one per alternative label. Prose only. */
export function ordersToRephrase(result: RecommendResult): RephrasedOrder[] {
  return [
    { id: 'primary', why: result.primary.why },
    ...result.alternatives.map((a) => ({ id: a.label, why: a.order.why })),
  ];
}

/**
 * Apply a batch of model rewrites to a recommendation, matched by id ('primary' / alt label). Each
 * order is warmed only when a safe rewrite for its id exists; the engine still decides what orders
 * exist and in what order. Returns the SAME result object when nothing was safely warmed, so a
 * caller can detect "did AI actually change anything" with a reference check (next !== result).
 */
export function mergeRephrasedOrders(result: RecommendResult, proposed: RephrasedOrder[]): RecommendResult {
  const byId = new Map<string, RephrasedOrder>();
  for (const p of proposed) if (p && typeof p.id === 'string') byId.set(p.id, p);

  const primary = mergeRephrasedOrder(result.primary, byId.get('primary'));
  const alternatives = result.alternatives.map((a) => {
    const order = mergeRephrasedOrder(a.order, byId.get(a.label));
    return order === a.order ? a : { ...a, order };
  });

  const changed = primary !== result.primary || alternatives.some((a, i) => a !== result.alternatives[i]);
  return changed ? { ...result, primary, alternatives } : result;
}
