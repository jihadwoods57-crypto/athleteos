// AthleteOS — trend-chart geometry tests. The chart math is load-bearing (the UI
// draws exactly these paths), so pin the projection, clamping, and trend summary.
import {
  appendDayScore,
  appendDayWeight,
  COMPLIANCE_THRESHOLD,
  currentStreak,
  DEFAULT_CHART_BOX,
  DEFAULT_WEIGHT_BOX,
  HISTORY_CAP,
  realTrendDays,
  recentDayLabels,
  weekdayLong,
  weeklyWeightProgress,
  seededHistory,
  trendGeometry,
  trendSeries,
  trendSummary,
  TREND_WINDOW,
  weeklyCompliance,
  weightSeries,
  weightTrendGeometry,
  nutritionTrend,
} from './history';
import type { DayScore, WeightPoint } from './types';

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

describe('weeklyWeightProgress', () => {
  it('is 0 for a brand-new athlete with no history (current == start)', () => {
    expect(weeklyWeightProgress([], 195, 195)).toBe(0);
  });

  it('measures current minus the oldest weight in the recent window', () => {
    const hist = [
      { date: '2026-06-18', weight: 180 },
      { date: '2026-06-19', weight: 181 },
      { date: '2026-06-20', weight: 182 },
    ];
    // oldest recent (window-1 = 6 back, but only 3 entries) is 180; current 183 -> +3
    expect(weeklyWeightProgress(hist, 183, 171)).toBe(3);
  });

  it('can be negative on a cut', () => {
    const hist = [{ date: '2026-06-19', weight: 200 }];
    expect(weeklyWeightProgress(hist, 197.5, 205)).toBe(-2.5);
  });

  it('falls back to the season start when there is no history', () => {
    expect(weeklyWeightProgress([], 174, 171)).toBe(3);
  });
});

describe('weekdayLong', () => {
  it('returns the full weekday name for a given day', () => {
    expect(weekdayLong(new Date(2026, 5, 16))).toBe('Tuesday'); // getDay() === 2
    expect(weekdayLong(new Date(2026, 5, 21))).toBe('Sunday'); // getDay() === 0
    expect(weekdayLong(new Date(2026, 5, 20))).toBe('Saturday'); // getDay() === 6
  });
});

describe('seededHistory', () => {
  it('ends at the live score so the chart reacts to today', () => {
    const h = seededHistory(94);
    expect(h).toHaveLength(7);
    expect(h[6]).toBe(94);
  });
});

describe('appendDayScore', () => {
  it('appends a new dated, rounded, clamped score', () => {
    const out = appendDayScore([], '2026-06-21', 87.6);
    expect(out).toEqual([{ date: '2026-06-21', score: 88 }]);
  });

  it('clamps out-of-range scores to 0..100', () => {
    expect(appendDayScore([], 'd', 130)[0].score).toBe(100);
    expect(appendDayScore([], 'd', -5)[0].score).toBe(0);
  });

  it('overwrites a repeat of the same date (idempotent re-roll), keeping order', () => {
    const seed: DayScore[] = [
      { date: '2026-06-20', score: 80 },
      { date: '2026-06-21', score: 70 },
    ];
    const out = appendDayScore(seed, '2026-06-21', 95);
    expect(out).toHaveLength(2);
    expect(out).toEqual([
      { date: '2026-06-20', score: 80 },
      { date: '2026-06-21', score: 95 },
    ]);
  });

  it('caps the log to the last HISTORY_CAP days', () => {
    let hist: DayScore[] = [];
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      hist = appendDayScore(hist, `day-${i}`, 50 + i);
    }
    expect(hist).toHaveLength(HISTORY_CAP);
    // oldest five fell off; the window ends at the newest entry.
    expect(hist[0].date).toBe('day-5');
    expect(hist[hist.length - 1].date).toBe(`day-${HISTORY_CAP + 4}`);
  });
});

describe('weeklyCompliance', () => {
  // Tuesday 2026-06-16 (getDay() === 2) — pins the weekday labels.
  const tue = new Date(2026, 5, 16);

  it('marks the last day as today (in progress), never counted as on-plan', () => {
    const wc = weeklyCompliance([], 99, COMPLIANCE_THRESHOLD, TREND_WINDOW, tue);
    expect(wc.days).toHaveLength(TREND_WINDOW);
    const last = wc.days[wc.days.length - 1];
    expect(last.today).toBe(true);
    expect(last.ok).toBe(false); // today is never "on plan" even at 99
    expect(last.label).toBe('Tue');
  });

  it('flags completed days below the threshold as off-plan', () => {
    const hist = [
      { date: 'a', score: 90 },
      { date: 'b', score: 70 }, // below 80 -> off plan
      { date: 'c', score: 85 },
    ];
    const wc = weeklyCompliance(hist, 88, COMPLIANCE_THRESHOLD, TREND_WINDOW, tue);
    const completed = wc.days.filter((d) => !d.today);
    expect(wc.total).toBe(TREND_WINDOW - 1);
    // every completed day at/above 80 is on plan; the single 70 is not.
    expect(completed.filter((d) => !d.ok)).toHaveLength(1);
    expect(wc.onPlan).toBe(wc.total - 1);
  });

  it('reports the mean completed score as the headline percent (excludes today)', () => {
    const hist = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, score: 80 }));
    // 6 completed days all 80; today live = 50 must NOT pull the percent down.
    const wc = weeklyCompliance(hist, 50, COMPLIANCE_THRESHOLD, TREND_WINDOW, tue);
    expect(wc.pct).toBe(80);
    expect(wc.total).toBe(6);
    expect(wc.onPlan).toBe(6);
  });

  it('shares the padded series with the trend chart (dots match the line)', () => {
    const hist = [{ date: 'a', score: 91 }];
    const series = trendSeries(hist, 92);
    const wc = weeklyCompliance(hist, 92, COMPLIANCE_THRESHOLD, TREND_WINDOW, tue);
    expect(wc.days.map((d) => d.score)).toEqual(series);
  });
});

describe('nutritionTrend', () => {
  it('uses the live nutrition score as the final (today) bar', () => {
    const nt = nutritionTrend([], 77);
    expect(nt.bars).toHaveLength(TREND_WINDOW);
    expect(nt.bars[nt.bars.length - 1]).toBe(77);
  });

  it('averages only the completed bars, never today', () => {
    const hist = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, score: 90 }));
    // 6 completed days at 90; a low live score must not pull the weekly avg down.
    const nt = nutritionTrend(hist, 10);
    expect(nt.avg).toBe(90);
    expect(nt.bars[nt.bars.length - 1]).toBe(10);
  });

  it('shares the padded series shape with the score trend', () => {
    const hist = [{ date: 'a', score: 88 }];
    expect(nutritionTrend(hist, 91).bars).toEqual(trendSeries(hist, 91));
  });
});

describe('appendDayWeight', () => {
  it('appends a dated, rounded weight and caps to HISTORY_CAP', () => {
    expect(appendDayWeight([], '2026-06-21', 181.27)).toEqual([{ date: '2026-06-21', weight: 181.3 }]);
    let hist: WeightPoint[] = [];
    for (let i = 0; i < HISTORY_CAP + 3; i++) hist = appendDayWeight(hist, `d${i}`, 170 + i);
    expect(hist).toHaveLength(HISTORY_CAP);
    expect(hist[0].date).toBe('d3');
  });

  it('overwrites the same date (idempotent re-roll)', () => {
    const seed: WeightPoint[] = [{ date: 'a', weight: 180 }];
    expect(appendDayWeight(seed, 'a', 183)).toEqual([{ date: 'a', weight: 183 }]);
  });
});

describe('weightSeries', () => {
  it('ramps from start toward the first known point while history is sparse', () => {
    const s = weightSeries([], 178, 171);
    expect(s).toHaveLength(TREND_WINDOW);
    expect(s[s.length - 1]).toBe(178); // live weight is the final point
    // monotonic ramp from ~start up to the live weight (the build narrative).
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
    expect(s[0]).toBeGreaterThan(171); // first lead step is start + one increment
    expect(s[0]).toBeLessThan(178);
  });

  it('uses only real weights once history fills the window', () => {
    const hist: WeightPoint[] = Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, weight: 170 + i }));
    const s = weightSeries(hist, 185, 171);
    expect(s).toHaveLength(TREND_WINDOW);
    expect(s[s.length - 1]).toBe(185);
    expect(s.slice(0, TREND_WINDOW - 1)).toEqual([174, 175, 176, 177, 178, 179]);
  });
});

describe('weightTrendGeometry', () => {
  it('fits the axis so neither the line nor the goal line clips', () => {
    const g = weightTrendGeometry([171, 175, 178], 184);
    const box = DEFAULT_WEIGHT_BOX;
    const top = box.padTop;
    const bottom = box.height - box.padBottom;
    // every plotted point and the goal line stay within the drawing area.
    for (const p of g.points) {
      expect(p.y).toBeGreaterThanOrEqual(top);
      expect(p.y).toBeLessThanOrEqual(bottom);
    }
    expect(g.goalY).toBeGreaterThanOrEqual(top);
    expect(g.goalY).toBeLessThanOrEqual(bottom);
  });

  it('places the goal above the current weight when the goal is higher (smaller y)', () => {
    const g = weightTrendGeometry([171, 175, 178], 184);
    expect(g.goalY).toBeLessThan(g.last.y); // higher goal -> drawn higher up
  });

  it('renders a path + end dot even with an empty series', () => {
    const g = weightTrendGeometry([], 184);
    expect(g.linePath.startsWith('M')).toBe(true);
    expect(g.last).toBeDefined();
  });
});

describe('trendSeries', () => {
  it('pads with the seed when history is empty, ending at the live score', () => {
    const s = trendSeries([], 94);
    expect(s).toHaveLength(TREND_WINDOW);
    expect(s[s.length - 1]).toBe(94);
    expect(s).toEqual(seededHistory(94));
  });

  it('uses only real history once it fills the window (seed drops out)', () => {
    const hist: DayScore[] = Array.from({ length: 10 }, (_, i) => ({
      date: `day-${i}`,
      score: 60 + i,
    }));
    const s = trendSeries(hist, 99);
    expect(s).toHaveLength(TREND_WINDOW);
    expect(s[s.length - 1]).toBe(99); // today is the final point
    // the last window-1 real days precede today, in order.
    expect(s.slice(0, TREND_WINDOW - 1)).toEqual([64, 65, 66, 67, 68, 69]);
  });

  it('mixes real history and seed pad while still filling up', () => {
    const hist: DayScore[] = [
      { date: 'a', score: 90 },
      { date: 'b', score: 91 },
    ];
    const s = trendSeries(hist, 92);
    expect(s).toHaveLength(TREND_WINDOW);
    // tail is the real days then today; head is seed padding.
    expect(s.slice(-3)).toEqual([90, 91, 92]);
  });
});

describe('realTrendDays', () => {
  it('is 1 on a brand-new athlete with no history (only today is real)', () => {
    expect(realTrendDays([])).toBe(1);
  });

  it('counts each persisted day plus today, matching the trendSeries tail', () => {
    const hist: DayScore[] = [
      { date: 'a', score: 90 },
      { date: 'b', score: 91 },
    ];
    expect(realTrendDays(hist)).toBe(3); // 2 real + today
    // and never claims more than the chart actually plots
    expect(realTrendDays(hist)).toBeLessThanOrEqual(trendSeries(hist, 92).length);
  });

  it('saturates at the window once real history fills it (seed has dropped out)', () => {
    const hist: DayScore[] = Array.from({ length: 10 }, (_, i) => ({
      date: `day-${i}`,
      score: 80 + i,
    }));
    expect(realTrendDays(hist)).toBe(TREND_WINDOW);
  });
});

describe('currentStreak', () => {
  const mk = (...scores: number[]): DayScore[] =>
    scores.map((score, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, score }));

  it('breaks to 0 when today is below the threshold, ignoring past wins', () => {
    expect(currentStreak(mk(95, 92, 88), 70)).toBe(0);
  });

  it('on empty history pads with the seeded lead (all on-plan) → today + 6', () => {
    // Fresh install: seeded 7-day trend reads all on-plan, so the streak should
    // match it rather than show a lone 1.
    expect(currentStreak([], 90)).toBe(7);
  });

  it('counts consecutive on-plan history days plus today, then the seed', () => {
    // 3 real on-plan days, unbroken back through history → +6 seed days +1 today.
    expect(currentStreak(mk(85, 88, 91), 90)).toBe(3 + 6 + 1);
  });

  it('stops at the first real recorded miss — the seed does not leak through', () => {
    // History (oldest→newest): 95, 50 (miss), 90, 92. Walking back from today:
    // today(+1), 92(+1), 90(+1), then 50 is a miss → stop. Streak = 3.
    expect(currentStreak(mk(95, 50, 90, 92), 90)).toBe(3);
  });

  it('a day exactly at the threshold counts as on-plan', () => {
    expect(currentStreak(mk(COMPLIANCE_THRESHOLD), COMPLIANCE_THRESHOLD)).toBe(2 + 6);
  });
});
