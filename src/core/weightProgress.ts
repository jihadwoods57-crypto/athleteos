// OnStandard — weight-progress tone (pure TS, no RN imports).
//
// A weight change is only "good" or "bad" relative to the user's GOAL. The old UI hardcoded
// "gain = green, loss = red", which paints a weight-loss client's progress as an alert (a real
// shame landmine the Role Review Board flagged). Core returns a semantic tone; the UI maps it to
// a color, so the meaning lives in one tested place.
import type { BaseGoal } from './types';

export type ProgressTone = 'good' | 'bad' | 'neutral';

/** Tone for a body-weight delta (lb, signed) given the account's goal. Maintenance and performance
 *  never moralize weight movement (it drifts with training/water); only lose/gain have a direction. */
export function weightProgressTone(deltaLb: number, goal: BaseGoal): ProgressTone {
  if (Math.abs(deltaLb) < 0.05) return 'neutral';
  if (goal === 'gain') return deltaLb > 0 ? 'good' : 'bad';
  if (goal === 'lose') return deltaLb < 0 ? 'good' : 'bad';
  return 'neutral'; // maintain / performance — don't color weight movement as success or alarm
}
