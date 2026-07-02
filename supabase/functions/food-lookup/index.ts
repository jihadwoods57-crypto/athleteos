// OnStandard — food-lookup Edge Function (Supabase / Deno).
//
// Resolves EXACT macros for a food, so a scanned barcode or a typed food name logs real numbers
// instead of a photo estimate:
//   * { barcode } -> Open Food Facts product lookup (packaged goods, e.g. a Core Power bottle).
//   * { query }   -> USDA FoodData Central search (generic + branded foods).
// Both normalize to macros PER 100 g + a printed serving; the app (core/foodSource.ts) scales to
// the serving and logs an EditableFood via the normal saveMeal path.
//
// Free data sources (no per-call cost): USDA is public domain (CC0), Open Food Facts is open
// (ODbL). Every resolved lookup is CACHED in the food_cache table (migration 0021) so repeat
// scans/searches are instant and never re-hit the external API.
//
// Deploy:
//   supabase secrets set USDA_API_KEY=<free key from api.data.gov>   # optional; DEMO_KEY works, rate-limited
//   supabase functions deploy food-lookup
//
// Fail-soft: any miss/error returns { found: false } and the app keeps working (photo estimate /
// manual entry). Holds no user data; the only auth is the standard Supabase gateway.
import { createClient } from 'npm:@supabase/supabase-js@^2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const USDA_API_KEY = Deno.env.get('USDA_API_KEY') ?? 'DEMO_KEY';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

interface MacroSet { protein: number; kcal: number; carbs: number; fat: number; }
interface FoodOut {
  found: true;
  name: string;
  serving: string | null;
  per100: MacroSet;
  source: 'off' | 'usda';
  attribution: string;
  cached?: boolean;
}

/** Non-negative finite number, else 0 (external data can be missing/junk). */
function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Normalize an Open Food Facts product into per-100g macros. Null if no usable macros. */
function fromOFF(product: Record<string, unknown> | undefined): FoodOut | null {
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
function fromUSDA(food: Record<string, unknown> | undefined): FoodOut | null {
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
const USDA_PENALTIES = [
  'oil', 'flour', 'leaves', 'powder', 'dehydrated', 'dried', 'chips', 'juice', 'roll', 'bread',
  'snacks', 'snack', 'babyfood', 'baby', 'candies', 'candy', 'cookies', 'cookie', 'nuggets',
  'nugget', 'breaded', 'tenders', 'tender', 'butter', 'canned', 'coated', 'fried', 'cake', 'pie',
  'sandwich', 'sauce', 'soup', 'pudding', 'cream', 'frozen', 'prepared',
  'deli', 'luncheon', 'seasoned', 'rotisserie', 'blueberry', 'strawberry', 'vanilla', 'chocolate',
  'flavored', 'honey',
];

function scoreUSDA(desc: string, query: string): number {
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
function usdaCandidates(foods: Array<Record<string, unknown>> | undefined, query: string): FoodOut[] {
  return (foods ?? [])
    .map((f, i) => ({ out: fromUSDA(f), sc: scoreUSDA(String(f?.description ?? ''), query) - i * 0.1 }))
    .filter((x): x is { out: FoodOut; sc: number } => x.out !== null)
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.out);
}

/** USDA repeats near-identical descriptions; keep only the first (best-ranked) of each name. */
function dedupeByName(items: FoodOut[]): FoodOut[] {
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

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'OnStandard/1.0 (nutrition app)' } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  let req: { barcode?: unknown; query?: unknown; refresh?: unknown };
  try {
    req = await request.json();
  } catch {
    return json({ found: false, error: 'bad request' }, 400);
  }

  const barcode = typeof req.barcode === 'string' ? req.barcode.replace(/\D/g, '') : '';
  const query = typeof req.query === 'string' ? req.query.trim() : '';
  const refresh = req.refresh === true; // skip the cache read + overwrite the row with a fresh lookup
  const source: 'off' | 'usda' = barcode ? 'off' : 'usda';
  const key = barcode || query.toLowerCase();
  if (!key) return json({ found: false, error: 'barcode or query required' }, 400);

  const sb = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
  const cacheWrite = (out: FoodOut) => {
    if (!sb) return Promise.resolve();
    return sb.from('food_cache')
      .upsert({ source, key, name: out.name, serving: out.serving, per100: out.per100, attribution: out.attribution })
      .then(() => {}, () => {}); // never let a cache write failure block the result
  };

  // ---- Barcode: one exact packaged product (cached; a scanned bottle is unambiguous). ----
  if (barcode) {
    // Cache read (service role; the client never touches food_cache directly).
    if (sb && !refresh) {
      try {
        const { data } = await sb.from('food_cache').select('name,serving,per100,source,attribution').eq('source', source).eq('key', key).maybeSingle();
        if (data) return json({ found: true, ...data, cached: true });
      } catch {
        // cache miss/unreachable -> fall through to a live lookup
      }
    }
    const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,nutriments,serving_size`);
    const out = data && data.status !== 0 ? fromOFF(data.product as Record<string, unknown> | undefined) : null;
    if (!out) return json({ found: false });
    await cacheWrite(out);
    return json(out);
  }

  // ---- Query: a RANKED LIST the athlete picks from. A plain term ("chicken breast") returns many
  // USDA variants; auto-picking the single right one is guesswork, so we surface the top matches and
  // let them choose theirs. Prefer the clean generic datasets (SR Legacy + Foundation); fall back to
  // Branded packaged foods only when there is no generic hit. Queries are always live (USDA is free),
  // so the picker never gets stuck on one stale cached auto-pick. ----
  const q = encodeURIComponent(query);
  const base = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(USDA_API_KEY)}&query=${q}`;
  let ranked = usdaCandidates((await fetchJson(`${base}&pageSize=25&dataType=${encodeURIComponent('SR Legacy,Foundation')}`))?.foods as Array<Record<string, unknown>> | undefined, query);
  if (!ranked.length) {
    ranked = usdaCandidates((await fetchJson(`${base}&pageSize=15&dataType=Branded`))?.foods as Array<Record<string, unknown>> | undefined, query);
  }
  const results = dedupeByName(ranked).slice(0, 6);
  if (!results.length) return json({ found: false });
  await cacheWrite(results[0]); // keep the auto-pick warm for the meal-log path that takes one result
  return json({ found: true, ...results[0], results });
});
