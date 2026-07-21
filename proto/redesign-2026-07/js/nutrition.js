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
  // ---- dairy ----
  { id: 'greek-yogurt', name: 'Greek yogurt (nonfat)', serving: '1 cup', per: m(23, 130, 9, 0) },
  { id: 'milk-2', name: 'Milk (2%)', serving: '1 cup', per: m(8, 122, 12, 5) },
  { id: 'cottage-cheese', name: 'Cottage cheese (low-fat)', serving: '1/2 cup', per: m(12, 90, 5, 2) },
  { id: 'cheddar', name: 'Cheddar cheese', serving: '1 oz', per: m(7, 113, 0, 9), aliases: ['cheese'] },
  { id: 'string-cheese', name: 'String cheese', serving: '1 stick', per: m(7, 80, 1, 6), aliases: ['mozzarella'] },
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
  // ---- fat ----
  { id: 'olive-oil', name: 'Olive oil', serving: '1 tbsp', per: m(0, 119, 0, 14), aliases: ['oil'] },
  { id: 'peanut-butter', name: 'Peanut butter', serving: '2 tbsp', per: m(7, 188, 8, 16), aliases: ['pb', 'nut butter'] },
  { id: 'almonds', name: 'Almonds', serving: '1 oz', per: m(6, 164, 6, 14), aliases: ['nuts'] },
  { id: 'walnuts', name: 'Walnuts', serving: '1 oz', per: m(4, 185, 4, 18), aliases: ['nuts'] },
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

/** Best single DB match for a detected-food name; tries the full name, then its longest word
 *  (so "Grilled chicken with herbs" still finds chicken). Undefined when nothing matches. */
export function matchFood(name) {
  const q = String(name == null ? '' : name).trim();
  if (!q) return undefined;
  const direct = searchFoods(q, 1)[0];
  if (direct) return direct;
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
  for (const w of words) {
    const hit = searchFoods(w, 1)[0];
    if (hit) return hit;
  }
  return undefined;
}

/** Servings implied by a kitchen-units quantity string ("2 eggs" → 2, "1/2 cup" → 0.5,
 *  "1.5 cups" → 1.5). Clamped 0.25–4 (a plate, not a platter); 1 when unparseable. */
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
 *  [per·PORTION_MIN, per·PORTION_MAX + HEADROOM_G], kcal snapped to the food's own Atwater
 *  value when it disagrees by >25%. Foods without a DB match keep their estimate (nothing to
 *  bound against). Returns { per: {protein,kcal,carbs,fat}, matched, adjusted }. */
export function groundFood(food) {
  const est = food && food.per ? food.per : {};
  let p = nn(est.protein), c = nn(est.carbs), f = nn(est.fat), kcal = nn(est.kcal);
  const hit = matchFood(food && food.name);
  let adjusted = false;
  if (hit) {
    const clamp = (val, ref) => {
      if (ref <= 0) return Math.min(val, PORTION_MAX * HEADROOM_G); // ref says ~none of this macro
      const lo = ref * PORTION_MIN, hi = ref * PORTION_MAX + HEADROOM_G;
      const out = Math.min(hi, Math.max(lo, val));
      if (Math.round(out) !== Math.round(val)) adjusted = true;
      return out;
    };
    p = clamp(p, hit.per.protein); c = clamp(c, hit.per.carbs); f = clamp(f, hit.per.fat);
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
