// Pure scoring core for the meal eval harness. Reuses the app's own pure functions so the
// metrics match what ships. Jest-tested; also imported by eval/run-eval.ts (via tsx).
// @ts-ignore - proto ESM js, resolved by jest transform / tsx
import { matchFood } from '../../proto/redesign-2026-07/js/nutrition.js';
// @ts-ignore
import { mealQualityScore, qualityBand, analysisAgreesWithBand, shouldVerify } from '../../proto/redesign-2026-07/js/meal-intel.js';
import { FOOD_DB } from './foodDb';
import { detectDayLeak } from '../../supabase/functions/_shared/day-leak';

export interface ExpectedFood { foodDbId: string; servings: number }
/**
 * Extra request context for one eval meal, mirroring what the real client sends.
 *
 * Every plate in this suite was posted as `mealType: 'Dinner'` with no day and no athlete, which
 * meant the harness had NEVER put a Day context line in the prompt — the single most-read
 * sentence-shaper in the read. That is why "Zero on the board for protein until now" reached an
 * athlete's breakfast (founder 2026-09-07) with a green eval behind it. Omit the field and the
 * request is byte-identical to the old one, so existing baselines stay comparable.
 */
export interface EvalRequestContext {
  mealType?: string;
  /** Confirmed severe restrictions the athlete has declared, exactly as the client sends them.
   *  Required for an allergen case: the allergen verifier only fires when a severe restriction is
   *  on file AND the read carries a low-confidence food, so a case without this can never test it. */
  avoid?: string[];
  dayContext?: { proteinSoFar?: number; proteinTarget?: number; mealsRemaining?: number; mealsLoggedSoFar?: number };
  athlete?: { sport?: string; position?: string; level?: string; bodyweightLb?: number; dayType?: string };
}
export interface ManifestEntry {
  id: string; photo: string; caseType: string; expectedFoods: ExpectedFood[];
  hasSevereAllergen?: boolean; expectVerify?: 'accuracy' | 'allergen' | 'none'; notes?: string;
  request?: EvalRequestContext;
  /**
   * Where `expectedFoods` came from. Defaults to 'estimated' — which is what every entry in this
   * suite is, and the single most important caveat about every number the harness prints.
   *
   * On 2026-09-07 `steak-potatoes` returned 32g of protein against a 64g "truth", identically on
   * two independent runs. That reads like a 50% model error. It is equally consistent with the
   * answer key being wrong: the key asserts sirloin-steak x1.75 servings and the model reads about
   * one, and NOBODY PUT THAT STEAK ON A SCALE. An eval that cannot say which of its two numbers was
   * measured is comparing two guesses and calling the difference an error.
   *
   * 'weighed' means the plate was photographed at portions recorded from a kitchen scale (see the
   * capture protocol in eval/README.md). Until entries carry it, portion accuracy is unmeasurable
   * and the macro error metrics are directional at best.
   */
  truthSource?: 'estimated' | 'weighed';
}
export interface MealResponse {
  detected?: Array<{ name?: string; confidence?: string; protein?: number; kcal?: number; carbs?: number; fat?: number }>;
  protein?: number; kcal?: number; carbs?: number; fat?: number; quality?: number; fiber?: number; analysis?: string;
}

const FOOD_BY_ID = new Map<string, any>((FOOD_DB as any[]).map((f) => [f.id, f]));

export function expectedMacros(foods: ExpectedFood[]) {
  const t = { protein: 0, kcal: 0, carbs: 0, fat: 0 };
  for (const { foodDbId, servings } of foods) {
    const f = FOOD_BY_ID.get(foodDbId); if (!f) continue;
    const s = Number(servings) || 0;
    t.protein += f.per.protein * s; t.kcal += f.per.kcal * s; t.carbs += f.per.carbs * s; t.fat += f.per.fat * s;
  }
  return { protein: Math.round(t.protein), kcal: Math.round(t.kcal), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

export function scoreDetection(detected: MealResponse['detected'], expected: ExpectedFood[]) {
  const detectedIds = new Set<string>();
  for (const d of detected || []) { const m = matchFood(d && d.name); if (m && m.id) detectedIds.add(m.id); }
  const expectedIds = new Set(expected.map((e) => e.foodDbId));
  let matched = 0; for (const id of expectedIds) if (detectedIds.has(id)) matched++;
  return {
    precision: detectedIds.size ? matched / detectedIds.size : 0,
    recall: expectedIds.size ? matched / expectedIds.size : 0,
    matched, detectedCount: detectedIds.size, expectedCount: expectedIds.size,
  };
}

export function scoreMacroError(resp: MealResponse, truth: { protein: number; kcal: number; carbs: number; fat: number }) {
  const err = (a: number | undefined, b: number) => { const x = Number(a) || 0, abs = Math.abs(x - b); return { abs, pct: b ? abs / b : 0 }; };
  return { protein: err(resp.protein, truth.protein), carbs: err(resp.carbs, truth.carbs), fat: err(resp.fat, truth.fat), kcal: err(resp.kcal, truth.kcal) };
}

// true = CONTRADICTION (the AI's analysis tone disagrees with the computed band).
export function scoreContradiction(resp: MealResponse): boolean {
  const q = mealQualityScore({ macros: { protein: resp.protein, carbs: resp.carbs, fat: resp.fat, kcal: resp.kcal }, fiber: resp.fiber, detected: resp.detected, minutesLate: 0 });
  const band = qualityBand(q);
  return band ? !analysisAgreesWithBand(resp.analysis || '', band) : false;
}

/* The day-leak rail. The detector itself lives in supabase/functions/_shared/day-leak.ts so the
   eval gate and the live telemetry in analyze-meal enforce the SAME definition — two copies would
   drift, and then the number on the dashboard and the number in the gate stop being one number.
   Extensionless import on purpose: jest/tsx resolve it, while Deno imports the same file as
   './day-leak.ts'. Same split athlete-context.ts already lives with. */
export function scoreDayLeak(resp: MealResponse) {
  return detectDayLeak(resp.analysis);
}

export function scoreVerifyTrigger(resp: MealResponse, entry: ManifestEntry) {
  const expected = entry.expectVerify || 'none';
  const severe = (entry.expectVerify === 'allergen' || entry.hasSevereAllergen) ? ['sim'] : [];
  const gate = shouldVerify({ detected: resp.detected, quality: resp.quality, source: 'photo', severeRestrictions: severe, budgetLeft: 3 });
  const fired = gate.fire ? gate.trigger : 'none';
  return { expected, fired, correct: fired === expected };
}

export function scoreMeal(resp: MealResponse, entry: ManifestEntry) {
  const truth = expectedMacros(entry.expectedFoods);
  return {
    id: entry.id, caseType: entry.caseType,
    detection: scoreDetection(resp.detected, entry.expectedFoods),
    macroError: scoreMacroError(resp, truth),
    contradiction: scoreContradiction(resp),
    dayLeak: scoreDayLeak(resp),
    verify: scoreVerifyTrigger(resp, entry),
  };
}
