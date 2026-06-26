// AthleteOS — curated local food database (pure TS, no RN imports).
//
// The persona review's dietitian (Dana, RD) flagged that the meal estimate is a
// 4-item photo guess with no way to add a real food with real macros. This is the
// offline, deterministic answer: a small curated table of common foods with honest
// per-serving macros, plus a pure search, so an athlete can add a real food and the
// existing `mealEdit` engine recomputes the meal from it.
//
// Scope (honest): this is a STARTER table of everyday foods, not USDA FoodData
// Central. The macros are standard rounded per-serving values; portions are the
// listed serving. A full nutrition DB (thousands of foods, branded items, barcode
// lookup) is a backend/data step — see docs/FOUNDER-DECISIONS.md.

import type { MacroSet } from './mealEdit';

export interface FoodItem {
  /** Stable id, used as a React key and to de-dupe. */
  id: string;
  name: string;
  /** Human serving label these macros describe (e.g. "1 cup", "100 g", "1 large"). */
  serving: string;
  /** Macros for ONE serving. */
  per: MacroSet;
  /** Coarse category, for future filtering / grouping. */
  category: FoodCategory;
  /** Extra search terms (synonyms, plurals) not in the display name. */
  aliases?: string[];
}

export type FoodCategory =
  | 'protein'
  | 'grain'
  | 'dairy'
  | 'fruit'
  | 'vegetable'
  | 'fat'
  | 'snack'
  | 'drink';

const m = (protein: number, kcal: number, carbs: number, fat: number): MacroSet => ({
  protein,
  kcal,
  carbs,
  fat,
});

// Per-serving values are standard rounded references for the listed serving.
export const FOOD_DB: readonly FoodItem[] = [
  // ---- protein ----
  { id: 'chicken-breast', name: 'Grilled chicken breast', serving: '4 oz', category: 'protein', per: m(35, 187, 0, 4), aliases: ['poultry'] },
  { id: 'chicken-thigh', name: 'Chicken thigh', serving: '4 oz', category: 'protein', per: m(28, 250, 0, 14) },
  { id: 'ground-beef-90', name: 'Ground beef (90/10)', serving: '4 oz', category: 'protein', per: m(23, 199, 0, 11), aliases: ['hamburger', 'mince'] },
  { id: 'sirloin-steak', name: 'Sirloin steak', serving: '4 oz', category: 'protein', per: m(31, 207, 0, 9), aliases: ['beef'] },
  { id: 'salmon', name: 'Salmon fillet', serving: '4 oz', category: 'protein', per: m(25, 233, 0, 14), aliases: ['fish'] },
  { id: 'tuna-canned', name: 'Canned tuna (in water)', serving: '1 can (5 oz)', category: 'protein', per: m(27, 121, 0, 1), aliases: ['fish'] },
  { id: 'shrimp', name: 'Shrimp', serving: '4 oz', category: 'protein', per: m(24, 112, 1, 1), aliases: ['prawns', 'seafood'] },
  { id: 'pork-loin', name: 'Pork loin', serving: '4 oz', category: 'protein', per: m(27, 206, 0, 11) },
  { id: 'turkey-breast', name: 'Turkey breast', serving: '4 oz', category: 'protein', per: m(34, 153, 0, 1), aliases: ['poultry'] },
  { id: 'egg', name: 'Egg', serving: '1 large', category: 'protein', per: m(6, 72, 0, 5), aliases: ['eggs'] },
  { id: 'egg-whites', name: 'Egg whites', serving: '1/2 cup', category: 'protein', per: m(13, 63, 1, 0) },
  { id: 'tofu', name: 'Firm tofu', serving: '4 oz', category: 'protein', per: m(10, 94, 2, 6), aliases: ['soy', 'vegetarian'] },
  { id: 'black-beans', name: 'Black beans', serving: '1/2 cup', category: 'protein', per: m(8, 114, 20, 0), aliases: ['legumes'] },
  { id: 'lentils', name: 'Lentils', serving: '1/2 cup', category: 'protein', per: m(9, 115, 20, 0), aliases: ['legumes', 'dal'] },
  { id: 'whey-protein', name: 'Whey protein (1 scoop)', serving: '1 scoop', category: 'protein', per: m(24, 120, 3, 1), aliases: ['protein powder', 'shake'] },

  // ---- grain / starch ----
  { id: 'white-rice', name: 'White rice (cooked)', serving: '1 cup', category: 'grain', per: m(4, 205, 45, 0) },
  { id: 'brown-rice', name: 'Brown rice (cooked)', serving: '1 cup', category: 'grain', per: m(5, 216, 45, 2) },
  { id: 'quinoa', name: 'Quinoa (cooked)', serving: '1 cup', category: 'grain', per: m(8, 222, 39, 4) },
  { id: 'oats', name: 'Rolled oats (dry)', serving: '1/2 cup', category: 'grain', per: m(5, 150, 27, 3), aliases: ['oatmeal', 'porridge'] },
  { id: 'pasta', name: 'Pasta (cooked)', serving: '1 cup', category: 'grain', per: m(8, 220, 43, 1), aliases: ['spaghetti', 'noodles'] },
  { id: 'sweet-potato', name: 'Sweet potato', serving: '1 medium', category: 'grain', per: m(2, 103, 24, 0), aliases: ['yam'] },
  { id: 'white-potato', name: 'Potato', serving: '1 medium', category: 'grain', per: m(4, 161, 37, 0) },
  { id: 'bread-whole-wheat', name: 'Whole wheat bread', serving: '1 slice', category: 'grain', per: m(4, 80, 14, 1), aliases: ['toast'] },
  { id: 'bagel', name: 'Bagel', serving: '1 medium', category: 'grain', per: m(11, 277, 55, 2) },
  { id: 'tortilla', name: 'Flour tortilla', serving: '1 medium', category: 'grain', per: m(4, 140, 24, 4), aliases: ['wrap'] },

  // ---- dairy ----
  { id: 'greek-yogurt', name: 'Greek yogurt (nonfat)', serving: '1 cup', category: 'dairy', per: m(23, 130, 9, 0) },
  { id: 'milk-2', name: 'Milk (2%)', serving: '1 cup', category: 'dairy', per: m(8, 122, 12, 5) },
  { id: 'cottage-cheese', name: 'Cottage cheese (low-fat)', serving: '1/2 cup', category: 'dairy', per: m(12, 90, 5, 2) },
  { id: 'cheddar', name: 'Cheddar cheese', serving: '1 oz', category: 'dairy', per: m(7, 113, 0, 9), aliases: ['cheese'] },
  { id: 'string-cheese', name: 'String cheese', serving: '1 stick', category: 'dairy', per: m(7, 80, 1, 6), aliases: ['mozzarella'] },

  // ---- fruit ----
  { id: 'banana', name: 'Banana', serving: '1 medium', category: 'fruit', per: m(1, 105, 27, 0) },
  { id: 'apple', name: 'Apple', serving: '1 medium', category: 'fruit', per: m(1, 95, 25, 0) },
  { id: 'blueberries', name: 'Blueberries', serving: '1 cup', category: 'fruit', per: m(1, 84, 21, 0), aliases: ['berries'] },
  { id: 'strawberries', name: 'Strawberries', serving: '1 cup', category: 'fruit', per: m(1, 49, 12, 0), aliases: ['berries'] },
  { id: 'orange', name: 'Orange', serving: '1 medium', category: 'fruit', per: m(1, 62, 15, 0) },
  { id: 'grapes', name: 'Grapes', serving: '1 cup', category: 'fruit', per: m(1, 104, 27, 0) },

  // ---- vegetable ----
  { id: 'broccoli', name: 'Broccoli', serving: '1 cup', category: 'vegetable', per: m(3, 31, 6, 0), aliases: ['greens'] },
  { id: 'spinach', name: 'Spinach', serving: '1 cup', category: 'vegetable', per: m(1, 7, 1, 0), aliases: ['greens', 'salad'] },
  { id: 'mixed-greens', name: 'Mixed greens', serving: '2 cups', category: 'vegetable', per: m(1, 15, 3, 0), aliases: ['salad', 'lettuce'] },
  { id: 'green-beans', name: 'Green beans', serving: '1 cup', category: 'vegetable', per: m(2, 31, 7, 0) },
  { id: 'carrots', name: 'Carrots', serving: '1 cup', category: 'vegetable', per: m(1, 52, 12, 0) },
  { id: 'bell-pepper', name: 'Bell pepper', serving: '1 medium', category: 'vegetable', per: m(1, 31, 7, 0), aliases: ['capsicum'] },
  { id: 'avocado', name: 'Avocado', serving: '1/2 medium', category: 'vegetable', per: m(2, 120, 6, 11) },

  // ---- fat ----
  { id: 'olive-oil', name: 'Olive oil', serving: '1 tbsp', category: 'fat', per: m(0, 119, 0, 14), aliases: ['oil'] },
  { id: 'peanut-butter', name: 'Peanut butter', serving: '2 tbsp', category: 'fat', per: m(7, 188, 8, 16), aliases: ['pb', 'nut butter'] },
  { id: 'almonds', name: 'Almonds', serving: '1 oz', category: 'fat', per: m(6, 164, 6, 14), aliases: ['nuts'] },
  { id: 'walnuts', name: 'Walnuts', serving: '1 oz', category: 'fat', per: m(4, 185, 4, 18), aliases: ['nuts'] },

  // ---- snack / drink ----
  { id: 'protein-bar', name: 'Protein bar', serving: '1 bar', category: 'snack', per: m(20, 210, 22, 7), aliases: ['bar'] },
  { id: 'granola', name: 'Granola', serving: '1/2 cup', category: 'snack', per: m(5, 230, 37, 7) },
  { id: 'rice-cakes', name: 'Rice cakes', serving: '2 cakes', category: 'snack', per: m(1, 70, 15, 0) },
  { id: 'dark-chocolate', name: 'Dark chocolate', serving: '1 oz', category: 'snack', per: m(2, 170, 13, 12), aliases: ['chocolate'] },
  { id: 'orange-juice', name: 'Orange juice', serving: '1 cup', category: 'drink', per: m(2, 112, 26, 0), aliases: ['oj', 'juice'] },
  { id: 'sports-drink', name: 'Sports drink', serving: '20 oz', category: 'drink', per: m(0, 130, 34, 0), aliases: ['gatorade', 'electrolyte'] },
] as const;

/** Lowercased haystack (name + aliases) for one food, cached at module load. */
const haystack = (f: FoodItem): string => [f.name, ...(f.aliases ?? [])].join(' ').toLowerCase();
const INDEX: ReadonlyMap<string, string> = new Map(FOOD_DB.map((f) => [f.id, haystack(f)]));

/**
 * Rank a food against a query: lower score = better match, -1 = no match.
 * Exact name > name starts-with > word-in-name starts-with > substring anywhere.
 */
function matchScore(f: FoodItem, q: string): number {
  const name = f.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  // a word in the name starts with the query ("rice" -> "Brown rice")
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
  const hay = INDEX.get(f.id) ?? '';
  if (hay.includes(q)) return 3;
  return -1;
}

/**
 * Search the curated DB. Case-insensitive over name + aliases, ranked best-first
 * with a stable tie-break on name so results are deterministic (no clock/RNG).
 * An empty/blank query returns []. `limit` caps the result count (default 20).
 */
export function searchFoods(query: string, limit = 20): FoodItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { f: FoodItem; s: number }[] = [];
  for (const f of FOOD_DB) {
    const s = matchScore(f, q);
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => a.s - b.s || a.f.name.localeCompare(b.f.name));
  return scored.slice(0, Math.max(0, limit)).map((x) => x.f);
}

/** Look a food up by id (e.g. to re-add a previously chosen item). */
export function foodById(id: string): FoodItem | undefined {
  return FOOD_DB.find((f) => f.id === id);
}
