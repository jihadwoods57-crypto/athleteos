import { buildPlanDraft, clampPlanSlots, parsePlanSlots, type CoachPlan, type EngineGoal, type PlanSlot } from '@/core';
import { supabase } from '@/lib/supabase/client';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/plan-generate` : '';
export const isPlanGenerateConfigured = Boolean(ENDPOINT && anonKey);

export async function generatePlan(args: {
  plan: CoachPlan;
  goal: EngineGoal;
  prompt?: string;
  protocol?: Record<string, unknown>;
  /** Drives the deterministic calorie floor on the returned draft. Default TRUE:
   *  when the caller doesn't know the age, the stricter floor applies (fail safe). */
  isMinor?: boolean;
  /** Confirmed avoid foods (allergies/dislikes) — sent to the model AND enforced
   *  deterministically on whatever comes back. */
  avoid?: string[];
}): Promise<PlanSlot[]> {
  const guard = (slots: PlanSlot[]): PlanSlot[] => clampPlanSlots(slots, { isMinor: args.isMinor ?? true, avoid: args.avoid });
  const fallback = guard(buildPlanDraft(args.plan, args.goal));
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
        // Same shape/caps as analyze-meal's avoid: the model shouldn't draft an
        // allergen, and clampPlanSlots below guarantees it even if it does.
        avoid: (args.avoid ?? []).slice(0, 20).map((a) => a.slice(0, 40)),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { slots?: unknown };
    // The model's draft passes the SAME deterministic safety gate as the local
    // fallback: calorie floor (minor-strict by default) + confirmed-allergen drop.
    const slots = guard(parsePlanSlots(json.slots));
    return slots.length > 0 ? slots : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
