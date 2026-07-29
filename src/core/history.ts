// OnStandard — score history + trend chart geometry (pure, no RN imports).
// Turns a series of daily scores into the SVG geometry the Home/Parent/Coach
// trend charts draw, replacing the prototype's hard-coded path. The live score
// is the last point, so the chart reacts to today's accountability.
import { daysBetweenStamps, shiftStamp } from './clock';
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
  /** Mean nutrition score across the REAL completed days (excludes today AND the
   *  seeded pre-history padding), 0..100. 0 when there are no real completed days. */
  avg: number;
  /** How many leading `bars` are seeded pre-history padding rather than real
   *  logged days. The UI renders these as neutral placeholders, not real bars. */
  seededBefore: number;
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
  const seededBefore = bars.length - realTrendDays(history, window);
  // Average only REAL completed bars: drop the leading seeded padding and today.
  const completed = bars.slice(seededBefore, -1);
  const avg = completed.length
    ? Math.round(completed.reduce((a, b) => a + b, 0) / completed.length)
    : 0;
  return { bars, avg, seededBefore };
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
  /** True when this point is seeded pre-history padding (the chart's lead-in),
   *  not a real logged day. Seeded days are never "on plan" and are excluded from
   *  the onPlan / total / pct headline — a real family is never shown a compliance
   *  figure manufactured from demo data. The UI renders them as neutral placeholders. */
  seeded: boolean;
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
  // The last `realTrendDays` points are real (persisted days + today); anything
  // before that is the seeded lead-in the chart draws only for shape.
  const seededBefore = scores.length - realTrendDays(history, window);
  const days: ComplianceDay[] = scores.map((score, i) => ({
    label: labels[i],
    score,
    seeded: i < seededBefore,
    // A seeded padding day never happened, so it can never be "on plan".
    ok: i !== lastIdx && i >= seededBefore && score >= threshold,
    today: i === lastIdx,
  }));
  const completed = days.filter((d) => !d.today && !d.seeded);
  const onPlan = completed.filter((d) => d.ok).length;
  const total = completed.length;
  const pct = total
    ? Math.round(completed.reduce((a, d) => a + d.score, 0) / total)
    : 0;
  return { days, onPlan, total, pct };
}

/** Full weekday name for a given day (defaults to today), e.g. "Tuesday". Used
 *  for the Plan / Nutrition headers so they read the real day instead of a frozen
 *  "Tuesday". */
export function weekdayLong(today: Date = new Date()): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[today.getDay()];
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

/** How many days of real history we RETAIN (audit item 14). Deliberately decoupled from
 *  TREND_WINDOW: the chart still shows the last 7 days, but we keep a full season+ so the
 *  athlete's record isn't truncated at two weeks — the foundation the "full portable record"
 *  premium tier and a season/longest-streak view need. ~400 days of {date, score} is a few tens
 *  of KB in AsyncStorage; the server `days` table is the durable source a new device backfills
 *  from (hydrateHistory). Raising this changes retention only — no chart or scoring math moves. */
export const HISTORY_CAP = 400;

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

/** One earned grace day per this many trailing days (council ruling 2026-07-02): a single recent
 *  sub-threshold day can be forgiven so one bad day never nukes a long streak, while a SECOND miss
 *  still ends it honestly. Cadence is a founder-tunable launch value (open question #1). */
/* ---------------------------------------------------------------------------------------------
 * STREAK — deliberately NOT implemented here.
 *
 * There used to be a second `streakInfo`/`currentStreak` in this file. It disagreed with the one
 * the app actually runs (proto/redesign-2026-07/js/day.js:469) on three points: whether an
 * incomplete today zeroes the run, whether grace is a fixed trailing window or a rolling one, and
 * whether activation day counts. Both were unit-tested, and the two suites asserted OPPOSITE
 * answers while both stayed green — see history.test.ts and protoStreakGrace.test.ts.
 *
 * Its only callers were src/screens/**, which was unreachable dead code and has been deleted, so
 * this copy was never what any athlete saw. Rather than reconcile two engines for a number the
 * product promises "never lies", there is now exactly ONE:
 *
 *     proto/redesign-2026-07/js/day.js  ->  streakInfo(activationDate)
 *
 * Guarded by streakSingleSource.test.ts, which fails if a second implementation reappears.
 * `longestStreak` below is a different question (best run ever, over completed days only) and has
 * no proto counterpart, so it stays.
 * ------------------------------------------------------------------------------------------- */

/**
 * The athlete's personal-best streak: the longest run of consecutive on-standard days anywhere in
 * their retained history (audit item 14 — the "was 9, longest 30" record the season/premium surface
 * shows). Pure read over completed days; today's live score is not included (it belongs to the
 * current streak, not yet a completed record). Returns 0 for an empty/never-on-standard history.
 */
export function longestStreak(history: DayScore[], threshold: number = COMPLIANCE_THRESHOLD): number {
  let best = 0;
  let run = 0;
  let prevDate: string | null = null;
  for (const d of history) {
    if (d.score >= threshold) {
      // Consecutive means date-adjacent: a gap the app never recorded resets the run
      // (entries are chronological — appendDayScore keys by date). Dateless legacy
      // entries (NaN distance) also reset, never bridge.
      const adjacent = prevDate != null && daysBetweenStamps(prevDate, d.date) === 1;
      run = adjacent && run > 0 ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prevDate = d.date;
  }
  return best;
}

/** How many retained days cleared the bar (the "N days on standard this season" record). Completed
 *  days only; pure. */
export function daysOnStandard(history: DayScore[], threshold: number = COMPLIANCE_THRESHOLD): number {
  return history.reduce((n, d) => (d.score >= threshold ? n + 1 : n), 0);
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

/**
 * Weight change so far this week: current weight minus the weight at the start of
 * the recorded window (the oldest of the last `window` recorded days), falling
 * back to the season start when no history has accrued yet. So a brand-new
 * athlete reads 0.0 (current == start) instead of the seed's fabricated +0.6,
 * matching the "0 gained" Home and Check-In already show. Can be negative (cut).
 */
export function weeklyWeightProgress(
  history: WeightPoint[],
  currentWeight: number,
  start: number,
  window: number = TREND_WINDOW,
): number {
  const recent = history.slice(-(window - 1));
  const weekStart = recent.length ? recent[0].weight : start;
  return +(currentWeight - weekStart).toFixed(1);
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
