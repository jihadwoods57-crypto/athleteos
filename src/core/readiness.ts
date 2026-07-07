// OnStandard — training-readiness engine (pure TS, no RN imports).
//
// The OnStandard Score grades NUTRITION adherence. A strength/performance coach asks a different
// question: "is this athlete recovered enough to train hard today?" Readiness answers it from the
// self-report check-in signals (energy, recovery, sleep, soreness), with an overtraining early-
// warning when recovery trends down. This is the surface that turns a nutrition roll-up into
// something a strength coach can use (Role Review Board: Strength Coach scored 3 with "zero
// readiness surface"). Honest by construction: returns null when there is no signal to read, and
// every coach-facing readiness number requires real per-athlete check-in data (no fabrication).
//
// Self-report signals are on the check-in 0..10 slider scale (see scoring.ts CI handling); soreness
// has inverse polarity (high soreness = worse). Output is 0..100 + a band, comparable across a room.

export type ReadinessBand = 'ready' | 'caution' | 'compromised';

export interface ReadinessSignals {
  /** 0..10 self-report energy. */
  energy?: number;
  /** 0..10 self-report recovery. */
  recovery?: number;
  /** 0..10 self-report sleep quality. */
  sleep?: number;
  /** 0..10 self-report soreness (HIGH = more sore = worse; inverted internally). */
  soreness?: number;
}

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Composite training-readiness (0..100) from the present self-report signals, or null if none are
 * usable (so the caller shows an honest "no check-in yet" state instead of a fabricated number).
 * Recovery and sleep lead; energy supports; soreness rounds it out with inverse polarity.
 */
export function readinessScore(sig: ReadinessSignals): number | null {
  const parts: { v: number; w: number }[] = [];
  if (finite(sig.recovery)) parts.push({ v: sig.recovery * 10, w: 0.35 });
  if (finite(sig.sleep)) parts.push({ v: sig.sleep * 10, w: 0.3 });
  if (finite(sig.energy)) parts.push({ v: sig.energy * 10, w: 0.2 });
  if (finite(sig.soreness)) parts.push({ v: (10 - sig.soreness) * 10, w: 0.15 });
  if (parts.length === 0) return null;
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  return clamp100(parts.reduce((a, p) => a + p.v * p.w, 0) / wSum);
}

/** Band a readiness score for the green/amber/red read a coach glances at. */
export function readinessBand(score: number): ReadinessBand {
  if (score >= 75) return 'ready';
  if (score >= 55) return 'caution';
  return 'compromised';
}

/**
 * Overtraining early-warning: recovery has trended DOWN across recent check-ins AND the latest
 * reading sits in the compromised range. Needs >=3 points so a single bad night is not a flag;
 * compares the start vs end of the recent window to ignore mid-window noise. History is 0..100.
 */
export function overtrainingFlag(recoveryHistory: number[]): boolean {
  const series = recoveryHistory.filter((n) => Number.isFinite(n));
  if (series.length < 3) return false;
  const recent = series.slice(-4);
  const first = recent[0];
  const last = recent[recent.length - 1];
  return last < first - 10 && last < 55;
}

/** Plain-English read of a readiness band, for the athlete's check-in + a coach's row. */
export function readinessLabel(band: ReadinessBand): { title: string; how: string } {
  switch (band) {
    case 'ready':
      return { title: 'Ready to train', how: 'Recovery, sleep and energy are where they should be. Green light for a hard session.' };
    case 'caution':
      return { title: 'Train with caution', how: 'You are a little under-recovered. Train, but hold back the top-end intensity and prioritize sleep tonight.' };
    case 'compromised':
    default:
      return { title: 'Recovery compromised', how: 'Recovery, sleep or soreness are flashing. Back off load today or swap in active recovery, and protect your sleep.' };
  }
}

export interface ReadinessRow {
  name: string;
  readiness: number;
  band: ReadinessBand;
}

/**
 * Roster-level readiness summary for a coach's briefing: how many are ready / caution / compromised
 * and the single least-ready athlete. Pure; the caller only passes rows it has REAL check-in data
 * for, so a coach never sees a fabricated readiness board.
 */
export function readinessSummary(rows: ReadinessRow[]): {
  ready: number;
  caution: number;
  compromised: number;
  lowest: ReadinessRow | null;
} {
  let ready = 0;
  let caution = 0;
  let compromised = 0;
  let lowest: ReadinessRow | null = null;
  for (const r of rows) {
    if (r.band === 'ready') ready += 1;
    else if (r.band === 'caution') caution += 1;
    else compromised += 1;
    if (lowest === null || r.readiness < lowest.readiness) lowest = r;
  }
  return { ready, caution, compromised, lowest };
}
