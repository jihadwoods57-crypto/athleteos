// Pure scoring core for the meal eval harness. Reuses the app's own pure functions so the
// metrics match what ships. Jest-tested; also imported by eval/run-eval.ts (via tsx).
// @ts-ignore - proto ESM js, resolved by jest transform / tsx
import { matchFood } from '../../proto/redesign-2026-07/js/nutrition.js';
// @ts-ignore
import { mealQualityScore, qualityBand, analysisAgreesWithBand, shouldVerify } from '../../proto/redesign-2026-07/js/meal-intel.js';
import { FOOD_DB } from './foodDb';

export interface ExpectedFood { foodDbId: string; servings: number }
export interface ManifestEntry {
  id: string; photo: string; caseType: string; expectedFoods: ExpectedFood[];
  hasSevereAllergen?: boolean; expectVerify?: 'accuracy' | 'allergen' | 'none'; notes?: string;
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
    verify: scoreVerifyTrigger(resp, entry),
  };
}
