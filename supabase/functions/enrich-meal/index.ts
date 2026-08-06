// OnStandard — enrich-meal Edge Function (Supabase / Deno).
//
// Fired best-effort by the client AFTER a meal logs (fire-and-forget; never blocks the photo flow).
// For each detected food the client couldn't ground against the curated table, this resolves the
// authoritative USDA/Open Food Facts macros and:
//   (a) warms food_cache (0021) — the learned store the grounder will consult for FUTURE meals, so
//       the second time this population logs "Chipotle chicken bowl" it grounds against real data;
//   (b) records the AI-estimate ↔ DB-truth pairing in food_enrichment_samples (0104) — the eval
//       corpus (AI-priority #7), de-identified (food name + macros only, no athlete/meal/photo).
//
// INVARIANT: this NEVER touches the logged meal or its score. Enrichment is forward-only — it makes
// future grounding better and measures drift; it does not re-grade a meal the athlete already saw.
//
// Resolve + ranking are shared with food-lookup via _shared/food-resolve.ts (one ranking, no drift).
// verify_jwt stays ON (default): only a signed-in user can fire it. Writes use the service role.
//
// Deploy: supabase functions deploy enrich-meal   (uses the same USDA_API_KEY secret as food-lookup)
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { resolveByQuery, productCacheKey } from '../_shared/food-resolve.ts';
import { clientIpFrom } from '../_shared/client-ip.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const USDA_API_KEY = Deno.env.get('USDA_API_KEY') ?? 'DEMO_KEY';
const MAX_FOODS = 8; // a plate is a handful of items; cap the batch so one call can't fan out unbounded

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

// Best-effort per-IP rate limit (mirrors food-lookup): a plate fires one call, so a normal user is
// far under this; it only blunts an abusive client from exhausting the shared USDA key.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(req: Request): boolean {
  const ip = clientIpFrom(req);
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) { rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS }); return false; }
  e.count++;
  return e.count > RL_MAX;
}

const nnInt = (x: unknown): number | null => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n >= 0 ? Math.min(5000, n) : null;
};

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (rateLimited(request)) return json({ ok: false, error: 'rate limited' }, 429);

  let req: { foods?: unknown; products?: unknown };
  try { req = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }

  // Accept [{ name, protein, kcal, carbs, fat }]; the client sends only the foods it COULDN'T
  // ground against the curated table (the gap cases), so we never waste a USDA call on a staple.
  const raw = Array.isArray(req.foods) ? req.foods : [];
  const seen = new Set<string>();
  const foods = raw
    .map((f) => (f && typeof f === 'object' ? f as Record<string, unknown> : {}))
    .map((f) => ({
      name: typeof f.name === 'string' ? f.name.trim().slice(0, 100) : '',
      ai: { protein: nnInt(f.protein), kcal: nnInt(f.kcal), carbs: nnInt(f.carbs), fat: nnInt(f.fat) },
    }))
    .filter((f) => f.name && f.name.length >= 2)
    .filter((f) => { const k = f.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_FOODS);
  // A call may carry gap FOODS, label-read PRODUCTS, or both — empty of both is a no-op.
  if (!foods.length && !(Array.isArray(req.products) && req.products.length)) {
    return json({ ok: true, enriched: 0 });
  }

  const sb = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
  if (!sb) return json({ ok: false, error: 'unavailable' }, 503);

  // ── PRODUCT CACHE WARMING (the packaged-product half of the accuracy loop, 2026-08-06). ──
  // The client sends the packaged items whose macros were READ off their label in this meal
  // (basis 'label' — a Core Power bottle with "42g" printed on it). Each is cached per-serving
  // under a normalized brand+product key (source 'product'; for that source, per100 holds
  // PER-SERVING macros — see productCacheKey). Next time this population logs the same product
  // with its label turned away, analyze-meal resolves it from here instead of guessing.
  // Label reads OVERWRITE an older cached row (upsert): a read claim is the freshest truth.
  const rawProducts = Array.isArray(req.products) ? req.products : [];
  const seenP = new Set<string>();
  let productsCached = 0;
  for (const p of rawProducts.slice(0, MAX_FOODS)) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    const key = productCacheKey(pr.brand, pr.product);
    if (!key || seenP.has(key)) continue;
    seenP.add(key);
    const per = (pr.per && typeof pr.per === 'object' ? pr.per : {}) as Record<string, unknown>;
    const perServing = {
      protein: nnInt(per.protein) ?? 0, kcal: nnInt(per.kcal) ?? 0,
      carbs: nnInt(per.carbs) ?? 0, fat: nnInt(per.fat) ?? 0,
    };
    // A cacheable read has real calories and at least one macro — junk rows would poison
    // every future resolution of this product.
    if (perServing.kcal <= 0 || perServing.protein + perServing.carbs + perServing.fat <= 0) continue;
    const name = typeof pr.product === 'string' && pr.product.trim()
      ? `${typeof pr.brand === 'string' ? pr.brand.trim() + ' ' : ''}${pr.product.trim()}`.slice(0, 120)
      : key;
    await sb.from('food_cache').upsert({
      source: 'product', key, name,
      serving: typeof pr.serving === 'string' ? pr.serving.slice(0, 80) : 'per package as consumed',
      per100: perServing, attribution: 'Label read (OnStandard vision)',
    }).then(() => { productsCached++; }, () => {});
  }

  let enriched = 0;
  for (const food of foods) {
    const key = food.name.toLowerCase();
    try {
      // Skip a food already in the cache (already learned) — no repeat USDA hit, still cheap.
      const { data: cached } = await sb.from('food_cache').select('key').eq('source', 'usda').eq('key', key).maybeSingle();
      if (cached) continue;
      const [top] = await resolveByQuery(food.name, USDA_API_KEY, 1);
      if (!top) continue;
      // (a) learned store — warms future grounding
      await sb.from('food_cache').upsert({
        source: 'usda', key, name: top.name, serving: top.serving, per100: top.per100, attribution: top.attribution,
      }).then(() => {}, () => {});
      // (b) eval corpus — de-identified AI-estimate ↔ DB-truth pairing
      await sb.from('food_enrichment_samples').insert({
        detected_name: food.name,
        ai_protein: food.ai.protein, ai_kcal: food.ai.kcal, ai_carbs: food.ai.carbs, ai_fat: food.ai.fat,
        db_name: top.name, db_per100: top.per100, source: top.source,
      }).then(() => {}, () => {});
      enriched++;
    } catch { /* best-effort per food; one bad lookup never fails the batch */ }
  }
  return json({ ok: true, enriched, productsCached });
});
