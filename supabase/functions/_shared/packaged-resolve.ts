// OnStandard — packaged-product resolution for the FIRST read (Deno, shared).
//
// WHY. The first read of a packaged product used to carry the model's GUESS into the score even
// when the product was named exactly ("Core Power 42g chocolate, 14 fl oz") and real data was one
// free call away. enrich-meal runs after logging and is forbidden from touching the logged meal or
// its score, so nothing ever corrected that first number. analyze-meal now grounds a named
// packaged item BEFORE the read is returned, through the helpers here: USDA Branded first (one
// fetch), Open Food Facts text search as the fallback (one fetch).
//
// Everything here is pure except resolvePackagedProduct's two fetches, and the match rule is a
// plain function so a test can pin exactly what "confident" means. Fail-soft throughout: null
// means "leave the estimate exactly as the model read it". Data is free (USDA CC0, OFF ODbL).
//
// Shares fromUSDA / fromOFF / fetchJson with food-lookup and enrich-meal via food-resolve.ts, so
// the three endpoints normalize external data identically.

import { fetchJson, fromOFF, fromUSDA, num, type MacroSet } from './food-resolve.ts';

/** A resolved packaged product: macros PER SERVING as the label defines it, plus provenance. */
export interface PackagedHit {
  name: string;
  perServing: MacroSet;
  /** 'label' when the source carried the product's own label-serving values (OFF *_serving);
   *  'database' for per-100g data scaled by the printed serving size. */
  basis: 'label' | 'database';
  source: 'off' | 'usda';
  serving: string | null;
  /** 0..1: how much of the named product the candidate's text accounted for. */
  score: number;
}

const TOKEN_STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'with', 'in', 'x', 'fl', 'oz', 'ml', 'g', 'gram', 'grams', 'l',
  'bottle', 'bar', 'can', 'pack', 'packet', 'pouch', 'container', 'cup', 'box', 'bag', 'size',
  'flavor', 'flavored', 'flavour', 'original',
]);

const singular = (t: string) => t.replace(/ies$/, 'y').replace(/(?:es|s)$/, '');

/** Significant lowercase WORD tokens of a product/brand string, singularised, stop-words and
 *  numbers dropped. Package sizes ("14 fl oz", "2.12 oz") are noise: the same product is listed
 *  under several sizes and none of them changes what it is. */
export function productTokens(s: unknown): string[] {
  if (typeof s !== 'string') return [];
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((t) => t && !/^\d/.test(t))
    .map(singular)
    .filter((t) => t.length > 1 && !TOKEN_STOP.has(t));
}

/** The GRAM CLAIMS in a product string: "42g" -> "42". A 42g product must never match its 26g
 *  sibling; that substitution is the worst error this path can make, and the gram figure is the
 *  thing that tells them apart. Sizes in oz/ml/fl are not claims. */
export function claimNumbers(s: unknown): string[] {
  if (typeof s !== 'string') return [];
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/g)) out.push(m[1]);
  return out;
}

/**
 * THE MATCH RULE. A candidate is a confident match for (brand, product) when:
 *   * every brand token appears in the candidate text (brand is a hard gate when given);
 *   * every gram CLAIM of the product appears in the candidate (42g never matches 26g);
 *   * at least 60% of the product's word tokens appear (plural-tolerant, sizes ignored).
 * Returns the coverage score 0..1 (word tokens only), or 0 when a gate fails.
 */
export function packagedMatchScore(candidateText: string, brand: unknown, product: unknown): number {
  const hay = new Set(productTokens(candidateText));
  const hayClaims = new Set(claimNumbers(candidateText));
  const brandT = productTokens(brand);
  const prodT = productTokens(product);
  if (!prodT.length && !brandT.length) return 0;
  for (const b of brandT) if (!hay.has(b)) return 0;
  for (const n of claimNumbers(product)) if (!hayClaims.has(n)) return 0;
  const words = prodT.filter((t) => !brandT.includes(t));
  if (!words.length) return brandT.length ? 1 : 0;
  const hit = words.filter((w) => hay.has(w)).length;
  const score = hit / words.length;
  return score >= 0.6 ? score : 0;
}

/** How many of the product the athlete had, from the read's kitchen-units quantity ("2 bars",
 *  "1 bottle", "half a bar"). A SIZE ("14 fl oz") is one unit, not fourteen. Clamped to a range a
 *  single sitting can hold; 1 when unguessable. */
export function servingCountFrom(quantity: unknown): number {
  if (typeof quantity !== 'string') return 1;
  const q = quantity.trim().toLowerCase();
  if (!q) return 1;
  if (/^(half|1\/2|½)\b/.test(q)) return 0.5;
  const m = q.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?([a-z]+)?/);
  if (!m) return 1;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  // A measure is a size, not a count.
  if (/^(fl|oz|ml|g|gram|grams|l|cup|cups|tbsp|tsp|lb|lbs|kg)$/.test(unit)) return 1;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.25, Math.min(6, n));
}

/** Per-serving macros from per-100 values and a serving size in g or ml (treated alike). */
export function scalePer100(per100: MacroSet, servingSize: number): MacroSet | null {
  if (!Number.isFinite(servingSize) || servingSize <= 0 || servingSize > 2000) return null;
  const k = servingSize / 100;
  return { protein: per100.protein * k, kcal: per100.kcal * k, carbs: per100.carbs * k, fat: per100.fat * k };
}

/** Pick the best confident USDA Branded hit for a named product, or null. Pure. */
export function pickUsdaPackaged(foods: Array<Record<string, unknown>> | undefined, brand: unknown, product: unknown): PackagedHit | null {
  let best: PackagedHit | null = null;
  for (const f of foods ?? []) {
    if (!f || typeof f !== 'object') continue;
    const text = [f.description, f.brandName, f.brandOwner].filter((x) => typeof x === 'string').join(' ');
    const score = packagedMatchScore(text, brand, product);
    if (score <= 0) continue;
    const out = fromUSDA(f);
    if (!out) continue;
    const size = Number(f.servingSize);
    const perServing = scalePer100(out.per100, size);
    if (!perServing) continue;
    const unit = String(f.servingSizeUnit ?? 'g').toLowerCase().replace('grm', 'g').replace('mlt', 'ml');
    const hit: PackagedHit = {
      name: out.name, perServing, basis: 'database', source: 'usda',
      serving: `${size} ${unit}`, score,
    };
    if (!best || hit.score > best.score) best = hit;
  }
  return best;
}

/** Pick the best confident Open Food Facts search hit, or null. Prefers the product's own
 *  label-serving values (basis 'label'); falls back to per-100g scaled by serving_quantity. Pure. */
export function pickOffPackaged(products: Array<Record<string, unknown>> | undefined, brand: unknown, product: unknown): PackagedHit | null {
  let best: PackagedHit | null = null;
  for (const p of products ?? []) {
    if (!p || typeof p !== 'object') continue;
    const text = [p.product_name, p.brands].filter((x) => typeof x === 'string').join(' ');
    const score = packagedMatchScore(text, brand, product);
    if (score <= 0) continue;
    const n = (p.nutriments ?? {}) as Record<string, unknown>;
    const servingVals: MacroSet = {
      protein: num(n['proteins_serving']), kcal: num(n['energy-kcal_serving']),
      carbs: num(n['carbohydrates_serving']), fat: num(n['fat_serving']),
    };
    let perServing: MacroSet | null = null;
    let basis: 'label' | 'database' = 'label';
    if (servingVals.kcal > 0 && servingVals.protein + servingVals.carbs + servingVals.fat > 0) {
      perServing = servingVals;
    } else {
      const out = fromOFF(p);
      perServing = out ? scalePer100(out.per100, Number(p.serving_quantity)) : null;
      basis = 'database';
    }
    if (!perServing || perServing.kcal <= 0) continue;
    const hit: PackagedHit = {
      name: String(p.product_name ?? '').trim() || 'Packaged product', perServing, basis, source: 'off',
      serving: p.serving_size ? String(p.serving_size) : null, score,
    };
    if (!best || hit.score > best.score) best = hit;
  }
  return best;
}

export type JsonFetcher = (url: string, timeoutMs: number) => Promise<Record<string, unknown> | null>;

/**
 * Resolve one named packaged product: USDA Branded, then Open Food Facts. Each source is ONE
 * fetch with a short timeout. `fetches` reports how many network calls were spent so the caller
 * can hold a per-read budget (`maxFetches` caps this call's own spend). Null on any miss or
 * failure, never a throw.
 */
export async function resolvePackagedProduct(
  brand: unknown, product: unknown, usdaKey: string,
  opts: { timeoutMs?: number; fetcher?: JsonFetcher; maxFetches?: number } = {},
): Promise<{ hit: PackagedHit | null; fetches: number }> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const get = opts.fetcher ?? fetchJson;
  const maxFetches = opts.maxFetches ?? 2;
  const query = `${typeof brand === 'string' ? brand : ''} ${typeof product === 'string' ? product : ''}`.trim().slice(0, 100);
  if (query.length < 3) return { hit: null, fetches: 0 };
  let fetches = 0;
  const q = encodeURIComponent(query);
  try {
    if (fetches < maxFetches) {
      fetches++;
      const data = await get(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey)}&query=${q}&pageSize=10&dataType=Branded`, timeoutMs);
      const hit = pickUsdaPackaged(data?.foods as Array<Record<string, unknown>> | undefined, brand, product);
      if (hit) return { hit, fetches };
    }
    if (fetches < maxFetches) {
      fetches++;
      const data = await get(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,nutriments,serving_size,serving_quantity`, timeoutMs);
      const hit = pickOffPackaged(data?.products as Array<Record<string, unknown>> | undefined, brand, product);
      if (hit) return { hit, fetches };
    }
  } catch {
    // any failure: the model's estimate stands
  }
  return { hit: null, fetches };
}
