// AthleteOS — score history + trend chart geometry (pure, no RN imports).
// Turns a series of daily scores into the SVG geometry the Home/Parent/Coach
// trend charts draw, replacing the prototype's hard-coded path. The live score
// is the last point, so the chart reacts to today's accountability.
import type { DayScore, TrendDir } from './types';

export type { DayScore } from './types';

/** Chart drawing box, matching the prototype's TrendChart viewBox. */
export interface ChartBox {
  width: number;
  height: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Score range the y-axis spans. Points outside are clamped. */
  min: number;
  max: number;
}

export const DEFAULT_CHART_BOX: ChartBox = {
  width: 322,
  height: 116,
  padX: 12,
  padTop: 16,
  padBottom: 0,
  min: 60,
  max: 100,
};

export interface Point {
  x: number;
  y: number;
}

export interface TrendChartGeometry {
  points: Point[];
  /** Open polyline path (the trend line). */
  linePath: string;
  /** Closed path down to the baseline (the gradient fill). */
  areaPath: string;
  /** The most recent point, for the end-of-line dot. */
  last: Point;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Project a score series into chart coordinates. x is evenly spaced across the
 * usable width; y maps [min..max] to the box bottom..top (SVG y grows downward).
 */
export function trendGeometry(
  scores: number[],
  box: ChartBox = DEFAULT_CHART_BOX,
): TrendChartGeometry {
  const n = Math.max(scores.length, 1);
  const usableW = box.width - box.padX * 2;
  const top = box.padTop;
  const bottom = box.height - box.padBottom;
  const usableH = bottom - top;
  const span = box.max - box.min || 1;

  const points: Point[] = scores.map((raw, i) => {
    const x = n === 1 ? box.padX + usableW / 2 : box.padX + (usableW * i) / (n - 1);
    const norm = clamp((raw - box.min) / span, 0, 1);
    const y = bottom - norm * usableH; // higher score -> higher up (smaller y)
    return { x: r1(x), y: r1(y) };
  });

  // Guard against an empty series so the path is always renderable.
  if (points.length === 0) {
    const mid = { x: r1(box.padX + usableW / 2), y: r1(bottom) };
    points.push(mid);
  }

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x},${r1(bottom)} L${first.x},${r1(bottom)} Z`;

  return { points, linePath, areaPath, last };
}

export interface TrendSummary {
  dir: TrendDir;
  /** Newest minus oldest score in the series. */
  delta: number;
  label: string;
}

/** Direction + delta of a score series (first vs last). */
export function trendSummary(scores: number[]): TrendSummary {
  if (scores.length < 2) return { dir: 'flat', delta: 0, label: '→ steady' };
  const delta = scores[scores.length - 1] - scores[0];
  if (delta > 0) return { dir: 'up', delta, label: '↑ trending up' };
  if (delta < 0) return { dir: 'down', delta, label: '↓ trending down' };
  return { dir: 'flat', delta: 0, label: '→ steady' };
}

/** Weekday short labels for the last `n` days ending today (oldest -> newest). */
export function recentDayLabels(n: number, today: Date = new Date()): string[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    out.push(names[day.getDay()]);
  }
  return out;
}

/** Most recent N days the trend chart shows (today + the prior days). */
export const TREND_WINDOW = 7;

/** How many days of real history we persist. The chart shows the last
 *  TREND_WINDOW; we keep a little more so a longer view can reuse it later. */
export const HISTORY_CAP = 14;

/** Seeded lead-in used to pad the chart while real history is still filling up,
 *  so a fresh install / early days still render a believable trend instead of a
 *  flat line. Once HISTORY has TREND_WINDOW-1 real days, the seed drops out. */
const SEEDED_LEAD = [82, 80, 83, 86, 88, 85];

/**
 * Seeded demo history ending at the live score — kept for callers/tests that
 * want a full synthetic series. Real callers should prefer `trendSeries`, which
 * uses persisted history and only falls back to the seed when it's sparse.
 */
export function seededHistory(liveScore: number): number[] {
  return [...SEEDED_LEAD, liveScore];
}

/**
 * Append a day's final score to the rolling history, keyed by ISO date. A
 * repeat of the same date overwrites (idempotent re-roll), the score is clamped
 * to 0..100 and rounded, and the result is capped to the last `cap` days.
 */
export function appendDayScore(
  history: DayScore[],
  date: string,
  score: number,
  cap: number = HISTORY_CAP,
): DayScore[] {
  const next = history.filter((h) => h.date !== date);
  next.push({ date, score: clamp(Math.round(score), 0, 100) });
  return next.slice(-cap);
}

/**
 * Build the trend series the chart plots: the last `window-1` persisted days
 * followed by today's live score as the final point. When real history is too
 * short to fill the window, the seeded lead pads the left so the chart still
 * reads as a trend rather than a stub.
 */
export function trendSeries(
  history: DayScore[],
  liveScore: number,
  window: number = TREND_WINDOW,
): number[] {
  const past = history.map((h) => h.score).slice(-(window - 1));
  const series = [...past, liveScore];
  if (series.length >= window) return series;
  const padCount = window - series.length;
  const lead = SEEDED_LEAD.slice(Math.max(0, SEEDED_LEAD.length - padCount));
  return [...lead, ...series];
}
