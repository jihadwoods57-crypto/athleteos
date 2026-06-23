// AthleteOS — store <-> Supabase sync bridge (inert until configured).
//
// This is the seam between the local Zustand day-slice and the `days` table. It is
// deliberately NOT wired into the store yet: with no keys, `isSupabaseConfigured` is
// false and every function early-returns, so the app runs on local mock data exactly
// as today. When keys land, call `hydrateDay()` after auth and `pushDay()` after each
// mutating action (the two TODO hooks noted below) to go live.
//
// `src/core` stays the single scoring authority: `pushDay` writes the score that
// `computeDerived` produced, never a second formula (see 0002_rls.sql server-recompute note).
import { computeDerived, gradeFor, todayStamp, type AppState } from '@/core';
import { db, isSupabaseConfigured } from '@/lib/supabase';
import type { DayRow } from '@/lib/supabase';

/** Project the local day-slice into a `days` row. Score/grade come from the pure engine. */
export function mapStateToDayRow(
  s: AppState,
  athleteId: string,
  date = todayStamp(),
): Partial<DayRow> & Pick<DayRow, 'athlete_id' | 'date'> {
  const d = computeDerived(s);
  return {
    athlete_id: athleteId,
    date,
    meals: s.meals as unknown as Record<string, boolean>,
    hydration_l: s.hydrationL,
    tasks: s.tasks as unknown as DayRow['tasks'],
    quick_added: s.quickAdded,
    current_weight: s.currentWeight ?? null,
    checkin: {
      energy: s.ciEnergy,
      recovery: s.ciRecovery,
      sleep: s.ciSleep,
      confidence: s.ciConfidence,
      soreness: s.ciSoreness,
      motivation: s.ciMotivation,
      submitted: s.ciSubmitted,
    },
    score: d.athleteScore,
    grade: gradeFor(d.athleteScore).g,
  };
}

/** Project a `days` row back onto the local day-slice for hydration. */
export function dayRowToState(row: DayRow): Partial<AppState> {
  return {
    meals: row.meals as unknown as AppState['meals'],
    hydrationL: row.hydration_l,
    tasks: (row.tasks ?? []) as unknown as AppState['tasks'],
    quickAdded: (row.quick_added ?? []) as AppState['quickAdded'],
    currentWeight: row.current_weight ?? undefined,
    dateStamp: row.date,
  };
}

/** Push the current day to Postgres. No-op when unconfigured. */
export async function pushDay(s: AppState, athleteId: string, date = todayStamp()): Promise<void> {
  if (!isSupabaseConfigured) return;
  await db.upsertDay(mapStateToDayRow(s, athleteId, date));
}

/** Pull today's day from Postgres, or null when unconfigured / no remote row yet. */
export async function hydrateDay(athleteId: string, date = todayStamp()): Promise<Partial<AppState> | null> {
  if (!isSupabaseConfigured) return null;
  const row = await db.fetchDay(athleteId, date);
  return row ? dayRowToState(row) : null;
}

// TODO (go-live, when keys exist):
//   1. After successful auth, call `hydrateDay(userId)` and `set(...)` the result.
//   2. In the store's mutating actions (addMeal/addWater/toggleTask/submitCi), fire
//      `pushDay(get(), userId)` (debounced) so the day-slice writes through to Postgres.
//      AsyncStorage stays the offline cache; the remote is the source of truth.
