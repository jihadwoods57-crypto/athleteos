import {
  sleepScore,
  hrvScore,
  restingHrScore,
  recoveryFromSample,
  blendRecovery,
  RECOVERY_SAMPLE_WEIGHT,
  type RecoverySample,
} from './recovery';

describe('component maps', () => {
  it('sleepScore rises with hours and clamps the band', () => {
    expect(sleepScore(4)).toBe(0);
    expect(sleepScore(8)).toBe(100);
    expect(sleepScore(2)).toBe(0);
    expect(sleepScore(10)).toBe(100);
    expect(sleepScore(6)).toBe(50);
  });
  it('hrvScore rises with HRV', () => {
    expect(hrvScore(20)).toBe(0);
    expect(hrvScore(90)).toBe(100);
    expect(hrvScore(55)).toBe(50);
  });
  it('restingHrScore is inverted (lower bpm is better)', () => {
    expect(restingHrScore(40)).toBe(100);
    expect(restingHrScore(80)).toBe(0);
    expect(restingHrScore(60)).toBe(50);
  });
});

describe('recoveryFromSample', () => {
  it('averages the present signals, sleep weighted highest', () => {
    const score = recoveryFromSample({ sleepHours: 8, hrvMs: 90, restingHr: 40 });
    expect(score).toBe(100);
  });
  it('handles a partial sample (only sleep)', () => {
    expect(recoveryFromSample({ sleepHours: 6 })).toBe(50);
  });
  it('ignores out-of-range / non-finite fields', () => {
    expect(recoveryFromSample({ sleepHours: 99, hrvMs: NaN, restingHr: 10 })).toBeNull();
    expect(recoveryFromSample({ sleepHours: 8, hrvMs: -5 })).toBe(100); // hrv dropped, sleep stands
  });
  it('returns null when no usable signal is present', () => {
    expect(recoveryFromSample({})).toBeNull();
    expect(recoveryFromSample({ hrvMs: 0, restingHr: 200 })).toBeNull();
  });
});

describe('blendRecovery — the fold point', () => {
  it('returns the self-report UNCHANGED when no sample (seam off)', () => {
    expect(blendRecovery(86, null)).toBe(86);
    expect(blendRecovery(0, null)).toBe(0);
    expect(blendRecovery(100, null)).toBe(100);
  });
  it('returns the self-report unchanged when the sample has no usable signal', () => {
    expect(blendRecovery(72, {})).toBe(72);
  });
  it('blends an objective sample with the self-report, sample weighted higher', () => {
    // objective = 100 (perfect), self = 50 -> 100*0.6 + 50*0.4 = 80
    const sample: RecoverySample = { sleepHours: 8, hrvMs: 90, restingHr: 40 };
    expect(blendRecovery(50, sample)).toBe(Math.round(100 * RECOVERY_SAMPLE_WEIGHT + 50 * (1 - RECOVERY_SAMPLE_WEIGHT)));
  });
  it('stays in 0..100', () => {
    expect(blendRecovery(100, { sleepHours: 2 })).toBeGreaterThanOrEqual(0);
    expect(blendRecovery(100, { sleepHours: 2 })).toBeLessThanOrEqual(100);
  });
});
