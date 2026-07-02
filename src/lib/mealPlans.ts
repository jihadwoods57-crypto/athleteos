// OnStandard — Meal Plans backend sync seam (Wave 2). Writes coach-authored plans to
// meal_plans / plan_assignments when the backend is live; a no-op otherwise (demo/offline),
// mirroring CoachGoalsEditor's pushAthleteGoals. The local `athletePlans` store is the source
// of truth; this only mirrors it upward.
//
// INERT until migration 0029_meal_plans.sql is applied to the live project AND
// EXPO_PUBLIC_BACKEND_LIVE is on. The 0029 tables are not in the generated Database types yet,
// so the queries below are cast; regenerate database.types.ts after the migration lands to
// restore full typing.
import { isBackendLive, supabase } from '@/lib/supabase';
import type { PlanSlot } from '@/core';

/** True only when a real backend is wired — every write below returns early otherwise. */
export const isMealPlanSyncConfigured = isBackendLive;

/** Save a plan as a `meal_plans` row (author = auth.uid via RLS). Returns the new id, or null
 *  when not live / unauthenticated / on any error. Never throws — the local plan already persisted. */
export async function saveMealPlan(args: {
  name: string;
  athleteId?: string | null;
  slots: PlanSlot[];
  goal?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  if (!isBackendLive || !supabase) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const authorId = auth.user?.id;
    if (!authorId) return null;
    const { data, error } = await (supabase as any)
      .from('meal_plans')
      .insert({
        author_id: authorId,
        athlete_id: args.athleteId ?? null,
        name: args.name,
        status: 'active',
        goal_json: args.goal ?? {},
        plan_json: args.slots,
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return { id: data.id as string };
  } catch {
    return null;
  }
}

/** Assign a saved plan to many athletes (`plan_assignments` upsert). Returns true on success,
 *  false when not live / unauthenticated / empty / on error. */
export async function assignPlan(planId: string, athleteIds: string[]): Promise<boolean> {
  if (!isBackendLive || !supabase || athleteIds.length === 0) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const assignedBy = auth.user?.id;
    if (!assignedBy) return false;
    const rows = athleteIds.map((athlete_id) => ({ plan_id: planId, athlete_id, assigned_by: assignedBy, status: 'active' }));
    const { error } = await (supabase as any).from('plan_assignments').upsert(rows, { onConflict: 'plan_id,athlete_id' });
    return !error;
  } catch {
    return false;
  }
}
