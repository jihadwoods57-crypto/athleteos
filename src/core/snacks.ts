// OnStandard — snack & shake presets (pure TS).
//
// The nutritionist in the real coaching threads keeps pushing between-meal calories ("add a
// shake", "liquid calories", "did you have snacks between meals?") and athletes under-log them.
// These one-tap presets log a REAL snack through the normal saveMeal path, so a snack persists
// to the meals table, feeds the daily score, and counts toward the coach's logging-completeness
// read — unlike the old ephemeral quick-add toggles it complements.
import type { EditableFood, MacroSet } from './mealEdit';

export interface SnackPreset {
  id: string;
  name: string;
  /** Human serving label shown on the logged food row. */
  serving: string;
  /** Macros for one serving. */
  per: MacroSet;
  /** Liquid calories the nutritionist asks about vs a solid snack (lets the UI group them). */
  kind: 'shake' | 'snack';
}

/** Curated between-meal presets, shakes first (the liquid calories coaches push hardest).
 *  Macros are typical label/estimate values; the athlete can still edit the logged food. */
export const SNACK_PRESETS: readonly SnackPreset[] = [
  { id: 'core_power_42', name: 'Core Power Elite (42g)', serving: '1 bottle (14 oz)', per: { protein: 42, kcal: 230, carbs: 9, fat: 2 }, kind: 'shake' },
  { id: 'core_power_26', name: 'Core Power (26g)', serving: '1 bottle (14 oz)', per: { protein: 26, kcal: 170, carbs: 8, fat: 4 }, kind: 'shake' },
  { id: 'choc_milk', name: 'Chocolate milk', serving: '16 oz', per: { protein: 16, kcal: 320, carbs: 52, fat: 8 }, kind: 'shake' },
  { id: 'whey_shake', name: 'Protein shake (whey)', serving: '1 scoop + water', per: { protein: 25, kcal: 130, carbs: 4, fat: 2 }, kind: 'shake' },
  { id: 'smoothie', name: 'Fruit + protein smoothie', serving: '16 oz', per: { protein: 30, kcal: 380, carbs: 55, fat: 6 }, kind: 'shake' },
  { id: 'greek_yogurt', name: 'Greek yogurt cup', serving: '1 cup', per: { protein: 18, kcal: 150, carbs: 12, fat: 4 }, kind: 'snack' },
  { id: 'banana_pb', name: 'Banana + peanut butter', serving: '1 banana + 2 tbsp', per: { protein: 8, kcal: 300, carbs: 40, fat: 16 }, kind: 'snack' },
  { id: 'protein_bar', name: 'Protein bar', serving: '1 bar', per: { protein: 20, kcal: 220, carbs: 22, fat: 7 }, kind: 'snack' },
  { id: 'turkey_rollups', name: 'Turkey roll-ups', serving: '4 slices', per: { protein: 22, kcal: 120, carbs: 4, fat: 2 }, kind: 'snack' },
  { id: 'cottage_cheese', name: 'Cottage cheese', serving: '1 cup', per: { protein: 24, kcal: 180, carbs: 8, fat: 5 }, kind: 'snack' },
  { id: 'trail_mix', name: 'Trail mix', serving: '1/4 cup', per: { protein: 6, kcal: 200, carbs: 18, fat: 13 }, kind: 'snack' },
  { id: 'fruit_cup', name: 'Fruit cup', serving: '1 cup', per: { protein: 1, kcal: 90, carbs: 23, fat: 0 }, kind: 'snack' },
];

/** Project a preset into an EditableFood for the normal saveMeal logging path (servings = 1;
 *  the macros already describe one serving). */
export function snackToFood(preset: SnackPreset): EditableFood {
  return { name: preset.name, portion: preset.serving, servings: 1, per: { ...preset.per } };
}

/** A copy of `foods` with `add` appended — the helper addSnack uses to accumulate multiple
 *  snacks/shakes in the day's snack slot instead of replacing it. Pure. */
export function appendSnack(foods: EditableFood[] | undefined, add: EditableFood): EditableFood[] {
  return [...(foods ?? []), add];
}
