// AthleteOS — AI meal analysis seam. One entry point the app calls; it uses the real
// backend (Claude vision) when configured, else the deterministic prototype analysis.
// The UI renders the identical MealResult shape either way.
import { mealResultFor } from '@/core';
import type { MealResult } from '@/core';
import { analyzeMealRemote, isAiConfigured, type AnalyzeMealRequest } from './client';

export { isAiConfigured, AI_ENDPOINT } from './client';
export type { AnalyzeMealRequest } from './client';

/**
 * Analyze a meal. Real (Claude vision via the backend) when configured; otherwise the
 * deterministic prototype result. Never throws: on any remote failure it falls back to
 * the deterministic analysis so logging a meal always succeeds.
 */
export async function analyzeMeal(req: AnalyzeMealRequest): Promise<MealResult> {
  if (!isAiConfigured) return mealResultFor(req.mealType);
  try {
    return await analyzeMealRemote(req);
  } catch {
    // Honest degradation: a network/AI hiccup must never block the athlete's log.
    return mealResultFor(req.mealType);
  }
}
