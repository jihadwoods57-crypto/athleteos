// AthleteOS — store <-> Supabase sync bridge (inert unless EXPO_PUBLIC_BACKEND_LIVE).
//
// This is the seam between the local Zustand day-slice and the `days` table. Every
// function gates on `isBackendLive` (NOT `isSupabaseConfigured`, which is already true
// whenever the AI Edge Function's project is set — the "shared-project flag trap").
// With the flag off every call early-returns, so the app runs on local mock data
// exactly as today. When the founder flips the flag, the store calls `hydrateDay()`
// after auth and a debounced `pushDay()` after each mutating action.
//
// SAFETY: `pushDay` is the only path that writes a real athlete's data, so it is gated
// behind `realDataConsent` (core/consent.ts) and FAILS CLOSED — a minor (or any athlete)
// without recorded consent never pushes. `src/core` stays the single scoring authority:
// `pushDay` writes the score `computeDerived` produced, never a second formula.
import {
  computeDerived,
  gradeFor,
  realDataConsent,
  todayStamp,
  type AppState,
  type ConsentContext,
  type ConsentReason,
} from '@/core';
import { db, isBackendLive } from '@/lib/supabase';
import type { DayRow } from '@/lib/supabase';

/** Why a `pushDay` did or did not write — surfaced for tests + the store's logging. */
export type PushReason = ConsentReason | 'backend-off';
export interface PushResult {
  pushed: boolean;
  reason: PushReason;
}

/**
 * Build the consent context the go-live data path checks before pushing real data.
 * Fail-safe by construction: an unknown/null role is treated as 'athlete' (so it IS
 * gated rather than waved through), and `baseAge` flows straight to the minor check
 * (an unknown age is treated as a minor by `isMinor`).
 */
export function consentContextFromState(s: AppState, backendLive: boolean): ConsentContext {
  return {
    backendLive,
    role: s.role ?? 'athlete',
    age: s.baseAge,
    consentGiven: s.realDataConsent,
  };
}

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

/**
 * Push the current day to Postgres. The single real-data write path, so it is the
 * consent gate: it writes ONLY when the backend is live AND `realDataConsent` passes.
 * Returns a discriminated result so the caller (and tests) can see why a push was
 * skipped. Never throws on the gate; a DB error from `upsertDay` still propagates.
 *   - backend off            -> { pushed: false, reason: 'backend-off' }
 *   - minor without consent  -> { pushed: false, reason: 'minor-consent-required' }
 *   - athlete without consent-> { pushed: false, reason: 'consent-required' }
 *   - consent ok             -> upsert, { pushed: true, reason: 'ok' }
 */
export async function pushDay(s: AppState, athleteId: string, date = todayStamp()): Promise<PushResult> {
  if (!isBackendLive) return { pushed: false, reason: 'backend-off' };
  const gate = realDataConsent(consentContextFromState(s, isBackendLive));
  if (!gate.ok) return { pushed: false, reason: gate.reason };
  await db.upsertDay(mapStateToDayRow(s, athleteId, date));
  return { pushed: true, reason: 'ok' };
}

/** Pull today's day from Postgres, or null when the backend is off / no remote row
 *  yet. Reading the athlete's OWN day needs no consent gate (consent gates collecting
 *  their data, not the athlete resuming it); the flag gate alone applies. */
export async function hydrateDay(athleteId: string, date = todayStamp()): Promise<Partial<AppState> | null> {
  if (!isBackendLive) return null;
  const row = await db.fetchDay(athleteId, date);
  return row ? dayRowToState(row) : null;
}
