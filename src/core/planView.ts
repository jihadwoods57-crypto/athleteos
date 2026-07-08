// OnStandard — athlete "Today's Prescribed Meals" view-model (pure). Joins each slot with its
// compliance state and whether its coach note should appear yet (only once the window opens, so
// the athlete sees the right cue at the right time). Keeps Nutrition.tsx declarative.
import type { CoachPlan, PlanSlot } from './coachPlan';
import { planCompliance, type SlotComplianceState } from './planCompliance';
import type { MealKey } from './types';

export interface PlanViewEntry {
  slot: PlanSlot;
  state: SlotComplianceState;
  showNote: boolean;
}

export function planView(
  plan: CoachPlan,
  logged: Partial<Record<MealKey, { protein: number; kcal: number }>>,
  now: Date = new Date(),
): PlanViewEntry[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openByKey = new Map(plan.windows.map((w) => [w.key, nowMin >= w.openMin]));
  const compliance = planCompliance(plan, logged, now);
  const stateByKey = new Map(compliance.slots.map((s) => [s.key, s.state]));
  return plan.slots.map((slot) => ({
    slot,
    state: stateByKey.get(slot.key) ?? 'upcoming',
    showNote: Boolean(slot.note) && (openByKey.get(slot.key) ?? false),
  }));
}
