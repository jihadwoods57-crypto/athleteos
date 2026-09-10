// OnStandard — ground the packaged items of a meal report before it is scored (Deno, shared).
//
// The orchestration half of packaged-resolve.ts: which items qualify, how many lookups a single
// read may spend, how a hit is written back onto the item, and the totals recompute that keeps the
// sum-to-totals invariant (the per-food macros MUST add up to the meal totals; the app subtracts a
// food's numbers when the athlete removes it). Pure apart from the injected resolver, so the
// analyze-meal behaviour is testable without a network: the cap, the untouched-on-failure rule and
// the recompute are all pinned in packaged-grounding.test.ts.
//
// HARD RULES.
//   * At most MAX_LOOKUPS network calls per read, whatever the plate holds.
//   * Any failure, timeout or miss leaves the item EXACTLY as the model read it. Grounding can
//     never fail the read.
//   * Only an item the model itself called a packaged ESTIMATE with a named product qualifies. A
//     label read ('label'), a product-cache hit ('database') and prepared food are never touched.

import type { PackagedHit } from './packaged-resolve.ts';
import { servingCountFrom } from './packaged-resolve.ts';

export const MAX_LOOKUPS = 3;

export type PackagedResolver = (
  brand: unknown, product: unknown, opts: { maxFetches: number },
) => Promise<{ hit: PackagedHit | null; fetches: number }>;

export interface GroundingReport {
  input: Record<string, unknown>;
  /** Items whose macros were replaced by resolved data. */
  grounded: string[];
  /** Items attempted but not confidently resolved (name), for the log. */
  missed: string[];
  /** Network calls spent. */
  lookups: number;
}

const nn = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Does this item qualify: a packaged product the model only ESTIMATED, with a product named. */
export function groundable(it: unknown): it is Record<string, unknown> {
  if (!it || typeof it !== 'object') return false;
  const d = it as Record<string, unknown>;
  if (d.kind !== 'packaged') return false;
  if (d.basis !== 'estimate' && d.basis !== undefined) return false;
  // A label the model READ off the packaging outranks any database: those numbers are a
  // transcription, and repairMealReport already pins the item to them.
  if (d.labelClaims && typeof d.labelClaims === 'object' && Object.keys(d.labelClaims as object).length) return false;
  const named = (typeof d.product === 'string' && d.product.trim().length >= 3)
    || (typeof d.brand === 'string' && d.brand.trim().length >= 2 && typeof d.name === 'string' && d.name.trim().length >= 3);
  return named;
}

/** Meal totals re-derived from the items, EXACTLY, once every item carries macros. Items are the
 *  authority (the client subtracts an item's numbers on delete), so a grounded item changes the
 *  totals by precisely its delta and nothing else. */
export function recomputeTotals(input: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(input.detected) ? (input.detected as Array<Record<string, unknown>>) : [];
  const withMacros = items.filter((it) => it && typeof it === 'object'
    && nn(it.protein) + nn(it.kcal) + nn(it.carbs) + nn(it.fat) > 0);
  if (!withMacros.length) return input;
  const out = { ...input };
  for (const k of ['protein', 'carbs', 'fat', 'kcal'] as const) {
    out[k] = Math.round(withMacros.reduce((s, it) => s + nn(it[k]), 0));
  }
  return out;
}

/**
 * Ground every qualifying packaged item, in plate order, within the lookup budget. Returns a NEW
 * input (items copied); the caller's object is never mutated, so a thrown resolver can be caught
 * upstream with the original read intact.
 */
export async function groundPackagedItems(
  raw: Record<string, unknown>,
  resolve: PackagedResolver,
  opts: { maxLookups?: number } = {},
): Promise<GroundingReport> {
  const maxLookups = opts.maxLookups ?? MAX_LOOKUPS;
  const items: unknown[] = Array.isArray(raw.detected)
    ? (raw.detected as unknown[]).map((it) => (it && typeof it === 'object' ? { ...(it as Record<string, unknown>) } : it))
    : [];
  const report: GroundingReport = { input: { ...raw, detected: items }, grounded: [], missed: [], lookups: 0 };
  if (!items.length) return report;

  for (const it of items) {
    if (report.lookups >= maxLookups) break;
    if (!groundable(it)) continue;
    const d = it;
    const before = { ...d };
    const product = typeof d.product === 'string' && d.product.trim() ? d.product : d.name;
    const label = typeof d.name === 'string' ? d.name : String(product);
    try {
      const { hit, fetches } = await resolve(d.brand, product, { maxFetches: maxLookups - report.lookups });
      report.lookups += Math.max(0, Math.min(maxLookups - report.lookups, Number(fetches) || 0));
      if (!hit || !(hit.perServing.kcal > 0)) { report.missed.push(label); continue; }
      const n = servingCountFrom(d.quantity);
      d.protein = Math.round(hit.perServing.protein * n);
      d.kcal = Math.round(hit.perServing.kcal * n);
      d.carbs = Math.round(hit.perServing.carbs * n);
      d.fat = Math.round(hit.perServing.fat * n);
      d.basis = hit.basis;
      d.confidence = 'high';
      d.groundedFrom = hit.source;
      report.grounded.push(label);
    } catch {
      // Never let grounding fail the read: put the item back exactly as it was.
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, before);
      report.missed.push(label);
    }
  }

  if (report.grounded.length) report.input = recomputeTotals(report.input);
  return report;
}
