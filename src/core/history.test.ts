// AthleteOS — trend-chart geometry tests. The chart math is load-bearing (the UI
// draws exactly these paths), so pin the projection, clamping, and trend summary.
import {
  DEFAULT_CHART_BOX,
  recentDayLabels,
  seededHistory,
  trendGeometry,
  trendSummary,
} from './history';

describe('trendGeometry — projection', () => {
  const box = DEFAULT_CHART_BOX;

  it('spreads x evenly from left pad to right edge', () => {
    const g = trendGeometry([80, 85, 90]);
    expect(g.points[0].x).toBe(box.padX); // 12
    expect(g.points[2].x).toBe(box.width - box.padX); // 310
    // middle point is centered
    expect(g.points[1].x).toBe((box.padX + (box.width - box.padX)) / 2);
  });

  it('maps the max score to the top and the min to the bottom', () => {
    const g = trendGeometry([box.min, box.max]);
    const bottom = box.height - box.padBottom; // 116
    expect(g.points[0].y).toBe(bottom); // min -> baseline
    expect(g.points[1].y).toBe(box.padTop); // max -> top
  });

  it('a higher score yields a smaller y (drawn higher up)', () => {
    const g = trendGeometry([70, 95]);
    expect(g.points[1].y).toBeLessThan(g.points[0].y);
  });

  it('clamps scores outside the [min,max] range', () => {
    const g = trendGeometry([40, 120]); // below min, above max
    const bottom = box.height - box.padBottom;
    expect(g.points[0].y).toBe(bottom); // clamped to min
    expect(g.points[1].y).toBe(box.padTop); // clamped to max
  });
});

describe('trendGeometry — paths', () => {
  it('builds an open polyline starting with M then L commands', () => {
    const g = trendGeometry([80, 85, 90]);
    expect(g.linePath.startsWith('M')).toBe(true);
    expect(g.linePath.split('L')).toHaveLength(3); // 1 M-seg + 2 L-segs
  });

  it('closes the area path back to the baseline', () => {
    const g = trendGeometry([80, 90]);
    const bottom = DEFAULT_CHART_BOX.height; // padBottom 0
    expect(g.areaPath.endsWith('Z')).toBe(true);
    expect(g.areaPath).toContain(`L${g.last.x},${bottom}`);
  });

  it('exposes the last point for the end dot', () => {
    const g = trendGeometry([80, 85, 92]);
    expect(g.last).toEqual(g.points[2]);
  });
});

describe('trendGeometry — edge cases', () => {
  it('renders a single-point series centered', () => {
    const g = trendGeometry([90]);
    expect(g.points).toHaveLength(1);
    const usableW = DEFAULT_CHART_BOX.width - DEFAULT_CHART_BOX.padX * 2;
    expect(g.points[0].x).toBe(DEFAULT_CHART_BOX.padX + usableW / 2);
  });

  it('never produces an empty path for an empty series', () => {
    const g = trendGeometry([]);
    expect(g.points.length).toBeGreaterThan(0);
    expect(g.linePath.startsWith('M')).toBe(true);
  });
});

describe('trendSummary', () => {
  it('reports up when the series rises', () => {
    const t = trendSummary([80, 85, 90]);
    expect(t.dir).toBe('up');
    expect(t.delta).toBe(10);
    expect(t.label).toBe('↑ trending up');
  });

  it('reports down when the series falls', () => {
    const t = trendSummary([90, 80]);
    expect(t.dir).toBe('down');
    expect(t.delta).toBe(-10);
  });

  it('reports flat for equal endpoints or too-short series', () => {
    expect(trendSummary([85, 90, 85]).dir).toBe('flat');
    expect(trendSummary([90]).dir).toBe('flat');
    expect(trendSummary([]).dir).toBe('flat');
  });
});

describe('recentDayLabels', () => {
  it('returns n weekday labels ending today (oldest -> newest)', () => {
    // Tuesday 2026-06-16 (getDay() === 2)
    const tue = new Date(2026, 5, 16);
    const labels = recentDayLabels(7, tue);
    expect(labels).toHaveLength(7);
    expect(labels[6]).toBe('Tue'); // today is last
    expect(labels[5]).toBe('Mon'); // yesterday
    expect(labels[0]).toBe('Wed'); // 6 days ago
  });
});

describe('seededHistory', () => {
  it('ends at the live score so the chart reacts to today', () => {
    const h = seededHistory(94);
    expect(h).toHaveLength(7);
    expect(h[6]).toBe(94);
  });
});
