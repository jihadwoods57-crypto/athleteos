/* OnStandard — nutrition grounding (pure; no DOM, no state).
   The shipped-WebView port of src/core/macroGrounding.ts + foodDb.ts, upgraded to per-food
   attribution (Tier 1: meal-session isolation + DB-backed nutrition). A vision model guesses
   grams from pixels; this bounds every per-food estimate against a curated reference table and
   Atwater consistency so a hallucinated "52g protein" can never reach the score — and so a
   deleted food's macros can be subtracted exactly, not left behind in the totals.
   FOOD_DB mirrors src/core/foodDb.ts — keep the two tables in sync (protoNutrition.test.ts
   asserts parity so they cannot drift silently). */

/** A plate can be roughly this many servings of a detected food (upper plausibility). */
const PORTION_MAX = 3;
/** ...or as little as this (lower plausibility), e.g. a garnish. */
const PORTION_MIN = 0.3;
/** Additive grams of headroom per food for always-present-but-undetected extras
 *  (cooking oil, butter, sauce) the lean reference misses. */
const HEADROOM_G = 8;
/** Meal-level kcal within this fraction of the Atwater value is left as reported. */
const KCAL_TOLERANCE = 0.12;

const m = (protein, kcal, carbs, fat) => ({ protein, kcal, carbs, fat });

/* Per-serving values are standard rounded references for the listed serving.
   MIRROR of src/core/foodDb.ts FOOD_DB — same ids, names, aliases, macros. */
export const FOOD_DB = [
  // ---- protein ----
  { id: 'chicken-breast', name: 'Grilled chicken breast', serving: '4 oz', per: m(35, 187, 0, 4), aliases: ['poultry'] },
  { id: 'chicken-thigh', name: 'Chicken thigh', serving: '4 oz', per: m(28, 250, 0, 14) },
  { id: 'ground-beef-90', name: 'Ground beef (90/10)', serving: '4 oz', per: m(23, 199, 0, 11), aliases: ['hamburger', 'mince'] },
  { id: 'sirloin-steak', name: 'Sirloin steak', serving: '4 oz', per: m(31, 207, 0, 9), aliases: ['beef'] },
  { id: 'salmon', name: 'Salmon fillet', serving: '4 oz', per: m(25, 233, 0, 14), aliases: ['fish'] },
  { id: 'tuna-canned', name: 'Canned tuna (in water)', serving: '1 can (5 oz)', per: m(27, 121, 0, 1), aliases: ['fish'] },
  { id: 'shrimp', name: 'Shrimp', serving: '4 oz', per: m(24, 112, 1, 1), aliases: ['prawns', 'seafood'] },
  { id: 'pork-loin', name: 'Pork loin', serving: '4 oz', per: m(27, 206, 0, 11) },
  { id: 'turkey-breast', name: 'Turkey breast', serving: '4 oz', per: m(34, 153, 0, 1), aliases: ['poultry'] },
  { id: 'egg', name: 'Egg', serving: '1 large', per: m(6, 72, 0, 5), aliases: ['eggs'] },
  { id: 'egg-whites', name: 'Egg whites', serving: '1/2 cup', per: m(13, 63, 1, 0) },
  { id: 'tofu', name: 'Firm tofu', serving: '4 oz', per: m(10, 94, 2, 6), aliases: ['soy', 'vegetarian'] },
  { id: 'black-beans', name: 'Black beans', serving: '1/2 cup', per: m(8, 114, 20, 0), aliases: ['legumes'] },
  { id: 'lentils', name: 'Lentils', serving: '1/2 cup', per: m(9, 115, 20, 0), aliases: ['legumes', 'dal'] },
  { id: 'whey-protein', name: 'Whey protein (1 scoop)', serving: '1 scoop', per: m(24, 120, 3, 1), aliases: ['protein powder', 'shake'] },
  { id: 'bacon', name: 'Bacon', serving: '3 strips', per: m(9, 129, 0, 10) },
  { id: 'breakfast-sausage', name: 'Breakfast sausage', serving: '2 links', per: m(8, 170, 1, 15), aliases: ['sausage', 'sausage links'] },
  { id: 'meatballs', name: 'Meatballs', serving: '3 meatballs', per: m(20, 240, 8, 17), aliases: ['meatball'] },
  // ---- grain / starch ----
  { id: 'white-rice', name: 'White rice (cooked)', serving: '1 cup', per: m(4, 205, 45, 0) },
  { id: 'brown-rice', name: 'Brown rice (cooked)', serving: '1 cup', per: m(5, 216, 45, 2) },
  { id: 'quinoa', name: 'Quinoa (cooked)', serving: '1 cup', per: m(8, 222, 39, 4) },
  { id: 'oats', name: 'Rolled oats (dry)', serving: '1/2 cup', per: m(5, 150, 27, 3), aliases: ['oatmeal', 'porridge'] },
  { id: 'pasta', name: 'Pasta (cooked)', serving: '1 cup', per: m(8, 220, 43, 1), aliases: ['spaghetti', 'noodles'] },
  { id: 'sweet-potato', name: 'Sweet potato', serving: '1 medium', per: m(2, 103, 24, 0), aliases: ['yam'] },
  { id: 'white-potato', name: 'Potato', serving: '1 medium', per: m(4, 161, 37, 0) },
  { id: 'bread-whole-wheat', name: 'Whole wheat bread', serving: '1 slice', per: m(4, 80, 14, 1), aliases: ['toast'] },
  { id: 'bagel', name: 'Bagel', serving: '1 medium', per: m(11, 277, 55, 2) },
  { id: 'tortilla', name: 'Flour tortilla', serving: '1 medium', per: m(4, 140, 24, 4), aliases: ['wrap'] },
  { id: 'grits', name: 'Grits (cooked)', serving: '1 cup', per: m(3, 143, 31, 0), aliases: ['polenta'] },
  { id: 'dinner-roll', name: 'Dinner roll', serving: '1 roll', per: m(3, 87, 15, 2), aliases: ['roll', 'bun', 'bread roll'] },
  { id: 'mashed-potato', name: 'Mashed potatoes', serving: '1/2 cup', per: m(2, 105, 18, 4), aliases: ['mashed potato'] },
  // ---- dairy ----
  { id: 'greek-yogurt', name: 'Greek yogurt (nonfat)', serving: '1 cup', per: m(23, 130, 9, 0) },
  { id: 'milk-2', name: 'Milk (2%)', serving: '1 cup', per: m(8, 122, 12, 5) },
  { id: 'cottage-cheese', name: 'Cottage cheese (low-fat)', serving: '1/2 cup', per: m(12, 90, 5, 2) },
  { id: 'cheddar', name: 'Cheddar cheese', serving: '1 oz', per: m(7, 113, 0, 9), aliases: ['cheese'] },
  { id: 'string-cheese', name: 'String cheese', serving: '1 stick', per: m(7, 80, 1, 6), aliases: ['mozzarella'] },
  { id: 'sour-cream', name: 'Sour cream', serving: '2 tbsp', per: m(1, 60, 1, 6) },
  // ---- fruit ----
  { id: 'banana', name: 'Banana', serving: '1 medium', per: m(1, 105, 27, 0) },
  { id: 'apple', name: 'Apple', serving: '1 medium', per: m(1, 95, 25, 0) },
  { id: 'blueberries', name: 'Blueberries', serving: '1 cup', per: m(1, 84, 21, 0), aliases: ['berries'] },
  { id: 'strawberries', name: 'Strawberries', serving: '1 cup', per: m(1, 49, 12, 0), aliases: ['berries'] },
  { id: 'orange', name: 'Orange', serving: '1 medium', per: m(1, 62, 15, 0) },
  { id: 'grapes', name: 'Grapes', serving: '1 cup', per: m(1, 104, 27, 0) },
  // ---- vegetable ----
  { id: 'broccoli', name: 'Broccoli', serving: '1 cup', per: m(3, 31, 6, 0), aliases: ['greens'] },
  { id: 'spinach', name: 'Spinach', serving: '1 cup', per: m(1, 7, 1, 0), aliases: ['greens', 'salad'] },
  { id: 'mixed-greens', name: 'Mixed greens', serving: '2 cups', per: m(1, 15, 3, 0), aliases: ['salad', 'lettuce'] },
  { id: 'green-beans', name: 'Green beans', serving: '1 cup', per: m(2, 31, 7, 0) },
  { id: 'carrots', name: 'Carrots', serving: '1 cup', per: m(1, 52, 12, 0) },
  { id: 'bell-pepper', name: 'Bell pepper', serving: '1 medium', per: m(1, 31, 7, 0), aliases: ['capsicum'] },
  { id: 'avocado', name: 'Avocado', serving: '1/2 medium', per: m(2, 120, 6, 11) },
  { id: 'asparagus', name: 'Asparagus', serving: '1 cup', per: m(3, 27, 5, 0) },
  { id: 'collard-greens', name: 'Collard greens (cooked)', serving: '1 cup', per: m(4, 70, 8, 3), aliases: ['collards', 'mustard greens', 'turnip greens'] },
  { id: 'onion', name: 'Onion', serving: '1/2 cup', per: m(1, 32, 7, 0), aliases: ['onions'] },
  { id: 'salsa', name: 'Salsa', serving: '2 tbsp', per: m(0, 10, 2, 0), aliases: ['pico de gallo', 'pico'] },
  { id: 'marinara', name: 'Marinara sauce', serving: '1/2 cup', per: m(2, 70, 10, 2), aliases: ['tomato sauce', 'pasta sauce', 'red sauce'] },
  // ---- fat ----
  { id: 'olive-oil', name: 'Olive oil', serving: '1 tbsp', per: m(0, 119, 0, 14), aliases: ['oil'] },
  { id: 'peanut-butter', name: 'Peanut butter', serving: '2 tbsp', per: m(7, 188, 8, 16), aliases: ['pb', 'nut butter'] },
  { id: 'almonds', name: 'Almonds', serving: '1 oz', per: m(6, 164, 6, 14), aliases: ['nuts'] },
  { id: 'walnuts', name: 'Walnuts', serving: '1 oz', per: m(4, 185, 4, 18), aliases: ['nuts'] },
  { id: 'butter', name: 'Butter', serving: '1 tbsp', per: m(0, 102, 0, 12) },
  // ---- snack / drink ----
  { id: 'protein-bar', name: 'Protein bar', serving: '1 bar', per: m(20, 210, 22, 7), aliases: ['bar'] },
  { id: 'granola', name: 'Granola', serving: '1/2 cup', per: m(5, 230, 37, 7) },
  { id: 'rice-cakes', name: 'Rice cakes', serving: '2 cakes', per: m(1, 70, 15, 0) },
  { id: 'dark-chocolate', name: 'Dark chocolate', serving: '1 oz', per: m(2, 170, 13, 12), aliases: ['chocolate'] },
  { id: 'orange-juice', name: 'Orange juice', serving: '1 cup', per: m(2, 112, 26, 0), aliases: ['oj', 'juice'] },
  { id: 'sports-drink', name: 'Sports drink', serving: '20 oz', per: m(0, 130, 34, 0), aliases: ['gatorade', 'electrolyte'] },
];

const haystack = (f) => [f.name, ...(f.aliases || [])].join(' ').toLowerCase();
const INDEX = new Map(FOOD_DB.map((f) => [f.id, haystack(f)]));

/* Exact name > name starts-with > word-in-name starts-with > substring anywhere. -1 = no match. */
function matchScore(f, q) {
  const name = f.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
  if ((INDEX.get(f.id) || '').includes(q)) return 3;
  return -1;
}

/** Ranked, deterministic search over name + aliases (same semantics as core searchFoods). */
export function searchFoods(query, limit = 20) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const f of FOOD_DB) {
    const s = matchScore(f, q);
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => a.s - b.s || a.f.name.localeCompare(b.f.name));
  return scored.slice(0, Math.max(0, limit)).map((x) => x.f);
}

/* PREPARATION AND SERVING WORDS — never a food's identity (accuracy fix 2026-08-06).
   The word fallback below sorts by LENGTH, which quietly assumed the longest word is the most
   identifying one. It is not: in "Grilled steak", "grilled" (7) beat "steak" (5), and "Grilled
   chicken breast" starts with "grilled" — so a ribeye resolved to chicken, and chicken's lean
   reference then clamped the steak's real 34g of fat down to 20g (450 kcal -> 316). Every word
   here is a cooking method, a cut/serving noun, or a filler word, so they are never matched on at
   all: a name with no food word left ("Grilled ribeye", before ribeye had an entry) returns
   UNDEFINED rather than falling back to them. That is the safer failure — groundFood leaves an
   unmatched food's estimate alone, while a wrong match actively clamps it against the wrong
   reference, which is the damage being fixed here.
   Deliberately NOT here: any word that is part of a real FOOD_DB name (mixed, green, white,
   brown, sweet, dark, sour, string, whole, dinner, breakfast) — filtering those would break the
   foods they identify. No FOOD_DB name consists only of words on this list. */
const PREP_WORDS = new Set([
  // cooking methods
  'grilled', 'roasted', 'baked', 'fried', 'seasoned', 'sauteed', 'steamed', 'boiled', 'braised',
  'smoked', 'broiled', 'poached', 'seared', 'scrambled', 'toasted', 'glazed', 'marinated',
  'breaded', 'stuffed', 'cooked', 'raw', 'homemade', 'crispy', 'loaded', 'topped', 'fresh',
  // cut / serving nouns
  'shredded', 'sliced', 'diced', 'chopped', 'minced', 'strips', 'links', 'wedges', 'bites',
  'chunks', 'fillet', 'filet', 'piece', 'pieces', 'slice', 'slices', 'portion', 'serving',
  'side', 'plate', 'bowl', 'cup', 'cups', 'ounce', 'ounces', 'style',
  // size / filler
  'medium', 'large', 'small', 'with', 'and', 'the', 'some', 'half',
]);

/** Best single DB match for a detected-food name; tries the full name, then its most identifying
 *  word (so "Grilled chicken with herbs" still finds chicken). Preparation and serving words are
 *  never matched on. Undefined when nothing matches, which leaves the estimate unbounded rather
 *  than bounding it against the wrong food. */
export function matchFood(name) {
  return matchFoodDetailed(name).hit;
}

/**
 * matchFood, plus HOW it matched: { hit, direct }.
 *
 * `direct` means the whole name (or an alias) found the entry. `direct:false` means only the
 * name's most identifying WORD did, and that distinction is load-bearing for portion scaling,
 * because the word fallback matches badly on compound dishes:
 *
 *     "Beef and broccoli stir fry"  ->  broccoli      (3g protein)
 *     "Jollof rice with goat"       ->  rice-cakes    (1g protein)
 *     "Dinner roll"                 ->  rolled oats   (the eval manifest's own note)
 *
 * A wide band made those survivable: the reference was wrong but it could only pull a number so
 * far. A band anchored on the portion is tighter by design, so the same wrong reference would
 * crush an honest 35g beef-and-broccoli read down to about 10g. Tightening is therefore allowed
 * ONLY on a direct match, where the entry really does describe the food on the plate.
 */
export function matchFoodDetailed(name) {
  const q = String(name == null ? '' : name).trim();
  if (!q) return { hit: undefined, direct: false };
  const direct = searchFoods(q, 1)[0];
  if (direct) return { hit: direct, direct: true };
  const words = q.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !PREP_WORDS.has(w))
    .sort((a, b) => b.length - a.length);
  for (const w of words) {
    const hit = searchFoods(w, 1)[0];
    if (hit) return { hit, direct: false };
  }
  return { hit: undefined, direct: false };
}

/* ---------------------------------------------------------------------------------------------
   PORTION: measured, not just described (2026-08-28).

   The model has always returned a `quantity` per item in plain kitchen units ("6 eggs",
   "1 cup rice", "10 oz"). Nothing ever converted it into an amount. It rode through meal-intel
   capped at 40 characters, got printed next to the food, and was thrown away — while the ONLY
   guard on the numbers was a plausibility band anchored to the curated table's ONE-serving
   reference. Two consequences, both measured before this change:

     - a genuinely large portion was crushed. Six eggs is 36g of protein; the ceiling was
       6g × 3 + 8 = 26g, so the athlete was told 26 and the confidence quietly dropped. The band
       was never wrong about eggs, it was wrong about how many.
     - a wrong portion was invisible. Because the band is ±(0.3× … 3×) of one serving it is
       nearly a no-op at normal sizes, so a read that says "1 cup rice" and prices three cups
       passes every downstream check. The totals check only proves the items sum to the total;
       the Atwater check only proves a macro set is internally consistent. Neither one has ever
       looked at the portion.

   So the band is now anchored on ref × servings, and servings is derived by comparing the
   model's quantity to THAT FOOD'S OWN serving label. The comparison is unit-aware, which is the
   whole reason parseServings below could never be used here: it reads "10 oz" as 10, and against
   a "4 oz" serving the truth is 2.5. Wiring the old parser into this path would have made the
   numbers worse, not better.

   FAILING TO PARSE IS A FIRST-CLASS OUTCOME. When the quantity and the serving label cannot be
   compared honestly ("a handful" against "1 oz", "1 plate" against "3 strips"), servingsFor
   reports resolved:false and groundFood keeps the ORIGINAL wide band. Nothing that passes today
   can start being clamped because a parser got clever.
   --------------------------------------------------------------------------------------------- */

/** Everything to the left of a unit: "1 1/2" → 1.5, "6-8" → 7 (a range means its midpoint),
 *  "half" → 0.5. Returns null when there is no number to read. */
function leadingAmount(s) {
  // NO bare-article rule. "a"/"an" reads as one in English, and expanding it here made "a few"
  // parse as one unit and tighten the band on a string that is not a quantity at all — the exact
  // regression this function exists to prevent. "half an egg" still works: the half rule below
  // consumes the article itself. An unexpanded "an egg" simply comes back unresolved, which costs
  // nothing, because unresolved means "keep the behaviour that already shipped".
  const t = String(s).toLowerCase().trim()
    .replace(/^one\s+/, '1 ').replace(/^two\s+/, '2 ').replace(/^three\s+/, '3 ')
    .replace(/^four\s+/, '4 ').replace(/^a?\s*half\s+(?:an?\s+)?/, '0.5 ')
    .replace(/^(?:one|a)\s+and\s+a\s+half\s+/, '1.5 ');
  // A range ("6-8 strips", "3–4 sticks") is an estimate of one thing, so take its midpoint.
  // The dashes here are ESCAPED, not literal. An en or em dash in this position is a RANGE
  // SEPARATOR the model may emit ("6\u20148 strips"), so the parser has to accept it; it is not
  // banned copy. The em-dash ratchet reads source and cannot tell those two apart, and it is
  // right to be strict, so the character is written as an escape and everything stays true.
  const range = t.match(/^(\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:\.\d+)?)/);
  if (range) return { n: (Number(range[1]) + Number(range[2])) / 2, rest: t.slice(range[0].length) };
  // Mixed number ("1 1/2 cups") before the bare fraction, or "1" swallows it and 1/2 is lost.
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) return { n: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), rest: t.slice(mixed[0].length) };
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return { n: Number(frac[1]) / Number(frac[2]), rest: t.slice(frac[0].length) };
  const plain = t.match(/^(\d+(?:\.\d+)?)/);
  if (plain) return { n: Number(plain[1]), rest: t.slice(plain[0].length) };
  return null;
}

/* Mass and volume in one base unit each, so "10 oz" and "4 oz" are the same currency. The
   "fl oz" entries MUST be tested before the bare ounce or a fluid ounce is weighed. */
const MASS_G = { g: 1, gram: 1, grams: 1, gm: 1, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };
const VOL_ML = {
  ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000,
  tsp: 4.93, teaspoon: 4.93, teaspoons: 4.93, tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79,
  cup: 236.6, cups: 236.6, pint: 473.2, pints: 473.2, quart: 946.4, quarts: 946.4,
};
const FL_OZ_ML = 29.57;

/** One measurement, normalised: { n, family, unit }. family is 'mass' | 'volume' | 'count'. */
function readMeasure(text) {
  const lead = leadingAmount(text);
  if (!lead || !isFinite(lead.n) || lead.n <= 0) return null;
  const rest = lead.rest.replace(/^[\s.]+/, '');
  const word = (rest.match(/^([a-z]+(?:\s+oz)?)/) || [])[1] || '';
  if (/^fl\s*oz/.test(rest) || /^fluid\s*ounce/.test(rest)) return { n: lead.n * FL_OZ_ML, family: 'volume', unit: 'fl oz' };
  const first = word.split(/\s+/)[0];
  if (MASS_G[first]) return { n: lead.n * MASS_G[first], family: 'mass', unit: first };
  if (VOL_ML[first]) return { n: lead.n * VOL_ML[first], family: 'volume', unit: first };
  return { n: lead.n, family: 'count', unit: first };
}

/** Every way a serving label can be read. "1 can (5 oz)" is BOTH one can and five ounces, and
 *  which one is usable depends entirely on how the model phrased its quantity. */
function readServingLabel(label) {
  const s = String(label == null ? '' : label);
  const out = [];
  const primary = readMeasure(s.replace(/\s*\([^)]*\)/, ''));
  if (primary) out.push(primary);
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) { const m = readMeasure(paren[1]); if (m) out.push(m); }
  return out;
}

/** "strips" and "strip" are the same unit; "large" and "eggs" are not. */
const sameNoun = (a, b) => {
  const norm = (x) => String(x || '').replace(/(?:es|s)$/, '');
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
};
/** Serving labels whose noun describes a SIZE rather than a countable thing. "1 large" is the
 *  unit of an egg, so "2 eggs" against it is plainly two. */
const SIZE_WORD = new Set(['large', 'medium', 'small', 'piece', 'pieces', 'serving', 'servings', 'each']);

/**
 * How many DB servings the model's quantity describes.
 *
 * Returns { servings, resolved }. `resolved` false means the two strings could not be compared
 * honestly and the caller must NOT tighten anything — see the block comment above.
 *
 * The count family is the one that needs care, because a bare count is only meaningful against a
 * unit. "9 strips" against a "3 strips" serving is three servings. "1 plate" against the same
 * serving is not a quantity at all, and guessing it is one third would be worse than admitting we
 * do not know. So a count comparison is allowed only when the nouns agree, when the serving's
 * noun is a size word, or when the serving is a single unit of the thing.
 */
export function servingsFor(quantity, servingLabel) {
  const unresolved = { servings: 1, resolved: false };
  const q = readMeasure(String(quantity == null ? '' : quantity).trim());
  if (!q) return unresolved;
  // "2 servings" says it outright and needs no reference at all.
  if (q.family === 'count' && /^(serving|portion)/.test(q.unit)) {
    return { servings: clampServings(q.n), resolved: true };
  }
  for (const ref of readServingLabel(servingLabel)) {
    if (ref.family !== q.family || !(ref.n > 0)) continue;
    if (q.family === 'count') {
      const comparable = sameNoun(q.unit, ref.unit) || SIZE_WORD.has(ref.unit) || ref.n === 1;
      if (!comparable) continue;
    }
    return { servings: clampServings(q.n / ref.n), resolved: true };
  }
  return unresolved;
}

/** A real plate, generously bounded. Ten servings of one food is a competitive eater; a fifth of
 *  a serving is a taste. Beyond either end the string is likelier to be a parse artefact. */
function clampServings(s) {
  if (!isFinite(s) || s <= 0) return 1;
  return Math.min(10, Math.max(0.2, s));
}

/** Servings implied by a kitchen-units quantity string ("2 eggs" → 2, "1/2 cup" → 0.5,
 *  "1.5 cups" → 1.5). Clamped 0.25–4 (a plate, not a platter); 1 when unparseable.
 *
 *  UNIT-BLIND BY DESIGN, and kept that way: it backs priceAddedFood, where the athlete picked the
 *  food out of the table themselves and "2" means two of whatever the table says a serving is.
 *  For grounding an AI read against a serving LABEL, use servingsFor — this one turns "10 oz"
 *  into 10 (then 4), which against a "4 oz" serving is wrong by 60%. */
export function parseServings(quantity) {
  const s = String(quantity == null ? '' : quantity).trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  let n = frac ? Number(frac[1]) / Number(frac[2]) : Number((s.match(/^(\d+(?:\.\d+)?)/) || [])[1]);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(4, Math.max(0.25, n));
}

const nn = (x) => (typeof x === 'number' && isFinite(x) && x > 0 ? x : 0);

/** True when a detected food carries its own AI macro estimate (new analyze-meal payloads). */
export function foodHasMacros(f) {
  return !!f && ['protein', 'kcal', 'carbs', 'fat'].some((k) => typeof f.per === 'object' && f.per && isFinite(Number(f.per[k])) && Number(f.per[k]) > 0);
}

/** Ground ONE food's macro estimate against its DB reference: each macro clamped into
 *  a band around per × servings (servingsFor, from the model's own quantity string) — or around
 *  per × 1 on the original wide band when the quantity cannot be compared to the serving label.
 *  kcal snapped to the food's own Atwater
 *  value when it disagrees by >25%. Foods without a DB match keep their estimate (nothing to
 *  bound against). Returns { per: {protein,kcal,carbs,fat}, matched, adjusted }. */
export function groundFood(food) {
  const est = food && food.per ? food.per : {};
  let p = nn(est.protein), c = nn(est.carbs), f = nn(est.fat), kcal = nn(est.kcal);
  // READ beats REFERENCE (Core Power fix 2026-08-06): an item whose macros were read off its own
  // packaging ('label') or resolved from a product database ('database') is NOT an estimate, and
  // clamping it against a generic curated reference is how a true 42g-protein shake gets mangled
  // back into a 14g one. Those items skip the plausibility band; the Atwater snap below still
  // holds (a printed label can round, but it can't break food science by >25%).
  // `edited` joins the bypass (2026-08-09): once the athlete has told us what is actually in an
  // item, the curated reference for its NAME no longer describes it. A sandwich they told us also
  // has egg and cheese would otherwise be clamped straight back down into the plain-sandwich band,
  // silently undoing the correction we just promised them — the same mangling as the 42g shake.
  if (food && (food.basis === 'label' || food.basis === 'database' || food.edited === true)) {
    const atw = 4 * p + 4 * c + 9 * f;
    if (atw > 0 && (kcal <= 0 || Math.abs(kcal - atw) / atw > 0.25)) kcal = atw;
    return { per: { protein: Math.round(p), kcal: Math.round(kcal), carbs: Math.round(c), fat: Math.round(f) }, matched: true, adjusted: false };
  }
  const { hit, direct } = matchFoodDetailed(food && food.name);
  let adjusted = false;
  if (hit) {
    // THE PORTION THE MODEL SAID IT SAW. When it can be compared to this food's own serving
    // label, the reference becomes ref × servings and the band closes around the actual plate.
    //
    // TWO conditions, and both have to hold. `resolved` says the quantity and the serving label
    // are genuinely comparable; `direct` says the table entry actually describes this food
    // rather than one word of its name (see matchFoodDetailed). Either one false and every
    // number below falls back to the original one-serving band, so no read that passes today
    // can start being clamped tomorrow.
    const q = servingsFor(food && food.quantity, hit.serving);
    const servings = q.servings;
    const resolved = q.resolved && direct;
    // Widths, once the portion is known. They differ per macro because prep variance does:
    // protein density is close to fixed for a given food (you cannot cook chicken into three
    // times the protein), carbohydrate moves with sauce, breading and sugar, and fat is the
    // wild card the prompt explicitly tells the model to allow for when it cannot see the oil.
    const BAND = resolved
      ? { protein: [0.6, 1.6, 5], carbs: [0.5, 2.2, 8], fat: [0.4, 3.0, 10] }
      : { protein: [PORTION_MIN, PORTION_MAX, HEADROOM_G], carbs: [PORTION_MIN, PORTION_MAX, HEADROOM_G], fat: [PORTION_MIN, PORTION_MAX, HEADROOM_G] };
    const scale = resolved ? servings : 1;
    const clamp = (val, refPerServing, macro) => {
      const ref = refPerServing * scale;
      if (ref <= 0) {
        // The reference says this food has essentially none of this macro (rice has no fat), so
        // there is nothing to take a ratio of and the estimate gets a flat ceiling instead.
        // PORTION_MAX × HEADROOM_G is a curious way to spell 24 grams, since it multiplies a
        // unitless multiplier by a gram allowance, but it is the shipped number and changing it
        // belongs to its own change. What DOES belong here is the portion: three cups of rice
        // fried in oil can hold more fat than one cup, so the ceiling scales with the plate.
        return Math.min(val, PORTION_MAX * HEADROOM_G * scale);
      }
      const [loMul, hiMul, head] = BAND[macro];
      const lo = ref * loMul, hi = ref * hiMul + head;
      const out = Math.min(hi, Math.max(lo, val));
      if (Math.round(out) !== Math.round(val)) adjusted = true;
      return out;
    };
    p = clamp(p, hit.per.protein, 'protein'); c = clamp(c, hit.per.carbs, 'carbs'); f = clamp(f, hit.per.fat, 'fat');
  }
  const atwater = 4 * p + 4 * c + 9 * f;
  if (atwater > 0 && (kcal <= 0 || Math.abs(kcal - atwater) / atwater > 0.25)) { kcal = atwater; adjusted = true; }
  return { per: { protein: Math.round(p), kcal: Math.round(kcal), carbs: Math.round(c), fat: Math.round(f) }, matched: !!hit, adjusted };
}

/** Price a user-added food (no AI estimate) from the DB reference × parsed servings.
 *  Null when the DB has no match — the caller keeps totals honest by flagging it unpriced. */
export function priceAddedFood(name, quantity) {
  const hit = matchFood(name);
  if (!hit) return null;
  const s = parseServings(quantity);
  return {
    protein: Math.round(hit.per.protein * s), kcal: Math.round(hit.per.kcal * s),
    carbs: Math.round(hit.per.carbs * s), fat: Math.round(hit.per.fat * s),
  };
}

/** Meal-level Atwater reconciliation (shared tail of both grounding paths). */
function reconcileKcal(totals) {
  const atwater = 4 * totals.protein + 4 * totals.carbs + 9 * totals.fat;
  if (atwater <= 0) return totals;
  const dev = totals.kcal > 0 ? Math.abs(totals.kcal - atwater) / atwater : 1;
  return dev > KCAL_TOLERANCE ? { ...totals, kcal: Math.round(atwater) } : totals;
}

/**
 * Ground a whole meal from its per-food estimates: each food bounded individually, totals =
 * the exact sum — which is what makes deletion clean (remove the food, re-sum, nothing of it
 * survives). Foods without macros contribute nothing and are counted unpriced.
 * Returns { foods: [{...food, per}], totals, confidence, unpriced }.
 */
export function groundMealFromFoods(detectedRich) {
  const list = Array.isArray(detectedRich) ? detectedRich.filter(Boolean) : [];
  const foods = [];
  let p = 0, c = 0, f = 0, kcal = 0, matched = 0, adjusted = false, unpriced = 0;
  for (const d of list) {
    if (foodHasMacros(d)) {
      const g = groundFood(d);
      foods.push({ ...d, per: g.per });
      p += g.per.protein; c += g.per.carbs; f += g.per.fat; kcal += g.per.kcal;
      if (g.matched) matched++;
      if (g.adjusted) adjusted = true;
    } else {
      const priced = d.userAdded ? priceAddedFood(d.name, d.quantity) : null;
      if (priced) {
        foods.push({ ...d, per: priced });
        p += priced.protein; c += priced.carbs; f += priced.fat; kcal += priced.kcal;
        matched++;
      } else { foods.push({ ...d }); unpriced++; }
    }
  }
  const totals = reconcileKcal({ protein: Math.round(p), kcal: Math.round(kcal), carbs: Math.round(c), fat: Math.round(f) });
  const ratio = list.length ? matched / list.length : 0;
  let confidence = ratio >= 0.6 ? 'high' : ratio >= 0.3 ? 'medium' : 'low';
  if (adjusted || unpriced) confidence = confidence === 'high' ? 'medium' : 'low';
  return { foods, totals, confidence, unpriced };
}

/**
 * Fallback for payloads WITHOUT per-food macros (older analyze-meal deploys): the straight
 * port of core groundMealMacros — meal totals bounded against the summed DB reference for the
 * detected names, then Atwater-reconciled. Returns { totals, confidence }.
 */
export function groundMealTotals(estimate, detectedNames) {
  const est = { protein: nn(estimate && estimate.protein), kcal: nn(estimate && estimate.kcal), carbs: nn(estimate && estimate.carbs), fat: nn(estimate && estimate.fat) };
  const names = Array.isArray(detectedNames) ? detectedNames.filter(Boolean) : [];
  let refP = 0, refC = 0, refF = 0, matched = 0, adjusted = false;
  for (const name of names) {
    const hit = matchFood(name);
    if (hit) { refP += hit.per.protein; refC += hit.per.carbs; refF += hit.per.fat; matched++; }
  }
  const extrap = names.length && matched ? Math.min(2, names.length / matched) : 1;
  const clamp = (val, ref) => {
    if (ref <= 0) return val;
    const lo = ref * PORTION_MIN, hi = ref * PORTION_MAX * extrap + 18;
    const out = Math.min(hi, Math.max(lo, val));
    if (Math.round(out) !== Math.round(val)) adjusted = true;
    return out;
  };
  const protein = clamp(est.protein, refP), carbs = clamp(est.carbs, refC), fat = clamp(est.fat, refF);
  const totals = reconcileKcal({ protein: Math.round(protein), kcal: Math.round(est.kcal), carbs: Math.round(carbs), fat: Math.round(fat) });
  const ratio = names.length ? matched / names.length : 0;
  let confidence = ratio >= 0.6 ? 'high' : ratio >= 0.3 ? 'medium' : 'low';
  if (adjusted) confidence = confidence === 'high' ? 'medium' : 'low';
  return { totals, confidence };
}

/**
 * Did the read actually land? — the last line of defence before a meal is marked settled.
 *
 * The analyzer now rejects a truncated report server-side (see _shared/meal-report.ts), but this
 * client has to survive an older deploy, a verify payload, and its own grounding: a plate whose
 * every macro is zero is not a meal that happens to be empty, it is a read that never happened.
 * Landing one clears `pending`, and from that moment the athlete is stuck — the screen shows
 * "~0g protein - high confidence" and corrections only ever scale zero by another number.
 *
 * So: refuse it, and let the caller fall into the failure path that offers "Read it again".
 * Label and manual entries are exempt — those numbers came from the athlete, not a model.
 */
export function isCompleteMealResult(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.source === 'label' || r.source === 'manual') return true;
  let sum = 0;
  for (const k of ['protein', 'kcal', 'carbs', 'fat']) {
    const v = r[k];
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return false;
    sum += n;
  }
  if (sum <= 0) return false;
  // Grounding keeps the model's food list under `detectedRich`; the raw wire shape calls it
  // `detected`. Either satisfies this — what matters is that SOMETHING was identified.
  const foods = Array.isArray(r.detectedRich) && r.detectedRich.length ? r.detectedRich
    : Array.isArray(r.detected) ? r.detected : [];
  return foods.length > 0;
}

/**
 * The detected foods the curated table CAN'T ground (no matchFood hit) — the "gap" foods
 * (branded products, restaurant plates) whose macros ride through on the AI's raw estimate.
 * Post-log enrichment (enrich-meal) resolves exactly these against USDA/OFF to warm the learned
 * store for future meals. Pure: takes the staged/logged detectedRich list, returns a compact
 * payload [{ name, protein, kcal, carbs, fat }] deduped by name, capped, foods already in the
 * curated table excluded (never waste a USDA call on chicken or rice). Empty when nothing needs it.
 */
export function gapFoods(detectedRich, cap = 8) {
  const list = Array.isArray(detectedRich) ? detectedRich.filter(Boolean) : [];
  const out = [];
  const seen = new Set();
  for (const d of list) {
    const name = String((d && d.name) || '').trim();
    if (name.length < 2) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    // A label-read or product-resolved item is not a gap — its numbers came from the package or
    // the product cache, and "enriching" it against a generic USDA entry would be a downgrade.
    if (d && (d.basis === 'label' || d.basis === 'database')) continue;
    // Full-NAME match only (searchFoods), NOT matchFood's longest-word fallback: a food like
    // "Chipotle chicken burrito bowl" only weak-matches plain "chicken", which grounds a whole
    // bowl against 4 oz of breast — that poor partial match IS the gap enrichment exists to close.
    if (searchFoods(name, 1).length) continue; // the curated table grounds this by name — skip
    seen.add(k);
    const per = (d && d.per) || {};
    out.push({
      name,
      protein: nn(per.protein), kcal: nn(per.kcal), carbs: nn(per.carbs), fat: nn(per.fat),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * The PACKAGED PRODUCTS whose macros were READ off their label in this meal (basis 'label' with
 * a brand or exact product name) — the payload that warms the server's product cache
 * (enrich-meal `products`), so the next photo of the same product resolves from real data even
 * when its label is turned away. Pure; [] when nothing qualifies.
 */
export function labelProducts(detectedRich, cap = 4) {
  const list = Array.isArray(detectedRich) ? detectedRich.filter(Boolean) : [];
  const out = [];
  const seen = new Set();
  for (const d of list) {
    if (d.basis !== 'label') continue;
    const brand = String(d.brand || '').trim();
    const product = String(d.product || '').trim();
    if (!brand && !product) continue;
    const key = `${brand} ${product}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const per = d.per || {};
    if (!(nn(per.kcal) > 0)) continue; // junk would poison every future resolution
    out.push({
      brand, product,
      serving: typeof d.quantity === 'string' ? d.quantity : undefined,
      per: { protein: nn(per.protein), kcal: nn(per.kcal), carbs: nn(per.carbs), fat: nn(per.fat) },
    });
    if (out.length >= cap) break;
  }
  return out;
}
