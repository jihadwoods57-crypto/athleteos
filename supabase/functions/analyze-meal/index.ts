// OnStandard — analyze-meal Edge Function (Supabase / Deno).
// Holds ANTHROPIC_API_KEY server-side and runs Claude vision. The app never sees the key.
// THREE modes, dispatched on the request `mode` field:
//   * 'meal'  (default) — read a plate photo, ESTIMATE macros, score for the goal (MealResult).
//   * 'label'          — transcribe a Nutrition Facts panel EXACTLY (LabelFacts). The numbers
//                        are read, not estimated, so this path does no grounding/guessing.
//   * 'memory'         — reword the app's COMPUTED memory insights in a warmer coach voice. The
//                        numbers are the app's ground truth: the model may only rephrase, never
//                        change a figure, and the client re-checks every number before showing it.
//   * 'order'          — reword the Restaurant Coach order explanations (`why`) in a warmer voice.
//                        Same contract as 'memory': prose only, every number preserved exactly,
//                        client re-verifies before showing.
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy analyze-meal
// Then set EXPO_PUBLIC_SUPABASE_URL + ANON_KEY in the app (.env) and isAiConfigured flips on.
//
// Model is configurable via the ANTHROPIC_MODEL secret; defaults to claude-sonnet-4-6
// (the right cost/latency tier for high-volume per-meal vision; claude-opus-4-8 is the
// higher tier). MEAL macros from the model are ESTIMATES — ground them against a food
// database (see groundMacros) before you trust them for scoring. LABEL numbers are read off
// the panel verbatim, so they need no grounding.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

// Per-athlete daily ceiling on the PAID vision calls (meal + label). This bounds a day's
// spend and stops a single athlete spamming photos, where the per-minute IP limit can't
// (it mis-buckets a whole team behind one school-wifi IP and resets on cold start). Backed
// by the ai_usage_daily counter (migration 0015). Tunable via DAILY_ANALYSIS_CAP; 40/day is
// generous for real use (~4-8 meals + the odd label scan) and slams abuse. Over the cap the
// function returns 429 and the app shows the free deterministic result (analyzeMeal/
// analyzeLabel already fall back on any error), so logging never blocks.
const DAILY_CAP = Number(Deno.env.get('DAILY_ANALYSIS_CAP') ?? '40');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Resolve the signed-in athlete from the caller's bearer token, or null. Null means an
// anonymous/preview call (the shared anon key, or backend not wired) — those skip the
// per-athlete cap and stay governed by the per-minute IP limit alone. Verifying via
// auth.getUser() (not a raw JWT decode) means a forged `sub` can't buy extra calls.
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === SUPABASE_ANON_KEY) return null;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null; // never let an auth hiccup block a legit log
  }
}

// Atomically claim one slot for today. Returns true if allowed, false if the athlete is at
// their daily cap. Fail-OPEN: if the counter is unreachable (infra gap / RPC error), allow
// the call — logging must never break, and the per-minute IP limit still blunts abuse.
async function withinDailyCap(userId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return true;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await sb.rpc('claim_ai_usage', { p_user: userId, p_limit: DAILY_CAP });
    if (error) return true;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.allowed !== false;
  } catch {
    return true;
  }
}

// Security hardening (audit G4). CORS: reflect the request Origin ONLY if it's on the allowlist.
// A native app sends no Origin header (and there's no browser to enforce CORS for it), so it's
// allowed; a browser Origin that isn't on the list gets no Access-Control-Allow-Origin, so the
// browser blocks the response. Set ALLOWED_ORIGINS to a comma-separated list of your web origins
// (e.g. "https://app.onstandard.app"); leave unset for native-only.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS; // native app, no browser CORS
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS; // unknown browser origin -> no ACAO, the browser blocks the read
}

// Best-effort per-IP rate limit so the paid Anthropic endpoint can't be hammered. In-memory and
// per-instance (resets on cold start, not shared across instances) — enough to blunt a single
// abusive client; a production-grade distributed limit needs a shared store (e.g. Upstash Redis).
// Tunable via RATE_LIMIT_PER_MIN.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
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

interface MemoryInsightIn {
  id: string;
  kind?: string;
  tone?: string;
  headline: string;
  detail: string;
  metric?: string;
}

interface OrderIn {
  id: string;
  why: string;
}

interface AnalyzeReq {
  /** 'meal' estimates a plate; 'label' transcribes a panel; 'memory'/'order' reword prose. */
  mode?: 'meal' | 'label' | 'memory' | 'order';
  mealType: 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';
  goal: string | null;
  description?: string;
  photoBase64?: string;
  /** For mode 'memory': the deterministic insights to reword (prose only is returned). */
  insights?: MemoryInsightIn[];
  /** For mode 'order': the recommended-order explanations to reword (prose only is returned). */
  orders?: OrderIn[];
}

// The exact shape the app renders (src/core MealResult). The model fills this via a
// forced tool call so the response is always valid structured data.
const MEAL_TOOL = {
  name: 'report_meal_analysis',
  description: 'Report the structured analysis of the athlete meal photo.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short dish name, e.g. "Chicken, Rice & Broccoli".' },
      quality: { type: 'integer', minimum: 0, maximum: 100, description: 'Meal quality 0-100 for an athlete with the stated goal.' },
      protein: { type: 'integer', description: 'Estimated grams of protein.' },
      kcal: { type: 'integer', description: 'Estimated calories.' },
      carbs: { type: 'integer', description: 'Estimated grams of carbohydrate.' },
      fat: { type: 'integer', description: 'Estimated grams of fat.' },
      detected: { type: 'array', items: { type: 'string' }, description: 'Foods identified in the photo.' },
      note: { type: 'string', description: 'One coach-voiced sentence tying this meal to the athlete goal. No hype, no em dashes.' },
    },
    required: ['name', 'quality', 'protein', 'kcal', 'carbs', 'fat', 'detected', 'note'],
  },
} as const;

const SYSTEM = `You are the OnStandard nutrition coach: a sharp, encouraging sports nutritionist for
serious high-school and college athletes (ages 13-22). Read the meal photo, identify the foods,
estimate macros, score the meal for THIS athlete's goal, and give one honest coach-voiced sentence.
Voice: direct, motivating, precise, never hype, never cutesy. Safety: never give extreme or
restrictive advice, never frame food as good/bad in a way that could fuel disordered eating; coach
toward fueling performance. Numbers are estimates; be reasonable. No em dashes in any text.
Always answer by calling report_meal_analysis.`;

// The exact shape src/core LabelFacts expects. The model transcribes the printed panel PER
// SERVING; it does not estimate. Required fields are the four macros + ingredients; the rest
// are filled only when actually printed.
const LABEL_TOOL = {
  name: 'report_label_facts',
  description: 'Report the Nutrition Facts panel exactly as printed, per serving.',
  input_schema: {
    type: 'object',
    properties: {
      productName: { type: 'string', description: 'Product name from the packaging, if visible. Omit if unknown.' },
      servingSize: { type: 'string', description: 'Serving size exactly as printed, e.g. "1 bar (60g)". Omit if not shown.' },
      servingsPerContainer: { type: 'number', description: 'Servings per container, if printed.' },
      calories: { type: 'integer', description: 'Calories PER SERVING, as printed.' },
      protein: { type: 'integer', description: 'Grams of protein per serving, as printed.' },
      carbs: { type: 'integer', description: 'Grams of total carbohydrate per serving, as printed.' },
      fat: { type: 'integer', description: 'Grams of total fat per serving, as printed.' },
      sugar: { type: 'integer', description: 'Grams of total sugars per serving, if printed.' },
      fiber: { type: 'integer', description: 'Grams of dietary fiber per serving, if printed.' },
      sodium: { type: 'integer', description: 'Milligrams of sodium per serving, if printed.' },
      ingredients: { type: 'array', items: { type: 'string' }, description: 'The ingredient list in printed order, each ingredient a separate string. Empty array if no ingredient list is visible.' },
    },
    required: ['calories', 'protein', 'carbs', 'fat', 'ingredients'],
  },
} as const;

const LABEL_SYSTEM = `You read Nutrition Facts labels for OnStandard. Transcribe the panel EXACTLY as
printed, PER SERVING. This is transcription, not estimation: report only what you can read. If a
value is not visible, omit that field rather than guessing (use 0 only if the label literally prints
0). Read the ingredient list verbatim, in order, splitting on commas into separate entries; drop
parenthetical sub-ingredients only if unreadable. Do not editorialize or add advice. Always answer
by calling report_label_facts.`;

// The shape the app expects back for mode 'memory': prose only, keyed by id. The model rewords
// headline + detail; it returns nothing else. The CLIENT (core/nutritionMemoryVoice.ts) verifies
// every number is preserved before showing any of it, so the numbers can never drift here.
const MEMORY_TOOL = {
  name: 'report_memory_voice',
  description: 'Return the rephrased insights, prose only, one entry per input id.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The exact id of the input insight being rephrased.' },
            headline: { type: 'string', description: 'Rephrased short headline. Keep every number identical to the input.' },
            detail: { type: 'string', description: 'Rephrased one-to-two sentence detail. Keep every number identical to the input.' },
          },
          required: ['id', 'headline', 'detail'],
        },
      },
    },
    required: ['insights'],
  },
} as const;

const MEMORY_SYSTEM = `You are the OnStandard nutrition coach giving an athlete a warm, human read on their
own logged-eating trends. You are handed insights the app already COMPUTED from real data. Your only
job is to reword each one in a warmer, more personal coach voice. Hard rules: keep EVERY number
exactly as given (never change, add, or drop a figure or unit); never invent a fact, food, day count,
or claim that is not in the input; keep the same meaning and the same good/bad direction; one or two
short sentences per insight; direct and encouraging, never hype, never cutesy, no em dashes. Return
one entry per input id, with its id unchanged, by calling report_memory_voice.`;

function memoryContent(req: AnalyzeReq): unknown[] {
  const items = (req.insights ?? []).map((i) => ({ id: i.id, headline: i.headline, detail: i.detail, metric: i.metric }));
  return [{
    type: 'text',
    text: `Reword these insights in a warmer coach voice, keeping every number exactly. Return one entry per id.\n\n${JSON.stringify(items, null, 2)}`,
  }];
}

// Mode 'order': reword the Restaurant Coach explanations. Same shape/contract as memory but a single
// `why` string per order. The CLIENT (core/restaurantCoachVoice.ts) re-verifies every number before
// showing any of it, so macros/prices can never drift here.
const ORDER_TOOL = {
  name: 'report_order_voice',
  description: 'Return the reworded order explanations, prose only, one entry per input id.',
  input_schema: {
    type: 'object',
    properties: {
      orders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The exact id of the input order being reworded.' },
            why: { type: 'string', description: 'Reworded one-to-two sentence explanation. Keep every number identical to the input.' },
          },
          required: ['id', 'why'],
        },
      },
    },
    required: ['orders'],
  },
} as const;

const ORDER_SYSTEM = `You are the OnStandard nutrition coach telling an athlete why a restaurant order fits
their goal. You are handed explanations the app already COMPUTED from a menu database. Your only job is
to reword each one in a warmer, more personal coach voice. Hard rules: keep EVERY number exactly as given
(never change, add, or drop a gram, calorie, or dollar figure); never invent a food, claim, or number not
in the input; keep the same meaning and goal framing; one or two short sentences per order; direct and
encouraging, never hype, never cutesy, no em dashes. Return one entry per input id, with its id unchanged,
by calling report_order_voice.`;

function orderContent(req: AnalyzeReq): unknown[] {
  const items = (req.orders ?? []).map((o) => ({ id: o.id, why: o.why }));
  return [{
    type: 'text',
    text: `Reword these order explanations in a warmer coach voice, keeping every number exactly. Return one entry per id.\n\n${JSON.stringify(items, null, 2)}`,
  }];
}

function userContent(req: AnalyzeReq): unknown[] {
  const blocks: unknown[] = [];
  if (req.photoBase64) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: req.photoBase64 },
    });
  }
  const goal = req.goal ? `Athlete goal: ${req.goal}.` : 'Athlete goal: general athletic development.';
  const desc = req.description ? ` Athlete note: ${req.description}.` : '';
  blocks.push({
    type: 'text',
    text: `${goal} Meal slot: ${req.mealType}.${desc} Analyze the meal${req.photoBase64 ? ' in the photo' : ' (no photo provided; infer a typical ' + req.mealType.toLowerCase() + ')'} and report it.`,
  });
  return blocks;
}

function labelContent(req: AnalyzeReq): unknown[] {
  const blocks: unknown[] = [];
  if (req.photoBase64) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: req.photoBase64 },
    });
  }
  blocks.push({
    type: 'text',
    text: 'Transcribe this Nutrition Facts panel exactly as printed, per serving, and report it. Read the ingredient list verbatim.',
  });
  return blocks;
}

/** Macro grounding now lives CLIENT-SIDE in src/core/macroGrounding.ts (groundMealResult),
 *  next to the scoring authority and the curated food DB, so it's unit-tested and can't drift
 *  from the DB. The function returns the model's raw estimate + detected foods; the app bounds
 *  the macros (food-DB plausibility + Atwater consistency) before they touch the score. This
 *  passthrough is kept as the seam in case server-side grounding is ever added. */
function groundMacros<T>(analysis: T): T {
  return analysis;
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  if (rateLimited(request)) return new Response(JSON.stringify({ error: 'rate limited, slow down' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return new Response(JSON.stringify({ error: 'server not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  let req: AnalyzeReq;
  try {
    req = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const isLabel = req?.mode === 'label';
  const isMemory = req?.mode === 'memory';
  const isOrder = req?.mode === 'order';

  // Input guards: reject an oversized/missing photo before spending an Anthropic call.
  // A base64 JPEG over ~8MB raw (~6MB image) is almost certainly abuse and would risk a
  // Deno timeout / token burn; cap it.
  if (typeof req.photoBase64 === 'string' && req.photoBase64.length > 8_000_000) {
    return new Response(JSON.stringify({ error: 'photo too large' }), { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (isMemory) {
    // Rewording needs at least one insight, and no more than a sane cap (memory shows ~6).
    if (!Array.isArray(req.insights) || req.insights.length === 0) {
      return new Response(JSON.stringify({ error: 'insights required for memory rephrase' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (req.insights.length > 12 || !req.insights.every((i) => i && typeof i.id === 'string' && typeof i.headline === 'string' && typeof i.detail === 'string')) {
      return new Response(JSON.stringify({ error: 'bad insights' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  } else if (isOrder) {
    // Rewording needs at least one order, and no more than a sane cap (primary + a few alternatives).
    if (!Array.isArray(req.orders) || req.orders.length === 0) {
      return new Response(JSON.stringify({ error: 'orders required for order rephrase' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (req.orders.length > 8 || !req.orders.every((o) => o && typeof o.id === 'string' && typeof o.why === 'string')) {
      return new Response(JSON.stringify({ error: 'bad orders' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  } else if (isLabel) {
    // A label scan is pure transcription — it MUST have the panel image; nothing to read otherwise.
    if (typeof req.photoBase64 !== 'string' || !req.photoBase64) {
      return new Response(JSON.stringify({ error: 'photo required for label scan' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  } else if (typeof req?.mealType !== 'string' || !req.mealType.trim()) {
    // The meal prompt needs the slot (and can infer a typical meal when no photo is sent).
    return new Response(JSON.stringify({ error: 'mealType required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Per-athlete daily cap on the paid photo calls (meal + label). Memory/order are cheap text
  // rewrites and don't count. Enforced only for signed-in athletes; anonymous/preview traffic
  // stays covered by the per-minute IP limit above. Checked after the input guards so a
  // malformed request never burns a slot.
  const countsAgainstDailyCap = !isMemory && !isOrder;
  if (countsAgainstDailyCap) {
    const userId = await resolveUserId(request);
    if (userId && !(await withinDailyCap(userId))) {
      return new Response(JSON.stringify({ error: 'daily analysis limit reached' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }

  const system = isMemory ? MEMORY_SYSTEM : isOrder ? ORDER_SYSTEM : isLabel ? LABEL_SYSTEM : SYSTEM;
  const tool = isMemory ? MEMORY_TOOL : isOrder ? ORDER_TOOL : isLabel ? LABEL_TOOL : MEAL_TOOL;
  const content = isMemory ? memoryContent(req) : isOrder ? orderContent(req) : isLabel ? labelContent(req) : userContent(req);

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content }],
    });
    const used = msg.content.find((b) => b.type === 'tool_use');
    if (!used || used.type !== 'tool_use') throw new Error('no structured output');
    // Label facts + memory/order prose are returned as-is (the CLIENT bounds the numbers); meal
    // macros pass through groundMacros.
    const result = isLabel || isMemory || isOrder ? used.input : groundMacros(used.input);
    return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
