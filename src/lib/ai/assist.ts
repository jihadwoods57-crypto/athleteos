// OnStandard — Coach Copilot client (doc-05 §6). Wires the deterministic tools to the assist
// Edge Function. The deterministic result is ALWAYS computed locally (source of truth); when a
// backend is configured, the model's coach-voiced narration is layered on. Any failure falls back
// to the deterministic result with no narration — the Copilot always answers, exactly like
// analyzeMeal always logs. The model never fetches data or changes a number.
import {
  clampForAudience,
  mergeCoachingVoice,
  personalityDirective,
  resolvePersonality,
  runCopilotTool,
  type CopilotContext,
  type CopilotQuery,
  type CopilotResult,
  type PersonalityStyle,
} from '@/core';
import { supabase } from '@/lib/supabase/client';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** The assist endpoint (narration only); shares the Supabase project with analyze-meal. */
export const ASSIST_ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/assist` : '';
/** True only when a real backend endpoint + key exist — gates the narration call. */
export const isAssistConfigured = Boolean(ASSIST_ENDPOINT && anonKey);

type AssistTaskWire = 'copilot_query' | 'copilot_artifact' | 'meal_coaching';

async function narrate(task: AssistTaskWire, data: unknown, directive: string, deep: boolean): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    const res = await fetch(ASSIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey ?? '',
        Authorization: `Bearer ${token ?? anonKey ?? ''}`,
      },
      body: JSON.stringify({ task, data, directive, deep }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { narration?: unknown };
    return typeof json?.narration === 'string' ? json.narration : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Heavy roster-wide reasoning gets the deeper model; single-athlete/quick tools use the standard tier. */
const DEEP_TOOLS = new Set<CopilotQuery['tool']>(['predict_falling_behind', 'summarize_nutrition', 'draft_report']);

/**
 * Run a Copilot tool. Returns the deterministic CopilotResult immediately (data = source of truth);
 * when configured, layers on the model's narration in the org personality voice. Never throws.
 */
export async function runCopilot(
  query: CopilotQuery,
  ctx: CopilotContext,
  personality: PersonalityStyle = resolvePersonality(),
): Promise<CopilotResult> {
  const result = runCopilotTool(query, ctx);
  if (!isAssistConfigured) return result; // narration null — the UI shows `data` directly
  const directive = personalityDirective(clampForAudience(personality, false));
  const narration = await narrate('copilot_query', result.data, directive, DEEP_TOOLS.has(query.tool));
  return { ...result, narration };
}

/**
 * The bounded athlete-facing voice (doc-05 §9, Phase 4): warm the deterministic coaching sentence in
 * the org personality — clamped for a minor, and with EVERY number locked by mergeCoachingVoice. No
 * chat, no free generation. Unconfigured/failed/number-drift all fall back to the engine's sentence.
 */
export async function voiceMealCoaching(
  source: string,
  opts: { personality?: PersonalityStyle; isMinor?: boolean } = {},
): Promise<string> {
  if (!isAssistConfigured || !source.trim()) return source;
  const personality = clampForAudience(opts.personality ?? resolvePersonality(), opts.isMinor ?? false);
  const narration = await narrate('meal_coaching', source, personalityDirective(personality), false);
  return mergeCoachingVoice(source, narration);
}

/**
 * Send a drafted artifact — the SEPARATE, human, audited action (doc-05 §6.2). Goes through the
 * send_copilot_artifact RPC (requires the coach's session + writes activity_log). Returns false if
 * the backend is unconfigured or the RPC rejects; the AI never sends on a human's behalf.
 */
export async function sendCopilotArtifact(artifactId: string): Promise<boolean> {
  if (!supabase) return false;
  // The RPC exists in migration 0016 but not yet in the generated Database types (applied by the
  // founder), so call it through a loose signature. The name is validated server-side.
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  const { error } = await rpc('send_copilot_artifact', { p_id: artifactId });
  return !error;
}
