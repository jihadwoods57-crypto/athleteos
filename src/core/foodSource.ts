// OnStandard — food-source normalization (pure TS).
//
// Turns a raw food-lookup result (per-100g macros + a serving string, from Open Food Facts by
// barcode or USDA FoodData Central by name, via the food-lookup edge function) into a single
// EditableFood the normal saveMeal path logs — exactly like a scanned label or a photo estimate.
// These are EXACT numbers (from a barcode/label or the USDA database), so they log at confidence
// high with no grounding clamp. Lives in core so the scaling is unit-tested and shared.
import type { EditableFood, MacroSet } from './mealEdit';

/** Raw result from the food-lookup edge function: macros per 100 g + the printed serving. */
export interface FoodLookupResult {
  name: string;
  /** Serving label as printed, e.g. "1 bar (60 g)" or "30 g"; may be null. */
  serving: string | null;
  /** Macros per 100 g of the food. */
  per100: MacroSet;
  source: 'off' | 'usda';
}

/** Parse the gram weight in a serving string ("30 g", "1 bar (60g)", "2 tbsp (32 g)") → grams,
 *  or null when no gram weight is present. Pure. */
export function parseServingGrams(serving: string | null | undefined): number | null {
  if (!serving) return null;
  const m = serving.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (!m) return null;
  const g = Number(m[1]);
  return Number.isFinite(g) && g > 0 ? g : null;
}

/** Scale per-100g macros to `grams`. Pure. */
function scaleMacros(per100: MacroSet, grams: number): MacroSet {
  const f = grams / 100;
  return {
    protein: Math.max(0, Math.round(per100.protein * f)),
    kcal: Math.max(0, Math.round(per100.kcal * f)),
    carbs: Math.max(0, Math.round(per100.carbs * f)),
    fat: Math.max(0, Math.round(per100.fat * f)),
  };
}

/** Normalize a lookup result into an EditableFood for saveMeal. Scales to the printed serving
 *  when its gram weight is known; otherwise logs one 100 g serving (labeled). servings = 1. */
export function foodLookupToEditable(r: FoodLookupResult): EditableFood {
  const grams = parseServingGrams(r.serving) ?? 100;
  const portion = r.serving?.trim() || '100 g';
  return {
    name: r.name?.trim() || 'Scanned food',
    portion,
    servings: 1,
    per: scaleMacros(r.per100, grams),
  };
}
