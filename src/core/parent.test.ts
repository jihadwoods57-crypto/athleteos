import { parentHistoryCoverage, parentDigest } from './parent';

describe('parentHistoryCoverage', () => {
  it('labels a partial week as still building', () => {
    expect(parentHistoryCoverage(3)).toBe('Building history: 3 of 7 days logged this week');
    expect(parentHistoryCoverage(0)).toBe('Building history: 0 of 7 days logged this week');
  });

  it('reads a full week plainly', () => {
    expect(parentHistoryCoverage(7)).toBe('7 of 7 days logged this week');
  });

  it('clamps out-of-range / non-finite day counts', () => {
    expect(parentHistoryCoverage(99)).toBe('7 of 7 days logged this week');
    expect(parentHistoryCoverage(-4)).toBe('Building history: 0 of 7 days logged this week');
    expect(parentHistoryCoverage(NaN)).toBe('Building history: 0 of 7 days logged this week');
  });
});

describe('parentDigest', () => {
  it('reassures honestly when the athlete is meeting targets (>= 80)', () => {
    const d = parentDigest({ score: 88, completedDays: 6, first: 'Jordan' });
    expect(d.reassuring).toBe(true);
    expect(d.summary).toContain('Jordan');
    expect(d.summary.toLowerCase()).toContain('nothing needs you');
    expect(d.coverage).toContain('Building history: 6 of 7');
  });

  it('qualifies a middling week instead of saying no action needed (70-79)', () => {
    const d = parentDigest({ score: 74, completedDays: 7, first: 'Jordan' });
    expect(d.reassuring).toBe(true);
    expect(d.summary.toLowerCase()).toContain('mostly on track');
    expect(d.summary.toLowerCase()).not.toContain('nothing needs you');
  });

  it('flags a real slip rather than always reassuring (< 70)', () => {
    const d = parentDigest({ score: 58, completedDays: 5, first: 'Jordan' });
    expect(d.reassuring).toBe(false);
    expect(d.summary.toLowerCase()).toContain('behind');
    expect(d.summary.toLowerCase()).toContain('check-in');
  });

  it('falls back to a neutral subject and a clamped band on a blank name / bad score', () => {
    const d = parentDigest({ score: NaN, completedDays: 0, first: '  ' });
    expect(d.summary).toContain('Your athlete');
    expect(d.reassuring).toBe(false); // NaN -> 0 -> below 70
  });

  it('keeps copy free of em dashes (design ban)', () => {
    for (const score of [95, 75, 50]) {
      const d = parentDigest({ score, completedDays: 4, first: 'Jordan' });
      expect(d.summary).not.toContain('—');
      expect(d.coverage).not.toContain('—');
    }
  });
});
