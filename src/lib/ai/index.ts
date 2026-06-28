// AthleteOS — AI meal analysis seam. One entry point the app calls; it uses the real
// backend (Claude vision) when configured, else the deterministic prototype analysis.
// The UI renders the identical MealResult shape either way.
import { mealResultFor } from '@/core';
import type { MealResult } from '@/core';
import { analyzeMealRemote, isAiConfigured, type AnalyzeMealRequest } from './client';

export { isAiConfigured, AI_ENDPOINT } from './client';
export type { AnalyzeMealRequest } from './client';

// ---------------------------------------------------------------- honest labeling
// Founder Rule #8: never call it AI until a model is actually doing the work. Until the
// vision endpoint is configured (isAiConfigured), these surfaces run on deterministic
// coaching, so they say "Coach", not "AI". Each label flips back to its AI form
// automatically the day a real endpoint is set — no further code change.
export const aiCoachTag = isAiConfigured ? 'AI NUTRITION COACH' : 'NUTRITION COACH';
export const aiCoachName = isAiConfigured ? 'AI Nutrition Coach' : 'Nutrition Coach';
export const aiTeamSummaryTag = isAiConfigured ? 'AI TEAM SUMMARY' : 'TEAM SUMMARY';
export const aiMemoryTag = isAiConfigured ? 'Remembered by AI' : 'Coach memory';
/** "AI " prefix for inline sentence copy, empty until a real model runs. */
export const aiPrefix = isAiConfigured ? 'AI ' : '';

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
