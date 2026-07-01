import {
  orderRephraseIsSafe,
  mergeRephrasedOrder,
  mergeRephrasedOrders,
  ordersToRephrase,
  type RephrasedOrder,
} from './restaurantCoachVoice';
import type { RecommendResult, RecommendedOrder } from './restaurantCoach';

const order = (why: string): RecommendedOrder => ({
  lines: [],
  totals: { calories: 850, protein: 42, carbs: 70, fat: 30, price: 12 },
  why,
  tags: ['high-protein'],
});

const PRIMARY_WHY = 'Built for size: 42g protein and 850 calories to push toward your gain goal. That covers 42g of your remaining 50g protein for today.';
const base = order(PRIMARY_WHY);

const warm = (over: Partial<RephrasedOrder> = {}): RephrasedOrder => ({
  id: 'primary',
  why: "Let's go big: 42g protein and 850 calories aimed right at your gain goal. That knocks out 42g of the 50g protein you've got left today.",
  ...over,
});

describe('orderRephraseIsSafe (strict number preservation)', () => {
  it('accepts a warmer rewrite that keeps every number', () => {
    expect(orderRephraseIsSafe(base, warm())).toBe(true);
  });
  it('rejects a changed number', () => {
    expect(orderRephraseIsSafe(base, warm({ why: '44g protein and 850 calories toward your 50g goal today.' }))).toBe(false);
  });
  it('rejects a dropped number', () => {
    expect(orderRephraseIsSafe(base, warm({ why: 'Big protein and big calories toward your goal today.' }))).toBe(false);
  });
  it('rejects an added number', () => {
    expect(orderRephraseIsSafe(base, warm({ why: '42g protein, 850 calories, 70g carbs toward your remaining 50g today.' }))).toBe(false);
  });
  it('rejects empty or over-long', () => {
    expect(orderRephraseIsSafe(base, warm({ why: '   ' }))).toBe(false);
    expect(orderRephraseIsSafe(base, warm({ why: '42 850 50 ' + 'x'.repeat(400) }))).toBe(false);
  });
});

describe('mergeRephrasedOrder', () => {
  it('swaps in warmer why when safe, preserving totals/lines/tags', () => {
    const out = mergeRephrasedOrder(base, warm());
    expect(out.why).toContain("Let's go big");
    expect(out.totals).toBe(base.totals);
    expect(out.tags).toBe(base.tags);
  });
  it('returns the original (same ref) when unsafe or absent', () => {
    expect(mergeRephrasedOrder(base, warm({ why: '99g protein, 850 cal, 50g left.' }))).toBe(base);
    expect(mergeRephrasedOrder(base, undefined)).toBe(base);
  });
});

describe('mergeRephrasedOrders (whole result)', () => {
  const result: RecommendResult = {
    restaurantId: 'chipotle',
    primary: base,
    alternatives: [
      { label: 'Leaner', order: order('Protein-dense and lean: 38g protein for just 620 calories. That covers 38g of your remaining 40g protein for today.') },
      { label: 'Budget', order: order('Solid value: 35g protein and 700 calories for 9 dollars. Covers 35g of your remaining 40g today.') },
    ],
  };

  it('warms primary + alternatives matched by id/label, preserving order/count', () => {
    const proposed: RephrasedOrder[] = [
      warm(),
      { id: 'Leaner', why: 'Lean and mean: 38g protein for only 620 calories, knocking out 38g of your remaining 40g today.' },
      { id: 'Budget', why: 'Best bang for 9 dollars: 35g protein and 700 calories, covering 35g of your remaining 40g today.' },
    ];
    const out = mergeRephrasedOrders(result, proposed);
    expect(out).not.toBe(result);
    expect(out.primary.why).toContain("Let's go big");
    expect(out.alternatives).toHaveLength(2);
    expect(out.alternatives[0].label).toBe('Leaner');
    expect(out.alternatives[0].order.why).toContain('Lean and mean');
    expect(out.alternatives[1].order.why).toContain('Best bang');
  });

  it('returns the SAME result object when nothing safely warms (reference check basis)', () => {
    const bad: RephrasedOrder[] = [warm({ why: '99g protein 99 calories 99 left.' })];
    expect(mergeRephrasedOrders(result, bad)).toBe(result);
  });

  it('falls back per-order: one unsafe rewrite does not poison the others', () => {
    const proposed: RephrasedOrder[] = [
      warm({ why: '999g protein 850 cal 50g left.' }), // unsafe -> primary kept
      { id: 'Leaner', why: 'Lean: 38g protein for 620 calories, covering 38g of your remaining 40g today.' },
    ];
    const out = mergeRephrasedOrders(result, proposed);
    expect(out.primary).toBe(base); // unsafe -> engine why
    expect(out.alternatives[0].order.why).toContain('Lean:'); // safe -> warmed
    expect(out.alternatives[1].order).toBe(result.alternatives[1].order); // no rewrite -> engine
  });

  it('ordersToRephrase flattens primary + alternatives, prose only', () => {
    const flat = ordersToRephrase(result);
    expect(flat.map((o) => o.id)).toEqual(['primary', 'Leaner', 'Budget']);
    expect(flat[0].why).toBe(PRIMARY_WHY);
  });
});
