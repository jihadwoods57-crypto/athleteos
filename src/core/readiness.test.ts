// AthleteOS — training-readiness engine. Proves the composite reads off real signals, returns null
// when there's nothing to read (no fabrication), bands correctly, and the overtraining flag needs a
// real downward trend (not a single bad night).
import { readinessScore, readinessBand, overtrainingFlag, readinessSummary, readinessLabel } from './readiness';

describe('readinessScore', () => {
  it('returns null when no signal is present (honest empty state)', () => {
    expect(readinessScore({})).toBeNull();
  });

  it('reads a fully-recovered athlete near the top', () => {
    const s = readinessScore({ energy: 9, recovery: 9, sleep: 9, soreness: 1 });
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThanOrEqual(85);
  });

  it('drops when soreness is high (inverse polarity)', () => {
    const fresh = readinessScore({ recovery: 8, sleep: 8, energy: 8, soreness: 1 })!;
    const sore = readinessScore({ recovery: 8, sleep: 8, energy: 8, soreness: 9 })!;
    expect(sore).toBeLessThan(fresh);
  });

  it('averages only the signals actually present', () => {
    // only recovery given -> recovery*10 on a 0..100 scale
    expect(readinessScore({ recovery: 7 })).toBe(70);
  });
});

describe('readinessBand', () => {
  it('bands ready / caution / compromised at 75 and 55', () => {
    expect(readinessBand(80)).toBe('ready');
    expect(readinessBand(60)).toBe('caution');
    expect(readinessBand(40)).toBe('compromised');
  });
});

describe('overtrainingFlag', () => {
  it('does not flag a single bad night that recovers', () => {
    expect(overtrainingFlag([80, 50, 78])).toBe(false); // dipped mid-window but last is fine
  });
  it('flags a sustained downward trend ending compromised', () => {
    expect(overtrainingFlag([80, 70, 60, 48])).toBe(true);
  });
  it('does not flag when recovered back up', () => {
    expect(overtrainingFlag([50, 55, 70, 82])).toBe(false);
  });
  it('needs at least three points', () => {
    expect(overtrainingFlag([40, 45])).toBe(false);
  });
});

describe('readinessSummary', () => {
  it('counts bands and finds the least-ready athlete', () => {
    const rows = [
      { name: 'A', readiness: 90, band: 'ready' as const },
      { name: 'B', readiness: 60, band: 'caution' as const },
      { name: 'C', readiness: 40, band: 'compromised' as const },
    ];
    const sum = readinessSummary(rows);
    expect(sum).toMatchObject({ ready: 1, caution: 1, compromised: 1 });
    expect(sum.lowest?.name).toBe('C');
  });
  it('returns a null lowest for an empty room', () => {
    expect(readinessSummary([]).lowest).toBeNull();
  });
});

describe('readinessLabel', () => {
  it('gives a plain-English read per band', () => {
    expect(readinessLabel('ready').title).toMatch(/ready/i);
    expect(readinessLabel('compromised').title).toMatch(/compromised/i);
  });
});
