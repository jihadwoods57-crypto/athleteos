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
import type { ActivitySample } from '@/core/activity';

/** Flipped true only once the native health module + permissions are wired (step 3 above). */
export const isHealthAvailable = false;

export type { RecoverySample, ActivitySample };

export type HealthConnectResult = { connected: boolean; reason?: 'unavailable' | 'denied' | 'error' };

/**
 * Which read scopes to request. Connected Standards (0155) needs ACTIVITY — steps, walking and
 * running distance, workouts, exercise minutes — which is a different and broader ask than the
 * recovery scopes this seam was built for, and it gets its own consent record
 * (health_share_consent) rather than riding the recovery one.
 */
export type HealthScope = 'recovery' | 'activity';

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
export async function connectHealth(_scopes: HealthScope[] = ['recovery']): Promise<HealthConnectResult> {
  if (!isHealthAvailable) return { connected: false, reason: 'unavailable' };
  // Real impl (once wired): request the read scopes named in _scopes; return connected per the
  // grant result. 'activity' maps to stepCount + distanceWalkingRunning + workouts +
  // appleExerciseTime on iOS, and Steps/Distance/ExerciseSession records on Health Connect.
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

/**
 * Read activity totals for a window — the read Connected Standards runs against.
 *
 * ⚠ RETURNS NULL, NOT AN EMPTY SAMPLE, when it cannot read. An empty sample says "you did
 * nothing"; null says "we don't know". src/core/activity.ts keeps that distinction all the way
 * to the server, where it becomes 'awaiting_sync' rather than a miss. Collapsing the two here
 * would defeat the whole feature at its first step. Never throws.
 */
export async function readActivity(_fromISO: string, _toISO: string): Promise<ActivitySample | null> {
  if (!isHealthAvailable) return null;
  // Real impl (once wired): sum stepCount / distanceWalkingRunning / appleExerciseTime across the
  // window and list workouts with their duration + distance. Prefer the platform's AGGREGATED
  // totals — an iPhone and an Apple Watch both record the same steps, and adding two sources
  // together would inflate every athlete who owns both.
  return null;
}

/**
 * Ask the platform to wake the app when activity changes (HKObserverQuery + background delivery;
 * Health Connect has no true push and polls instead). Inert until wired.
 *
 * The wake handler must NOT route through the WebView bridge: a step goal crossed at 6:40 PM can
 * wake a process whose WebView does not exist. See the header of src/lib/location/index.ts for
 * the same reasoning about geofences, and activitySync.ts for the path that respects it.
 */
export async function observeActivity(): Promise<boolean> {
  if (!isHealthAvailable) return false;
  return false;
}
