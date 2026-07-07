// OnStandard — plan compliance read (pure). Matches what the athlete actually logged against the
// prescribed slots. DISPLAY ONLY: this never feeds the day score (Constitution Rule #13); it is the
// "did you eat the plan?" number the athlete + coach see alongside the unchanged OnStandard Score.
import type { CoachPlan } from './coachPlan';
import type { MealKey } from './types';

export type SlotComplianceState = 'completed' | 'partial' | 'missed' | 'upcoming';
export interface SlotCompliance {
  key: MealKey;
  state: SlotComplianceState;
}
export interface PlanComplianceResult {
  slots: SlotCompliance[];
  completedRequired: number;
  requiredTotal: number;
  compliancePct: number;
}

const MET = 0.85; // logged protein must reach 85% of the slot target to count as completed

export function planCompliance(
  plan: CoachPlan,
  logged: Partial<Record<MealKey, { protein: number; kcal: number }>>,
  now: Date = new Date(),
): PlanComplianceResult {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const windowByKey = new Map(plan.windows.map((w) => [w.key, w]));

  const slots: SlotCompliance[] = plan.slots.map((slot) => {
    const hit = logged[slot.key];
    if (hit) {
      const target = slot.macros.protein;
      const state: SlotComplianceState = target <= 0 || hit.protein >= target * MET ? 'completed' : 'partial';
      return { key: slot.key, state };
    }
    const w = windowByKey.get(slot.key);
    const past = w ? nowMin > w.deadlineMin : false;
    return { key: slot.key, state: past ? 'missed' : 'upcoming' };
  });

  const requiredKeys = new Set(plan.windows.filter((w) => w.required).map((w) => w.key));
  const requiredSlots = slots.filter((s) => requiredKeys.has(s.key));
  const requiredTotal = requiredSlots.length;
  const completedRequired = requiredSlots.filter((s) => s.state === 'completed').length;
  const compliancePct = requiredTotal > 0 ? Math.round((completedRequired / requiredTotal) * 100) : 100;

  return { slots, completedRequired, requiredTotal, compliancePct };
}
