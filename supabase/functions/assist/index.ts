// OnStandard — assist Edge Function (Supabase / Deno). The AI gatekeeper (doc-05 §3, §8).
//
// Holds ANTHROPIC_API_KEY server-side. Its ONLY job is to add coach-voiced NARRATION over data the
// app already computed deterministically — it never fetches data, never computes a number, never
// decides. The deterministic `data` (the source of truth: at-risk list, summary, draft body) is
// produced client-side by src/core and passed in; the model may only rephrase/summarize it in the
// configured personality voice. The forced tool returns { narration } and nothing else, so the
// model cannot assert a target, send a message, or invent a figure. On any failure/refusal/no-key
// the function returns { narration: null } and the app shows the deterministic `data` directly.
//
// Deploy:  supabase functions deploy assist   (shares the ANTHROPIC_API_KEY secret)
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';
// A deeper model for heavy roster analysis; defaults to the standard tier. Fable 5 when available.
const DEEP_MODEL = Deno.env.get('ANTHROPIC_DEEP_MODEL') ?? 'claude-opus-4-8';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

// Best-effort per-IP rate limit (mirrors analyze-meal), so the paid endpoint can't be hammered.
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

type AssistTask = 'meal_coaching' | 'copilot_query' | 'copilot_artifact';

interface AssistBody {
  task: AssistTask;
  /** The deterministic engine output to narrate over — the source of truth. Never modified here. */
  data: unknown;
  /** The personality style directive (from core/personality.personalityDirective). */
  directive?: string;
  /** Deep analysis (heavier model) for roster-wide reasoning. */
  deep?: boolean;
}

const NARRATION_TOOL = {
  name: 'report_narration',
  description: 'Return ONE short coach-voiced narration over the provided data. Prose only.',
  input_schema: {
    type: 'object',
    properties: {
      narration: { type: 'string', description: 'A brief, coach-voiced sentence or two that summarizes the data. No new numbers, names, or facts; no commands; no em dashes.' },
    },
    required: ['narration'],
  },
} as const;

const SYSTEM = `You are the OnStandard coach's assistant. You are given DATA the app already computed
(the source of truth) and you may ONLY put a short, coach-voiced narration over it. Hard rules:
never introduce a number, name, statistic, or fact that is not present in the data; never issue a
command, set a target, or say a message was sent; never change or reinterpret a figure. You are
phrasing only. One or two sentences, direct and encouraging, no hype, no em dashes. Always answer by
calling report_narration.`;

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  if (rateLimited(request)) return new Response(JSON.stringify({ narration: null, error: 'rate limited' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  // No key configured -> honest fallback: the app shows the deterministic data directly.
  if (!key) return new Response(JSON.stringify({ narration: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  let body: AssistBody;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ narration: null, error: 'bad request' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!body || body.data === undefined) {
    return new Response(JSON.stringify({ narration: null, error: 'data required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const directive = typeof body.directive === 'string' ? body.directive : '';
  const userText = `${directive}\n\nData (the source of truth — narrate over it, change nothing):\n${JSON.stringify(body.data, null, 2)}`;

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: body.deep ? DEEP_MODEL : MODEL,
      max_tokens: 512,
      system: SYSTEM,
      tools: [NARRATION_TOOL],
      tool_choice: { type: 'tool', name: NARRATION_TOOL.name },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    });
    const used = msg.content.find((b) => b.type === 'tool_use');
    const narration = used && used.type === 'tool_use' ? (used.input as { narration?: unknown }).narration : null;
    return new Response(JSON.stringify({ narration: typeof narration === 'string' ? narration : null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch {
    // Any failure/refusal -> deterministic fallback; the app renders `data` with no narration.
    return new Response(JSON.stringify({ narration: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
