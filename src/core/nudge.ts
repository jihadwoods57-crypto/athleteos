// AthleteOS — the overseer nudge acknowledgement read (pure TS, no RN imports).
//
// The lightweight day-scoped "Nudged" flag (AppState.nudged) answers "did I nudge
// this athlete today". This module adds the honest other half the product spec
// asks for: once a coach/trainer/nutritionist nudges someone, the dashboard can
// read whether anything has MOVED since. Offline + deterministic, so it never
// fabricates an athlete response: it records the athlete's compliance at the
// moment of the nudge (the baseline) and derives the read by comparing that
// baseline against their live compliance. For the static demo roster that
// honestly reads "no change yet, follow up" rather than inventing improvement;
// the same selector lights up green the instant real compliance data moves.
// Day-scoped alongside `nudged` (cleared on rollover), so the read is always
// "since you nudged today".
// See docs/specs/2026-06-23-next-phase-product-spec.md section 3 (loop #3).

/** A single nudge, with the athlete's state captured at send-time so movement
 *  can be read honestly later in the day. Day-scoped (cleared on rollover). */
export interface NudgeRecord {
  /** Athlete/client name — matches the roster row and the `nudged` flag. */
  name: string;
  /** Day stamp the nudge was sent (AppState.dateStamp at send-time). */
  day: string;
  /** Athlete compliance % captured at send-time, the baseline to read against. */
  comp: number;
  /** Athlete score captured at send-time (kept for parity / future reads). */
  score: number;
}

/** The derived, honest acknowledgement read for a nudged athlete. */
export interface NudgeOutcome {
  /** True once live compliance has risen above the nudge-time baseline. */
  improved: boolean;
  /** Whole-point compliance delta since the nudge (negative, zero, or positive). */
  compDelta: number;
  /** Glanceable read for the dashboard; honest "no change yet" when flat. */
  label: string;
}

/** Find the nudge record for an athlete, if they were nudged today. */
export function findNudge(log: NudgeRecord[], name: string): NudgeRecord | undefined {
  return log.find((n) => n.name === name);
}

/**
 * Derive the honest "did anything move since the nudge" read. Compares the
 * athlete's live compliance against the baseline captured when the nudge was
 * sent. Improvement only ever comes from real movement in the data: a static
 * demo roster reads "No change yet, follow up", which is the truth offline.
 */
export function nudgeOutcome(record: NudgeRecord, currentComp: number): NudgeOutcome {
  const compDelta = Math.round(currentComp - record.comp);
  if (compDelta > 0) {
    return { improved: true, compDelta, label: `Up ${compDelta}% compliance since your nudge` };
  }
  if (compDelta < 0) {
    return { improved: false, compDelta, label: `Down ${Math.abs(compDelta)}% since your nudge, follow up` };
  }
  return { improved: false, compDelta: 0, label: 'No change yet since your nudge, follow up' };
}
