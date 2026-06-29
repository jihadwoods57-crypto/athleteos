// AthleteOS — macro grounding (pure TS, no RN imports).
//
// A meal photo's macros are the weakest number in the app: vision models guess grams from
// pixels, and a wrong "52g protein" silently corrupts the score. This is the honest guard.
// It does NOT pretend to measure — it BOUNDS the model's estimate against two sources of
// truth so a number can never be wildly wrong:
//   1. Food science (exact): calories must equal 4·protein + 4·carbs + 9·fat (Atwater). If
//      the model's stated kcal is inconsistent with its own macros, reconcile to the macros.
//   2. The curated food DB (foodDb.ts): match the detected foods, sum their per-serving
//      reference macros, and clamp the estimate into a plausible band (a plate is a few
//      servings, not ten). Catches gross hallucinations without flattening real portions.
// The result stays an ESTIMATE — but a bounded, internally-consistent one we can let touch
// the score. Confidence reflects how much we could corroborate. Lives in core (the scoring
// authority), not the Edge Function, so it's testable and never drifts from the food DB.
import type { MealResult } from './content';
import type { EditableFood, MacroSet } from './mealEdit';
import { searchFoods } from './foodDb';

/** A plate can be roughly this many servings of a detected food (upper plausibility). */
const PORTION_MAX = 3;
/** ...or as little as this (lower plausibility), e.g. a garnish. */
const PORTION_MIN = 0.3;
/** Multiplier headroom for foods the DB couldn't price, capped so it can't blow the band open. */
const EXTRAP_CAP = 2;
/** Additive grams of headroom on the upper bound for always-present-but-undetected
 *  ingredients (cooking oil, butter, sauces, dressings) that the lean reference misses.
 *  Lets a real "18g fat" plate pass while still catching a hallucinated "250g protein". */
const HEADROOM_G = 18;
/** kcal within this fraction of the Atwater value is left as the model reported it. */
const KCAL_TOLERANCE = 0.12;

export type MacroConfidence = 'high' | 'medium' | 'low';

export interface GroundedMacros extends MacroSet {
  /** How much of the estimate we could corroborate (DB match rate + consistency). */
  confidence: MacroConfidence;
  /** True if any macro was pulled into a plausible band or kcal was materially reconciled. */
  adjusted: boolean;
}

/** Clamp a value to a finite, non-negative number (vision can emit junk). */
function nn(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Ground a meal's estimated macros against the food DB + Atwater consistency. Pure and
 * deterministic. `detected` is the list of foods the model says it saw; each is matched to
 * the curated DB (best single match) to build a per-serving reference the estimate is bounded
 * against. Returns bounded macros + a confidence read.
 */
export function groundMealMacros(
  estimate: { protein?: number; kcal?: number; carbs?: number; fat?: number },
  detected: string[] = [],
): GroundedMacros {
  const est = { protein: nn(estimate.protein), kcal: nn(estimate.kcal), carbs: nn(estimate.carbs), fat: nn(estimate.fat) };
  let adjusted = false;

  // ---- reference from the curated DB (matched foods only) ----
  let refP = 0, refC = 0, refF = 0, matched = 0;
  for (const name of detected) {
    const hit = name && name.trim() ? searchFoods(name, 1)[0] : undefined;
    if (hit) { refP += hit.per.protein; refC += hit.per.carbs; refF += hit.per.fat; matched++; }
  }
  const total = detected.length;
  // Foods we couldn't price widen the upper bound (the meal has more than we accounted for).
  const extrap = total && matched ? Math.min(EXTRAP_CAP, total / matched) : 1;

  const clamp = (val: number, ref: number): number => {
    if (ref <= 0) return val; // nothing to bound against for this macro
    const lo = ref * PORTION_MIN;
    const hi = ref * PORTION_MAX * extrap + HEADROOM_G;
    const c = Math.min(hi, Math.max(lo, val));
    if (Math.round(c) !== Math.round(val)) adjusted = true;
    return c;
  };

  const protein = clamp(est.protein, refP);
  const carbs = clamp(est.carbs, refC);
  const fat = clamp(est.fat, refF);

  // ---- Atwater calorie reconciliation ----
  const atwater = 4 * protein + 4 * carbs + 9 * fat;
  let kcal = est.kcal;
  if (atwater > 0) {
    const dev = kcal > 0 ? Math.abs(kcal - atwater) / atwater : 1;
    if (kcal <= 0 || dev > KCAL_TOLERANCE) {
      kcal = atwater;
      if (est.kcal <= 0 || dev > 0.25) adjusted = true;
    }
  }

  // ---- confidence ----
  const ratio = total ? matched / total : 0;
  let confidence: MacroConfidence = ratio >= 0.6 ? 'high' : ratio >= 0.3 ? 'medium' : 'low';
  if (adjusted) confidence = confidence === 'high' ? 'medium' : 'low';

  return { protein: Math.round(protein), kcal: Math.round(kcal), carbs: Math.round(carbs), fat: Math.round(fat), confidence, adjusted };
}

/**
 * Ground a full MealResult's macros in place (keeping name/quality/detected/note). This is
 * what the AI seam runs on every real photo result before the app shows or logs it, so a
 * hallucinated macro never reaches the score.
 */
export function groundMealResult(mr: MealResult): MealResult {
  const g = groundMealMacros(mr, mr.detected ?? []);
  return { ...mr, protein: g.protein, kcal: g.kcal, carbs: g.carbs, fat: g.fat };
}

/**
 * Project a (grounded) MealResult into a single EditableFood, so logging a photo meal feeds
 * its REAL macros into the score through the same saveMeal path an edited plate / label scan
 * uses — instead of the generic per-slot constant. servings=1 (totals already in `per`).
 */
export function mealResultToFood(mr: MealResult): EditableFood {
  return {
    name: mr.name?.trim() || 'Logged meal',
    portion: 'photo estimate',
    servings: 1,
    per: { protein: mr.protein, kcal: mr.kcal, carbs: mr.carbs, fat: mr.fat },
  };
}
