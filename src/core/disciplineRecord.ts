// OnStandard — the Discipline Record (add-on build 2026-07-04; pure TS, no RN imports).
//
// The recruiting-side seller of Individual Plus ("your full portable record + a shareable
// recruiting card"). An athlete's #1 want is to get recruited; what a college coach can't
// get from film is whether a kid shows up every day. This record is that proof: computed
// ONLY from real logged history (score days, streaks, weight arc), earned in-app, so a
// recruiter reading it knows it wasn't self-typed. Nothing is fabricated: a short history
// renders honestly as a short history, and an empty one refuses to render a record at all.
import { COMPLIANCE_THRESHOLD, currentStreak, daysOnStandard, longestStreak } from './history';
import type { DayScore, WeightPoint } from './types';

export interface DisciplineRecord {
  /** Total real logged days on record. */
  daysLogged: number;
  /** Days at or above the on-standard bar (>= threshold). */
  daysOnStandard: number;
  /** Share of logged days on standard, 0..100. */
  onStandardPct: number;
  /** Longest consecutive on-standard run. */
  longestStreak: number;
  /** Current run, including today's live score. */
  currentStreak: number;
  /** Average score across all logged days. */
  avgScore: number;
  /** First logged date (ISO) — "on record since". */
  since: string;
  /** Net weight change over the record (display units as given), null with <2 points. */
  weightDelta: number | null;
  /** One-line integrity note that travels with every share. */
  integrityLine: string;
}

/** Minimum real days before a record exists at all. Below this the surface shows
 *  "your record starts building" — a 3-day record impresses nobody and shipping one
 *  would teach athletes the number is decorative. */
export const RECORD_MIN_DAYS = 7;

export function disciplineRecord(
  history: DayScore[],
  liveScore: number,
  weightHistory: WeightPoint[] = [],
  threshold: number = COMPLIANCE_THRESHOLD,
): DisciplineRecord | null {
  const real = history.filter((h) => typeof h.score === 'number' && Number.isFinite(h.score));
  if (real.length < RECORD_MIN_DAYS) return null;
  const scores = real.map((h) => h.score);
  const onStd = daysOnStandard(real, threshold);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const since = real.reduce((min, h) => (h.date < min ? h.date : min), real[0].date);
  const weightDelta =
    weightHistory.length >= 2
      ? Math.round((weightHistory[weightHistory.length - 1].weight - weightHistory[0].weight) * 10) / 10
      : null;
  return {
    daysLogged: real.length,
    daysOnStandard: onStd,
    onStandardPct: Math.round((onStd / real.length) * 100),
    longestStreak: longestStreak(real, threshold),
    currentStreak: currentStreak(real, liveScore, threshold),
    avgScore: avg,
    since,
    weightDelta,
    integrityLine: 'Logged daily in OnStandard with photo-verified nutrition. Not self-reported.',
  };
}

/** The shareable text card — what lands in a recruiter's or college coach's messages.
 *  Plain, factual, no hype, no em dash. */
export function disciplineRecordText(r: DisciplineRecord, athleteName: string): string {
  const lines: string[] = [];
  lines.push(`${athleteName} · Discipline Record (OnStandard)`);
  lines.push(`On record since ${r.since} · ${r.daysLogged} logged days`);
  lines.push(`${r.onStandardPct}% of days on standard (avg score ${r.avgScore}/100)`);
  lines.push(`Longest streak ${r.longestStreak} days · current ${r.currentStreak}`);
  if (r.weightDelta != null && r.weightDelta !== 0) {
    lines.push(`Body weight ${r.weightDelta > 0 ? '+' : ''}${r.weightDelta} over the record`);
  }
  lines.push(r.integrityLine);
  lines.push('https://onstandard.app');
  return lines.join('\n');
}
