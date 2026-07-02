import { buildPlanDraft, parsePlanSlots, type CoachPlan, type EngineGoal, type PlanSlot } from '@/core';
import { supabase } from '@/lib/supabase/client';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/plan-generate` : '';
export const isPlanGenerateConfigured = Boolean(ENDPOINT && anonKey);

export async function generatePlan(args: { plan: CoachPlan; goal: EngineGoal; prompt?: string; protocol?: Record<string, unknown> }): Promise<PlanSlot[]> {
  const fallback = buildPlanDraft(args.plan, args.goal);
  if (!isPlanGenerateConfigured) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey ?? '', Authorization: `Bearer ${token ?? anonKey ?? ''}` },
      body: JSON.stringify({
        goal: args.goal,
        prompt: args.prompt ?? '',
        protocol: args.protocol ?? {},
        windows: args.plan.windows.map((w) => ({ key: w.key, label: w.label, required: w.required })),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { slots?: unknown };
    const slots = parsePlanSlots(json.slots);
    return slots.length > 0 ? slots : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
