// AthleteOS — score history + trend chart geometry (pure, no RN imports).
// Turns a series of daily scores into the SVG geometry the Home/Parent/Coach
// trend charts draw, replacing the prototype's hard-coded path. The live score
// is the last point, so the chart reacts to today's accountability.
import type { DayScore, TrendDir, WeightPoint } from './types';

export type { DayScore, WeightPoint } from './types';

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

export interface NutritionTrend {
  /** Padded daily nutrition scores, oldest -> newest; the last is today (live). */
  bars: number[];
  /** Mean nutrition score across the completed days (excludes today), 0..100. */
  avg: number;
}

/**
 * Build the Parent nutrition-trend bars from real per-day nutrition sub-scores,
 * reusing the same padded-series shape as the score trend (today's live
 * nutrition score is the final bar). The weekly-average headline excludes today
 * so an early in-progress day can't drag it down.
 */
export function nutritionTrend(
  history: DayScore[],
  liveScore: number,
  window: number = TREND_WINDOW,
): NutritionTrend {
  const bars = trendSeries(history, liveScore, window);
  const completed = bars.slice(0, -1);
  const avg = completed.length
    ? Math.round(completed.reduce((a, b) => a + b, 0) / completed.length)
    : 0;
  return { bars, avg };
}

/** A completed day at or above this accountability score counts as "on plan".
 *  Same bar as the coach alert threshold — a passing, on-track day. */
export const COMPLIANCE_THRESHOLD = 80;

export interface ComplianceDay {
  /** Weekday short label (M/T/W…). */
  label: string;
  score: number;
  /** A completed day at/above the threshold. False for today (in progress). */
  ok: boolean;
  /** The live, in-progress day (the last point) — rendered as an indicator,
   *  not counted in the weekly summary. */
  today: boolean;
}

export interface WeeklyCompliance {
  /** One entry per day in the window, oldest -> newest; the last is today. */
  days: ComplianceDay[];
  /** Completed days (excludes today) that were on plan. */
  onPlan: number;
  /** Completed days in the window (window - 1). */
  total: number;
  /** Mean accountability score across the completed days, 0..100. */
  pct: number;
}

/**
 * Summarize the week's accountability for the Parent compliance card from real
 * persisted history. Reuses the SAME padded series the trend chart draws, so the
 * day dots and the trend line can never disagree. Today is shown as an
 * in-progress indicator; the headline % (mean completed score) and the
 * "N of M on plan" count consider only completed days, so an early-morning live
 * score can't drag the week down.
 */
export function weeklyCompliance(
  history: DayScore[],
  liveScore: number,
  threshold: number = COMPLIANCE_THRESHOLD,
  window: number = TREND_WINDOW,
  today: Date = new Date(),
): WeeklyCompliance {
  const scores = trendSeries(history, liveScore, window);
  const labels = recentDayLabels(scores.length, today);
  const lastIdx = scores.length - 1;
  const days: ComplianceDay[] = scores.map((score, i) => ({
    label: labels[i],
    score,
    ok: i !== lastIdx && score >= threshold,
    today: i === lastIdx,
  }));
  const completed = days.filter((d) => !d.today);
  const onPlan = completed.filter((d) => d.ok).length;
  const total = completed.length;
  const pct = total
    ? Math.round(completed.reduce((a, d) => a + d.score, 0) / total)
    : 0;
  return { days, onPlan, total, pct };
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

/**
 * How many points of the `window`-length trend series are backed by REAL data —
 * persisted history days plus today's live score — rather than the seeded lead
 * that pads a sparse chart. Today always counts, so the result is at least 1 and
 * at most `window`. A screen can use this to tell an honest story on a brand-new
 * athlete (mostly-seeded chart) instead of claiming a full "Past 7 days" of real
 * data the athlete hasn't lived yet.
 */
export function realTrendDays(
  history: DayScore[],
  window: number = TREND_WINDOW,
): number {
  return Math.min(history.length, window - 1) + 1; // +1 for today (always real)
}

/**
 * The athlete's current accountability streak: consecutive days, ending today,
 * that cleared the on-plan threshold. Today is honest — a sub-threshold live
 * score ends the streak at 0 right now. Prior days read real persisted history
 * (most recent backward); the first recorded miss ends the count. When the real
 * history is unbroken all the way back, the unknown pre-history is padded with
 * the SAME seeded lead the trend chart draws (`SEEDED_LEAD`), so a fresh install
 * shows a believable streak consistent with the seeded 7-day trend instead of a
 * lone "1" — and that seed drops out the moment a real miss is recorded.
 */
export function currentStreak(
  history: DayScore[],
  liveScore: number,
  threshold: number = COMPLIANCE_THRESHOLD,
): number {
  // Today is live: missing the bar today breaks the streak immediately.
  if (liveScore < threshold) return 0;
  let streak = 1;
  const scores = history.map((h) => h.score);
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] < threshold) return streak; // a real recorded miss ends it
    streak++;
  }
  // Unbroken through all real history — pad the unknown pre-history with the
  // seeded lead, the same believable baseline the trend chart uses.
  for (let i = SEEDED_LEAD.length - 1; i >= 0; i--) {
    if (SEEDED_LEAD[i] < threshold) break;
    streak++;
  }
  return streak;
}

/**
 * Append a day's recorded body weight to the rolling history, keyed by ISO date.
 * Same idempotent-overwrite + cap semantics as `appendDayScore`, with a sane
 * weight clamp so a corrupt blob can't blow out the chart axis.
 */
export function appendDayWeight(
  history: WeightPoint[],
  date: string,
  weight: number,
  cap: number = HISTORY_CAP,
): WeightPoint[] {
  const next = history.filter((h) => h.date !== date);
  next.push({ date, weight: clamp(r1(weight), 40, 600) });
  return next.slice(-cap);
}

/**
 * Build the weight series the Parent chart plots: the last `window-1` persisted
 * daily weights followed by the live `currentWeight` as the final point. When
 * real history is too short, the left is padded with a straight ramp from
 * `start` toward the first known point, so a fresh install reads as a build
 * toward goal instead of a flat line.
 */
export function weightSeries(
  history: WeightPoint[],
  currentWeight: number,
  start: number,
  window: number = TREND_WINDOW,
): number[] {
  const past = history.map((h) => h.weight).slice(-(window - 1));
  const series = [...past, currentWeight];
  if (series.length >= window) return series;
  const padCount = window - series.length;
  const firstKnown = series[0];
  const lead: number[] = [];
  for (let i = 0; i < padCount; i++) {
    const t = (i + 1) / (padCount + 1);
    lead.push(r1(start + (firstKnown - start) * t));
  }
  return [...lead, ...series];
}

export interface WeightChartGeometry extends TrendChartGeometry {
  /** y of the season goal line within the box (same axis as the trend line). */
  goalY: number;
}

/** Chart box for the Parent weight trend (matches its 322×134 viewBox). The
 *  y-range (min/max) is fitted to the data + goal per call, so only the box
 *  dimensions/pads matter here. */
export const DEFAULT_WEIGHT_BOX: ChartBox = {
  width: 322,
  height: 134,
  padX: 12,
  padTop: 12,
  padBottom: 0,
  min: 160,
  max: 190,
};

/**
 * Project a weight series into chart geometry, fitting the y-axis to the data
 * AND the season goal so neither the line nor the dashed goal marker clips.
 * Returns the trend line/area paths plus the goal line's y on the same axis.
 */
export function weightTrendGeometry(
  weights: number[],
  target: number,
  box: ChartBox = DEFAULT_WEIGHT_BOX,
): WeightChartGeometry {
  const all = weights.length ? weights : [target];
  const lo = Math.min(target, ...all);
  const hi = Math.max(target, ...all);
  const pad = Math.max(2, (hi - lo) * 0.15);
  const fit: ChartBox = { ...box, min: Math.floor(lo - pad), max: Math.ceil(hi + pad) };
  const g = trendGeometry(weights, fit);
  const span = fit.max - fit.min || 1;
  const top = fit.padTop;
  const bottom = fit.height - fit.padBottom;
  const norm = clamp((target - fit.min) / span, 0, 1);
  const goalY = r1(bottom - norm * (bottom - top));
  return { ...g, goalY };
}
