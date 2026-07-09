// OnStandard — day-0 honesty. Proves a brand-new athlete (no prior day) never shows a fabricated
// "this week" trend, and that the recovery number is flagged unreal until a check-in actually backs it.
import { computeDerived } from './scoring';
import { createInitialState } from './defaultState';
import { trendSeries } from './history';

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

  it('measures the "this week" delta from the first REAL day, never the seeded pad (days 2-6)', () => {
    // Two real prior days, both well below the seeded lead (82-88). If the delta were measured
    // from series[0] (a SEED value ~83), it would read a large fabricated drop the athlete never
    // lived. The honest baseline is the earliest REAL day in the window.
    const d = computeDerived({
      ...base,
      scoreHistory: [
        { date: '2026-06-01', score: 60 },
        { date: '2026-06-02', score: 62 },
      ],
    });
    expect(d.scoreDelta).toBe(d.athleteScore - 60); // vs first real day, not the seed
  });

  it('leaves the seeded showcase demo trend intact (empty history keeps its slope)', () => {
    const demo = computeDerived({ ...base, scoreHistory: [] });
    const series = trendSeries([], demo.athleteScore);
    expect(demo.scoreDelta).toBe(series[series.length - 1] - series[0]);
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
