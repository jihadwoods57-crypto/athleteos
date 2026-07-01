// OnStandard — recovery-source seam (P5, inert behind isHealthAvailable).
//
// Models ingesting a real recovery reading (sleep / HRV / resting HR) from Apple
// Health (HealthKit) or Android Health Connect, to fold into the recovery sub-score
// via the pure core/recovery.ts mapping (blendRecovery). Native HealthKit /
// Health-Connect wiring + on-device permission + testing is the founder step;
// until then isHealthAvailable is false and readRecoverySample returns null, so the
// score falls back to the self-report check-in and is UNCHANGED.
//
// Activate (founder):
//   1) add the health module (expo-health / react-native-health / Health Connect)
//   2) request read permission for sleep + HRV + resting HR
//   3) implement readRecoverySample to return the latest values
//   4) set isHealthAvailable = true and pass the sample into blendRecovery at the
//      recovery fold point in scoring.
import type { RecoverySample } from '@/core';

export const isHealthAvailable = false;

export type { RecoverySample };

/**
 * Read today's recovery sample from the health store. Returns null until the seam
 * is wired (isHealthAvailable), so the recovery sub-score falls back to the
 * self-report and nothing changes. Never throws.
 */
export async function readRecoverySample(): Promise<RecoverySample | null> {
  if (!isHealthAvailable) return null;
  // Real impl (once wired): query the health store for last-night sleep, the
  // morning HRV reading, and resting HR; return whatever is present.
  return null;
}
