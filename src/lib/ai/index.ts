// OnStandard — AI meal analysis seam. One entry point the app calls; it uses the real
// backend (Claude vision) when configured, else the deterministic prototype analysis.
// The UI renders the identical MealResult shape either way.
import { groundMealResult, mealResultFor, mergeRephrasedInsights, mergeRephrasedOrders, ordersToRephrase, sampleScannedLabel } from '@/core';
import type { LabelFacts, MemoryInsight, RecommendResult } from '@/core';
import { AiUnavailableError, analyzeLabelRemote, analyzeMealRemote, isAiConfigured, rephraseMemoryRemote, rephraseOrdersRemote, type AnalyzeLabelRequest, type AnalyzeMealRequest, type MealRemoteResponse } from './client';

export { isAiConfigured, AI_ENDPOINT, AiUnavailableError } from './client';
export type { AnalyzeMealRequest, AnalyzeLabelRequest, MealRemoteResponse, Clarification } from './client';
export { isDeepDiveConfigured, runDeepDive, type DeepDiveFailure, type DeepDiveResponse } from './deepDive';

// ---------------------------------------------------------------- honest labeling
// Founder Rule #8: never call it AI until a model is actually doing the work. Until the
// vision endpoint is configured (isAiConfigured), these surfaces run on deterministic
// coaching, so they say "Coach", not "AI". Each label flips back to its AI form
// automatically the day a real endpoint is set — no further code change.
export const aiCoachTag = isAiConfigured ? 'AI NUTRITION COACH' : 'NUTRITION COACH';
export const aiCoachName = isAiConfigured ? 'AI Nutrition Coach' : 'Nutrition Coach';
export const aiTeamSummaryTag = isAiConfigured ? 'AI TEAM SUMMARY' : 'TEAM SUMMARY';
export const aiMemoryTag = isAiConfigured ? 'Remembered by AI' : 'Coach memory';
export const aiRestaurantCoachTag = isAiConfigured ? 'AI RESTAURANT COACH' : 'RESTAURANT COACH';
/** "AI " prefix for inline sentence copy, empty until a real model runs. */
export const aiPrefix = isAiConfigured ? 'AI ' : '';

/**
 * Analyze a meal. Real (Claude vision via the backend) when configured; otherwise the
 * deterministic prototype result (the honest free-preview, labeled "Coach", not "AI"). Returns a
 * finished result, up to three clarifying questions, OR — when a CONFIGURED model was asked and
 * could not answer — an `unavailable` signal carrying why (rate-limited vs error). It never throws.
 *
 * HONESTY (audit 2026-07-02, item 5): when a real backend is configured we do NOT fabricate a
 * canned plate on failure — that would log invented macros for the athlete's actual photo and
 * quietly poison their score and the coach's view. The caller shows an honest retry/manual state.
 * The no-backend path is unchanged: a deterministic preview is expected there and is not a lie.
 */
export async function analyzeMeal(req: AnalyzeMealRequest): Promise<MealRemoteResponse> {
  if (!isAiConfigured) return { kind: 'result', result: mealResultFor(req.mealType) };
  try {
    const res = await analyzeMealRemote(req);
    if (res.kind === 'questions') return res;
    // Ground the model's macros (food-DB plausibility + Atwater) before the app shows or
    // logs them, so a hallucinated number never reaches the score.
    return { kind: 'result', result: groundMealResult(res.result) };
  } catch (e) {
    // Configured but the model couldn't answer: surface it honestly, never a fabricated plate.
    return { kind: 'unavailable', reason: e instanceof AiUnavailableError ? e.reason : 'error' };
  }
}

/**
 * Transcribe a Nutrition Facts label. Real (Claude vision) when configured; otherwise the
 * deterministic sample so the scan flow is fully clickable in the free preview.
 *
 * HONESTY (audit 2026-07-02, item 5): when a real backend is configured this THROWS
 * AiUnavailableError on failure rather than returning the sample panel — presenting a sample label
 * under "read straight off the label · exact" framing would be a fabricated reading of the
 * athlete's actual photo. The caller catches it and shows the honest retry state. The no-backend
 * path still returns the sample (the free preview, which is not represented as a real scan).
 */
export async function analyzeLabel(req: AnalyzeLabelRequest): Promise<LabelFacts> {
  if (!isAiConfigured) return sampleScannedLabel();
  return analyzeLabelRemote(req);
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

/**
 * "AI Restaurant Coach": reword the goal-aware order explanations (`why`) in a warmer coach voice
 * when a model is configured. The engine's orders are the ground truth AND the fallback — this only
 * rewords the prose. Every rewrite is run through the core voice guard (mergeRephrasedOrders), which
 * keeps the macros, price, item lines, and tags exactly the engine's and drops any rewrite that
 * would change a number. Inert without a backend (returns the result untouched), and never throws:
 * any network/AI hiccup falls back to the deterministic recommendation. The numbers never change.
 */
export async function rephraseOrders(result: RecommendResult): Promise<RecommendResult> {
  if (!isAiConfigured) return result;
  try {
    const proposed = await rephraseOrdersRemote({ orders: ordersToRephrase(result) });
    return mergeRephrasedOrders(result, proposed);
  } catch {
    return result;
  }
}
