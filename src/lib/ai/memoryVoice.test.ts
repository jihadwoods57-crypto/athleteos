import { rephraseMemoryInsights, isAiConfigured } from './index';
import type { MemoryInsight } from '@/core';

const insights: MemoryInsight[] = [
  {
    id: 'slot_protein_breakfast',
    kind: 'slot_protein_trend',
    tone: 'win',
    headline: 'Breakfast protein is climbing',
    detail: "Earlier you averaged 18g of protein at breakfast; now you're at 37g.",
    metric: '+19g',
    rank: 119,
  },
  {
    id: 'protein_streak',
    kind: 'protein_streak',
    tone: 'win',
    headline: 'Protein streak going',
    detail: "5 days in a row you've hit your 140g protein target.",
    metric: '5 days',
    rank: 85,
  },
];

describe('rephraseMemoryInsights', () => {
  it('is inert without a configured backend', () => {
    expect(isAiConfigured).toBe(false);
  });

  it('returns the deterministic insights UNCHANGED when AI is unconfigured', async () => {
    const out = await rephraseMemoryInsights(insights);
    expect(out).toBe(insights); // same reference: a true no-op, no work done
  });

  it('handles an empty list without calling out', async () => {
    const out = await rephraseMemoryInsights([]);
    expect(out).toEqual([]);
  });

  it('never throws and always resolves usable insights (the surface always renders)', async () => {
    const out = await rephraseMemoryInsights(insights);
    expect(out).toHaveLength(2);
    expect(out[0].detail).toContain('37g'); // numbers intact regardless of path
  });
});
