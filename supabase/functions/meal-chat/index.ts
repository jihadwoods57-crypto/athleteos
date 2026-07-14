// OnStandard — meal-chat Edge Function. The Team Discussion's AI half.
//
// Authority boundary (doc-05 discipline, same as assist): the model DISCUSSES the
// deterministic context the client hands it — it never fetches coaching data, never
// computes or alters a number, and may only repeat figures already present in the
// provided context. The function's only reads are AUTHORIZATION: an RLS-scoped select
// (caller's JWT) proving the meal belongs to the caller. On success the reply is
// persisted into meal_comments as role 'ai' via the service role — 0046 deliberately
// forbids clients from writing 'ai' rows, so AI messages can never be forged.
//
// Spend caps: BOTH ceilings are keyed counters on claim_ai_usage_key (0030) — a per-athlete
// daily budget (`meal_chat:<uid>`, MEAL_CHAT_DAILY_CAP, default 10) and a global daily bill
// backstop ('meal_chat_global', MEAL_CHAT_GLOBAL_CAP, default 2000). The per-athlete budget
// is deliberately NOT the shared analyze-meal claim_ai_usage counter: chat questions and
// photo analyses are metered independently. Both fail open, per the assist/analyze-meal
// discipline (an un-applied migration never blocks a legit question).
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Math.max(1, Math.floor(Number(Deno.env.get('MEAL_CHAT_DAILY_CAP') ?? '10')) || 10);
const GLOBAL_CAP = Math.max(1, Math.floor(Number(Deno.env.get('MEAL_CHAT_GLOBAL_CAP') ?? '2000')) || 2000);
const CONTEXT_MAX = 8192;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Keyed daily claim against ai_usage_key_daily (migration 0030: claim_ai_usage_key(p_key text,
// p_limit int) returns (allowed, used); security definer, execute granted to service_role only,
// so both calls go through the service-role client). Both meal-chat ceilings ride this helper,
// with `failOpen` deciding what an unreachable counter means (audit 2026-07-11 P2):
//   * per-athlete: key `meal_chat:<uid>`, limit DAILY_CAP, failOpen=true — an infra hiccup
//     never blocks a legit question. Deliberately an INDEPENDENT keyed counter, NOT the shared
//     analyze-meal claim_ai_usage (ai_usage_daily) counter, so chat questions and photo
//     analyses are separate per-athlete budgets;
//   * global: key 'meal_chat_global', limit GLOBAL_CAP, failOpen=false — the hard backstop on
//     the bill (the anon key is public) must hold even when the counter is down.
async function withinKeyCap(key: string, limit: number, failOpen = true): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return failOpen;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await sb.rpc('claim_ai_usage_key', { p_key: key, p_limit: limit });
    if (error) return failOpen;
    const row = Array.isArray(data) ? data[0] : data;
    return row?.allowed !== false;
  } catch {
    return failOpen;
  }
}

// [COPIED VERBATIM from assist/index.ts] CORS allowlist: reflect the request Origin ONLY
// if it's on the allowlist. A native app sends no Origin header, so it's allowed; a
// browser Origin that isn't on the list gets no Access-Control-Allow-Origin.
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

// [COPIED VERBATIM from assist/index.ts] Best-effort per-IP rate limit (mirrors
// analyze-meal), so the paid endpoint can't be hammered.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '30');
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

const REPLY_TOOL = {
  name: 'reply',
  description: 'Reply to the athlete inside their meal thread.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Coach-voiced reply, 150 words max, plain prose, no em dashes. Reference only numbers present in the provided context. Encourage consistency first; educate, never shame.' },
    },
    required: ['message'],
  },
} as const;

const SYSTEM = `You are the OnStandard AI Nutritionist inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Coach voice: specific, encouraging, practical. Consistency is praised before choices are critiqued. Never shame food, weight, or a late log.
3. When coach guidance appears in the context, defer to it explicitly.
4. Answer the athlete's question for THEIR goal and plan, not generic nutrition advice.
5. 150 words maximum. No em dashes. No markdown headers.`;

function bad(status: number, error: string, cors: Record<string, string>) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return bad(405, 'bad_request', cors);
  try {
    if (rateLimited(req)) return bad(429, 'limit', cors);

    const body = await req.json().catch(() => null);
    const mealId = body?.mealId;
    // Coach-support mode (WS4d, founder-ratified 2/3/1): after the coach comments, the AI may
    // add AT MOST ONE short supporting message per meal — and only when the coach's message is
    // substantive (a question or a nutrition point), never on every post.
    const coachSupport = body?.coachSupport === true;
    const question = String((coachSupport ? body?.coachText : body?.question) ?? '').trim().slice(0, 500);
    const context = body?.context;
    if (!mealId || !question || !context) return bad(400, 'bad_request', cors);
    if (JSON.stringify(context).length > CONTEXT_MAX) return bad(400, 'bad_request', cors);

    // ---- authorization (RLS does the work) ----
    // Athlete mode: the caller must OWN the meal. Coach mode: the RLS-scoped select succeeding
    // for a non-owner proves can_view (linked coach/staff); the athlete row id comes from the DB.
    const auth = req.headers.get('authorization') ?? '';
    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return bad(401, 'unauthorized', cors);
    const { data: mealRow } = await userClient.from('meals').select('id, athlete_id').eq('id', mealId).maybeSingle();
    if (!mealRow) return bad(403, 'unauthorized', cors);
    if (coachSupport ? mealRow.athlete_id === callerId : mealRow.athlete_id !== callerId) return bad(403, 'unauthorized', cors);

    const service = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    if (coachSupport) {
      // Selective: only back a substantive coach message; and only once per meal, ever.
      const hot = /\?|protein|carb|kcal|calorie|macro|weight|hydrat|late|window|goal|target|shake|recover|portion/i.test(question);
      if (!hot) return new Response(JSON.stringify({ skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      const { count } = await service.from('meal_comments')
        .select('id', { count: 'exact', head: true })
        .eq('meal_id', mealId).eq('role', 'ai').eq('author_id', callerId);
      if ((count ?? 0) >= 1) return new Response(JSON.stringify({ skipped: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ---- caps: per-user daily fails open; the global bill backstop fails CLOSED ----
    if (!(await withinKeyCap(coachSupport ? `meal_chat_support:${callerId}` : `meal_chat:${callerId}`, DAILY_CAP))) return bad(429, 'limit', cors);
    if (!(await withinKeyCap('meal_chat_global', GLOBAL_CAP, /* failOpen */ false))) return bad(429, 'limit', cors);

    // ---- the model call: prose only, forced tool ----
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [REPLY_TOOL],
      tool_choice: { type: 'tool', name: 'reply' },
      messages: [{
        role: 'user',
        content: coachSupport
          ? `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nThe COACH just said this on the athlete's meal: "${question}"\n\nIn 60 words or less, speaking to the athlete, back the coach's point using ONLY figures already in the context. Do not add new requirements, do not soften the coach, do not contradict them. If the context has nothing relevant, one steady sentence reinforcing the coach is enough.`
          : `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nAthlete's question: ${question}`,
      }],
    });
    const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: { message?: string } } | undefined;
    const reply = String(tool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
    if (!reply) return bad(502, 'unavailable', cors);

    // ---- persist as the unforgeable 'ai' row (service role) ----
    // `kind` ships in a later migration (post-0048); insert WITH it first and on error retry
    // once WITHOUT it, so replies still persist against a pre-migration database.
    // athlete_id is always the meal OWNER (RLS thread scoping); author_id records who
    // triggered the AI (the athlete's ask, or the coach whose point is being supported).
    const row = { meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: callerId, role: 'ai', text: reply };
    const { error: insertErr } = await service.from('meal_comments').insert({ ...row, kind: 'message' });
    if (insertErr) {
      await service.from('meal_comments').insert(row);
    }

    return new Response(JSON.stringify({ reply }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch {
    return bad(503, 'unavailable', cors);
  }
});
