// OnStandard — pure slot-list reducers shared by the store actions (kept in core so they're
// unit-tested without RN). The store's plan actions are thin wrappers over these.
import type { PlanSlot } from './coachPlan';
import type { MealKey } from './types';

export function applySlotPatch(slots: PlanSlot[], key: MealKey, patch: Partial<PlanSlot>): PlanSlot[] {
  return slots.map((s) => (s.key === key ? { ...s, ...patch } : s));
}

export function toggleMode(slots: PlanSlot[], key: MealKey): PlanSlot[] {
  return slots.map((s) => (s.key === key ? { ...s, mode: s.mode === 'pinned' ? 'open' : 'pinned' } : s));
}
