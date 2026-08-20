// OnStandard — recovery + activity source, backed by Apple HealthKit.
//
// Ingests a real reading (sleep / HRV / resting HR) and activity totals (steps, distance,
// exercise minutes, workouts) from HealthKit. This data is DISPLAYED as honest context on the
// recovery check-in and the #devices screen — it does NOT silently change the recovery sub-score
// (self-report stays the source of truth; blending device data into scoring is a founder-gated
// decision, blendRecovery in core/recovery.ts is the ready path).
//
// WIRED 2026-08-20 against @kingstinct/react-native-healthkit. docs/go-live/WEARABLES.md named
// react-native-health; that package is a legacy-architecture module with no Expo config plugin,
// and RN 0.86 is New-Architecture-only, so it could not have worked here. Kingstinct is a Nitro
// module with an official config plugin that writes both the entitlement and the usage strings.
//
// ⚠ THE MODULE IS REQUIRED OPTIONALLY, AND THAT IS NOT DEFENSIVE PROGRAMMING — IT IS LOan-BEARING.
// runtimeVersion policy is "appVersion" (app.json), so adding native code does NOT bump the
// runtime version, which means this JS can and will be delivered over the air to build #26 and
// earlier — binaries that have no HealthKit module compiled in at all. A static import would
// throw at launch and brick the app for every existing user. src/lib/location/index.ts carries
// the identical guard for the identical reason; read its header before changing this one.
import { Platform } from 'react-native';
import type { RecoverySample } from '@/core';
import type { ActivitySample, Workout } from '@/core/activity';

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');

let HK: HealthKitModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  HK = require('@kingstinct/react-native-healthkit');
} catch {
  HK = null;
}

export type { RecoverySample, ActivitySample };

export type HealthConnectResult = { connected: boolean; reason?: 'unavailable' | 'denied' | 'error' };

/**
 * Which read scopes to request. Connected Standards (0155) needs ACTIVITY — steps, walking and
 * running distance, workouts, exercise minutes — which is a different and broader ask than the
 * recovery scopes this seam was built for, and it gets its own consent record
 * (health_share_consent) rather than riding the recovery one.
 */
export type HealthScope = 'recovery' | 'activity';

/* HealthKit read types, per scope. Everything here is READ ONLY: nothing is ever written back,
   which is why the config plugin is configured with NSHealthUpdateUsageDescription:false. */
const RECOVERY_TYPES = [
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRestingHeartRate',
] as const;

const ACTIVITY_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierAppleExerciseTime',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKWorkoutTypeIdentifier',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const typesFor = (scopes: readonly HealthScope[]): any[] => {
  const out: string[] = [];
  if (scopes.includes('recovery')) out.push(...RECOVERY_TYPES);
  if (scopes.includes('activity')) out.push(...ACTIVITY_TYPES);
  return out.length ? out : [...RECOVERY_TYPES];
};

/**
 * True only where a HealthKit store actually exists: the module is compiled in, the platform is
 * iOS, and the device itself supports HealthKit (iPad does not). Evaluated once at load because
 * none of those three can change without a relaunch.
 */
export const isHealthAvailable: boolean = (() => {
  if (Platform.OS !== 'ios' || !HK) return false;
  try {
    return !!HK.isHealthDataAvailable();
  } catch {
    return false;
  }
})();

/**
 * Whether read permission has already been granted this install. Never throws.
 *
 * ⚠ iOS deliberately refuses to tell an app whether READ access was granted — that would leak
 * the fact that a person has no data for a type. `authorizationStatusFor` answers for SHARE
 * (write) only and returns notDetermined for a read scope we hold, so using it here would report
 * "not connected" forever. `getRequestStatusForAuthorization` is the sanctioned question: it
 * answers whether the system would still show a prompt. `unnecessary` means the athlete has
 * already been through the sheet, which is the most this platform will ever tell us.
 */
export async function healthConnected(): Promise<boolean> {
  if (!isHealthAvailable || !HK) return false;
  try {
    const status = await HK.getRequestStatusForAuthorization({ toRead: typesFor(['recovery']) });
    return status === 2; // AuthorizationRequestStatus.unnecessary
  } catch {
    return false;
  }
}

/**
 * Request read permission for the given scopes. Returns { connected:false, reason:'unavailable' }
 * where there is no HealthKit store, so the UI shows an honest state and never a fake "connected".
 * Never throws.
 */
export async function connectHealth(scopes: HealthScope[] = ['recovery']): Promise<HealthConnectResult> {
  if (!isHealthAvailable || !HK) return { connected: false, reason: 'unavailable' };
  try {
    await HK.requestAuthorization({ toRead: typesFor(scopes) });
    // requestAuthorization resolves true once the sheet is dismissed, NOT once access is granted
    // (see healthConnected above: the grant is unknowable). Re-ask the request status so the
    // answer means "the athlete has been through the sheet", not "the sheet opened".
    const status = await HK.getRequestStatusForAuthorization({ toRead: typesFor(scopes) });
    if (status === 2) return { connected: true };
    return { connected: false, reason: 'denied' };
  } catch {
    return { connected: false, reason: 'error' };
  }
}

/* HKCategoryValueSleepAnalysis: 0 inBed, 1 asleepUnspecified, 2 awake, 3 asleepCore,
   4 asleepDeep, 5 asleepREM. "In bed" is NOT sleep and "awake" is the opposite of it; counting
   either would hand an athlete hours they did not sleep, which is the one thing this product
   must never do. */
const ASLEEP_VALUES = new Set([1, 3, 4, 5]);

const hoursBetween = (a: string | Date, b: string | Date): number => {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3_600_000;
};

/**
 * Read the latest recovery sample (last-night sleep, morning HRV, resting HR). Returns null when
 * nothing could be read, so the recovery sub-score falls back to the self-report and nothing
 * changes. Never throws.
 *
 * A PARTIAL read is a real answer, not a failure: a phone with no watch has resting HR and no
 * HRV. Only a total absence of all three returns null.
 */
export async function readRecoverySample(): Promise<RecoverySample | null> {
  if (!isHealthAvailable || !HK) return null;
  const since = new Date(Date.now() - 24 * 3_600_000);
  const out: RecoverySample = {};

  try {
    const sleep = await HK.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
      limit: 0,
      filter: { date: { startDate: since, endDate: new Date() } },
    });
    // Sum only the asleep intervals. Apple emits overlapping samples when a watch and a phone
    // both report, but they are the same interval rather than two, so summing raw would double
    // a night. Merge overlaps first.
    const spans = (sleep || [])
      .filter((s) => ASLEEP_VALUES.has(Number(s.value)))
      .map((s) => ({ start: new Date(s.startDate).getTime(), end: new Date(s.endDate).getTime() }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
      .sort((a, b) => a.start - b.start);
    let total = 0;
    let cursor = -Infinity;
    for (const s of spans) {
      const from = Math.max(s.start, cursor);
      if (s.end > from) total += s.end - from;
      cursor = Math.max(cursor, s.end);
    }
    if (total > 0) out.sleepHours = Math.round((total / 3_600_000) * 100) / 100;
  } catch { /* a missing sleep grant is not a failure of the whole read */ }

  try {
    const hrv = await HK.queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', {
      limit: 1,
      unit: 'ms',
      ascending: false,
      filter: { date: { startDate: since, endDate: new Date() } },
    });
    const v = hrv && hrv[0] ? Number(hrv[0].quantity) : NaN;
    if (Number.isFinite(v) && v > 0) out.hrvMs = Math.round(v);
  } catch { /* no HRV source on this device */ }

  try {
    const rhr = await HK.queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', {
      limit: 1,
      unit: 'count/min',
      ascending: false,
      filter: { date: { startDate: since, endDate: new Date() } },
    });
    const v = rhr && rhr[0] ? Number(rhr[0].quantity) : NaN;
    if (Number.isFinite(v) && v > 0) out.restingHr = Math.round(v);
  } catch { /* no resting HR source on this device */ }

  return (out.sleepHours == null && out.hrvMs == null && out.restingHr == null) ? null : out;
}

/**
 * Read activity totals for a window — the read Connected Standards runs against.
 *
 * ⚠ RETURNS NULL, NOT AN EMPTY SAMPLE, when it cannot read. An empty sample says "you did
 * nothing"; null says "we don't know". src/core/activity.ts keeps that distinction all the way
 * to the server, where it becomes 'awaiting_sync' rather than a miss. Collapsing the two here
 * would defeat the whole feature at its first step. Never throws.
 */
export async function readActivity(fromISO: string, toISO: string): Promise<ActivitySample | null> {
  if (!isHealthAvailable || !HK) return null;
  const startDate = new Date(fromISO);
  const endDate = new Date(toISO);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return null;
  const filter = { date: { startDate, endDate } };

  // queryStatisticsForQuantity returns HealthKit's OWN de-duplicated total. An iPhone and an
  // Apple Watch both record the same steps; summing raw samples would inflate every athlete who
  // owns both, so the aggregate is the only correct read here.
  const sum = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    identifier: any, unit: any,
  ): Promise<number | undefined> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const stats = await HK!.queryStatisticsForQuantity(identifier, ['cumulativeSum'], { filter, unit });
      const v = Number(stats?.sumQuantity?.quantity);
      return Number.isFinite(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };

  let read = false;
  const out: ActivitySample = {};

  const steps = await sum('HKQuantityTypeIdentifierStepCount', 'count');
  if (steps != null) { out.steps = Math.round(steps); read = true; }
  const distance = await sum('HKQuantityTypeIdentifierDistanceWalkingRunning', 'm');
  if (distance != null) { out.distanceMeters = Math.round(distance); read = true; }
  const active = await sum('HKQuantityTypeIdentifierAppleExerciseTime', 'min');
  if (active != null) { out.activeMinutes = Math.round(active); read = true; }
  const energy = await sum('HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal');
  if (energy != null) { out.activeEnergyKcal = Math.round(energy); read = true; }

  try {
    const raw = await HK.queryWorkoutSamples({ limit: 0, filter });
    const workouts: Workout[] = [];
    for (const w of raw || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const any = w as any;
      const startedAt = any?.startDate ? new Date(any.startDate).toISOString() : null;
      const endedAt = any?.endDate ? new Date(any.endDate).toISOString() : null;
      if (!startedAt || !endedAt) continue;
      const durationMin = Math.round(hoursBetween(startedAt, endedAt) * 60);
      if (!durationMin) continue;
      const meters = Number(any?.totalDistance?.quantity);
      workouts.push({
        startedAt,
        endedAt,
        durationMin,
        ...(Number.isFinite(meters) && meters > 0 ? { distanceMeters: Math.round(meters) } : {}),
        ...(any?.workoutActivityType != null ? { activityType: String(any.workoutActivityType) } : {}),
      });
    }
    out.workouts = workouts;
    read = true;
  } catch { /* a missing workout grant leaves workouts undefined, never [] */ }

  // Nothing at all came back: say "we don't know" rather than "you did nothing".
  return read ? out : null;
}

/**
 * Ask the platform to wake the app when activity changes (HKObserverQuery + background delivery).
 *
 * DELIBERATELY INERT. The config plugin is configured with background:false, so
 * com.apple.developer.healthkit.background-delivery is NOT in the entitlements and
 * enableBackgroundDelivery would fail at runtime. Background health reads are a materially bigger
 * privacy ask than the on-demand read this feature needs, and Apple reviews them as such, so
 * turning it on is a founder decision rather than a side effect of wiring the module. To enable:
 * set background:true on the plugin in app.json, add the capability to the App ID, REGENERATE the
 * provisioning profile (a capability change invalidates every existing one), and implement here.
 *
 * The wake handler must NOT route through the WebView bridge: a step goal crossed at 6:40 PM can
 * wake a process whose WebView does not exist. See the header of src/lib/location/index.ts for
 * the same reasoning about geofences, and activitySync.ts for the path that respects it.
 */
export async function observeActivity(): Promise<boolean> {
  return false;
}
