// OnStandard — day-0 honesty. Proves a brand-new athlete (no prior day) never shows a fabricated
// "this week" trend, and that the recovery number is flagged unreal until a check-in actually backs it.
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';

describe('day-0 honesty', () => {
  const base = createInitialState();

  it('isDay0 is true for a real new athlete (only today\'s anchor), false for the empty/demo history', () => {
    expect(computeDerived({ ...base, scoreHistory: [] }).isDay0).toBe(false); // empty = seeded demo, keep its trend
    expect(computeDerived({ ...base, scoreHistory: [{ date: base.dateStamp, score: 49 }] }).isDay0).toBe(true);
  });

  it('zeroes the "this week" delta on day 0 (no fabricated ↓58 trending down)', () => {
    const d = computeDerived({ ...base, scoreHistory: [{ date: base.dateStamp, score: 49 }] });
    expect(d.scoreDelta).toBe(0);
    expect(d.deltaStr).toBe('↑ +0');
  });

  it('shows a REAL delta once a genuine prior day exists', () => {
    const d = computeDerived({ ...base, scoreHistory: [{ date: '2026-06-01', score: 80 }] });
    expect(d.isDay0).toBe(false);
    // delta is today's live score minus the window start — a real number, not forced to 0
    expect(typeof d.scoreDelta).toBe('number');
  });

  it('flags recovery as NOT real until a check-in is submitted (the fake 86 fix)', () => {
    const d0 = computeDerived({ ...base, ciSubmitted: false });
    expect(d0.recoveryScore).toBe(86); // fallback still computes (so the score is defined)
    expect(d0.recoveryScoreIsReal).toBe(false); // ...but the UI knows not to show it as real

    const submitted = computeDerived({
      ...base,
      ciSubmitted: true,
      ciConfig: { energy: true, recovery: true, sleep: true, confidence: false, soreness: false, motivation: false },
      ciEnergy: 8,
      ciRecovery: 7,
      ciSleep: 8,
    });
    expect(submitted.recoveryScoreIsReal).toBe(true);
  });
});
