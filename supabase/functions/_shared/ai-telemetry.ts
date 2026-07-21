// OnStandard — AI call telemetry (Supabase / Deno, shared across the AI edge functions).
//
// Records ONE row per paid Anthropic call into public.ai_calls: which function/mode, the model
// the API actually used, the token counts off `message.usage`, wall-clock latency, and success.
// Dollars are NOT computed here — they live in SQL (public.ai_model_prices + the ai_call_costs
// view), so a price change is a one-row data edit, not a code deploy, and this helper stays a
// dumb, safe recorder. See migration 0105_ai_calls.sql.
//
// INVARIANT: telemetry must never be able to break the AI pipeline. Every path here swallows its
// own errors and returns void. The insert is AWAITED by the caller (before it returns its
// Response) so the row is durable even though a Deno isolate may be frozen right after the
// response is sent — the added latency is a single local insert (~tens of ms) against a call that
// already took seconds. If telemetry is unconfigured (no service-role key) it is simply a no-op,
// exactly like the ai_usage_daily counters.
import { createClient } from 'npm:@supabase/supabase-js@^2';

export interface AiCallRecord {
  fn: string;                 // edge function name, e.g. 'analyze-meal'
  mode?: string | null;       // 'meal' | 'label' | 'memory' | 'order' (analyze-meal); null elsewhere
  phase?: string | null;      // 'analyze' | 'finalize' for meal mode; null otherwise
  userId?: string | null;     // athlete uuid, or null for anonymous callers
  model: string;              // AUTHORITATIVE model string — read from message.model, not the request
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  latencyMs?: number | null;  // wall-clock around the Anthropic call
  ok?: boolean;               // false for a failed/again upstream call
  errorCode?: string | null;  // short tag on failure (e.g. 'upstream_error'); null on success
}

// Pull the four token counts off an Anthropic SDK `message.usage` object into our record shape.
// Defensive: any missing field reads as 0 so a shape change can never throw here.
export function usageFrom(
  u: unknown,
): Pick<AiCallRecord, 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens'> {
  const usage = (u ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    inputTokens: n(usage.input_tokens),
    outputTokens: n(usage.output_tokens),
    cacheCreationTokens: n(usage.cache_creation_input_tokens),
    cacheReadTokens: n(usage.cache_read_input_tokens),
  };
}

// Best-effort insert of one AI call. AWAIT this before returning the handler's Response so the
// write lands before the isolate can be frozen. NEVER throws; NEVER blocks on failure.
export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return; // telemetry off when unconfigured — same posture as the usage counters
  try {
    const sb = createClient(url, key);
    const { error } = await sb.from('ai_calls').insert({
      fn: rec.fn,
      mode: rec.mode ?? null,
      phase: rec.phase ?? null,
      user_id: rec.userId ?? null,
      model: rec.model,
      input_tokens: rec.inputTokens ?? 0,
      output_tokens: rec.outputTokens ?? 0,
      cache_creation_tokens: rec.cacheCreationTokens ?? 0,
      cache_read_tokens: rec.cacheReadTokens ?? 0,
      latency_ms: rec.latencyMs ?? null,
      ok: rec.ok ?? true,
      error_code: rec.errorCode ?? null,
    });
    if (error) console.error('ai-telemetry insert error:', error.message);
  } catch (e) {
    // A telemetry failure must never surface to the caller or break the AI response.
    console.error('ai-telemetry unexpected error:', e);
  }
}
