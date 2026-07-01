// OnStandard — Nutrition Memory voice guard (pure TS, no RN / Supabase imports).
//
// The memory insights in nutritionMemory.ts are COMPUTED from real logged data — they are the
// ground truth, and every number in them is earned. When a real model is configured it may
// rephrase those insights in a warmer coach voice (see lib/ai rephraseMemoryInsights). The
// model is ALLOWED to change wording; it is NEVER allowed to change a fact. This module is the
// deterministic guard that enforces that, the sibling of macroGrounding for prose: it accepts a
// rephrase ONLY when it provably preserves the original's numbers, and otherwise keeps the
// deterministic text. So a rephrased insight can read warmer, but its numbers are exactly the
// engine's — the model cannot drift, drop, or invent a figure and have it reach the athlete.
//
// "Strict" by founder ruling (2026-06-29): the multiset of numeric tokens must match EXACTLY.
// Any add, change, drop, or reorder of a number rejects the rephrase. The engine rounds every
// figure to an integer, so token matching on whole numbers is sufficient and unambiguous.
import type { MemoryInsight } from './nutritionMemory';

/** The model's proposed rewrite of a single insight: prose only, keyed back by id. */
export interface RephrasedInsight {
  /** Must match the original MemoryInsight.id; anything else is ignored. */
  id: string;
  headline: string;
  detail: string;
}

/** Upper bound on rephrased length (chars), so a runaway generation can't bloat the card. */
const HEADLINE_MAX = 80;
const DETAIL_MAX = 320;

/** Every run of digits in a string, as integers, in ascending order (order-independent compare). */
function numericTokens(s: string): number[] {
  const m = s.match(/\d+/g);
  return (m ? m.map((t) => Number(t)) : []).sort((a, b) => a - b);
}

/** Two number-multisets are identical (same values, same counts), order ignored. */
function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decide whether a proposed rephrase is safe to show. Strict: the rewrite must carry exactly
 * the same numbers (across headline + detail combined) as the original, both fields must be
 * non-empty after trimming, and neither may exceed its length cap. Combining the two fields
 * before comparing lets the model legitimately move a figure between headline and detail, while
 * still forbidding any change to the set of numbers as a whole.
 */
export function rephraseIsSafe(original: MemoryInsight, proposed: RephrasedInsight): boolean {
  const headline = proposed.headline?.trim() ?? '';
  const detail = proposed.detail?.trim() ?? '';
  if (!headline || !detail) return false;
  if (headline.length > HEADLINE_MAX || detail.length > DETAIL_MAX) return false;
  const before = numericTokens(`${original.headline} ${original.detail}`);
  const after = numericTokens(`${headline} ${detail}`);
  return sameNumbers(before, after);
}

/**
 * Merge one model rephrase into one insight. Returns a copy with the warmer headline/detail
 * ONLY when rephraseIsSafe; otherwise returns the original unchanged. Everything that isn't
 * prose — id, kind, tone, metric, rank — is ALWAYS carried from the original, so the model can
 * never touch the badge number, the color, or the ranking. The numbers in the prose are
 * guaranteed identical by the guard above.
 */
export function mergeRephrasedInsight(original: MemoryInsight, proposed: RephrasedInsight | undefined): MemoryInsight {
  if (!proposed || !rephraseIsSafe(original, proposed)) return original;
  return { ...original, headline: proposed.headline.trim(), detail: proposed.detail.trim() };
}

/**
 * Merge a batch of model rephrases into the deterministic insight list, matched by id. Order
 * and count of the returned list are the engine's (never the model's): each original is kept in
 * place, warmed only when a safe rephrase for its id exists. A rephrase for an unknown id is
 * ignored; a missing or unsafe one leaves that insight as deterministic ground truth. This is
 * the whole-list contract the AI seam relies on — the model rewords, the engine still decides
 * what exists and in what order.
 */
export function mergeRephrasedInsights(originals: MemoryInsight[], proposed: RephrasedInsight[]): MemoryInsight[] {
  const byId = new Map<string, RephrasedInsight>();
  for (const p of proposed) if (p && typeof p.id === 'string') byId.set(p.id, p);
  return originals.map((o) => mergeRephrasedInsight(o, byId.get(o.id)));
}
