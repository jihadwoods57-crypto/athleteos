// OnStandard — plan-generate Edge Function (Supabase / Deno).
// DRAFTS a one-day meal plan with Claude for a coach to review; it never assigns. The
// client (src/core/planValidate.ts parsePlanSlots) re-sanitizes the output before it ever
// touches AppState, so this function is not the last line of defense on shape.
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy plan-generate
// Model is configurable via the ANTHROPIC_MODEL secret; defaults to claude-sonnet-5.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@^2';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';

// Per-athlete daily ceiling on this paid call, same pattern as analyze-meal. Bounds a day's
// spend and stops a single account spamming plan drafts, where the per-minute IP limit can't
// (it mis-buckets a whole team behind one school-wifi IP and resets on cold start). Backed by
// the ai_usage_daily counter (migration 0015). Tunable via DAILY_ANALYSIS_CAP; 40/day is
// generous for real use. Over the cap the function returns 429 and the client falls back to
// its local draft, so plan-building never blocks.
// Guard a misconfigured DAILY_ANALYSIS_CAP: a non-number or <=0 would make `count < NaN`
// always false and 429 every signed-in athlete. Fall back to the safe default of 40.
const DAILY_CAP = (() => {
  const n = Math.floor(Number(Deno.env.get('DAILY_ANALYSIS_CAP') ?? '40'));
  return Number.isFinite(n) && n > 0 ? n : 40;
})();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Resolve the signed-in user from the caller's bearer token, or null. Null means an
// anonymous/preview call (the shared anon key, or backend not wired) — those skip the
// per-user cap and stay governed by the per-minute IP limit alone. Verifying via
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
    return null; // never let an auth hiccup block a legit request
  }
}

// Atomically claim one slot for today. Returns true if allowed, false if the caller is at
// their daily cap. Fail-OPEN: if the counter is unreachable (infra gap / RPC error), allow
// the call — drafting must never break, and the per-minute IP limit still blunts abuse.
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

interface PlanWindowIn {
  key: string;
  label: string;
  required: boolean;
}

interface PlanProtocolIn {
  currentWeight?: number;
  targetWeight?: number;
  calories?: number;
  protein?: number;
  mealsPerDay?: number;
  position?: string;
  deadline?: string;
}

interface PlanReq {
  goal: 'gain' | 'lose' | 'maintain' | 'performance';
  /** Optional free-text ask from the coach, e.g. "5,200 cal, 6 meals, 2 shakes, 290lb OL". */
  prompt?: string;
  protocol: PlanProtocolIn;
  windows: PlanWindowIn[];
}

// The exact shape the app expects back: one slot per meal window, matching PlanSlot
// (src/core/coachPlan.ts). The model fills this via a forced tool call so the response is
// always structured data; the client re-sanitizes with parsePlanSlots regardless.
const PLAN_TOOL = {
  name: 'report_meal_plan',
  description: 'Report a full day meal plan as an array of slots, one per meal window given.',
  input_schema: {
    type: 'object',
    properties: {
      slots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
            mode: { type: 'string', enum: ['pinned', 'open'] },
            macros: {
              type: 'object',
              properties: { kcal: { type: 'integer' }, protein: { type: 'integer' }, carbs: { type: 'integer' }, fat: { type: 'integer' } },
              required: ['kcal', 'protein'],
            },
            pinnedMeal: { type: ['object', 'null'], description: 'The single prescribed meal when mode is pinned, else null.' },
            options: { type: 'array', description: '2-3 approved meal choices when mode is open.', items: { type: 'object' } },
            restaurantAlts: { type: 'array', description: '2-3 restaurant equivalents (Chipotle, Publix, Wawa) that keep the athlete on target while traveling.', items: { type: 'object' } },
            note: { type: ['string', 'null'], description: 'One short coach note shown when this meal arrives, or null. No em dashes.' },
            photoRequired: { type: 'boolean' },
          },
          required: ['key', 'mode', 'macros', 'options', 'restaurantAlts', 'photoRequired'],
        },
      },
    },
    required: ['slots'],
  },
} as const;

const PLAN_SYSTEM = `You are the OnStandard sports nutritionist DRAFTING a one-day meal plan for a coach to
review and edit. You never assign; you propose. Build exactly one slot per meal window you are given,
using the athlete's goal and targets. For each slot: set realistic macros that add up close to the daily
targets; provide 2-3 approved options (each a real meal with an items list) when the slot should be
flexible, or a single pinnedMeal when one specific meal is best; always include 2-3 restaurant equivalents
(Chipotle, Publix, Wawa or similar) that hit the same macros for a traveling athlete; add a short coach
note only when it matters. Voice: direct, encouraging, never hype, no em dashes. Every meal must be real
food an athlete would actually eat. Return by calling report_meal_plan.`;

// Build the user-turn text prompt from the coach's goal, protocol targets, the required meal
// windows, and any optional free-text ask. Kept deterministic/textual (no images) since a plan
// draft has no photo input.
function buildPrompt(req: PlanReq): string {
  const lines: string[] = [];
  lines.push(`Athlete goal: ${req.goal}.`);
  const p = req.protocol ?? {};
  const protocolBits: string[] = [];
  if (typeof p.currentWeight === 'number') protocolBits.push(`current weight ${p.currentWeight} lb`);
  if (typeof p.targetWeight === 'number') protocolBits.push(`target weight ${p.targetWeight} lb`);
  if (typeof p.calories === 'number') protocolBits.push(`${p.calories} cal/day target`);
  if (typeof p.protein === 'number') protocolBits.push(`${p.protein} g protein/day target`);
  if (typeof p.mealsPerDay === 'number') protocolBits.push(`${p.mealsPerDay} meals/day`);
  if (typeof p.position === 'string' && p.position) protocolBits.push(`position: ${p.position}`);
  if (typeof p.deadline === 'string' && p.deadline) protocolBits.push(`deadline: ${p.deadline}`);
  if (protocolBits.length > 0) lines.push(`Protocol: ${protocolBits.join(', ')}.`);
  const windowList = req.windows.map((w) => `${w.key} (${w.label})${w.required ? ', required' : ''}`).join('; ');
  lines.push(`Meal windows to fill, exactly one slot each: ${windowList}.`);
  if (typeof req.prompt === 'string' && req.prompt.trim()) lines.push(`Coach's request: ${req.prompt.trim()}`);
  lines.push('Draft the full day now and report it.');
  return lines.join('\n');
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  if (rateLimited(request)) return new Response(JSON.stringify({ error: 'rate limited, slow down' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return new Response(JSON.stringify({ error: 'server not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  let req: PlanReq;
  try {
    req = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  if (!Array.isArray(req.windows) || req.windows.length === 0) {
    return new Response(JSON.stringify({ error: 'windows required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Per-user daily cap on this paid call. Enforced only for signed-in users; anonymous/preview
  // traffic stays covered by the per-minute IP limit above. Checked after the input guard so a
  // malformed request never burns a slot.
  const userId = await resolveUserId(request);
  if (userId && !(await withinDailyCap(userId))) {
    return new Response(JSON.stringify({ error: 'daily analysis limit reached' }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: PLAN_SYSTEM,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: PLAN_TOOL.name },
      messages: [{ role: 'user', content: buildPrompt(req) }],
    });
    const used = msg.content.find((b) => b.type === 'tool_use');
    if (!used || used.type !== 'tool_use') throw new Error('no structured output');

    return new Response(JSON.stringify(used.input), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
