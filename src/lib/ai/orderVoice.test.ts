import { rephraseOrders, isAiConfigured } from './index';
import type { RecommendResult } from '@/core';

const result: RecommendResult = {
  restaurantId: 'chipotle',
  primary: {
    lines: [],
    totals: { calories: 850, protein: 42, carbs: 70, fat: 30, price: 12 },
    why: 'Built for size: 42g protein and 850 calories to push toward your gain goal.',
    tags: ['high-protein'],
  },
  alternatives: [
    { label: 'Leaner', order: { lines: [], totals: { calories: 620, protein: 38, carbs: 50, fat: 20, price: 11 }, why: 'Lean: 38g protein for 620 calories.', tags: ['lean-protein'] } },
  ],
};

describe('rephraseOrders', () => {
  it('is inert without a configured backend', () => {
    expect(isAiConfigured).toBe(false);
  });

  it('returns the deterministic recommendation UNCHANGED when AI is unconfigured', async () => {
    const out = await rephraseOrders(result);
    expect(out).toBe(result); // same reference: a true no-op
  });

  it('never throws and always resolves a usable recommendation', async () => {
    const out = await rephraseOrders(result);
    expect(out.primary.why).toContain('42g protein'); // numbers intact regardless of path
    expect(out.primary.totals.price).toBe(12);
    expect(out.alternatives).toHaveLength(1);
  });
});
