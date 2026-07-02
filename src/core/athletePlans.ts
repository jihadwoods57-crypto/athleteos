// OnStandard — per-athlete meal plans (pure). A coach/nutritionist authors a PlanSlot[] per
// client, keyed by a stable athlete key (backend athleteId, or the display name as a demo
// fallback). Local-first, exactly like the rest of the app's state; the backend seam
// (src/lib/mealPlans.ts) syncs these to meal_plans/plan_assignments only when live.
import type { PlanSlot } from './coachPlan';

/** The coach's working plans, keyed by athlete key. */
export type AthletePlans = Record<string, PlanSlot[]>;

/** Which plan the CoachPlanEditor is editing: the signed-in user's own plan, or a specific
 *  client's plan (opened from the coach's PersonDetail). */
export type PlanEditTarget = { kind: 'self' } | { kind: 'athlete'; key: string; name: string };

/** A stable key for an athlete: the real backend id when present, else the display name. */
export function athleteKey(a: { athleteId?: string | null; name: string }): string {
  return a.athleteId && a.athleteId.trim() ? a.athleteId : a.name;
}

/** The plan for one athlete, or [] when none authored yet. */
export function getAthletePlan(map: AthletePlans, key: string): PlanSlot[] {
  return map[key] ?? [];
}

/** Set one athlete's plan, returning a new map (immutable). An empty slots array clears it. */
export function setAthletePlan(map: AthletePlans, key: string, slots: PlanSlot[]): AthletePlans {
  if (slots.length === 0) {
    const { [key]: _drop, ...rest } = map;
    return rest;
  }
  return { ...map, [key]: slots };
}

/** Copy one plan to many athletes at once (bulk assign), returning a new map. Each athlete
 *  gets its own array copy so later per-athlete edits never alias across clients. */
export function assignPlanToMany(map: AthletePlans, keys: string[], slots: PlanSlot[]): AthletePlans {
  const next = { ...map };
  for (const key of keys) {
    if (!key) continue;
    next[key] = slots.map((s) => ({ ...s }));
  }
  return next;
}
