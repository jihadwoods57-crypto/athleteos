/* OnStandard — Verified Commitments: the native location seam.
 *
 * Everything that talks to the OS lives here; every DECISION lives in geofence.ts, which is pure
 * and tested. This file is deliberately thin.
 *
 * WHY THE BACKGROUND TASK WRITES TO SUPABASE DIRECTLY
 * A region crossing at 5:43 AM wakes the app in the background — the WebView that renders the UI
 * may not exist at that moment. Routing the verdict through the WebView would mean an athlete who
 * hadn't opened the app that morning (i.e. exactly the athlete this feature is for) never gets
 * verified. So the task calls verify_arrival itself and the UI catches up on next load.
 *
 * WHAT LEAVES THE DEVICE: a boolean and an instance id. Never a coordinate. The comparison to the
 * coach's circle happens here, in isWithin(), and the number is thrown away.
 */
import { supabase } from '../supabase';
import {
  selectArmable, toRegions, isWithin, GEOFENCE_TASK, GEOFENCE_CAP,
  type ArmableInstance,
} from './geofence';

export type PermissionState = 'always' | 'when_in_use' | 'denied' | 'undetermined' | 'unavailable';

/* expo-location and expo-task-manager are optional at runtime: an older native binary (an OTA
   update landing on a build made before slice 2) simply has no module, and every entry point
   below must degrade to "unavailable" rather than crash the app on launch. */
type LocationModule = typeof import('expo-location');
type TaskModule = typeof import('expo-task-manager');

let Location: LocationModule | null = null;
let TaskManager: TaskModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  Location = require('expo-location');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  TaskManager = require('expo-task-manager');
} catch {
  Location = null;
  TaskManager = null;
}

export const isLocationAvailable = (): boolean => !!Location && !!TaskManager;

/** Regions currently armed, kept so a background crossing can be matched to its instance without
 *  another network round trip. Rebuilt on every arm; empty after disarm. */
let ARMED: ArmableInstance[] = [];

/* ---------------------------------------------------------------- permissions */

export async function getPermissionState(): Promise<PermissionState> {
  if (!Location) return 'unavailable';
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return fg.canAskAgain ? 'undetermined' : 'denied';
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.granted ? 'always' : 'when_in_use';
  } catch {
    return 'unavailable';
  }
}

/** Ask for foreground first, then background only if requested. Asking for background without a
 *  foreground grant is refused by both platforms, and asking for "Always" before the athlete has
 *  seen why is the surest way to get denied forever. */
export async function requestPermission(wantBackground: boolean): Promise<PermissionState> {
  if (!Location) return 'unavailable';
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return fg.canAskAgain ? 'undetermined' : 'denied';
    if (!wantBackground) return 'when_in_use';
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted ? 'always' : 'when_in_use';
  } catch {
    return 'unavailable';
  }
}

/* ---------------------------------------------------------------- arming */

/** Fetch what is armable right now (server-side window + consent check live in
 *  my_armable_geofences, migration 0139) and hand the OS exactly that set. */
export async function refreshGeofences(nowMs: number = Date.now()): Promise<{
  armed: number; capped: number; state: PermissionState;
}> {
  const state = await getPermissionState();
  if (state !== 'always' || !Location || !supabase) {
    // Without background permission we do NOT register anything — the athlete verifies by tapping.
    await disarmAll();
    return { armed: 0, capped: 0, state };
  }
  let rows: ArmableInstance[] = [];
  try {
    const { data } = await supabase.rpc('my_armable_geofences', { p_limit: GEOFENCE_CAP });
    rows = Array.isArray(data) ? (data as ArmableInstance[]) : [];
  } catch {
    rows = [];
  }
  const armable = selectArmable(rows, nowMs);
  ARMED = armable;
  try {
    if (!armable.length) {
      await disarmAll();
      return { armed: 0, capped: 0, state };
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, toRegions(armable));
  } catch {
    return { armed: 0, capped: Math.max(0, rows.length - armable.length), state };
  }
  // A non-zero `capped` is reported so the UI can TELL the athlete which commitments need a tap,
  // rather than leaving them silently unverified.
  return { armed: armable.length, capped: Math.max(0, rows.length - armable.length), state };
}

export async function disarmAll(): Promise<void> {
  ARMED = [];
  if (!Location) return;
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch { /* nothing armed, or the module went away — either way we're disarmed */ }
}

/* ---------------------------------------------------------------- foreground tap */

/** The "I'm here" path. Takes ONE fix, compares it here, and returns a boolean plus a reason.
 *  The coordinate never leaves this function. */
export async function checkArrival(instanceId: string): Promise<{ within: boolean; reason: string | null }> {
  if (!Location) return { within: false, reason: 'Location is unavailable on this device' };
  const state = await getPermissionState();
  if (state === 'denied' || state === 'undetermined') {
    return { within: false, reason: 'Location permission is off' };
  }
  const target = ARMED.find((a) => a.instance_id === instanceId)
    || (await fetchArmable()).find((a) => a.instance_id === instanceId);
  if (!target) return { within: false, reason: 'This commitment isn’t open for check-in' };
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const within = isWithin(
      pos.coords.latitude, pos.coords.longitude,
      { latitude: target.lat, longitude: target.lng, radius: target.radius_m },
      pos.coords.accuracy ?? 0,
    );
    return { within, reason: within ? null : `Not at ${target.name}` };
  } catch {
    return { within: false, reason: 'Couldn’t get a location fix' };
  }
}

async function fetchArmable(): Promise<ArmableInstance[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase.rpc('my_armable_geofences', { p_limit: GEOFENCE_CAP });
    const rows = Array.isArray(data) ? (data as ArmableInstance[]) : [];
    ARMED = rows;
    return rows;
  } catch {
    return [];
  }
}

/** Record a verdict. `within: false` writes 'unverified' with a reason — the RPC cannot write
 *  'missed', by construction. */
export async function reportArrival(
  instanceId: string, source: 'geofence' | 'manual', within: boolean, reason: string | null,
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('verify_arrival', {
      p_instance: instanceId, p_source: source, p_within: within, p_reason: reason,
    });
    return !error;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- coach: capture a place */

/** The one function in this file that RETURNS a coordinate, and the distinction matters:
 *  a coach standing in their own weight room, deliberately recording it as a scheduled place.
 *  That is someone naming a building, not the app observing where a person goes. It needs only
 *  foreground permission, and the value is written to commitment_locations by the coach's own
 *  save — it is never derived from anyone's movement. */
export async function capturePlace(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (!Location) return null;
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy ?? 0),
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- the background task */

/** Registered once at app start. Safe to call repeatedly and safe on a build without the modules. */
export function registerGeofenceTask(): void {
  if (!TaskManager || !Location) return;
  try {
    if (TaskManager.isTaskDefined(GEOFENCE_TASK)) return;
    TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
      if (error || !data) return;
      const { eventType, region } = data;
      const instanceId = region?.identifier;
      if (!instanceId) return;
      // Enter === 1 per GeofencingEventType. An Exit is recorded as a departure only; we never
      // downgrade an arrival that already happened.
      if (eventType === Location!.GeofencingEventType.Enter) {
        await reportArrival(instanceId, 'geofence', true, null);
      }
    });
  } catch { /* a defineTask collision on fast refresh is harmless */ }
}
