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
  if (per100.kcal <= 0 && per100.protein <= 0) return null;
  const name = String(food?.description ?? '').trim();
  const serving = food?.servingSize ? `${food.servingSize} ${String(food?.servingSizeUnit ?? 'g')}` : null;
  return { found: true, name: name || 'Food', serving, per100, source: 'usda', attribution: 'USDA FoodData Central (CC0)' };
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

  let req: { barcode?: unknown; query?: unknown };
  try {
    req = await request.json();
  } catch {
    return json({ found: false, error: 'bad request' }, 400);
  }

  const barcode = typeof req.barcode === 'string' ? req.barcode.replace(/\D/g, '') : '';
  const query = typeof req.query === 'string' ? req.query.trim() : '';
  const source: 'off' | 'usda' = barcode ? 'off' : 'usda';
  const key = barcode || query.toLowerCase();
  if (!key) return json({ found: false, error: 'barcode or query required' }, 400);

  // Cache read (service role; the client never touches food_cache directly).
  const sb = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
  if (sb) {
    try {
      const { data } = await sb.from('food_cache').select('name,serving,per100,source,attribution').eq('source', source).eq('key', key).maybeSingle();
      if (data) return json({ found: true, ...data, cached: true });
    } catch {
      // cache miss/unreachable -> fall through to a live lookup
    }
  }

  // Live lookup.
  let out: FoodOut | null = null;
  if (barcode) {
    const data = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,nutriments,serving_size`);
    if (data && data.status !== 0) out = fromOFF(data.product as Record<string, unknown> | undefined);
  } else {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(USDA_API_KEY)}&query=${encodeURIComponent(query)}&pageSize=3&dataType=${encodeURIComponent('Branded,Foundation,SR Legacy')}`;
    const data = await fetchJson(url);
    const foods = (data?.foods ?? []) as Array<Record<string, unknown>>;
    for (const f of foods) {
      out = fromUSDA(f);
      if (out) break;
    }
  }

  if (!out) return json({ found: false });

  // Cache write (best-effort).
  if (sb) {
    try {
      await sb.from('food_cache').upsert({ source, key, name: out.name, serving: out.serving, per100: out.per100, attribution: out.attribution });
    } catch {
      // never let a cache write failure block the result
    }
  }

  return json(out);
});
