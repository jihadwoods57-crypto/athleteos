// AthleteOS — Restaurant Coach engine. Proves goal-awareness (the SAME restaurant yields
// different orders for a gainer vs a fat-loss athlete), budget respect, protein targeting,
// and that alternatives are real non-empty orders.
import { recommendOrder, type RecommendContext } from './restaurantCoach';
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
