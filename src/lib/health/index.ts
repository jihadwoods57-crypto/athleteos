// OnStandard — recovery-source seam (inert behind isHealthAvailable).
//
// Ingests a real recovery reading (sleep / HRV / resting HR) from Apple Health (HealthKit)
// or Android Health Connect. In v1 this data is DISPLAYED as honest context on the recovery
// check-in and the #devices screen — it does NOT silently change the 25% recovery sub-score
// (self-report stays the source of truth; blending device data into scoring is a founder-gated
// decision, blendRecovery in core/recovery.ts is the ready path). Until the native module is
// wired, isHealthAvailable is false, connect returns 'unavailable', and readRecoverySample
// returns null — so nothing shows fabricated hardware data and the score is unchanged.
//
// Activate (founder — see docs/go-live/WEARABLES.md):
//   1) add the health module + config plugin (iOS react-native-health / Android Health Connect)
//      and the sleep/HRV/resting-HR read permissions
//   2) implement healthConnected / connectHealth / readRecoverySample below against the module
//   3) set isHealthAvailable = true
//   4) (optional, founder-gated) fold the sample into scoring via blendRecovery at the recovery
//      fold point — do NOT enable silently; it changes 25% of the daily score.
import type { RecoverySample } from '@/core';

/** Flipped true only once the native health module + permissions are wired (step 3 above). */
export const isHealthAvailable = false;

export type { RecoverySample };

export type HealthConnectResult = { connected: boolean; reason?: 'unavailable' | 'denied' | 'error' };

/** Whether read permission has already been granted this install. False until wired. Never throws. */
export async function healthConnected(): Promise<boolean> {
  if (!isHealthAvailable) return false;
  // Real impl (once wired): check granted read permissions for sleep + HRV + resting HR.
  return false;
}

/**
 * Request read permission for sleep / HRV / resting HR. Returns { connected:false,
 * reason:'unavailable' } until the module is wired, so the UI shows an honest state and never a
 * fake "connected". Never throws.
 */
export async function connectHealth(): Promise<HealthConnectResult> {
  if (!isHealthAvailable) return { connected: false, reason: 'unavailable' };
  // Real impl (once wired): request the read scopes; return connected per the grant result.
  return { connected: false, reason: 'unavailable' };
}

/**
 * Read the latest recovery sample (last-night sleep, morning HRV, resting HR). Returns null until
 * wired, so the recovery sub-score falls back to the self-report and nothing changes. Never throws.
 */
export async function readRecoverySample(): Promise<RecoverySample | null> {
  if (!isHealthAvailable) return null;
  // Real impl (once wired): query last-night sleep hours, the morning HRV reading, and resting
  // HR; return whatever is present ({ sleepHours?, hrvMs?, restingHr? }).
  return null;
}
