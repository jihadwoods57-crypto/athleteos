// OnStandard — wearable recovery mapping (P5, pure TS, no RN imports).
//
// Score credibility: when a real recovery signal exists (sleep / HRV / resting HR
// from Apple Health or Health Connect), fold it into the recovery sub-score instead
// of relying only on the self-report check-in slider. This is the PURE mapping;
// the device ingestion is a seam (src/lib/health), inert behind isHealthAvailable
// (default false). CRITICAL: with no real sample, blendRecovery returns the
// self-report UNCHANGED, so the daily score is identical when the seam is off.
// Copy/values follow the shipped guardrails; no medical claims.

/** A real recovery reading from a wearable / health store. All fields optional —
 *  a device may expose only some. Values outside sane ranges are ignored. */
export interface RecoverySample {
  /** Last night's sleep, hours. */
  sleepHours?: number;
  /** Heart-rate variability, ms (higher = better recovered, person-relative). */
  hrvMs?: number;
  /** Resting heart rate, bpm (lower = better recovered). */
  restingHr?: number;
}

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
/** Linear map of `v` in [lo,hi] to [0,100], clamped (lo<hi). */
function band(v: number, lo: number, hi: number): number {
  return clamp100(((v - lo) / (hi - lo)) * 100);
}

/** Sleep hours -> 0..100. Below 4h reads 0, 8h+ reads ~100; the athlete-health sweet spot. */
export function sleepScore(hours: number): number {
  return band(hours, 4, 8);
}
/** HRV ms -> 0..100 against a coarse adult band (20ms low, 90ms strong). Person-relative in reality; this is a generic fallback map. */
export function hrvScore(ms: number): number {
  return band(ms, 20, 90);
}
/** Resting HR bpm -> 0..100, inverted (40bpm athletic = 100, 80bpm = 0). */
export function restingHrScore(bpm: number): number {
  return band(80 - bpm, 0, 40);
}

/**
 * Map a real recovery sample to a 0..100 recovery score, averaging only the signals
 * actually present (sleep weighted highest as the most reliable). Returns null if
 * the sample carries no usable signal, so the caller falls back to the self-report.
 */
export function recoveryFromSample(sample: RecoverySample): number | null {
  const parts: { score: number; weight: number }[] = [];
  if (finite(sample.sleepHours) && sample.sleepHours >= 0 && sample.sleepHours <= 24) {
    parts.push({ score: sleepScore(sample.sleepHours), weight: 0.5 });
  }
  if (finite(sample.hrvMs) && sample.hrvMs > 0 && sample.hrvMs < 300) {
    parts.push({ score: hrvScore(sample.hrvMs), weight: 0.3 });
  }
  if (finite(sample.restingHr) && sample.restingHr > 20 && sample.restingHr < 150) {
    parts.push({ score: restingHrScore(sample.restingHr), weight: 0.2 });
  }
  if (parts.length === 0) return null;
  const wSum = parts.reduce((a, p) => a + p.weight, 0);
  return clamp100(parts.reduce((a, p) => a + p.score * p.weight, 0) / wSum);
}

/** How much a real recovery reading is trusted vs the self-report when blending. */
export const RECOVERY_SAMPLE_WEIGHT = 0.6;

/**
 * The recovery sub-score to use: when a usable real sample exists, blend it with
 * the athlete's self-report (sample weighted higher as the objective signal); when
 * it does not, return the self-report UNCHANGED. This is the single fold point the
 * scoring engine would call once the health seam is wired; with the seam off the
 * caller passes null and the score is byte-for-byte identical to today.
 */
export function blendRecovery(selfReport: number, sample: RecoverySample | null): number {
  if (sample == null) return selfReport;
  const objective = recoveryFromSample(sample);
  if (objective == null) return selfReport;
  return clamp100(objective * RECOVERY_SAMPLE_WEIGHT + selfReport * (1 - RECOVERY_SAMPLE_WEIGHT));
}
