// AthleteOS — AI meal analysis seam. One entry point the app calls; it uses the real
// backend (Claude vision) when configured, else the deterministic prototype analysis.
// The UI renders the identical MealResult shape either way.
import { groundMealResult, mealResultFor, mergeRephrasedInsights, sampleScannedLabel } from '@/core';
import type { LabelFacts, MealResult, MemoryInsight } from '@/core';
import { analyzeLabelRemote, analyzeMealRemote, isAiConfigured, rephraseMemoryRemote, type AnalyzeLabelRequest, type AnalyzeMealRequest } from './client';

export { isAiConfigured, AI_ENDPOINT } from './client';
export type { AnalyzeMealRequest, AnalyzeLabelRequest } from './client';

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
    // Ground the model's macros (food-DB plausibility + Atwater) before the app shows or
    // logs them, so a hallucinated number never reaches the score. The deterministic
    // fallback is already curated/sane, so it needs no grounding.
    return groundMealResult(await analyzeMealRemote(req));
  } catch {
    // Honest degradation: a network/AI hiccup must never block the athlete's log.
    return mealResultFor(req.mealType);
  }
}

/**
 * Transcribe a Nutrition Facts label. Real (Claude vision) when configured; otherwise the
 * deterministic sample so the scan flow is fully clickable in the free preview. Never
 * throws: any remote failure falls back to the sample so logging a scan always succeeds.
 */
export async function analyzeLabel(req: AnalyzeLabelRequest): Promise<LabelFacts> {
  if (!isAiConfigured) return sampleScannedLabel();
  try {
    return await analyzeLabelRemote(req);
  } catch {
    return sampleScannedLabel();
  }
}

/**
 * "Remembered by AI": rephrase the deterministic memory insights in a warmer coach voice when a
 * model is configured. The engine's insights are the ground truth AND the fallback — this only
 * rewords. Every model rewrite is run through the core voice guard (mergeRephrasedInsights),
 * which keeps the numbers, badge, tone, and ranking exactly the engine's and drops any rewrite
 * that would change a figure. Inert without a backend (returns the insights untouched), and
 * never throws: any network/AI hiccup falls back to the deterministic insights, so the memory
 * surface always renders. The numbers never change.
 */
export async function rephraseMemoryInsights(insights: MemoryInsight[]): Promise<MemoryInsight[]> {
  if (!isAiConfigured || insights.length === 0) return insights;
  try {
    const proposed = await rephraseMemoryRemote({
      insights: insights.map(({ id, kind, tone, headline, detail, metric }) => ({ id, kind, tone, headline, detail, metric })),
    });
    return mergeRephrasedInsights(insights, proposed);
  } catch {
    return insights;
  }
}
