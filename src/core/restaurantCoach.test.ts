// OnStandard — Restaurant Coach engine. Proves goal-awareness (the SAME restaurant yields
// different orders for a gainer vs a fat-loss athlete), budget respect, protein targeting,
// and that alternatives are real non-empty orders.
import { recommendOrder, genericMealGuidance, type RecommendContext } from './restaurantCoach';
import { RESTAURANT_ITEMS, itemsForRestaurant, findRestaurant } from './restaurants';

const base = (over: Partial<RecommendContext> = {}): RecommendContext => ({
  restaurantId: 'chipotle',
  goal: 'maintain',
  proteinRemaining: 50,
  caloriesRemaining: 1200,
  ...over,
});

describe('database integrity', () => {
  it('every item has positive calories, a price, tags, and a confidence in 0..1', () => {
    for (const it of RESTAURANT_ITEMS) {
      expect(it.calories).toBeGreaterThanOrEqual(0);
      expect(it.price).toBeGreaterThanOrEqual(0);
      expect(it.tags.length).toBeGreaterThan(0);
      expect(it.confidence).toBeGreaterThan(0);
      expect(it.confidence).toBeLessThanOrEqual(1);
      expect(it.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('finds a restaurant from a loose query ("I\'m at Chipotle")', () => {
    expect(findRestaurant('chipotle')?.id).toBe('chipotle');
    expect(findRestaurant("Chick-fil-A")?.id).toBe('chickfila');
  });
});

describe('goal-awareness — same restaurant, different athlete', () => {
  it('a gainer gets more calories than a fat-loss athlete at the same place', () => {
    const gain = recommendOrder(base({ goal: 'gain' })).primary.totals;
    const lose = recommendOrder(base({ goal: 'lose', caloriesRemaining: 600 })).primary.totals;
    expect(gain.calories).toBeGreaterThan(lose.calories);
    expect(gain.protein).toBeGreaterThan(0);
    expect(lose.protein).toBeGreaterThan(0);
  });

  it('fat-loss stays within the remaining-calorie ceiling and skips fries', () => {
    const r = recommendOrder({ restaurantId: 'chickfila', goal: 'lose', proteinRemaining: 40, caloriesRemaining: 600 });
    expect(r.primary.totals.calories).toBeLessThanOrEqual(800);
    const names = r.primary.lines.map((l) => l.item.name.toLowerCase());
    expect(names.some((n) => n.includes('waffle fries'))).toBe(false);
  });

  it('hits a meaningful share of the protein target', () => {
    const r = recommendOrder(base({ goal: 'maintain', proteinRemaining: 45 }));
    expect(r.primary.totals.protein).toBeGreaterThanOrEqual(25);
  });
});

describe('confirmed-allergy avoid list — the hard filter a recommender must honor', () => {
  it('never recommends (or one-tap logs) an item matching a confirmed avoid food', () => {
    // memory.ts promises avoidFoodsFromFacts is "the hard filter a recommender must
    // honor" — but recommendOrder had no avoid input at all: an athlete who confirmed
    // "chicken = allergy" still got chicken items recommended and one-tap loggable.
    const withAvoid = recommendOrder({ restaurantId: 'chickfila', goal: 'gain', proteinRemaining: 45, caloriesRemaining: 900, avoid: ['chicken'] });
    const names = [
      ...withAvoid.primary.lines.map((l) => l.item.name.toLowerCase()),
      ...withAvoid.alternatives.flatMap((a) => a.order.lines.map((l) => l.item.name.toLowerCase())),
    ];
    expect(names.some((n) => n.includes('chicken'))).toBe(false);
  });

  it('an empty avoid list changes nothing', () => {
    const plain = recommendOrder({ restaurantId: 'chickfila', goal: 'gain', proteinRemaining: 45, caloriesRemaining: 900 });
    const empty = recommendOrder({ restaurantId: 'chickfila', goal: 'gain', proteinRemaining: 45, caloriesRemaining: 900, avoid: [] });
    expect(empty.primary.totals).toEqual(plain.primary.totals);
  });
});

describe('budget awareness', () => {
  it('never exceeds the stated budget', () => {
    const r = recommendOrder(base({ goal: 'gain', budget: 12 }));
    expect(r.primary.totals.price).toBeLessThanOrEqual(12);
  });
  it('still returns something under a tight budget', () => {
    const r = recommendOrder({ restaurantId: 'wendys', goal: 'lose', proteinRemaining: 30, caloriesRemaining: 600, budget: 8 });
    expect(r.primary.totals.price).toBeLessThanOrEqual(8);
    expect(r.primary.totals.protein).toBeGreaterThan(0);
  });
});

describe('genericMealGuidance — the off-menu fallback (works anywhere)', () => {
  const g = (over: Partial<Parameters<typeof genericMealGuidance>[0]> = {}) =>
    genericMealGuidance({ goal: 'maintain', proteinRemaining: 40, caloriesRemaining: 1200, ...over });

  it('always returns a protein target, a headline, and at least one pick + skip', () => {
    const out = g();
    expect(out.proteinTarget).toBeGreaterThanOrEqual(25);
    expect(out.proteinTarget).toBeLessThanOrEqual(60);
    expect(out.headline.length).toBeGreaterThan(0);
    expect(out.pick.length).toBeGreaterThan(0);
    expect(out.skip.length).toBeGreaterThan(0);
  });

  it('fat-loss carries a calorie ceiling within a sane single-meal range', () => {
    const out = g({ goal: 'lose', caloriesRemaining: 600 });
    expect(out.calorieCeiling).toBeGreaterThanOrEqual(350);
    expect(out.calorieCeiling).toBeLessThanOrEqual(800);
    expect(out.skip.join(' ').toLowerCase()).toMatch(/fried|sugary/);
  });

  it('gain/maintain carry no calorie ceiling (the point is to fuel)', () => {
    expect(g({ goal: 'gain' }).calorieCeiling).toBeUndefined();
    expect(g({ goal: 'maintain' }).calorieCeiling).toBeUndefined();
  });

  it('post-workout performance guidance emphasises carbs/recovery', () => {
    const out = g({ goal: 'performance', context: 'post-workout' });
    expect(`${out.headline} ${out.pick.join(' ')}`.toLowerCase()).toMatch(/carb|glycogen|refill/);
  });

  it('clamps a missing/zero protein remaining to a sane meal target', () => {
    expect(g({ proteinRemaining: 0 }).proteinTarget).toBe(40);
    expect(g({ proteinRemaining: 999 }).proteinTarget).toBe(60);
  });
});

describe('explanation + alternatives', () => {
  it('produces a goal-aware why and real alternative orders', () => {
    const r = recommendOrder(base({ goal: 'gain', proteinRemaining: 40 }));
    expect(r.primary.why.length).toBeGreaterThan(0);
    expect(r.primary.why).toMatch(/protein/i);
    expect(r.alternatives.length).toBeGreaterThan(0);
    for (const a of r.alternatives) {
      expect(a.order.lines.length).toBeGreaterThan(0);
      expect(a.order.totals.protein).toBeGreaterThan(0);
    }
    // a gainer's alternatives include a leaner option
    expect(r.alternatives.some((a) => a.label.includes('Leaner'))).toBe(true);
  });
});
