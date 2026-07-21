// OnStandard — shared USDA FoodData Central + Open Food Facts resolver (Deno, no imports).
//
// Extracted verbatim from food-lookup/index.ts so BOTH the manual food-lookup endpoint AND the
// post-log enrich-meal background job resolve foods identically (one ranking, one normalization —
// no drift). Pure/normalization helpers + two high-level resolvers. No Supabase, no caching here;
// the caller owns the food_cache read/write so each endpoint keeps its own cache policy.
//
// Data sources (free, no per-call cost): USDA is public domain (CC0); Open Food Facts is open
// (ODbL). Fail-soft: any miss/error resolves to null and the caller degrades gracefully.

export interface MacroSet { protein: number; kcal: number; carbs: number; fat: number; }
export interface FoodOut {
  found: true;
  name: string;
  serving: string | null;
  per100: MacroSet;
  source: 'off' | 'usda';
  attribution: string;
  cached?: boolean;
}

/** Non-negative finite number, else 0 (external data can be missing/junk). */
export function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Normalize an Open Food Facts product into per-100g macros. Null if no usable macros. */
export function fromOFF(product: Record<string, unknown> | undefined): FoodOut | null {
  const n = (product?.nutriments ?? {}) as Record<string, unknown>;
  const per100: MacroSet = {
    protein: num(n['proteins_100g']),
    kcal: num(n['energy-kcal_100g'] ?? n['energy-kcal']),
    carbs: num(n['carbohydrates_100g']),
    fat: num(n['fat_100g']),
  };
  if (per100.kcal <= 0 && per100.protein <= 0) return null;
  const name = String(product?.product_name ?? '').trim();
  const serving = product?.serving_size ? String(product.serving_size) : null;
  return { found: true, name: name || 'Scanned product', serving, per100, source: 'off', attribution: 'Open Food Facts (ODbL)' };
}

/** Normalize a USDA FoodData Central search hit into per-100g macros. Null if no usable macros. */
export function fromUSDA(food: Record<string, unknown> | undefined): FoodOut | null {
  const byNum: Record<string, number> = {};
  for (const fn of (food?.foodNutrients ?? []) as Array<Record<string, unknown>>) {
    const k = String(fn?.nutrientNumber ?? (fn?.nutrient as Record<string, unknown> | undefined)?.number ?? '');
    if (k) byNum[k] = num(fn?.value);
  }
  // 203 protein, 204 fat, 205 carbs, 208 energy (kcal) — USDA values are per 100 g.
  const per100: MacroSet = { protein: byNum['203'] ?? 0, kcal: byNum['208'] ?? 0, carbs: byNum['205'] ?? 0, fat: byNum['204'] ?? 0 };
  if (per100.kcal <= 0) return null; // a real food has calories; drop incomplete USDA entries
  const name = String(food?.description ?? '').trim();
  const serving = food?.servingSize ? `${food.servingSize} ${String(food?.servingSizeUnit ?? 'g')}` : null;
  return { found: true, name: name || 'Food', serving, per100, source: 'usda', attribution: 'USDA FoodData Central (CC0)' };
}

/** Score a USDA generic result for a query: reward a description that leads with the query and is a
 *  raw/plain whole food; penalize derivative forms (oil, flour, powder, chips, leaves, ...) USDA
 *  surfaces for plain terms ("Oil, almond" for "almonds"). Higher is better. */
export const USDA_PENALTIES = [
  'oil', 'flour', 'leaves', 'powder', 'dehydrated', 'dried', 'chips', 'juice', 'roll', 'bread',
  'snacks', 'snack', 'babyfood', 'baby', 'candies', 'candy', 'cookies', 'cookie', 'nuggets',
  'nugget', 'breaded', 'tenders', 'tender', 'butter', 'canned', 'coated', 'fried', 'cake', 'pie',
  'sandwich', 'sauce', 'soup', 'pudding', 'cream', 'frozen', 'prepared',
  'deli', 'luncheon', 'seasoned', 'rotisserie', 'blueberry', 'strawberry', 'vanilla', 'chocolate',
  'flavored', 'honey',
];

export function scoreUSDA(desc: string, query: string): number {
  const d = desc.toLowerCase();
  const q = query.toLowerCase().trim();
  const q0 = (q.split(/\s+/)[0] ?? q).replace(/s$/, ''); // tolerate plural ("almonds" -> "almond")
  const first = (d.split(/[\s,]+/)[0] ?? '').replace(/s$/, '');
  let s = 0;
  if (d.startsWith(q)) s += 100;
  else if (first === q0 || first.startsWith(q0)) s += 40;
  if (/\braw\b/.test(d)) s += 25;
  // Penalize processed / derivative forms — but only when the word isn't part of the query itself
  // (so "peanut butter" or "banana bread" aren't self-penalized).
  for (const w of USDA_PENALTIES) {
    if (!q.includes(w) && new RegExp(`\\b${w}\\b`).test(d)) s -= 40;
  }
  return s;
}

/** Rank USDA search hits for a query, best first. A light index penalty preserves USDA's own
 *  relevance order as the tiebreak between equally-scored entries. Drops entries with no macros. */
export function usdaCandidates(foods: Array<Record<string, unknown>> | undefined, query: string): FoodOut[] {
  return (foods ?? [])
    .map((f, i) => ({ out: fromUSDA(f), sc: scoreUSDA(String(f?.description ?? ''), query) - i * 0.1 }))
    .filter((x): x is { out: FoodOut; sc: number } => x.out !== null)
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.out);
}

/** USDA repeats near-identical descriptions; keep only the first (best-ranked) of each name. */
export function dedupeByName(items: FoodOut[]): FoodOut[] {
  const seen = new Set<string>();
  const out: FoodOut[] = [];
  for (const it of items) {
    const k = it.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** Fetch JSON with a bounded timeout (fail-soft: any error/timeout → null). The timeout is the
 *  guard the inline food-lookup version lacked — a slow USDA never hangs a caller now. */
export async function fetchJson(url: string, timeoutMs = 6000): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'OnStandard/1.0 (nutrition app)' }, signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Resolve one packaged product by barcode → the single OFF match, or null. */
export async function resolveByBarcode(barcode: string): Promise<FoodOut | null> {
  const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,nutriments,serving_size`);
  return data && data.status !== 0 ? fromOFF(data.product as Record<string, unknown> | undefined) : null;
}

/** Resolve a food name → a ranked list of USDA matches (generic SR Legacy + Foundation first,
 *  Branded only as a fallback), deduped, top `limit`. Empty when nothing usable resolves. */
export async function resolveByQuery(query: string, usdaKey: string, limit = 6): Promise<FoodOut[]> {
  const q = encodeURIComponent(query);
  const base = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey)}&query=${q}`;
  let ranked = usdaCandidates((await fetchJson(`${base}&pageSize=25&dataType=${encodeURIComponent('SR Legacy,Foundation')}`))?.foods as Array<Record<string, unknown>> | undefined, query);
  if (!ranked.length) {
    ranked = usdaCandidates((await fetchJson(`${base}&pageSize=15&dataType=Branded`))?.foods as Array<Record<string, unknown>> | undefined, query);
  }
  return dedupeByName(ranked).slice(0, Math.max(1, limit));
}
