// OnStandard — performance / PR tracking (pure TS, no RN imports).
//
// The app sells performance + scholarships but, until now, only measured food
// and mood. This module is the missing development track: a model for logged
// athletic results (lifts, sprints, jumps, body weight, and custom metrics) with
// best / trend / personal-record computation over time. It is deliberately kept
// OUT of the daily Accountability Score (a separate track) — it answers "am I
// getting better?", not "did I stay on plan today?".
//
// Pure + deterministic: id/timestamp creation lives in the store, not here, so
// every function is unit-testable from fixed fixtures.
import type { TrendDir } from './types';

/** Which direction counts as an improvement for a metric. Heavier/higher/farther
 *  is better for lifts and jumps; FASTER (a lower time) is better for sprints. */
export type PerfDir = 'higher' | 'lower';

/** Broad grouping for sectioning + iconography on the Performance screen. */
export type PerfCategory = 'lift' | 'speed' | 'jump' | 'body' | 'custom';

export interface PerfMetricDef {
  /** Stable id used as the metricKey on entries (e.g. 'bench'). */
  key: string;
  /** Human label, e.g. 'Bench Press'. */
  label: string;
  /** Display unit, e.g. 'lb' | 's' | 'in'. */
  unit: string;
  /** Direction of improvement. */
  dir: PerfDir;
  category: PerfCategory;
}

/** Catalog of the common metrics offered as quick-picks. A 'custom' entry lets
 *  the athlete name their own metric (stored on the entry, see resolveMetric). */
export const PERF_METRICS: PerfMetricDef[] = [
  { key: 'bench', label: 'Bench Press', unit: 'lb', dir: 'higher', category: 'lift' },
  { key: 'squat', label: 'Back Squat', unit: 'lb', dir: 'higher', category: 'lift' },
  { key: 'deadlift', label: 'Deadlift', unit: 'lb', dir: 'higher', category: 'lift' },
  { key: 'clean', label: 'Power Clean', unit: 'lb', dir: 'higher', category: 'lift' },
  { key: 'sprint40', label: '40-Yard Dash', unit: 's', dir: 'lower', category: 'speed' },
  { key: 'sprint10', label: '10-Yard Split', unit: 's', dir: 'lower', category: 'speed' },
  { key: 'mile', label: 'Mile Run', unit: 's', dir: 'lower', category: 'speed' },
  { key: 'vertical', label: 'Vertical Jump', unit: 'in', dir: 'higher', category: 'jump' },
  { key: 'broad', label: 'Broad Jump', unit: 'in', dir: 'higher', category: 'jump' },
  { key: 'bodyweight', label: 'Body Weight', unit: 'lb', dir: 'higher', category: 'body' },
];

/** The metricKey used for athlete-named custom metrics. */
export const CUSTOM_METRIC_KEY = 'custom';

/** How many entries we keep, total, across all metrics. PRs are long-lived
 *  history, so this is generous; a corrupt/runaway blob still can't grow without
 *  bound. Trimmed oldest-first. */
export const PERF_ENTRY_CAP = 365;

/**
 * One logged result. For catalog metrics, `metricKey` indexes PERF_METRICS and
 * the custom* fields are unused. For a custom metric, `metricKey` is
 * CUSTOM_METRIC_KEY and the athlete-chosen label/unit/dir travel on the entry so
 * the metric is fully described without a catalog lookup.
 */
export interface PerfEntry {
  /** Stable unique id (assigned by the store, never here). */
  id: string;
  /** Catalog key, or CUSTOM_METRIC_KEY. */
  metricKey: string;
  /** Custom metric name (only when metricKey === CUSTOM_METRIC_KEY). */
  customLabel?: string;
  /** Custom unit (only for custom metrics); defaults to '' when absent. */
  customUnit?: string;
  /** Custom direction (only for custom metrics); defaults to 'higher'. */
  customDir?: PerfDir;
  /** The measured value, in the metric's unit. */
  value: number;
  /** ISO date (YYYY-MM-DD) the result was achieved. */
  date: string;
}

// 2-decimal precision keeps sprint splits honest (a 0.15s drop must not round
// away) while still being clean for whole-number lifts.
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Trim a number for display: whole numbers lose the decimal, fractions keep up
 *  to 2 places with no trailing zeros (e.g. 225, 4.8, 4.75, 32.5). */
function trimNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(round2(v));
}

/**
 * Resolve the full metric definition for an entry — from the catalog for a known
 * key, or constructed from the entry's custom* fields. Falls back to a safe
 * generic def for an unknown key so a corrupt blob still renders.
 */
export function resolveMetric(entry: PerfEntry): PerfMetricDef {
  if (entry.metricKey === CUSTOM_METRIC_KEY) {
    return {
      key: CUSTOM_METRIC_KEY,
      label: (entry.customLabel ?? '').trim() || 'Custom',
      unit: entry.customUnit ?? '',
      dir: entry.customDir ?? 'higher',
      category: 'custom',
    };
  }
  const found = PERF_METRICS.find((m) => m.key === entry.metricKey);
  return (
    found ?? { key: entry.metricKey, label: entry.metricKey || 'Metric', unit: '', dir: 'higher', category: 'custom' }
  );
}

/**
 * A stable identity for grouping entries into a single metric series. Catalog
 * metrics group by key; custom metrics group by their (case-insensitive,
 * trimmed) label so two "Pull-ups" logs land in one series.
 */
export function metricIdentity(entry: PerfEntry): string {
  if (entry.metricKey === CUSTOM_METRIC_KEY) {
    return `custom:${(entry.customLabel ?? '').trim().toLowerCase()}`;
  }
  return entry.metricKey;
}

/** True if `candidate` is a strict improvement over `current` for the direction. */
export function isImprovement(dir: PerfDir, candidate: number, current: number): boolean {
  return dir === 'higher' ? candidate > current : candidate < current;
}

/** Pick the better of two values for a direction (ties return `a`). */
export function betterValue(dir: PerfDir, a: number, b: number): number {
  return isImprovement(dir, b, a) ? b : a;
}

/** Chronologically sort a metric's entries (oldest -> newest). Stable on equal
 *  dates by preserving input order. */
export function sortByDate(entries: PerfEntry[]): PerfEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i))
    .map((x) => x.e);
}

export interface PerfMetricSummary {
  /** Group identity (see metricIdentity). */
  id: string;
  def: PerfMetricDef;
  /** Entries for this metric, oldest -> newest. */
  entries: PerfEntry[];
  /** The personal record (best value across all entries). */
  best: number;
  /** Date of the PR. */
  bestDate: string;
  /** The most recent logged value. */
  latest: number;
  latestDate: string;
  /** The first logged value (the baseline progress is measured from). */
  first: number;
  /** latest - first, oriented so a positive delta always means improvement
   *  (for a lower-is-better metric, a faster time yields a positive delta). */
  improvement: number;
  /** Trend direction of latest vs first, in improvement terms. */
  trend: TrendDir;
  /** True when the latest entry is itself the personal record. */
  latestIsPr: boolean;
  count: number;
}

/** Improvement of `latest` over `first`, oriented positive = better. */
function orientedDelta(dir: PerfDir, first: number, latest: number): number {
  const raw = latest - first;
  const oriented = dir === 'higher' ? raw : -raw;
  return round2(oriented) + 0; // `+ 0` normalizes a -0 from a zero delta to 0
}

/** Summarize a single metric's series. `entries` must all belong to one metric;
 *  they are sorted internally. Returns null for an empty series. */
export function summarizeMetric(entries: PerfEntry[]): PerfMetricSummary | null {
  if (entries.length === 0) return null;
  const sorted = sortByDate(entries);
  const def = resolveMetric(sorted[0]);
  let best = sorted[0].value;
  let bestDate = sorted[0].date;
  for (const e of sorted) {
    if (isImprovement(def.dir, e.value, best)) {
      best = e.value;
      bestDate = e.date;
    }
  }
  const first = sorted[0].value;
  const latestEntry = sorted[sorted.length - 1];
  const improvement = orientedDelta(def.dir, first, latestEntry.value);
  const trend: TrendDir = improvement > 0 ? 'up' : improvement < 0 ? 'down' : 'flat';
  return {
    id: metricIdentity(sorted[0]),
    def,
    entries: sorted,
    best,
    bestDate,
    latest: latestEntry.value,
    latestDate: latestEntry.date,
    first,
    improvement,
    trend,
    latestIsPr: latestEntry.value === best,
    count: sorted.length,
  };
}

/**
 * Group all entries by metric and summarize each, sorted for display: metrics
 * with a more recent latest entry first (most active on top), ties broken by
 * label. This is the Performance screen's primary data source.
 */
export function performanceSummaries(entries: PerfEntry[]): PerfMetricSummary[] {
  const groups = new Map<string, PerfEntry[]>();
  for (const e of entries) {
    const id = metricIdentity(e);
    const g = groups.get(id);
    if (g) g.push(e);
    else groups.set(id, [e]);
  }
  const summaries: PerfMetricSummary[] = [];
  for (const g of groups.values()) {
    const s = summarizeMetric(g);
    if (s) summaries.push(s);
  }
  return summaries.sort((a, b) =>
    a.latestDate > b.latestDate ? -1 : a.latestDate < b.latestDate ? 1 : a.def.label.localeCompare(b.def.label),
  );
}

/** Format a value with its unit, e.g. "225 lb", "4.8 s", "32.5 in". Whole
 *  numbers render without a decimal; fractional values keep one place. */
export function formatPerfValue(def: PerfMetricDef, value: number): string {
  const n = trimNum(value);
  return def.unit ? `${n} ${def.unit}` : n;
}

/** Signed improvement string for a summary, e.g. "+15 lb", "−0.2 s", "even".
 *  Always oriented so "+" = better regardless of metric direction. */
export function improvementLabel(summary: PerfMetricSummary): string {
  if (summary.improvement === 0 || summary.count < 2) return 'even';
  const sign = summary.improvement > 0 ? '+' : '−';
  const n = trimNum(Math.abs(summary.improvement));
  return summary.def.unit ? `${sign}${n} ${summary.def.unit}` : `${sign}${n}`;
}

/**
 * A single compact line for the coach's PersonDetail: the athlete's most
 * recently improved/active metric as "Bench Press · 225 lb PR (+15)", or null
 * when there is no performance history to show. Keeps the overseer surface
 * honest — absent when there's nothing logged.
 */
export function topPerformanceLine(entries: PerfEntry[]): string | null {
  const summaries = performanceSummaries(entries);
  if (summaries.length === 0) return null;
  const top = summaries[0];
  const pr = formatPerfValue(top.def, top.best);
  if (top.count < 2 || top.improvement === 0) return `${top.def.label} · ${pr} PR`;
  return `${top.def.label} · ${pr} PR (${improvementLabel(top)})`;
}

/**
 * Append an entry to the log, kept sorted oldest -> newest and capped to the
 * last PERF_ENTRY_CAP entries (oldest dropped first). Pure: the caller assigns
 * the id. Returns a new array.
 */
export function addPerfEntry(entries: PerfEntry[], entry: PerfEntry, cap: number = PERF_ENTRY_CAP): PerfEntry[] {
  return sortByDate([...entries, entry]).slice(-cap);
}

/** Remove an entry by id. Returns a new array (unchanged if the id is absent). */
export function removePerfEntry(entries: PerfEntry[], id: string): PerfEntry[] {
  return entries.filter((e) => e.id !== id);
}

// ---- trend chart geometry (a self-fitting sparkline per metric) ----

export interface SparkBox {
  width: number;
  height: number;
  padX: number;
  padY: number;
}

export const DEFAULT_SPARK_BOX: SparkBox = { width: 300, height: 64, padX: 6, padY: 8 };

export interface SparkPoint {
  x: number;
  y: number;
}

export interface SparkGeometry {
  points: SparkPoint[];
  /** Open polyline path. */
  linePath: string;
  /** The most recent point, for the end dot. */
  last: SparkPoint;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Project a metric's values over time into a self-fitting sparkline. The y-axis
 * is oriented so an IMPROVING series always trends UP visually (smaller y),
 * regardless of whether the metric is higher- or lower-is-better — so a dropping
 * 40-yard time and a rising bench both read as "up and to the right". A flat or
 * single-point series sits on the mid-line.
 */
export function perfSparkGeometry(
  values: number[],
  dir: PerfDir,
  box: SparkBox = DEFAULT_SPARK_BOX,
): SparkGeometry {
  const n = Math.max(values.length, 1);
  const usableW = box.width - box.padX * 2;
  const top = box.padY;
  const bottom = box.height - box.padY;
  const usableH = bottom - top;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const points: SparkPoint[] = values.map((raw, i) => {
    const x = n === 1 ? box.padX + usableW / 2 : box.padX + (usableW * i) / (n - 1);
    // Normalize to 0..1 where 1 = best (for the metric's direction).
    const goodness = dir === 'higher' ? (raw - lo) / span : (hi - raw) / span;
    const norm = clamp01(span === 0 ? 0.5 : goodness);
    const y = bottom - norm * usableH; // better -> higher up
    return { x: round2(x), y: round2(y) };
  });

  if (points.length === 0) {
    points.push({ x: round2(box.padX + usableW / 2), y: round2(top + usableH / 2) });
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return { points, linePath, last: points[points.length - 1] };
}
