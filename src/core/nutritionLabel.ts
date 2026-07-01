// OnStandard — Nutrition Label Scanner model (pure TS, no RN imports).
//
// "Scan a label" is the high-trust sibling of the meal-photo path. A photo of a plate is
// ESTIMATED (portions vary); a Nutrition Facts panel is a FACT — the AI transcribes printed
// numbers, so we show them EXACT and only the scaling (× servings eaten) is our own math,
// which is also exact. The single judgment call is the quality read + the coach-configurable
// ingredient flags, which we label as a read, not a measurement. This module is that pure,
// tested core; the AI seam (lib/ai) fills LabelFacts from the photo when configured, and the
// deterministic fallback returns a neutral packaged-food record so logging always works.
import type { MealResult } from './content';
import type { EditableFood } from './mealEdit';

/** The Nutrition Facts panel, transcribed PER SERVING exactly as printed. */
export interface LabelFacts {
  /** Product name read off the packaging, when present. */
  productName?: string;
  /** Serving size as printed, free text (e.g. "1 bar (60g)"). */
  servingSize?: string;
  /** Servings per container, when printed. */
  servingsPerContainer?: number;
  // --- per-serving nutrition, exactly as printed ---
  calories: number;
  protein: number; // g
  carbs: number;   // g
  fat: number;     // g
  sugar?: number;  // g
  fiber?: number;  // g
  sodium?: number; // mg
  /** Parsed ingredient list, in printed order. */
  ingredients: string[];
}

/** Coach-configurable ingredient/▸nutrient flags. The coach chooses which fire. */
export type IngredientFlagKey =
  | 'added_sugar'
  | 'artificial_dyes'
  | 'sugar_alcohols'
  | 'seed_oils'
  | 'ultra_processed'
  | 'high_sodium'
  | 'allergen_dairy'
  | 'allergen_gluten'
  | 'allergen_nuts';

/** Tone token-NAME for a flag chip — the UI maps it to a color token, never a hex here. */
export type FlagTone = 'warning' | 'accent' | 'neutral';

export interface IngredientFlag {
  key: IngredientFlagKey;
  /** Short user-facing label, e.g. "Added sugar". */
  label: string;
  tone: FlagTone;
  /** The ingredient strings (or the fact) that triggered it — shown as evidence. */
  matched: string[];
}

interface FlagDef {
  key: IngredientFlagKey;
  label: string;
  tone: FlagTone;
  /** Lowercased substrings that, if found in an ingredient, trigger the flag. */
  patterns: string[];
}

// Ingredient-pattern flags. Substring match on lowercased ingredient text. The sodium and
// added-sugar AMOUNT thresholds are handled separately (they're facts, not ingredients).
const FLAG_DEFS: FlagDef[] = [
  { key: 'added_sugar', label: 'Added sugar', tone: 'warning',
    patterns: ['sugar', 'corn syrup', 'high fructose', 'cane juice', 'dextrose', 'maltodextrin', 'glucose syrup', 'agave', 'molasses'] },
  { key: 'artificial_dyes', label: 'Artificial dye', tone: 'warning',
    patterns: ['red 40', 'red 3', 'yellow 5', 'yellow 6', 'blue 1', 'blue 2', 'green 3', 'fd&c'] },
  { key: 'sugar_alcohols', label: 'Sugar alcohol', tone: 'accent',
    patterns: ['erythritol', 'xylitol', 'maltitol', 'sorbitol', 'isomalt', 'mannitol'] },
  { key: 'seed_oils', label: 'Seed oil', tone: 'accent',
    patterns: ['soybean oil', 'canola oil', 'sunflower oil', 'safflower oil', 'corn oil', 'cottonseed oil', 'grapeseed oil', 'vegetable oil'] },
  { key: 'ultra_processed', label: 'Ultra-processed', tone: 'accent',
    patterns: ['maltodextrin', 'mono- and diglycerides', 'monoglycerides', 'carrageenan', 'artificial flavor', 'emulsifier', 'soy lecithin', 'natural flavor'] },
  { key: 'allergen_dairy', label: 'Dairy', tone: 'neutral',
    patterns: ['milk', 'whey', 'casein', 'lactose', 'butter', 'cream'] },
  { key: 'allergen_gluten', label: 'Gluten', tone: 'neutral',
    patterns: ['wheat', 'barley', 'rye', 'malt', 'gluten', 'semolina'] },
  { key: 'allergen_nuts', label: 'Tree nut / peanut', tone: 'neutral',
    patterns: ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'pistachio', 'macadamia'] },
];

/** Every flag key, with its label — for a coach settings screen. */
export const INGREDIENT_FLAG_DEFS: { key: IngredientFlagKey; label: string }[] = [
  ...FLAG_DEFS.map((d) => ({ key: d.key, label: d.label })),
  { key: 'high_sodium', label: 'High sodium' },
];

/** FDA "high" sodium reference: 20% DV ≈ 460mg per serving. */
export const HIGH_SODIUM_MG = 460;

/** Default flags a coach has on out of the box. Seed oils default OFF ("if the coach cares",
 *  per the product brief); allergens default ON because they're safety-relevant. */
export const DEFAULT_ENABLED_FLAGS: IngredientFlagKey[] = [
  'added_sugar', 'artificial_dyes', 'sugar_alcohols', 'ultra_processed',
  'high_sodium', 'allergen_dairy', 'allergen_gluten', 'allergen_nuts',
];

/**
 * Run the coach-configured flags over a label. Ingredient flags match substrings in the
 * ingredient list; high_sodium keys off the printed sodium fact. Each ingredient is matched
 * at most once per flag, and the matched evidence is de-duplicated. Pure + order-stable.
 */
export function flagIngredients(
  facts: Pick<LabelFacts, 'ingredients' | 'sodium'>,
  enabled: IngredientFlagKey[] = DEFAULT_ENABLED_FLAGS,
): IngredientFlag[] {
  const on = new Set(enabled);
  const lower = (facts.ingredients ?? []).map((i) => i.toLowerCase());
  const out: IngredientFlag[] = [];

  for (const def of FLAG_DEFS) {
    if (!on.has(def.key)) continue;
    const matched: string[] = [];
    (facts.ingredients ?? []).forEach((ing, idx) => {
      if (def.patterns.some((p) => lower[idx].includes(p))) matched.push(ing.trim());
    });
    const uniq = Array.from(new Set(matched));
    if (uniq.length) out.push({ key: def.key, label: def.label, tone: def.tone, matched: uniq });
  }

  if (on.has('high_sodium') && typeof facts.sodium === 'number' && facts.sodium >= HIGH_SODIUM_MG) {
    out.push({ key: 'high_sodium', label: 'High sodium', tone: 'warning', matched: [`${facts.sodium}mg per serving`] });
  }
  return out;
}

/** Round to one decimal for grams; sodium stays whole mg. Keeps scaled numbers tidy. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Total nutrition for the servings actually eaten — exact scaling of the printed facts. */
export interface ScaledNutrition {
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  sodium: number;
}

/**
 * Scale per-serving facts by the servings eaten. Servings is clamped to a sane 0.25–20 and
 * snapped to the nearest quarter (the UI stepper moves in ¼s). Macros round to 1 decimal,
 * calories + sodium to whole numbers — facts stay exact, only multiplied.
 */
export function scaleLabel(facts: LabelFacts, servings: number): ScaledNutrition {
  const s = Math.min(20, Math.max(0.25, Math.round((Number.isFinite(servings) ? servings : 1) * 4) / 4));
  return {
    servings: s,
    calories: Math.round(facts.calories * s),
    protein: r1(facts.protein * s),
    carbs: r1(facts.carbs * s),
    fat: r1(facts.fat * s),
    sugar: r1((facts.sugar ?? 0) * s),
    sodium: Math.round((facts.sodium ?? 0) * s),
  };
}

/**
 * A humble quality READ for a packaged food (0..100) from its label — explicitly a judgment,
 * not a measurement (the macros are the facts). Rewards protein density, penalizes a sugar-
 * heavy or heavily-flagged product. Bounded so a single scan never reads as 100 ("perfect")
 * or 0. Per-serving basis, so it doesn't change with how many servings you log.
 */
export function labelQuality(facts: LabelFacts, flags: IngredientFlag[]): number {
  let q = 68;
  const kcal = Math.max(1, facts.calories);
  const proteinDensity = (facts.protein * 4) / kcal; // fraction of calories from protein
  q += Math.round(Math.min(0.5, proteinDensity) * 60); // up to +30 for a high-protein food
  const sugar = facts.sugar ?? 0;
  if (sugar >= 20) q -= 16;
  else if (sugar >= 10) q -= 8;
  if (facts.fiber && facts.fiber >= 3) q += 4;
  for (const f of flags) {
    if (f.key === 'added_sugar' || f.key === 'artificial_dyes' || f.key === 'high_sodium') q -= 6;
    else if (f.key === 'ultra_processed' || f.key === 'sugar_alcohols' || f.key === 'seed_oils') q -= 3;
    // allergen flags are informational only — they don't lower quality.
  }
  return Math.max(20, Math.min(96, q));
}

/**
 * Project a scanned label + servings into the SAME MealResult shape the meal-photo path
 * produces, so a scan logs through the identical pipeline (mealAnalysis → addMeal → score →
 * recordMeal). `detected` carries the first few ingredients as evidence; the note states
 * plainly that the macros are read from the label, not estimated.
 */
export function labelToMealResult(facts: LabelFacts, servings: number, flags?: IngredientFlag[]): MealResult {
  const scaled = scaleLabel(facts, servings);
  const fl = flags ?? flagIngredients(facts);
  const servingsLabel = scaled.servings === 1 ? '1 serving' : `${scaled.servings} servings`;
  return {
    name: facts.productName?.trim() || 'Scanned food',
    quality: labelQuality(facts, fl),
    protein: Math.round(scaled.protein),
    kcal: scaled.calories,
    carbs: Math.round(scaled.carbs),
    fat: Math.round(scaled.fat),
    detected: (facts.ingredients ?? []).slice(0, 4).map((i) => i.trim()).filter(Boolean),
    note: `Read from the label — ${servingsLabel} logged. These macros are off the Nutrition Facts panel, not estimated.`,
  };
}

/**
 * Project a scanned label + servings into a single EditableFood, so a scan logs through the
 * SAME saveMeal(key, foods) path an edited plate uses — which means its EXACT label macros
 * (not a slot constant) feed the day score. servings=1 because the per-serving macros are
 * already scaled into `per`; `portion` records what was actually eaten for the log.
 */
export function labelToFood(facts: LabelFacts, servings: number): EditableFood {
  const scaled = scaleLabel(facts, servings);
  const unit = facts.servingSize?.trim() || 'serving';
  return {
    name: facts.productName?.trim() || 'Scanned food',
    portion: `${scaled.servings} × ${unit}`,
    servings: 1,
    per: { protein: scaled.protein, kcal: scaled.calories, carbs: scaled.carbs, fat: scaled.fat },
  };
}

/** Honest one-line provenance note for the label-result UI. */
export function labelProvenanceNote(): string {
  return 'Numbers are read straight off the Nutrition Facts label, so they are exact. The quality read and ingredient flags are a coach-style judgment.';
}

/**
 * A believable demo label for the deterministic fallback (backend / AI off) so the scan
 * flow is fully clickable in the free preview — the sibling of mealResultFor() for photos.
 * Replaced by the real transcription the day the AI endpoint is configured.
 */
export function sampleScannedLabel(): LabelFacts {
  return {
    productName: 'Protein Bar',
    servingSize: '1 bar (60g)',
    servingsPerContainer: 1,
    calories: 210,
    protein: 20,
    carbs: 23,
    fat: 7,
    sugar: 4,
    fiber: 9,
    sodium: 200,
    ingredients: ['Whey protein isolate', 'Almonds', 'Soluble corn fiber', 'Cane sugar', 'Sea salt', 'Natural flavor'],
  };
}
