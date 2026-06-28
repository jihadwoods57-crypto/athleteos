// AthleteOS — restaurant nutrition database (Layer 1 of the Nutrition Intelligence
// Engine). Pure TS, no RN imports.
//
// Structured menu data for the chains athletes actually eat at, so the Restaurant Coach
// (restaurantCoach.ts) can recommend an ORDER before the athlete eats — not just log it
// after. Designed to scale to thousands of items: every item carries a confidence score
// and a lastVerified date so a future ingestion/admin pipeline (Layer 4) can grow and
// re-verify the table without code changes.
//
// HONESTY (same standard as foodDb.ts): this is a curated STARTER set. Macros are
// rounded public/estimated values and prices are approximate (they vary by region);
// each item is stamped with a confidence score and a verify date. A full, continuously
// verified catalog is the Layer-4 data pipeline — see the architecture notes in the PR.

/** Intelligent, goal-oriented tags an item can carry (Layer 1 "intelligent tags"). */
export type NutritionTag =
  | 'high-protein'
  | 'lean-protein'
  | 'post-workout'
  | 'weight-gain'
  | 'fat-loss'
  | 'recovery'
  | 'budget'
  | 'vegetarian'
  | 'vegan'
  | 'gluten-free';

export type RestaurantCategory =
  | 'entree'
  | 'protein'
  | 'side'
  | 'drink'
  | 'breakfast'
  | 'snack';

export interface RestaurantItem {
  /** Stable id: `${restaurantId}:${slug}`. */
  id: string;
  restaurantId: string;
  restaurant: string;
  category: RestaurantCategory;
  name: string;
  servingSize: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number; // mg
  /** Approximate menu price (USD) — required for budget-aware recommendations. */
  price: number;
  ingredients?: string[];
  tags: NutritionTag[];
  /** 0..1 confidence in this row's accuracy (drives Layer-4 re-verification priority). */
  confidence: number;
  /** ISO date (YYYY-MM-DD) this row was last verified. */
  lastVerified: string;
}

export interface Restaurant {
  id: string;
  name: string;
  /** Coarse cuisine/category for browse + context matching (Layer 5). */
  kind: 'mexican' | 'chicken' | 'sandwich' | 'burger' | 'smoothie' | 'coffee' | 'asian' | 'pizza' | 'mediterranean';
}

export const RESTAURANTS: Restaurant[] = [
  { id: 'chipotle', name: 'Chipotle', kind: 'mexican' },
  { id: 'chickfila', name: 'Chick-fil-A', kind: 'chicken' },
  { id: 'jerseymikes', name: "Jersey Mike's", kind: 'sandwich' },
  { id: 'wendys', name: "Wendy's", kind: 'burger' },
  { id: 'smoothieking', name: 'Smoothie King', kind: 'smoothie' },
  { id: 'cava', name: 'CAVA', kind: 'mediterranean' },
  { id: 'pandaexpress', name: 'Panda Express', kind: 'asian' },
  { id: 'subway', name: 'Subway', kind: 'sandwich' },
  { id: 'mcdonalds', name: "McDonald's", kind: 'burger' },
  { id: 'tacobell', name: 'Taco Bell', kind: 'mexican' },
  { id: 'panera', name: 'Panera Bread', kind: 'sandwich' },
  { id: 'starbucks', name: 'Starbucks', kind: 'coffee' },
  { id: 'raisingcanes', name: "Raising Cane's", kind: 'chicken' },
];

const V = '2026-06-27'; // starter verify stamp
const V2 = '2026-06-28'; // coverage-expansion stamp (chains added in the 2nd wave)

/** Helper to keep the literal table terse + consistent. */
function item(
  restaurantId: string,
  restaurant: string,
  category: RestaurantCategory,
  name: string,
  servingSize: string,
  m: { cal: number; p: number; c: number; f: number; fiber: number; sugar: number; sodium: number; price: number },
  tags: NutritionTag[],
  confidence = 0.7,
  verified: string = V,
): RestaurantItem {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `${restaurantId}:${slug}`,
    restaurantId,
    restaurant,
    category,
    name,
    servingSize,
    calories: m.cal,
    protein: m.p,
    carbs: m.c,
    fat: m.f,
    fiber: m.fiber,
    sugar: m.sugar,
    sodium: m.sodium,
    price: m.price,
    tags,
    confidence,
    lastVerified: verified,
  };
}

export const RESTAURANT_ITEMS: RestaurantItem[] = [
  // ---- Chipotle (build-your-own; components priced as add-ons over a base) ----
  item('chipotle', 'Chipotle', 'protein', 'Chicken (4oz)', '4 oz', { cal: 180, p: 32, c: 0, f: 7, fiber: 0, sugar: 0, sodium: 310, price: 0 }, ['high-protein', 'lean-protein', 'gluten-free']),
  item('chipotle', 'Chipotle', 'protein', 'Double Chicken (8oz)', '8 oz', { cal: 360, p: 64, c: 0, f: 14, fiber: 0, sugar: 0, sodium: 620, price: 4.5 }, ['high-protein', 'lean-protein', 'post-workout', 'gluten-free']),
  item('chipotle', 'Chipotle', 'protein', 'Steak (4oz)', '4 oz', { cal: 150, p: 21, c: 1, f: 6, fiber: 0, sugar: 0, sodium: 330, price: 1 }, ['high-protein', 'gluten-free']),
  item('chipotle', 'Chipotle', 'protein', 'Sofritas (tofu)', '4 oz', { cal: 150, p: 8, c: 9, f: 10, fiber: 3, sugar: 5, sodium: 560, price: 0 }, ['vegan', 'vegetarian']),
  item('chipotle', 'Chipotle', 'entree', 'Burrito Bowl base', 'bowl', { cal: 0, p: 0, c: 0, f: 0, fiber: 0, sugar: 0, sodium: 0, price: 8 }, ['gluten-free']),
  item('chipotle', 'Chipotle', 'side', 'White Rice', '4 oz', { cal: 210, p: 4, c: 40, f: 4, fiber: 1, sugar: 0, sodium: 350, price: 0 }, ['post-workout', 'recovery']),
  item('chipotle', 'Chipotle', 'side', 'Black Beans', '4 oz', { cal: 130, p: 8, c: 22, f: 2, fiber: 7, sugar: 1, sodium: 210, price: 0 }, ['vegetarian', 'recovery']),
  item('chipotle', 'Chipotle', 'side', 'Fajita Veggies', '2.5 oz', { cal: 20, p: 1, c: 5, f: 0, fiber: 1, sugar: 3, sodium: 150, price: 0 }, ['fat-loss', 'vegan', 'vegetarian']),
  item('chipotle', 'Chipotle', 'side', 'Guacamole', '4 oz', { cal: 230, p: 2, c: 8, f: 22, fiber: 6, sugar: 1, sodium: 370, price: 2.5 }, ['weight-gain', 'vegan', 'vegetarian']),
  item('chipotle', 'Chipotle', 'side', 'Cheese', '1 oz', { cal: 110, p: 6, c: 1, f: 8, fiber: 0, sugar: 0, sodium: 190, price: 0 }, ['weight-gain', 'vegetarian']),

  // ---- Chick-fil-A ----
  item('chickfila', 'Chick-fil-A', 'protein', 'Grilled Chicken Filet', '1 filet', { cal: 130, p: 25, c: 1, f: 3, fiber: 0, sugar: 0, sodium: 440, price: 4 }, ['high-protein', 'lean-protein', 'fat-loss']),
  item('chickfila', 'Chick-fil-A', 'entree', 'Grilled Nuggets (12)', '12 ct', { cal: 200, p: 38, c: 4, f: 4, fiber: 0, sugar: 1, sodium: 1000, price: 6.5 }, ['high-protein', 'lean-protein', 'post-workout']),
  item('chickfila', 'Chick-fil-A', 'entree', 'Chicken Sandwich', '1 sandwich', { cal: 420, p: 29, c: 41, f: 16, fiber: 1, sugar: 6, sodium: 1400, price: 5.5 }, ['high-protein', 'weight-gain']),
  item('chickfila', 'Chick-fil-A', 'entree', 'Cobb Salad w/ Grilled', '1 salad', { cal: 330, p: 36, c: 12, f: 15, fiber: 4, sugar: 6, sodium: 970, price: 9 }, ['high-protein', 'fat-loss', 'recovery']),
  item('chickfila', 'Chick-fil-A', 'side', 'Waffle Fries (medium)', 'medium', { cal: 420, p: 5, c: 45, f: 24, fiber: 5, sugar: 1, sodium: 240, price: 3 }, ['weight-gain']),
  item('chickfila', 'Chick-fil-A', 'side', 'Fruit Cup', 'medium', { cal: 60, p: 1, c: 15, f: 0, fiber: 2, sugar: 11, sodium: 0, price: 3.5 }, ['fat-loss', 'vegan', 'vegetarian']),

  // ---- Jersey Mike's ----
  item('jerseymikes', "Jersey Mike's", 'entree', 'Turkey Sub (regular, in a tub)', 'regular', { cal: 330, p: 36, c: 16, f: 14, fiber: 4, sugar: 7, sodium: 1600, price: 9 }, ['high-protein', 'lean-protein', 'fat-loss']),
  item('jerseymikes', "Jersey Mike's", 'entree', 'Chicken Philly (regular)', 'regular', { cal: 610, p: 46, c: 60, f: 20, fiber: 3, sugar: 8, sodium: 1700, price: 10 }, ['high-protein', 'weight-gain', 'post-workout']),
  item('jerseymikes', "Jersey Mike's", 'entree', 'Club Sub (giant)', 'giant', { cal: 1100, p: 70, c: 90, f: 50, fiber: 5, sugar: 12, sodium: 3200, price: 14 }, ['high-protein', 'weight-gain']),

  // ---- Wendy's ----
  item('wendys', "Wendy's", 'entree', 'Grilled Chicken Sandwich', '1 sandwich', { cal: 360, p: 34, c: 38, f: 8, fiber: 2, sugar: 8, sodium: 800, price: 6 }, ['high-protein', 'lean-protein']),
  item('wendys', "Wendy's", 'entree', "Dave's Single Burger", '1 burger', { cal: 590, p: 30, c: 39, f: 34, fiber: 2, sugar: 10, sodium: 1120, price: 7 }, ['high-protein', 'weight-gain']),
  item('wendys', "Wendy's", 'side', 'Baked Potato (plain)', '1 potato', { cal: 270, p: 7, c: 61, f: 0, fiber: 7, sugar: 3, sodium: 25, price: 3 }, ['recovery', 'post-workout', 'budget', 'vegan', 'vegetarian']),
  item('wendys', "Wendy's", 'side', 'Chili (small)', 'small', { cal: 240, p: 17, c: 23, f: 9, fiber: 6, sugar: 7, sodium: 880, price: 3 }, ['high-protein', 'budget', 'recovery']),

  // ---- Smoothie King ----
  item('smoothieking', 'Smoothie King', 'drink', 'Gladiator Chocolate (20oz)', '20 oz', { cal: 220, p: 45, c: 7, f: 2, fiber: 4, sugar: 2, sodium: 200, price: 8 }, ['high-protein', 'lean-protein', 'post-workout', 'recovery']),
  item('smoothieking', 'Smoothie King', 'drink', 'The Hulk Chocolate (20oz)', '20 oz', { cal: 670, p: 33, c: 70, f: 30, fiber: 4, sugar: 50, sodium: 250, price: 8.5 }, ['weight-gain', 'high-protein', 'post-workout']),
  item('smoothieking', 'Smoothie King', 'drink', 'Lean1 Chocolate (20oz)', '20 oz', { cal: 280, p: 27, c: 33, f: 5, fiber: 6, sugar: 18, sodium: 230, price: 8 }, ['high-protein', 'fat-loss', 'recovery']),

  // ---- CAVA (build-your-own Mediterranean bowl) ----
  item('cava', 'CAVA', 'protein', 'Grilled Chicken', '4 oz', { cal: 250, p: 27, c: 1, f: 14, fiber: 0, sugar: 0, sodium: 540, price: 0 }, ['high-protein', 'lean-protein', 'gluten-free'], 0.6, V2),
  item('cava', 'CAVA', 'protein', 'Harissa Honey Chicken', '4 oz', { cal: 290, p: 26, c: 10, f: 16, fiber: 0, sugar: 9, sodium: 600, price: 0 }, ['high-protein', 'post-workout'], 0.6, V2),
  item('cava', 'CAVA', 'protein', 'Falafel', '4 pieces', { cal: 230, p: 9, c: 24, f: 11, fiber: 6, sugar: 3, sodium: 430, price: 0 }, ['vegetarian', 'vegan'], 0.6, V2),
  item('cava', 'CAVA', 'entree', 'Greens + Grains base', 'bowl', { cal: 360, p: 9, c: 60, f: 9, fiber: 8, sugar: 4, sodium: 400, price: 9 }, ['post-workout', 'recovery', 'vegetarian'], 0.6, V2),
  item('cava', 'CAVA', 'side', 'RightRice', '4 oz', { cal: 180, p: 5, c: 30, f: 5, fiber: 4, sugar: 1, sodium: 300, price: 0 }, ['recovery', 'vegetarian'], 0.6, V2),
  item('cava', 'CAVA', 'side', 'Hummus', '2 oz', { cal: 150, p: 5, c: 12, f: 9, fiber: 4, sugar: 1, sodium: 280, price: 0 }, ['vegetarian', 'vegan'], 0.6, V2),

  // ---- Panda Express ----
  item('pandaexpress', 'Panda Express', 'protein', 'Grilled Teriyaki Chicken', 'entree', { cal: 300, p: 36, c: 14, f: 11, fiber: 0, sugar: 11, sodium: 980, price: 6 }, ['high-protein', 'lean-protein', 'post-workout'], 0.6, V2),
  item('pandaexpress', 'Panda Express', 'protein', 'String Bean Chicken Breast', 'entree', { cal: 190, p: 14, c: 13, f: 9, fiber: 4, sugar: 7, sodium: 580, price: 6 }, ['lean-protein', 'fat-loss'], 0.6, V2),
  item('pandaexpress', 'Panda Express', 'entree', 'Orange Chicken', 'entree', { cal: 490, p: 25, c: 51, f: 23, fiber: 2, sugar: 19, sodium: 820, price: 6 }, ['high-protein', 'weight-gain'], 0.6, V2),
  item('pandaexpress', 'Panda Express', 'side', 'Super Greens', 'side', { cal: 90, p: 6, c: 10, f: 3, fiber: 4, sugar: 4, sodium: 320, price: 2 }, ['fat-loss', 'vegan', 'vegetarian'], 0.6, V2),
  item('pandaexpress', 'Panda Express', 'side', 'Brown Steamed Rice', 'side', { cal: 420, p: 9, c: 86, f: 4, fiber: 4, sugar: 0, sodium: 15, price: 2 }, ['post-workout', 'recovery', 'budget'], 0.6, V2),

  // ---- Subway ----
  item('subway', 'Subway', 'entree', 'Oven Roasted Turkey (6in)', '6 in', { cal: 250, p: 19, c: 38, f: 3, fiber: 5, sugar: 6, sodium: 580, price: 6 }, ['high-protein', 'lean-protein', 'fat-loss'], 0.6, V2),
  item('subway', 'Subway', 'entree', 'Rotisserie-Style Chicken (6in)', '6 in', { cal: 310, p: 27, c: 38, f: 6, fiber: 5, sugar: 7, sodium: 540, price: 7 }, ['high-protein', 'lean-protein'], 0.6, V2),
  item('subway', 'Subway', 'entree', 'Steak & Cheese (footlong)', 'footlong', { cal: 700, p: 48, c: 88, f: 22, fiber: 8, sugar: 14, sodium: 1500, price: 11 }, ['high-protein', 'weight-gain'], 0.6, V2),

  // ---- McDonald's ----
  item('mcdonalds', "McDonald's", 'breakfast', 'Egg McMuffin', '1 sandwich', { cal: 310, p: 17, c: 30, f: 13, fiber: 2, sugar: 3, sodium: 770, price: 4 }, ['high-protein', 'budget'], 0.6, V2),
  item('mcdonalds', "McDonald's", 'entree', 'McDouble', '1 burger', { cal: 400, p: 22, c: 33, f: 20, fiber: 2, sugar: 7, sodium: 920, price: 3.5 }, ['high-protein', 'weight-gain', 'budget'], 0.6, V2),
  item('mcdonalds', "McDonald's", 'entree', 'McNuggets (10 pc)', '10 ct', { cal: 410, p: 23, c: 25, f: 24, fiber: 1, sugar: 0, sodium: 840, price: 5 }, ['high-protein'], 0.6, V2),
  item('mcdonalds', "McDonald's", 'side', 'Apple Slices', '1 bag', { cal: 15, p: 0, c: 4, f: 0, fiber: 0, sugar: 3, sodium: 0, price: 1.5 }, ['fat-loss', 'vegan', 'vegetarian'], 0.6, V2),

  // ---- Taco Bell ----
  item('tacobell', 'Taco Bell', 'entree', 'Power Menu Bowl - Chicken', 'bowl', { cal: 470, p: 26, c: 50, f: 19, fiber: 7, sugar: 4, sodium: 1200, price: 6 }, ['high-protein', 'post-workout'], 0.6, V2),
  item('tacobell', 'Taco Bell', 'entree', 'Chicken Soft Taco', '1 taco', { cal: 170, p: 9, c: 16, f: 8, fiber: 2, sugar: 1, sodium: 380, price: 2 }, ['budget'], 0.6, V2),
  item('tacobell', 'Taco Bell', 'side', 'Black Beans & Rice', 'side', { cal: 170, p: 5, c: 30, f: 4, fiber: 6, sugar: 1, sodium: 320, price: 2 }, ['vegetarian', 'budget', 'recovery'], 0.6, V2),

  // ---- Panera Bread ----
  item('panera', 'Panera Bread', 'entree', 'Chipotle Chicken Avocado Melt', '1 sandwich', { cal: 730, p: 41, c: 65, f: 36, fiber: 5, sugar: 8, sodium: 1700, price: 11 }, ['high-protein', 'weight-gain'], 0.6, V2),
  item('panera', 'Panera Bread', 'entree', 'Turkey Sandwich', '1 sandwich', { cal: 470, p: 28, c: 53, f: 16, fiber: 4, sugar: 9, sodium: 1300, price: 9 }, ['high-protein'], 0.6, V2),
  item('panera', 'Panera Bread', 'breakfast', 'Greek Yogurt w/ Granola', '1 cup', { cal: 280, p: 12, c: 44, f: 7, fiber: 3, sugar: 24, sodium: 90, price: 5 }, ['recovery', 'vegetarian'], 0.6, V2),

  // ---- Starbucks ----
  item('starbucks', 'Starbucks', 'breakfast', 'Turkey Bacon & Egg White Sandwich', '1 sandwich', { cal: 230, p: 17, c: 28, f: 5, fiber: 3, sugar: 3, sodium: 550, price: 5 }, ['high-protein', 'lean-protein'], 0.6, V2),
  item('starbucks', 'Starbucks', 'snack', 'Egg White & Roasted Pepper Bites', '2 pieces', { cal: 170, p: 12, c: 11, f: 8, fiber: 1, sugar: 2, sodium: 470, price: 5 }, ['high-protein', 'fat-loss'], 0.6, V2),
  item('starbucks', 'Starbucks', 'drink', 'Grande Nonfat Latte', '16 oz', { cal: 130, p: 13, c: 19, f: 0, fiber: 0, sugar: 18, sodium: 170, price: 5 }, ['lean-protein'], 0.6, V2),

  // ---- Raising Cane's ----
  item('raisingcanes', "Raising Cane's", 'entree', 'Chicken Fingers (3 pc)', '3 ct', { cal: 310, p: 24, c: 17, f: 16, fiber: 1, sugar: 0, sodium: 720, price: 6 }, ['high-protein'], 0.6, V2),
  item('raisingcanes', "Raising Cane's", 'entree', '3 Finger Combo', 'combo', { cal: 660, p: 33, c: 67, f: 28, fiber: 4, sugar: 1, sodium: 1200, price: 9 }, ['high-protein', 'weight-gain'], 0.6, V2),
];

/** All items for a restaurant id. */
export function itemsForRestaurant(restaurantId: string): RestaurantItem[] {
  return RESTAURANT_ITEMS.filter((i) => i.restaurantId === restaurantId);
}

/** Items carrying a given intelligent tag (optionally scoped to one restaurant). */
export function itemsByTag(tag: NutritionTag, restaurantId?: string): RestaurantItem[] {
  return RESTAURANT_ITEMS.filter((i) => i.tags.includes(tag) && (!restaurantId || i.restaurantId === restaurantId));
}

/** Case-insensitive restaurant lookup by name or id (for "I'm at Chipotle"). */
export function findRestaurant(query: string): Restaurant | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return RESTAURANTS.find((r) => r.id === q || r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()));
}
