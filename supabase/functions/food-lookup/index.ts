// OnStandard — food-lookup Edge Function (Supabase / Deno).
//
// Resolves EXACT macros for a food, so a scanned barcode or a typed food name logs real numbers
// instead of a photo estimate:
//   * { barcode } -> Open Food Facts product lookup (packaged goods, e.g. a Core Power bottle).
//   * { query }   -> USDA FoodData Central search (generic + branded foods).
// Both normalize to macros PER 100 g + a printed serving; the app (core/foodSource.ts) scales to
// the serving and logs an EditableFood via the normal saveMeal path.
//
// The USDA/OFF resolve + normalization + ranking now live in _shared/food-resolve.ts so the
// post-log enrich-meal background job grounds identically (one ranking, no drift). This file owns
// the cache policy, rate limiting, and CORS; the resolver owns the data normalization.
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
import { resolveByBarcode, resolveByQuery, type FoodOut } from '../_shared/food-resolve.ts';

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

// Best-effort per-IP rate limit (same in-memory pattern as the paid functions). This endpoint
// was the ONLY one with no limiter at all: unbounded anon traffic could exhaust the shared USDA
// key (killing Search for everyone) and grow food_cache without bound. Per-instance; enough to
// blunt a single abusive client. Tunable via RATE_LIMIT_PER_MIN.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '30');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > RL_MAX;
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (rateLimited(request)) return json({ found: false, error: 'rate limited, slow down' }, 429);

  let req: { barcode?: unknown; query?: unknown; refresh?: unknown };
  try {
    req = await request.json();
  } catch {
    return json({ found: false, error: 'bad request' }, 400);
  }

  // Bound the inputs: no food name needs 100 chars, and a barcode is at most EAN-14.
  const barcode = typeof req.barcode === 'string' ? req.barcode.replace(/\D/g, '').slice(0, 14) : '';
  const query = typeof req.query === 'string' ? req.query.trim().slice(0, 100) : '';
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
    if (sb && !refresh) {
      try {
        const { data } = await sb.from('food_cache').select('name,serving,per100,source,attribution').eq('source', source).eq('key', key).maybeSingle();
        if (data) return json({ found: true, ...data, cached: true });
      } catch {
        // cache miss/unreachable -> fall through to a live lookup
      }
    }
    const out = await resolveByBarcode(barcode);
    if (!out) return json({ found: false });
    await cacheWrite(out);
    return json(out);
  }

  // ---- Query: a RANKED LIST the athlete picks from. Prefer the clean generic datasets; fall back
  // to Branded only when there is no generic hit. Queries are always live (USDA is free), so the
  // picker never gets stuck on one stale cached auto-pick. ----
  const results = await resolveByQuery(query, USDA_API_KEY, 6);
  if (!results.length) return json({ found: false });
  // Keep the auto-pick warm — but only for short, reusable queries: every novel query text is a
  // service-role row in food_cache, so long one-off strings would just grow the table forever.
  if (query.length <= 60) await cacheWrite(results[0]);
  return json({ found: true, ...results[0], results });
});
