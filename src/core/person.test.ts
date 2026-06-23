import { personBreakdown } from './person';

describe('personBreakdown', () => {
  it('anchors the four bars to the headline score (mean stays at the score)', () => {
    // unclamped band is [12, 90] (max +10 offset, min -12 offset).
    for (const score of [68, 74, 79, 85, 90]) {
      const b = personBreakdown(score);
      const mean = (b.nutrition + b.recovery + b.tasks + b.checkin) / 4;
      // offsets sum to zero, so away from the clamp edges the mean equals the score.
      expect(mean).toBe(score);
    }
  });

  it('keeps recovery the laggard and check-in the strongest category', () => {
    const b = personBreakdown(80);
    expect(b.recovery).toBeLessThan(b.tasks);
    expect(b.tasks).toBeLessThan(b.nutrition);
    expect(b.nutrition).toBeLessThan(b.checkin);
  });

  it('moves every bar with the score — a 68 reads mid-60s, a 92 reads low-90s', () => {
    const low = personBreakdown(68);
    const high = personBreakdown(92);
    expect(high.nutrition).toBeGreaterThan(low.nutrition);
    expect(high.recovery).toBeGreaterThan(low.recovery);
    // low athlete's strongest bar still sits well under the high athlete's weakest.
    expect(low.checkin).toBeLessThan(high.recovery);
  });

  it('is deterministic and clamps into [0, 100]', () => {
    expect(personBreakdown(68)).toEqual(personBreakdown(68));
    for (const score of [0, 5, 96, 100]) {
      for (const v of Object.values(personBreakdown(score))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});
