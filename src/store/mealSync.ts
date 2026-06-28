// AthleteOS — meal-record sync: persist each logged meal (macros + photo) to the
// `meals` table when the backend is live. The sibling of sync.ts: where sync.ts
// owns the day *slice* (`days`, one row per athlete-day), this owns the meal
// *collection* (N `meals` rows per day, plus the photo in the meal-photos bucket).
//
// SAFETY: like pushDay, this is the only path that writes a real athlete's meal
// data, so it gates HARD on isBackendLive AND realDataConsent and FAILS CLOSED —
// with the flag off (today's beta) it is a pure no-op and the photo is dropped
// exactly as before. A non-consenting (or unverified minor) athlete never persists
// a meal. src/core stays the scoring authority; this only persists evidence.
import {
  mealMacros,
  mealResultFor,
  realDataConsent,
  todayStamp,
  type AppState,
  type ConsentReason,
  type MealKey,
  type MealLabel,
} from '@/core';
import { db, isBackendLive, requireSupabase } from '@/lib/supabase';
import type { MealRow } from '@/lib/supabase';
import { consentContextFromState } from './sync';

const KEY_TO_LABEL: Record<MealKey, MealLabel> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

/** Why a recordMeal did or did not write — surfaced for tests + the store's logging. */
export type RecordReason = ConsentReason | 'no-user';
export interface RecordResult {
  recorded: boolean;
  reason: RecordReason;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a base64 string (no data: prefix) to bytes — dependency-free, so the
 *  upload path needs no atob/Buffer polyfill on React Native. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63);
    if (p < len) out[p++] = (n >> 16) & 0xff;
    if (c2 !== -1 && p < len) out[p++] = (n >> 8) & 0xff;
    if (c3 !== -1 && p < len) out[p++] = n & 0xff;
  }
  return out;
}

/**
 * Upload a base64 JPEG to meal-photos/{athlete}/{date}/{key}.jpg and return the
 * stored path. The path is stable per slot, so re-logging the same meal overwrites
 * (upsert) rather than orphaning a photo. Returns null when there's no photo or on
 * ANY failure — a photo upload must never block (or fail) the meal record.
 */
export async function uploadMealPhoto(
  athleteId: string,
  date: string,
  key: MealKey,
  base64: string | null | undefined,
): Promise<string | null> {
  if (!base64) return null;
  const path = `${athleteId}/${date}/${key}.jpg`;
  try {
    const { error } = await requireSupabase()
      .storage.from('meal-photos')
      .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

/**
 * Project a logged meal slot into an `insertMeal` row. Pure. Macros come from the
 * athlete's edited plate when they corrected it (the honest, user-owned numbers),
 * otherwise the AI/deterministic estimate. photo_path is filled in by recordMeal
 * after the upload.
 */
export function mapMealToRow(
  s: AppState,
  athleteId: string,
  key: MealKey,
  photoPath: string | null,
  date = todayStamp(),
): Omit<MealRow, 'id' | 'logged_at'> {
  const est = s.mealAnalysis ?? mealResultFor(KEY_TO_LABEL[key]);
  const foods = s.mealFoods[key];
  const macros = foods && foods.length ? mealMacros(foods) : est;
  return {
    athlete_id: athleteId,
    day_date: date,
    type: key,
    photo_path: photoPath,
    name: est.name,
    protein: macros.protein,
    kcal: macros.kcal,
    carbs: macros.carbs,
    fat: macros.fat,
    quality: est.quality,
    detected: est.detected,
    note: est.note,
  };
}

/**
 * Persist one logged meal: upload its photo (if any), then insert the row. The
 * single real-data write path for meals, so it is the consent gate — writes ONLY
 * when the backend is live AND realDataConsent passes. Never throws on the gate;
 * a DB error from insertMeal still propagates. Mirrors pushDay's discriminated
 * result so the caller (and tests) can see why a write was skipped.
 */
export async function recordMeal(s: AppState, athleteId: string | null, key: MealKey, date = todayStamp()): Promise<RecordResult> {
  if (!isBackendLive) return { recorded: false, reason: 'backend-off' };
  if (!athleteId) return { recorded: false, reason: 'no-user' };
  const gate = realDataConsent(consentContextFromState(s, isBackendLive));
  if (!gate.ok) return { recorded: false, reason: gate.reason };
  const photoPath = await uploadMealPhoto(athleteId, date, key, s.mealPhoto);
  await db.insertMeal(mapMealToRow(s, athleteId, key, photoPath, date));
  return { recorded: true, reason: 'ok' };
}
