import {
  rephraseIsSafe,
  mergeRephrasedInsight,
  mergeRephrasedInsights,
  type RephrasedInsight,
} from './nutritionMemoryVoice';
import type { MemoryInsight } from './nutritionMemory';

// A realistic deterministic insight to rephrase — note the two numbers (18, 37) and the badge.
const base: MemoryInsight = {
  id: 'slot_protein_breakfast',
  kind: 'slot_protein_trend',
  tone: 'win',
  headline: 'Breakfast protein is climbing',
  detail: "Earlier you averaged 18g of protein at breakfast; now you're at 37g. One of your biggest improvements.",
  metric: '+19g',
  rank: 119,
};

const warm = (over: Partial<RephrasedInsight> = {}): RephrasedInsight => ({
  id: base.id,
  headline: 'Your breakfast protein is climbing',
  detail: "You've gone from 18g of protein at breakfast to 37g. That's real progress, keep it rolling.",
  ...over,
});

describe('rephraseIsSafe (strict number preservation)', () => {
  it('accepts a warmer rewrite that keeps every number', () => {
    expect(rephraseIsSafe(base, warm())).toBe(true);
  });

  it('rejects a rewrite that CHANGES a number', () => {
    expect(rephraseIsSafe(base, warm({ detail: 'You went from 18g to 38g at breakfast. Great work.' }))).toBe(false);
  });

  it('rejects a rewrite that DROPS a number', () => {
    expect(rephraseIsSafe(base, warm({ detail: 'Your breakfast protein is way up from where you started. Great work.' }))).toBe(false);
  });

  it('rejects a rewrite that ADDS a number', () => {
    expect(rephraseIsSafe(base, warm({ detail: "From 18g to 37g at breakfast, and 3 days running. Keep it up." }))).toBe(false);
  });

  it('accepts a number MOVED between headline and detail (set compared across both)', () => {
    const moved = warm({ headline: 'Breakfast protein up to 37g', detail: "You averaged 18g earlier; now you're hitting it most mornings." });
    expect(rephraseIsSafe(base, moved)).toBe(true);
  });

  it('rejects empty headline or detail', () => {
    expect(rephraseIsSafe(base, warm({ headline: '   ' }))).toBe(false);
    expect(rephraseIsSafe(base, warm({ detail: '' }))).toBe(false);
  });

  it('rejects an over-long rewrite', () => {
    expect(rephraseIsSafe(base, warm({ detail: '18g to 37g. ' + 'x'.repeat(400) }))).toBe(false);
  });

  it('treats a decimal as one number — a flipped decimal (2.3 -> 3.2) is rejected', () => {
    // mealFrequencyInsight emits `${perDay.toFixed(1)} meals a day` (nutritionMemory.ts) — a real
    // decimal in the guarded detail. A digit-run guard would split "2.3" into {2,3}, so "3.2" would
    // pass with the same multiset and silently flip the figure the athlete reads.
    const dec: MemoryInsight = {
      ...base,
      headline: 'Some meals are going unlogged',
      detail: 'About 2.3 meals a day logged over the last 14. Getting all three plus a snack in gives the full picture.',
    };
    const flipped = warm({
      headline: 'A few meals are slipping through',
      detail: 'You logged about 3.2 meals a day across the last 14 days — get all three plus a snack for the full picture.',
    });
    expect(rephraseIsSafe(dec, flipped)).toBe(false);
    // an honest rewrite that keeps 2.3 and 14 is still accepted
    const honest = warm({
      headline: 'A few meals are slipping through',
      detail: 'You logged about 2.3 meals a day across the last 14 days — add a snack to round it out.',
    });
    expect(rephraseIsSafe(dec, honest)).toBe(true);
  });

  it('handles a numberless insight (any wording with no numbers is fine)', () => {
    const noNum: MemoryInsight = { ...base, headline: 'Your go-to meal', detail: 'You keep coming back to the same dinner. The OnStandard knows your kitchen.', metric: undefined };
    const r = warm({ headline: 'This is your signature meal', detail: 'You lean on the same dinner again and again, and we know it well.' });
    expect(rephraseIsSafe(noNum, r)).toBe(true);
  });
});

describe('mergeRephrasedInsight', () => {
  it('swaps in the warmer prose when safe, preserving id/kind/tone/metric/rank', () => {
    const out = mergeRephrasedInsight(base, warm());
    expect(out.headline).toBe('Your breakfast protein is climbing');
    expect(out.detail).toContain("18g");
    expect(out.detail).toContain('37g');
    // everything non-prose is carried verbatim from the engine
    expect(out.id).toBe(base.id);
    expect(out.kind).toBe(base.kind);
    expect(out.tone).toBe(base.tone);
    expect(out.metric).toBe(base.metric);
    expect(out.rank).toBe(base.rank);
  });

  it('keeps the deterministic insight unchanged when the rewrite is unsafe', () => {
    const out = mergeRephrasedInsight(base, warm({ detail: 'You went from 18g to 99g. Wow.' }));
    expect(out).toEqual(base);
  });

  it('keeps the deterministic insight when there is no rephrase', () => {
    expect(mergeRephrasedInsight(base, undefined)).toEqual(base);
  });

  it('trims surrounding whitespace on accepted prose', () => {
    const out = mergeRephrasedInsight(base, warm({ headline: '  Breakfast protein climbing  ' }));
    expect(out.headline).toBe('Breakfast protein climbing');
  });
});

describe('mergeRephrasedInsights (whole list)', () => {
  const second: MemoryInsight = {
    id: 'protein_streak',
    kind: 'protein_streak',
    tone: 'win',
    headline: 'Protein streak going',
    detail: "5 days in a row you've hit your 140g protein target. Don't break the chain.",
    metric: '5 days',
    rank: 85,
  };

  it('preserves engine order and count; warms only safe matches by id', () => {
    const proposed: RephrasedInsight[] = [
      { id: 'protein_streak', headline: 'Five-day protein streak', detail: "You've hit your 140g target 5 days straight. Keep the chain alive." },
      warm(), // for base
    ];
    const out = mergeRephrasedInsights([base, second], proposed);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('slot_protein_breakfast'); // order unchanged
    expect(out[1].id).toBe('protein_streak');
    expect(out[0].headline).toBe('Your breakfast protein is climbing');
    expect(out[1].headline).toBe('Five-day protein streak');
  });

  it('ignores a rephrase for an unknown id and leaves unmatched insights deterministic', () => {
    const out = mergeRephrasedInsights([base, second], [{ id: 'does_not_exist', headline: 'x', detail: 'y' }]);
    expect(out).toEqual([base, second]);
  });

  it('falls back per-insight: one unsafe rewrite does not poison the others', () => {
    const proposed: RephrasedInsight[] = [
      warm({ detail: 'From 18g to 50g. Numbers changed, must reject.' }), // unsafe -> base kept
      { id: 'protein_streak', headline: 'Five-day protein streak', detail: "You've hit your 140g target 5 days straight. Keep the chain alive." },
    ];
    const out = mergeRephrasedInsights([base, second], proposed);
    expect(out[0]).toEqual(base); // unsafe -> deterministic
    expect(out[1].headline).toBe('Five-day protein streak'); // safe -> warmed
  });
});
