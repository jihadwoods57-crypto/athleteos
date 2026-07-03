// OnStandard — Restaurant Coach (Layers 2 + 3 of the Nutrition Intelligence Engine).
// Pure TS, no RN imports.
//
// The flagship "answer before you eat" engine: given WHERE the athlete is (restaurant),
// WHO they are (goal + remaining daily targets), and their constraints (budget, timing),
// recommend a concrete ORDER, with the nutrition totals, a goal-aware "why", and ranked
// alternatives (leaner / budget / recovery / muscle-gain). Deterministic and testable —
// this is the decision engine the LLM (Layer 7) narrates, not an LLM guess. Goal-aware by
// construction: the SAME restaurant yields different orders for a different athlete.
import {
  itemsForRestaurant,
  type NutritionTag,
  type RestaurantItem,
} from './restaurants';

export type EngineGoal = 'gain' | 'lose' | 'maintain' | 'performance';
export type EatingContext = 'pre-workout' | 'post-workout' | 'general';

export interface RecommendContext {
  restaurantId: string;
  goal: EngineGoal;
  /** Grams of protein still to hit today (from computeDerived.proteinGap). */
  proteinRemaining: number;
  /** Calories still available today (calTarget - kcalToday). */
  caloriesRemaining: number;
  /** Optional spend cap in USD ("I have $12"). */
  budget?: number;
  /** Situational context (Layer 5) that shifts the objective + the explanation. */
  context?: EatingContext;
  /** Confirmed avoid foods (allergies/dislikes) from the athlete's memory —
   *  avoidFoodsFromFacts(). The HARD filter this recommender must honor: a matching
   *  item can never be recommended, in the primary OR any alternative. */
  avoid?: string[];
}

export interface OrderLine {
  item: RestaurantItem;
  qty: number;
}

export interface OrderTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  price: number;
}

export interface RecommendedOrder {
  lines: OrderLine[];
  totals: OrderTotals;
  why: string;
  tags: NutritionTag[];
}

export interface RecommendResult {
  restaurantId: string;
  primary: RecommendedOrder;
  alternatives: { label: string; order: RecommendedOrder }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Objective value of an item for a goal — the heart of goal-awareness. Higher = better
 *  fit. Negative means "actively works against this goal" (e.g. fries on a fat-loss day). */
function valueOf(it: RestaurantItem, goal: EngineGoal, context: EatingContext): number {
  const carbBoost = context === 'post-workout' ? 0.6 : context === 'pre-workout' ? 0.4 : 0;
  switch (goal) {
    case 'gain':
      return it.protein * 2 + it.calories * 0.05 + it.carbs * carbBoost;
    case 'lose':
      return it.protein * 3 - it.fat * 1.2 - it.calories * 0.03;
    case 'performance':
      return it.protein * 2 + it.carbs * (0.5 + carbBoost) - it.fat * 0.2;
    default: // maintain
      return it.protein * 2 - it.fat * 0.3 + it.carbs * carbBoost;
  }
}

function sum(items: RestaurantItem[]): OrderTotals {
  return items.reduce<OrderTotals>(
    (t, i) => ({
      calories: t.calories + i.calories,
      protein: t.protein + i.protein,
      carbs: t.carbs + i.carbs,
      fat: t.fat + i.fat,
      price: +(t.price + i.price).toFixed(2),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, price: 0 },
  );
}

function dedupeTags(items: RestaurantItem[]): NutritionTag[] {
  const seen = new Set<NutritionTag>();
  for (const it of items) for (const t of it.tags) seen.add(t);
  return [...seen];
}

/** Greedy, deterministic order builder for one goal+context under budget/calorie limits. */
function buildOrder(ctx: RecommendContext, goal: EngineGoal): RecommendedOrder {
  const context = ctx.context ?? 'general';
  // The avoid list is absolute: a confirmed allergen/dislike never enters the item
  // pool, so it can't be an anchor, a side, or an alternative. Name-based match —
  // deterministic, no model in the loop.
  const avoid = (ctx.avoid ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const all = itemsForRestaurant(ctx.restaurantId).filter(
    (i) => !avoid.some((a) => i.name.toLowerCase().includes(a)),
  );
  const budget = typeof ctx.budget === 'number' && ctx.budget > 0 ? ctx.budget : Infinity;
  // Fat-loss respects the day's remaining calories (capped to a sane single-meal ceiling);
  // gain/performance don't hard-cap (the point is to fuel).
  const calorieCap = goal === 'lose' ? clamp(ctx.caloriesRemaining || 650, 350, 800) : Infinity;
  const proteinTarget = clamp(ctx.proteinRemaining || 40, 25, 60);

  const chosen: RestaurantItem[] = [];
  const fits = (it: RestaurantItem): boolean => {
    const t = sum([...chosen, it]);
    return t.price <= budget && t.calories <= calorieCap;
  };

  // Component restaurants (e.g. Chipotle) have a 0-protein base entree the protein sits on;
  // reserve its cost so the anchor we pick still leaves room for the base under budget.
  const base = all.find((i) => i.category === 'entree' && i.protein === 0);
  const baseCost = base ? base.price : 0;

  // Anchor: the best main (entree/protein/drink) that fits — with the base reserved.
  const mains = all
    .filter((i) => i.category === 'entree' || i.category === 'protein' || i.category === 'drink')
    .filter((i) => i.protein > 0)
    .sort((a, b) => valueOf(b, goal, context) - valueOf(a, goal, context));
  const anchor = mains.find((it) => {
    const reserve = it.category === 'protein' ? baseCost : 0;
    return it.price + reserve <= budget && (goal !== 'lose' || it.calories <= calorieCap);
  });
  if (anchor) chosen.push(anchor);

  // Include the base when the anchor is a build-your-own protein, for a realistic price.
  if (anchor && anchor.category === 'protein' && base) chosen.push(base);

  // Add sides/items while protein is short (and, for gain, while calories/budget allow),
  // taking the highest positive-value item that still fits each round.
  for (let round = 0; round < 3; round++) {
    const totals = sum(chosen);
    if (totals.protein >= proteinTarget && goal !== 'gain') break;
    const next = all
      // Only sides/drinks/snacks round out the order — the anchor is the one main, so we
      // never stack three entrees/proteins into an unrealistic single order.
      .filter((i) => i.category !== 'protein' && i.category !== 'entree')
      .filter((i) => !chosen.includes(i))
      .filter((i) => valueOf(i, goal, context) > 0 && fits(i))
      .sort((a, b) => valueOf(b, goal, context) - valueOf(a, goal, context))[0];
    if (!next) break;
    chosen.push(next);
  }

  const totals = sum(chosen);
  return { lines: chosen.map((i) => ({ item: i, qty: 1 })), totals, why: explain(ctx, goal, totals), tags: dedupeTags(chosen) };
}

/** Goal-aware natural-language rationale (the deterministic seed; Layer 7 can enrich it). */
function explain(ctx: RecommendContext, goal: EngineGoal, t: OrderTotals): string {
  if (t.protein === 0) return 'No matching items found within your budget. Try raising the budget or a different spot.';
  const proteinLeft = Math.max(0, Math.round(ctx.proteinRemaining));
  const covers = proteinLeft > 0 ? ` That covers ${Math.min(t.protein, proteinLeft)}g of your remaining ${proteinLeft}g protein for today.` : '';
  switch (goal) {
    case 'gain':
      return `Built for size: ${t.protein}g protein and ${t.calories} calories to push toward your gain goal.${covers}`;
    case 'lose':
      return `Protein-dense and lean: ${t.protein}g protein for just ${t.calories} calories, within your remaining intake for the day.${covers}`;
    case 'performance':
      return ctx.context === 'post-workout'
        ? `Recovery-focused: ${t.protein}g protein and ${t.carbs}g carbs to repair muscle and refill glycogen after training.${covers}`
        : `Performance fuel: ${t.protein}g protein with ${t.carbs}g quality carbs, easy to train on.${covers}`;
    default:
      return `Balanced choice: ${t.protein}g protein and ${t.calories} calories that fits your plan for the day.${covers}`;
  }
}

/** Goal-aware guidance when the athlete is NOT at a chain in the database (a cafeteria,
 *  a local spot, an unlisted chain). Same targets the order builder uses, expressed as a
 *  "build your plate" template instead of a specific order — so the coach is useful
 *  anywhere, never a dead end. Pure. */
export interface GenericGuidance {
  /** Protein (g) to aim for at THIS meal. */
  proteinTarget: number;
  /** Calorie ceiling for this meal on a fat-loss day (omitted otherwise — gain/perf fuel). */
  calorieCeiling?: number;
  /** Goal-aware one-line framing. */
  headline: string;
  /** Concrete "build your plate" picks, ordered. */
  pick: string[];
  /** What to skip for this goal. */
  skip: string[];
}

export function genericMealGuidance(ctx: {
  goal: EngineGoal;
  proteinRemaining: number;
  caloriesRemaining: number;
  context?: EatingContext;
}): GenericGuidance {
  const context = ctx.context ?? 'general';
  const proteinTarget = Math.round(clamp(ctx.proteinRemaining || 40, 25, 60));
  const calorieCeiling = ctx.goal === 'lose' ? Math.round(clamp(ctx.caloriesRemaining || 650, 350, 800)) : undefined;
  const protein = `Anchor with a lean protein — grilled chicken, turkey, lean beef, fish, eggs, or a protein shake. Aim for ~${proteinTarget}g.`;
  const carb = context === 'post-workout'
    ? 'Add a real carb to refill the tank: rice, potato, pasta, fruit, or bread.'
    : 'Add a smart carb: rice, potato, whole-grain bread, beans, or fruit.';
  const veg = 'Fill the rest of the plate with vegetables or a side salad.';

  switch (ctx.goal) {
    case 'gain':
      return {
        proteinTarget,
        headline: `You have room to fuel — get ${proteinTarget}g+ protein and don't shy from calories.`,
        pick: [protein, carb, 'Add a calorie-dense extra: avocado/guac, cheese, nuts, or olive oil.', veg],
        skip: ['Diet sodas and "light" options — today you want the calories.'],
      };
    case 'lose':
      return {
        proteinTarget,
        calorieCeiling,
        headline: `Stay lean: hit ${proteinTarget}g protein and keep this meal near ${calorieCeiling} calories.`,
        pick: [protein, 'Double the non-starchy vegetables — they fill you up for few calories.', 'Keep one fist-sized carb, choose grilled over fried.', 'Sauces and dressing on the side.'],
        skip: ['Fried items, sugary drinks, and refined-carb sides (fries, chips, white bread).'],
      };
    case 'performance':
      return {
        proteinTarget,
        headline: context === 'post-workout'
          ? `Recover: ${proteinTarget}g protein plus carbs to repair muscle and refill glycogen.`
          : `Fuel to train: ${proteinTarget}g protein with quality carbs you can move on.`,
        pick: [protein, carb, veg, 'Hydrate — water or milk over soda.'],
        skip: ['Heavy fried/greasy food right before training — it sits hard.'],
      };
    default: // maintain
      return {
        proteinTarget,
        headline: `Build a balanced plate: ${proteinTarget}g protein, a smart carb, and vegetables.`,
        pick: [protein, carb, veg],
        skip: ['Sugary drinks — make it water or milk.'],
      };
  }
}

/**
 * Recommend an order for the athlete's primary goal, plus ranked alternatives (leaner,
 * budget, recovery, muscle-gain) — every one a real order off the same menu. Pure.
 */
export function recommendOrder(ctx: RecommendContext): RecommendResult {
  const primary = buildOrder(ctx, ctx.goal);

  const altSpecs: { label: string; goal: EngineGoal; ctx?: Partial<RecommendContext> }[] = [
    { label: 'Leaner / fat-loss', goal: 'lose' },
    { label: 'Budget', goal: ctx.goal, ctx: { budget: Math.min(ctx.budget ?? 10, 10) } },
    { label: 'Recovery', goal: 'performance', ctx: { context: 'post-workout' } },
    { label: 'Muscle gain', goal: 'gain' },
  ];

  const alternatives = altSpecs
    // Don't echo an alternative that's the same intent as the primary goal.
    .filter((a) => !(a.goal === ctx.goal && !a.ctx))
    .map((a) => ({ label: a.label, order: buildOrder({ ...ctx, ...a.ctx }, a.goal) }))
    // Drop alternatives that came back empty (e.g. budget too low).
    .filter((a) => a.order.totals.protein > 0);

  return { restaurantId: ctx.restaurantId, primary, alternatives };
}
