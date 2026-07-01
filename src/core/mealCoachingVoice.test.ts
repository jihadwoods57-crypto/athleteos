import { coachingRephraseIsSafe, mergeCoachingVoice } from './mealCoachingVoice';

const source = 'Solid, though about 10g short on protein for this slot. Add 200 calories to hit your target.';

describe('meal-coaching voice — numbers never change', () => {
  it('accepts a rephrase that preserves every number', () => {
    const warm = "Nice work — you're just 10g of protein shy here. Another 200 calories gets you there.";
    expect(coachingRephraseIsSafe(source, warm)).toBe(true);
    expect(mergeCoachingVoice(source, warm)).toBe(warm);
  });

  it('rejects a rephrase that changes a number, keeping the deterministic sentence', () => {
    const drifted = "You're 15g of protein shy; add 200 calories.";
    expect(coachingRephraseIsSafe(source, drifted)).toBe(false);
    expect(mergeCoachingVoice(source, drifted)).toBe(source);
  });

  it('rejects a rephrase that drops a number', () => {
    expect(mergeCoachingVoice(source, 'You are a little short on protein; add a bit more food.')).toBe(source);
  });

  it('falls back to the source when the model returns nothing', () => {
    expect(mergeCoachingVoice(source, null)).toBe(source);
    expect(mergeCoachingVoice(source, '   ')).toBe(source);
  });

  it('treats unit prose changes as fine as long as the figures match (37g -> 37 grams)', () => {
    expect(coachingRephraseIsSafe('Up to 37g now.', 'Up to 37 grams now.')).toBe(true);
  });
});
