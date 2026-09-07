// Pure scoring core for the meal eval harness. Reuses the app's own pure functions so the
// metrics match what ships. Jest-tested; also imported by eval/run-eval.ts (via tsx).
// @ts-ignore - proto ESM js, resolved by jest transform / tsx
import { matchFood } from '../../proto/redesign-2026-07/js/nutrition.js';
// @ts-ignore
import { mealQualityScore, qualityBand, analysisAgreesWithBand, shouldVerify } from '../../proto/redesign-2026-07/js/meal-intel.js';
import { FOOD_DB } from './foodDb';

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
  dayContext?: { proteinSoFar?: number; proteinTarget?: number; mealsRemaining?: number; mealsLoggedSoFar?: number };
  athlete?: { sport?: string; position?: string; level?: string; bodyweightLb?: number; dayType?: string };
}
export interface ManifestEntry {
  id: string; photo: string; caseType: string; expectedFoods: ExpectedFood[];
  hasSevereAllergen?: boolean; expectVerify?: 'accuracy' | 'allergen' | 'none'; notes?: string;
  request?: EvalRequestContext;
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

/* THE DAY-LEAK RAIL. The prompt has told the model for months not to write the athlete's day into
   the read: the app appends its own grounded day sentence immediately after, so a second set of
   totals from the model either duplicates it or contradicts it. Nothing measured whether the model
   complied, and it did not — a breakfast read opened "Zero on the board for protein until now, so
   this plate is a solid opening move... trying to build back toward 180g today" (founder 2026-09-07).
   Both halves are leaks, and both are now counted.

   EMPTY-DAY is the worse one and the reason this exists: it spends the verdict sentence narrating a
   board the athlete has not had a chance to fill. On a first meal there is nothing to be behind on.

   Deliberately conservative. A day total must sit next to a DAY WORD, because the prompt actively
   wants numbers that ARE the advice ("add 30g of protein at lunch") and flagging those would train
   the next person to ignore this metric. */
const EMPTY_DAY = [
  /\bzero\b[^.!?]{0,60}?\b(on the board|logged|so far|until now|to this point)\b/i,
  /\b(nothing|no protein|none)\b[^.!?]{0,40}?\b(on the board|logged yet|so far today|logged so far|yet today)\b/i,
  /\bstarting (?:the day|today|out)\s+(?:at|from)\s+(?:zero|0)\b/i,
  /\b(?:0|zero)\s?g\b[^.!?]{0,30}?\b(so far|on the board|today|to this point)\b/i,
  /\b(?:first|nothing) on the board\b/i,
];
const DAY_WORD = '(?:today|for the day|on the day|daily|a day)';
const DAY_TOTAL = [
  // "toward 180g today", "180g on the day", "your daily 180g"
  new RegExp(`\\b\\d{2,4}\\s?g\\b[^.!?]{0,20}?\\b${DAY_WORD}\\b`, 'i'),
  new RegExp(`\\b${DAY_WORD}\\b[^.!?]{0,20}?\\b\\d{2,4}\\s?g\\b`, 'i'),
  // "you're at 120 of 180", stated as a running day tally
  /\b\d{2,4}\s?(?:g|grams)?\s+of\s+(?:your\s+)?\d{2,4}\s?g?\b/i,
];

/** Did the read narrate the athlete's DAY instead of judging the plate in front of them? */
export function scoreDayLeak(resp: MealResponse) {
  const text = String(resp.analysis || '');
  const emptyDay = EMPTY_DAY.some((re) => re.test(text));
  const dayTotal = DAY_TOTAL.some((re) => re.test(text));
  return { emptyDay, dayTotal, leaked: emptyDay || dayTotal };
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
