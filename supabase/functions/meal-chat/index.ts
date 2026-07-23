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
import { recordAiCall, usageFrom } from '../_shared/ai-telemetry.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import {
  composeSystem, violatesStyleLanguage, styleCorrectionMessage, SAFE_INTUITIVE, type PlanStyle,
} from '../_shared/plan-style.ts';
import { loadPlanStyleForAthlete } from '../_shared/plan-style-load.ts';

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

// Coach OS Slice D draft mode: FOUR candidate replies the coach could send, one per stance.
// Forced tool with a fixed 4-item array. These are DRAFTS — the function persists nothing.
const DRAFT_STANCES = ['supportive', 'direct', 'context', 'followup'] as const;
const DRAFT_TOOL = {
  name: 'draft_replies',
  description: 'Draft exactly four alternative replies the coach could send to the athlete about this meal, one per stance.',
  input_schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        description: 'Exactly four drafts, one for each stance in order: supportive, direct, context, followup.',
        items: {
          type: 'object',
          properties: {
            stance: { type: 'string', enum: ['supportive', 'direct', 'context', 'followup'] },
            text: { type: 'string', description: 'Coach-voiced draft to the athlete, 60 words max, plain prose, no em dashes, no markdown. Reference only numbers present in the provided context.' },
          },
          required: ['stance', 'text'],
        },
      },
    },
    required: ['drafts'],
  },
} as const;

const DRAFT_SYSTEM = `You are the OnStandard AI Nutritionist helping a COACH draft replies inside an athlete's meal thread.
Rules that bind you:
1. Use ONLY the provided context (this meal, their plan and goal, today's summary, recent meals, the thread). Never invent, recompute, or adjust any number; you may repeat numbers exactly as given.
2. Coach voice: specific, encouraging, practical. Consistency is praised before choices are critiqued. Never shame food, weight, or a late log.
3. When coach guidance appears in the context, defer to it explicitly.
4. Speak AS the coach TO the athlete about THEIR goal and plan, not generic nutrition advice.
5. Draft FOUR alternative replies the COACH could send, one per stance: supportive (reinforce what went right), direct (name the gap and the fix), context (ask one clarifying question), followup (propose one concrete next step).
6. These are drafts the coach will edit before sending. Do not sign them, do not send them.
7. 60 words maximum per draft. No em dashes. No markdown.`;

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
    // Coach OS Slice D — draft mode: the coach asks for FOUR candidate replies. No question is
    // sent (there is nothing to answer yet), and NOTHING is persisted — these are drafts.
    const draftMode = body?.draftReplies === true;
    const question = String((coachSupport ? body?.coachText : body?.question) ?? '').trim().slice(0, 500);
    const context = body?.context;
    if (!mealId || !context || (!draftMode && !question)) return bad(400, 'bad_request', cors);
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
    // Coach modes (coachSupport + draft): the RLS-scoped select above succeeding for a NON-owner
    // proves can_view (linked coach/staff), so a coach must NOT own the meal. Athlete mode: owner.
    const coachMode = coachSupport || draftMode;
    if (coachMode ? mealRow.athlete_id === callerId : mealRow.athlete_id !== callerId) return bad(403, 'unauthorized', cors);

    const service = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Plan style (0142) resolves for the MEAL OWNER, never the caller. In draft and coach-support
    // mode the caller is the COACH — but the person who reads the words is the athlete, so it is
    // their style that decides what may be said. Getting this backwards would let a coach
    // unknowingly send macro figures to an athlete who is deliberately not tracking them.
    const planStyle: PlanStyle | null =
      (await loadPlanStyleForAthlete(service, mealRow.athlete_id))?.style ?? null;
    const styleSafe = (text: string): string => {
      // Shared tail of both call sites below: one corrected retry is handled inline by the
      // caller; this is the final rail that guarantees nothing unsafe is ever persisted.
      const v = violatesStyleLanguage(text, planStyle);
      return v ? SAFE_INTUITIVE.reply : text;
    };

    // ---- draft mode: four candidate coach-voice replies, PERSIST NOTHING ----
    if (draftMode) {
      // New rate-limit keys so drafting never consumes the coachSupport / athlete-chat budget.
      // Per-user fails open (an infra hiccup never blocks a legit draft); global fails CLOSED.
      if (!(await withinKeyCap(`meal_draft:${callerId}`, DAILY_CAP))) return bad(429, 'limit', cors);
      if (!(await withinKeyCap('meal_draft_global', GLOBAL_CAP, /* failOpen */ false))) return bad(429, 'limit', cors);

      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
      const t0d = Date.now();
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 700, // 4 drafts x ~60 words + tool-call JSON; headroom so the 4th draft never truncates into a 502
        system: [{ type: 'text', text: composeSystem(DRAFT_SYSTEM, '', planStyle), cache_control: { type: 'ephemeral' } }],
        tools: [DRAFT_TOOL],
        tool_choice: { type: 'tool', name: 'draft_replies' },
        messages: [{
          role: 'user',
          content: `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nDraft four replies the COACH could send to the athlete about this meal, one per stance (supportive, direct, context, followup), using ONLY figures already in the context. Speak as the coach to the athlete. Each draft is 60 words or less.`,
        }],
      });
      await recordAiCall({ fn: 'meal-chat', mode: 'draft', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0d, ok: true });
      const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: { drafts?: Array<{ stance?: string; text?: string }> } } | undefined;
      const raw = Array.isArray(tool?.input?.drafts) ? tool!.input!.drafts! : [];
      // Normalize to exactly the four canonical stances in order; strip em dashes; enforce ~60 words.
      const byStance = new Map<string, string>();
      for (const d of raw) {
        const stance = String(d?.stance ?? '').toLowerCase();
        const text = String(d?.text ?? '').replace(/—/g, ',').trim();
        if (DRAFT_STANCES.includes(stance as typeof DRAFT_STANCES[number]) && text && !byStance.has(stance)) {
          byStance.set(stance, text.split(/\s+/).slice(0, 60).join(' '));
        }
      }
      let drafts = DRAFT_STANCES.map((stance) => ({ stance, text: byStance.get(stance) ?? '' }));
      if (drafts.some((d) => !d.text)) return bad(502, 'unavailable', cors);
      // Plan-style rail on a COACH-facing surface: these drafts are sent verbatim to the athlete,
      // so an Intuitive breach here is the same harm as one in the athlete's own feed. A drafting
      // coach can see the safe replacement and edit it, so a single deterministic swap is the
      // right cost here — no paid retry for a draft the coach is about to rewrite anyway.
      if (planStyle === 'intuitive') {
        const swapped = drafts.map((d) => ({ ...d, text: styleSafe(d.text) }));
        if (swapped.some((d, i) => d.text !== drafts[i].text)) {
          await recordAiCall({ fn: 'meal-chat', mode: 'draft', userId: callerId, model: MODEL, latencyMs: 0, ok: true, outcome: 'style_safe_copy' });
        }
        drafts = swapped;
      }
      // PERSIST NOTHING — no meal_comments insert. The coach edits and sends these manually.
      return new Response(JSON.stringify({ drafts }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

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
    // ONE typed tools array for the reply call and its style retry. REPLY_TOOL is `as const`, so
    // its input_schema.required is a readonly tuple the SDK's mutable string[] rejects — tolerated
    // at a single call site, not at two.
    const replyTools = [REPLY_TOOL] as unknown as Anthropic.Tool[];
    const t0r = Date.now();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: composeSystem(SYSTEM, '', planStyle), cache_control: { type: 'ephemeral' } }],
      tools: replyTools,
      tool_choice: { type: 'tool', name: 'reply' },
      messages: [{
        role: 'user',
        content: coachSupport
          ? `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nThe COACH just said this on the athlete's meal: "${question}"\n\nIn 60 words or less, speaking to the athlete, back the coach's point using ONLY figures already in the context. Do not add new requirements, do not soften the coach, do not contradict them. If the context has nothing relevant, one steady sentence reinforcing the coach is enough.`
          : `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nAthlete's question: ${question}`,
      }],
    });
    await recordAiCall({ fn: 'meal-chat', mode: 'reply', userId: callerId, model: msg.model ?? MODEL, ...usageFrom(msg.usage), latencyMs: Date.now() - t0r, ok: true });
    const tool = msg.content.find((b) => b.type === 'tool_use') as { input?: { message?: string } } | undefined;
    let reply = String(tool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
    if (!reply) return bad(502, 'unavailable', cors);

    // Plan-style rail (0142) — the INVERTED fallback (see _shared/plan-style.ts's header): correct
    // and retry WITH the style still applied, never a bare re-ask. This reply is persisted as an
    // unforgeable 'ai' row the athlete will read forever, so it gets the paid retry the throwaway
    // coach drafts above do not.
    {
      const v = violatesStyleLanguage(reply, planStyle);
      if (v) {
        const t0s = Date.now();
        const retry = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 400,
          system: [{ type: 'text', text: composeSystem(SYSTEM, '', planStyle), cache_control: { type: 'ephemeral' } }],
          tools: replyTools,
          tool_choice: { type: 'tool', name: 'reply' },
          messages: [
            { role: 'user', content: `Context (deterministic, computed by the app):\n${JSON.stringify(context)}\n\nAthlete's question: ${question}` },
            { role: 'assistant', content: `<discarded>${reply}</discarded>` },
            { role: 'user', content: styleCorrectionMessage(v) },
          ],
        });
        await recordAiCall({
          fn: 'meal-chat', mode: 'reply', userId: callerId, model: retry.model ?? MODEL,
          ...usageFrom(retry.usage), latencyMs: Date.now() - t0s, ok: true, outcome: `style_${v.kind}_retry`,
        });
        const rtool = retry.content.find((b) => b.type === 'tool_use') as { input?: { message?: string } } | undefined;
        const candidate = String(rtool?.input?.message ?? '').replace(/—/g, ',').trim().slice(0, 1000);
        // styleSafe is the final rail: a corrected retry that STILL breaches falls to safe copy
        // rather than persisting a violation into the athlete's permanent thread.
        reply = candidate ? styleSafe(candidate) : SAFE_INTUITIVE.reply;
      }
    }

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
