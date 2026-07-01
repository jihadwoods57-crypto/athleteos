import {
  PERF_METRICS,
  CUSTOM_METRIC_KEY,
  PERF_ENTRY_CAP,
  resolveMetric,
  metricIdentity,
  isImprovement,
  betterValue,
  sortByDate,
  summarizeMetric,
  performanceSummaries,
  formatPerfValue,
  improvementLabel,
  topPerformanceLine,
  addPerfEntry,
  removePerfEntry,
  perfSparkGeometry,
  type PerfEntry,
} from './performance';

const e = (over: Partial<PerfEntry> & Pick<PerfEntry, 'id' | 'metricKey' | 'value' | 'date'>): PerfEntry => over;

describe('resolveMetric', () => {
  it('resolves a catalog metric by key', () => {
    const def = resolveMetric(e({ id: '1', metricKey: 'bench', value: 200, date: '2026-06-01' }));
    expect(def.label).toBe('Bench Press');
    expect(def.unit).toBe('lb');
    expect(def.dir).toBe('higher');
  });

  it('resolves a custom metric from its own fields', () => {
    const def = resolveMetric(
      e({ id: '1', metricKey: CUSTOM_METRIC_KEY, customLabel: 'Pull-ups', customUnit: 'reps', customDir: 'higher', value: 12, date: '2026-06-01' }),
    );
    expect(def.label).toBe('Pull-ups');
    expect(def.unit).toBe('reps');
    expect(def.category).toBe('custom');
  });

  it('falls back safely for an unknown key', () => {
    const def = resolveMetric(e({ id: '1', metricKey: 'mystery', value: 1, date: '2026-06-01' }));
    expect(def.label).toBe('mystery');
    expect(def.dir).toBe('higher');
  });

  it('custom metric with blank label reads "Custom"', () => {
    const def = resolveMetric(e({ id: '1', metricKey: CUSTOM_METRIC_KEY, customLabel: '   ', value: 1, date: '2026-06-01' }));
    expect(def.label).toBe('Custom');
  });
});

describe('metricIdentity', () => {
  it('groups catalog metrics by key', () => {
    expect(metricIdentity(e({ id: '1', metricKey: 'squat', value: 1, date: '2026-06-01' }))).toBe('squat');
  });
  it('groups custom metrics by normalized label', () => {
    const a = metricIdentity(e({ id: '1', metricKey: CUSTOM_METRIC_KEY, customLabel: 'Pull-Ups', value: 1, date: '2026-06-01' }));
    const b = metricIdentity(e({ id: '2', metricKey: CUSTOM_METRIC_KEY, customLabel: '  pull-ups ', value: 1, date: '2026-06-02' }));
    expect(a).toBe(b);
  });
});

describe('isImprovement / betterValue', () => {
  it('higher-is-better: bigger wins', () => {
    expect(isImprovement('higher', 210, 200)).toBe(true);
    expect(isImprovement('higher', 190, 200)).toBe(false);
    expect(betterValue('higher', 200, 210)).toBe(210);
  });
  it('lower-is-better: smaller wins', () => {
    expect(isImprovement('lower', 4.7, 4.8)).toBe(true);
    expect(isImprovement('lower', 4.9, 4.8)).toBe(false);
    expect(betterValue('lower', 4.8, 4.7)).toBe(4.7);
  });
  it('ties are not improvements', () => {
    expect(isImprovement('higher', 200, 200)).toBe(false);
    expect(isImprovement('lower', 4.8, 4.8)).toBe(false);
  });
});

describe('sortByDate', () => {
  it('sorts oldest -> newest, stable on equal dates', () => {
    const xs = [
      e({ id: 'b', metricKey: 'bench', value: 2, date: '2026-06-02' }),
      e({ id: 'a1', metricKey: 'bench', value: 1, date: '2026-06-01' }),
      e({ id: 'a2', metricKey: 'bench', value: 3, date: '2026-06-01' }),
    ];
    expect(sortByDate(xs).map((x) => x.id)).toEqual(['a1', 'a2', 'b']);
  });
});

describe('summarizeMetric — higher is better (bench)', () => {
  const entries: PerfEntry[] = [
    e({ id: '1', metricKey: 'bench', value: 200, date: '2026-05-01' }),
    e({ id: '2', metricKey: 'bench', value: 225, date: '2026-06-01' }),
    e({ id: '3', metricKey: 'bench', value: 215, date: '2026-06-15' }),
  ];
  it('finds the PR and its date', () => {
    const s = summarizeMetric(entries)!;
    expect(s.best).toBe(225);
    expect(s.bestDate).toBe('2026-06-01');
  });
  it('latest/first and oriented improvement', () => {
    const s = summarizeMetric(entries)!;
    expect(s.first).toBe(200);
    expect(s.latest).toBe(215);
    expect(s.improvement).toBe(15); // 215 - 200
    expect(s.trend).toBe('up');
  });
  it('latestIsPr is false when the latest is not the best', () => {
    expect(summarizeMetric(entries)!.latestIsPr).toBe(false);
  });
  it('latestIsPr is true when the newest entry is the best', () => {
    const withPr = [...entries, e({ id: '4', metricKey: 'bench', value: 230, date: '2026-06-20' })];
    const s = summarizeMetric(withPr)!;
    expect(s.best).toBe(230);
    expect(s.latestIsPr).toBe(true);
    expect(s.trend).toBe('up');
  });
});

describe('summarizeMetric — lower is better (40-yard dash)', () => {
  const entries: PerfEntry[] = [
    e({ id: '1', metricKey: 'sprint40', value: 4.9, date: '2026-05-01' }),
    e({ id: '2', metricKey: 'sprint40', value: 4.7, date: '2026-06-01' }),
    e({ id: '3', metricKey: 'sprint40', value: 4.75, date: '2026-06-15' }),
  ];
  it('PR is the fastest (lowest) time', () => {
    const s = summarizeMetric(entries)!;
    expect(s.best).toBe(4.7);
    expect(s.bestDate).toBe('2026-06-01');
  });
  it('improvement is positive when the latest is faster than the first', () => {
    const s = summarizeMetric(entries)!;
    // first 4.9 -> latest 4.75 : a faster time is a positive improvement
    expect(s.improvement).toBeCloseTo(0.15, 5);
    expect(s.trend).toBe('up');
  });
  it('a slower latest than first trends down', () => {
    const slower = [
      e({ id: '1', metricKey: 'sprint40', value: 4.7, date: '2026-05-01' }),
      e({ id: '2', metricKey: 'sprint40', value: 4.9, date: '2026-06-01' }),
    ];
    const s = summarizeMetric(slower)!;
    expect(s.improvement).toBeCloseTo(-0.2, 5);
    expect(s.trend).toBe('down');
  });
  it('single entry is flat with zero improvement', () => {
    const s = summarizeMetric([e({ id: '1', metricKey: 'sprint40', value: 4.8, date: '2026-05-01' })])!;
    expect(s.trend).toBe('flat');
    expect(s.improvement).toBe(0);
    expect(s.latestIsPr).toBe(true);
  });
  it('returns null for an empty series', () => {
    expect(summarizeMetric([])).toBeNull();
  });
});

describe('performanceSummaries', () => {
  const entries: PerfEntry[] = [
    e({ id: '1', metricKey: 'bench', value: 200, date: '2026-05-01' }),
    e({ id: '2', metricKey: 'bench', value: 225, date: '2026-06-10' }),
    e({ id: '3', metricKey: 'sprint40', value: 4.8, date: '2026-06-20' }),
    e({ id: '4', metricKey: CUSTOM_METRIC_KEY, customLabel: 'Pull-ups', customUnit: 'reps', value: 10, date: '2026-06-05' }),
  ];
  it('groups into one summary per metric', () => {
    const out = performanceSummaries(entries);
    expect(out.length).toBe(3);
  });
  it('orders by most recent latest entry first', () => {
    const out = performanceSummaries(entries);
    // sprint40 latest 06-20, bench 06-10, custom 06-05
    expect(out.map((s) => s.def.label)).toEqual(['40-Yard Dash', 'Bench Press', 'Pull-ups']);
  });
  it('handles an empty log', () => {
    expect(performanceSummaries([])).toEqual([]);
  });
});

describe('formatPerfValue', () => {
  const bench = PERF_METRICS.find((m) => m.key === 'bench')!;
  const sprint = PERF_METRICS.find((m) => m.key === 'sprint40')!;
  it('whole numbers render without a decimal', () => {
    expect(formatPerfValue(bench, 225)).toBe('225 lb');
  });
  it('fractional values keep up to two places, trimming trailing zeros', () => {
    expect(formatPerfValue(sprint, 4.82)).toBe('4.82 s');
    expect(formatPerfValue(sprint, 4.8)).toBe('4.8 s');
    expect(formatPerfValue(sprint, 4.829)).toBe('4.83 s');
  });
  it('unitless metric omits the unit', () => {
    expect(formatPerfValue({ key: 'x', label: 'X', unit: '', dir: 'higher', category: 'custom' }, 5)).toBe('5');
  });
});

describe('improvementLabel', () => {
  it('positive improvement for a lift', () => {
    const s = summarizeMetric([
      e({ id: '1', metricKey: 'bench', value: 200, date: '2026-05-01' }),
      e({ id: '2', metricKey: 'bench', value: 215, date: '2026-06-01' }),
    ])!;
    expect(improvementLabel(s)).toBe('+15 lb');
  });
  it('faster sprint shows a positive label with a fractional magnitude', () => {
    const s = summarizeMetric([
      e({ id: '1', metricKey: 'sprint40', value: 4.9, date: '2026-05-01' }),
      e({ id: '2', metricKey: 'sprint40', value: 4.7, date: '2026-06-01' }),
    ])!;
    expect(improvementLabel(s)).toBe('+0.2 s');
  });
  it('slower sprint shows a minus sign', () => {
    const s = summarizeMetric([
      e({ id: '1', metricKey: 'sprint40', value: 4.7, date: '2026-05-01' }),
      e({ id: '2', metricKey: 'sprint40', value: 4.9, date: '2026-06-01' }),
    ])!;
    expect(improvementLabel(s)).toBe('−0.2 s');
  });
  it('single entry reads "even"', () => {
    const s = summarizeMetric([e({ id: '1', metricKey: 'bench', value: 200, date: '2026-05-01' })])!;
    expect(improvementLabel(s)).toBe('even');
  });
});

describe('topPerformanceLine', () => {
  it('returns null with no history', () => {
    expect(topPerformanceLine([])).toBeNull();
  });
  it('summarizes the most recently active metric with its PR + delta', () => {
    const line = topPerformanceLine([
      e({ id: '1', metricKey: 'bench', value: 200, date: '2026-05-01' }),
      e({ id: '2', metricKey: 'bench', value: 225, date: '2026-06-20' }),
    ]);
    expect(line).toBe('Bench Press · 225 lb PR (+25 lb)');
  });
  it('omits the delta for a single-entry metric', () => {
    const line = topPerformanceLine([e({ id: '1', metricKey: 'vertical', value: 30, date: '2026-06-20' })]);
    expect(line).toBe('Vertical Jump · 30 in PR');
  });
});

describe('addPerfEntry / removePerfEntry', () => {
  it('appends and keeps the log sorted', () => {
    const a = addPerfEntry([], e({ id: '1', metricKey: 'bench', value: 200, date: '2026-06-02' }));
    const b = addPerfEntry(a, e({ id: '2', metricKey: 'bench', value: 205, date: '2026-06-01' }));
    expect(b.map((x) => x.id)).toEqual(['2', '1']);
  });
  it('caps the log to the most recent entries', () => {
    let log: PerfEntry[] = [];
    for (let i = 0; i < PERF_ENTRY_CAP + 10; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      log = addPerfEntry(log, e({ id: `id-${i}`, metricKey: 'bench', value: 100 + i, date: `2026-06-${day}` }));
    }
    expect(log.length).toBe(PERF_ENTRY_CAP);
  });
  it('removes by id, leaving others intact', () => {
    const log = [
      e({ id: '1', metricKey: 'bench', value: 200, date: '2026-06-01' }),
      e({ id: '2', metricKey: 'bench', value: 205, date: '2026-06-02' }),
    ];
    expect(removePerfEntry(log, '1').map((x) => x.id)).toEqual(['2']);
    expect(removePerfEntry(log, 'nope')).toHaveLength(2);
  });
});

describe('perfSparkGeometry', () => {
  it('improving lift series ends higher (smaller y) than it starts', () => {
    const g = perfSparkGeometry([200, 210, 225], 'higher');
    expect(g.points).toHaveLength(3);
    expect(g.last.y).toBeLessThan(g.points[0].y);
    expect(g.linePath.startsWith('M')).toBe(true);
  });
  it('improving (faster) sprint series also trends UP visually', () => {
    // times dropping 4.9 -> 4.7 is an improvement; the last point should be higher up
    const g = perfSparkGeometry([4.9, 4.8, 4.7], 'lower');
    expect(g.last.y).toBeLessThan(g.points[0].y);
  });
  it('single point sits mid-box', () => {
    const g = perfSparkGeometry([200], 'higher');
    expect(g.points).toHaveLength(1);
    expect(g.last.y).toBeGreaterThan(0);
  });
  it('flat series does not throw and stays on one line', () => {
    const g = perfSparkGeometry([200, 200, 200], 'higher');
    expect(g.points).toHaveLength(3);
    const ys = g.points.map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
  });
});
