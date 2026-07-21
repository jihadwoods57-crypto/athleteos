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
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { resolveByQuery } from '../_shared/food-resolve.ts';

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
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
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

  let req: { foods?: unknown };
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
  if (!foods.length) return json({ ok: true, enriched: 0 });

  const sb = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
  if (!sb) return json({ ok: false, error: 'unavailable' }, 503);

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
  return json({ ok: true, enriched });
});
