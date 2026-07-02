// OnStandard — Trust Pass math tests.
// Locks the council's key call: the pass-day baseline is the MEDIAN (not mean) of the
// athlete's last N real photo-earned nutrition sub-scores, so one hero-plate can't inflate
// a coaster's credit. See docs/council/2026-07-02-trust-pass.md.
import {
  trailingEarnedNutritionMedian,
  passDayNutritionScore,
  passEligibility,
  passStatus,
  passDayCredit,
  type TrustPass,
} from './trustPass';
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

describe('passDayNutritionScore', () => {
  it('credits the full baseline for "yes", 60% for "partial", 0 for "no"', () => {
    expect(passDayNutritionScore(80, 'yes')).toBe(80);
    expect(passDayNutritionScore(80, 'partial')).toBe(48); // 0.6 * 80
    expect(passDayNutritionScore(80, 'no')).toBe(0);
  });

  it('an unanswered pass day credits 0 (no free green from silence)', () => {
    expect(passDayNutritionScore(80, null)).toBe(0);
  });

  it('honesty invariant: no <= partial <= yes at the same baseline (honesty never scored below a lie)', () => {
    const base = 88;
    expect(passDayNutritionScore(base, 'no')).toBeLessThanOrEqual(passDayNutritionScore(base, 'partial'));
    expect(passDayNutritionScore(base, 'partial')).toBeLessThanOrEqual(passDayNutritionScore(base, 'yes'));
  });

  it('is worth exactly the proven baseline for "yes" — never manufactures a number above it', () => {
    // A coaster whose real median is 60 gets a 60 "yes" day, not a fabricated 80.
    expect(passDayNutritionScore(60, 'yes')).toBe(60);
  });
});

describe('passEligibility', () => {
  it('requires >= 7 real on-standard (>=80) days by default', () => {
    expect(passEligibility(days(80, 80, 80, 80, 80, 80)).eligible).toBe(false); // 6
    expect(passEligibility(days(80, 80, 80, 80, 80, 80, 80)).eligible).toBe(true); // 7
  });

  it('counts only days at or above the on-standard threshold', () => {
    const r = passEligibility(days(79, 80, 81, 50, 95, 88, 90, 84));
    expect(r.onStandardDays).toBe(6); // 80,81,95,88,90,84 (79 and 50 excluded)
    expect(r.eligible).toBe(false); // < 7
  });

  it('a brand-new athlete with no history cannot earn a pass', () => {
    expect(passEligibility([]).eligible).toBe(false);
    expect(passEligibility([]).onStandardDays).toBe(0);
  });
});

describe('passStatus', () => {
  const pass: TrustPass = { grantedDate: '2026-06-01', lengthDays: 10 };

  it('returns null when there is no pass', () => {
    expect(passStatus(null, '2026-06-05')).toBeNull();
  });

  it('is active within the granted window and expired after it', () => {
    expect(passStatus(pass, '2026-06-01')!.phase).toBe('active'); // day 0
    expect(passStatus(pass, '2026-06-09')!.phase).toBe('active'); // day 8
    expect(passStatus(pass, '2026-06-11')!.phase).toBe('expired'); // day 10 == length
  });

  it('flags every 5th camera-free day as a spot-check (camera comes back)', () => {
    expect(passStatus(pass, '2026-06-01')!.isCheckDay).toBe(false); // day 0
    expect(passStatus(pass, '2026-06-06')!.isCheckDay).toBe(true); // day 5
  });

  it('credit does not decay before day 10, then bleeds down (forward-only)', () => {
    const longPass: TrustPass = { grantedDate: '2026-06-01', lengthDays: 30 };
    expect(passStatus(longPass, '2026-06-09')!.decayPct).toBe(1); // day 8, no decay
    expect(passStatus(longPass, '2026-06-15')!.decayPct).toBeLessThan(1); // day 14, decaying
  });
});

describe('passDayCredit', () => {
  const pass: TrustPass = { grantedDate: '2026-06-01', lengthDays: 10 };
  const hist = days(80, 82, 84, 86, 88, 80, 82, 84, 86, 88); // median 84

  it('credits the proven-baseline median scaled by the answer on an active non-check day', () => {
    const r = passDayCredit(pass, hist, '2026-06-02', 'yes'); // day 1, not a check day
    expect(r).not.toBeNull();
    expect(r!.requiresPhoto).toBe(false);
    expect(r!.nutrition).toBe(84); // median 84 * f(yes)=1.0
  });

  it('a check day requires the camera back and credits nothing on its own', () => {
    const r = passDayCredit(pass, hist, '2026-06-06', 'yes'); // day 5 = check day
    expect(r!.requiresPhoto).toBe(true);
    expect(r!.nutrition).toBe(0);
  });

  it('returns null with no earned baseline (a pass can never credit from nothing)', () => {
    expect(passDayCredit(pass, [], '2026-06-02', 'yes')).toBeNull();
  });

  it('returns null once the pass has expired', () => {
    expect(passDayCredit(pass, hist, '2026-06-20', 'yes')).toBeNull();
  });
});
