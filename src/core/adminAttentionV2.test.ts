// Command Center v2 pure additions: zscore anomaly detection, cost forecast, "what changed" movers,
// and series-gated anomaly flags. The v1 contract (adminFlags.test.ts) must remain green alongside.
import { zscore, forecast, movers, evaluateFlags } from '../../web/admin/attention.js';

describe('zscore', () => {
  test('null when the series is too short', () => {
    expect(zscore([1, 2, 3], 5)).toBeNull();
  });
  test('null when the series is flat (no variance)', () => {
    expect(zscore([4, 4, 4, 4, 4, 4], 4)).toBeNull();
  });
  test('positive z for a value above the norm, negative below', () => {
    const s = [10, 11, 9, 10, 12, 8, 10];
    expect(zscore(s, 20)).toBeGreaterThan(2);
    expect(zscore(s, 2)).toBeLessThan(-2);
  });
});

describe('forecast', () => {
  test('null for an empty series', () => {
    expect(forecast([])).toBeNull();
  });
  test('projects the trailing-7 run-rate across the month', () => {
    const f = forecast([2, 2, 2, 2, 2, 2, 2], 30);
    expect(f).not.toBeNull();
    expect(f!.dailyRunRate).toBeCloseTo(2, 5);
    expect(f!.monthlyProjection).toBeCloseTo(60, 5);
  });
  test('uses only the last 7 points for the run-rate', () => {
    // 8 points; the first (huge) is dropped by the trailing-7 window.
    const f = forecast([1000, 3, 3, 3, 3, 3, 3, 3], 30);
    expect(f!.dailyRunRate).toBeCloseTo(3, 5);
  });
});

describe('movers', () => {
  const cur = { activeToday: 60, calls: 120, costPerMeal: 0.03, subs: 2, appErrorsToday: 1 };
  const prev = { activeToday: 40, calls: 100, costPerMeal: 0.02, subs: 2, appErrorsToday: 5 };

  test('returns the changed metrics, sorted by |deltaPct|', () => {
    const ms = movers(cur, prev);
    expect(ms.length).toBe(4); // subs unchanged → excluded
    // errors 5→1 is −80%, the largest relative move (bigger than cost's +50%)
    expect(ms[0].key).toBe('appErrorsToday');
    expect(ms[0].dir).toBe('down');
  });
  test('marks direction goodness by metric semantics', () => {
    const ms = movers(cur, prev);
    const active = ms.find((x) => x.key === 'activeToday')!;
    const cost = ms.find((x) => x.key === 'costPerMeal')!;
    const errs = ms.find((x) => x.key === 'appErrorsToday')!;
    expect(active.good).toBe(true);   // active up = good
    expect(cost.good).toBe(false);    // cost up = bad
    expect(errs.good).toBe(true);     // errors DOWN = good
  });
  test('empty when a bundle is missing', () => {
    expect(movers(cur, null)).toEqual([]);
  });
});

describe('series-gated anomaly flags', () => {
  test('cost anomaly note fires from the series even when the +30% threshold is not hit', () => {
    // cost 0.05 vs a 7-day avg of 0.049 (only +2%, below +30%), but way outside the PRIOR-days
    // baseline variance (series EXCLUDES today's 0.05).
    const m = {
      costPerMeal: 0.05, costPerMealAvg7: 0.049,
      costSeries: [0.01, 0.011, 0.009, 0.01, 0.012, 0.01],
    };
    const keys = evaluateFlags(m).map((f) => f.key);
    expect(keys).toContain('ai_cost_anomaly');
    expect(keys).not.toContain('ai_cost'); // fixed threshold not tripped
  });
  test('activity_drop warns when today is far below the prior-days norm', () => {
    const m = { activeToday: 2, activeSeries: [40, 42, 38, 41, 39, 43] };
    expect(evaluateFlags(m).map((f) => f.key)).toContain('activity_drop');
  });
  test('no series → no anomaly flags (v1 behavior preserved)', () => {
    expect(evaluateFlags({ activeToday: 2, costPerMeal: 0.05 })).toEqual([]);
  });
  test('flags are sorted warn-before-note', () => {
    const m = {
      activeToday: 2, activeSeries: [40, 42, 38, 41, 39, 43], // warn (activity_drop)
      costPerMeal: 0.05, costPerMealAvg7: 0.049, costSeries: [0.01, 0.011, 0.009, 0.01, 0.012, 0.01], // note (ai_cost_anomaly)
    };
    const levels = evaluateFlags(m).map((f) => f.level);
    expect(levels[0]).toBe('warn');
    expect(levels).toContain('note');
  });
});
