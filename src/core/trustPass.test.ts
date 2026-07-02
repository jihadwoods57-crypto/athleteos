// OnStandard — Trust Pass math tests.
// Locks the council's key call: the pass-day baseline is the MEDIAN (not mean) of the
// athlete's last N real photo-earned nutrition sub-scores, so one hero-plate can't inflate
// a coaster's credit. See docs/council/2026-07-02-trust-pass.md.
import { trailingEarnedNutritionMedian } from './trustPass';
import type { DayScore } from './types';

const days = (...scores: number[]): DayScore[] => scores.map((score, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, score }));

describe('trailingEarnedNutritionMedian', () => {
  it('returns null with no earned history (no baseline to credit against)', () => {
    expect(trailingEarnedNutritionMedian([])).toBeNull();
  });

  it('is the MEDIAN, not the mean — one hero-plate cannot inflate a coaster', () => {
    // [55,58,60,62,97] -> mean ~66.4 (a 97 drags it up) but median 60 (what he really does).
    expect(trailingEarnedNutritionMedian(days(55, 58, 60, 62, 97))).toBe(60);
  });

  it('averages the two middle values on an even count (rounded)', () => {
    // [60,62,64,70] -> (62+64)/2 = 63.
    expect(trailingEarnedNutritionMedian(days(60, 62, 64, 70))).toBe(63);
  });

  it('uses only the last N (default 10) earned days', () => {
    // 12 days; the first two (10, 12) are outside the window of 10 and must not count.
    const hist = days(10, 12, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80);
    expect(trailingEarnedNutritionMedian(hist)).toBe(80);
  });

  it('honors a custom window N', () => {
    // last 3 of [40,50,60,70,80] -> [60,70,80] -> median 70.
    expect(trailingEarnedNutritionMedian(days(40, 50, 60, 70, 80), 3)).toBe(70);
  });

  it('ignores non-finite scores from a corrupt/legacy row', () => {
    const hist = [{ date: '2026-06-01', score: NaN }, ...days(60, 62, 64)];
    expect(trailingEarnedNutritionMedian(hist)).toBe(62);
  });
});
