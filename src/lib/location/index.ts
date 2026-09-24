/* OnStandard — Verified Commitments: the native location seam.
 *
 * Everything that talks to the OS lives here; every DECISION lives in geofence.ts, which is pure
 * and tested. This file is deliberately thin.
 *
 * WHY THE BACKGROUND TASK WRITES TO SUPABASE DIRECTLY
 * A region crossing at 5:43 AM wakes the app in the background — the WebView that renders the UI
 * may not exist at that moment. Routing the verdict through the WebView would mean an athlete who
 * hadn't opened the app that morning (i.e. exactly the athlete this feature is for) never gets
 * verified. So the task calls verify_arrival_at itself and the UI catches up on next load.
 *
 * NO BACKGROUND-LOCATION MODE (controller ruling 2026-09-23). The binary asks for "Always" because
 * region monitoring needs it, but does NOT declare UIBackgroundModes "location" (App Review 2.5.4
 * on 2026-09-18 was exactly that key). The OS watches the region and wakes the app; if iOS then
 * refuses a reading, the region match is reported without one (see geofence.ts).
 * expo-location 57.0.19 (and 57.0.20) refused startGeofencingAsync without that mode, and its geofencing
 * consumer set allowsBackgroundLocationUpdates (which CoreLocation throws on without the mode), so
 * it is PATCHED: patches/expo-location+57.0.20.patch, applied by the postinstall. Region
 * monitoring itself never needed the mode. If the device test disproves that, WALK_IN in
 * geofence.ts turns walk-in off per platform by OTA (docs/go-live/ROLLCALL-DEVICE-TEST.md).
 *
 * WHAT LEAVES THE DEVICE (0242, founder 2026-09-23): ONE position reading per arrival, sent once to
 * verify_arrival_at with the instance id and the phone's own stated accuracy. The server measures
 * the distance to the coach's place, stores the verdict (and "Not at <place>" when it is a miss; the
 * distance comes back to the athlete in the reply and is never stored) and does not keep the
 * coordinate. There is no position stream and no history: a region crossing
 * or an "I'm here" tap each take exactly one reading. Until 0242 the comparison happened here and
 * only a boolean left, which meant the server had to believe whatever the phone said; that is
 * what changed.
 *
 * The coach's "use where I'm standing" (capturePlace, LOCATION_PLACE) is deliberately NOT
 * restored: coaches pick places on a map.
 */
import { Platform } from 'react-native';
import { supabase } from '../supabase';
import {
  armingPlan, arrivalArgs, handleRegionEvent, GEOFENCE_TASK, GEOFENCE_CAP,
  pruneRegions, nextClose, walkInEnabled,
  type PositionFix, type RpcFn, type Region,
} from './geofence';

export type PermissionState = 'always' | 'when_in_use' | 'denied' | 'undetermined' | 'unavailable';

/* expo-location and expo-task-manager are optional at runtime: an older native binary (an OTA
   update landing on a build made without expo-location) simply has no module, and every entry
   point below must degrade to "unavailable" rather than crash the app on launch. */
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

/* The NATIVE module, not the JS package: the JS ships in every OTA, so a require can succeed on a
   binary whose native side has no ExpoLocation at all (final review I-2). */
function nativeLocationPresent(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const core = require('expo-modules-core') as { requireOptionalNativeModule: (n: string) => unknown };
    return !!core.requireOptionalNativeModule('ExpoLocation');
  } catch {
    return false;
  }
}

export const isLocationAvailable = (): boolean => !!Location && !!TaskManager && nativeLocationPresent();

/** Whether THIS phone may use walk-in (region) check-in at all: the WALK_IN switch in geofence.ts.
 *  When false, "Always" is never asked for and nothing is armed; "I'm here" still works. */
export const walkInAllowed = (): boolean => walkInEnabled(Platform.OS);

/** Whether THIS BINARY reports region exits, and therefore whether a minimum-stay can actually be
 *  enforced for an athlete running it (migration 0208).
 *
 *  This exists because the proto ships over the air and lands on binaries older than itself. On a
 *  build that drops every Exit, `departed_at` is never written and the server's 'confirmed'
 *  verdict degrades to "arrived, and enough clock time passed". The UI must not promise
 *  enforcement it cannot deliver on the binary it happens to be running on, so it asks. */
export const REPORTS_PRESENCE = true;

/** How long one reading may take before we give up on it. A background region wake gets roughly
 *  ten seconds from iOS, and without a background-location mode iOS may refuse the fix outright.
 *  Five seconds leaves room to still send the region-match report before the OS suspends us. */
const FIX_TIMEOUT_MS = 5000;

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
    // Walk-in switched off for this platform (the device-test fallback): never ask for Always.
    if (!wantBackground || !walkInAllowed()) return 'when_in_use';
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted ? 'always' : 'when_in_use';
  } catch {
    return 'unavailable';
  }
}

/* ---------------------------------------------------------------- arming */

/** What walk-in check-in is doing on this phone after an arm:
 *    'on'           regions armed, or the armed ones kept through a failed server read
 *    'idle'         nothing inside its window right now (or no Always permission): nothing armed
 *    'off'          switched off for this platform (WALK_IN, the device-test fallback)
 *    'unavailable'  the OS refused to arm (the error is logged): the athlete taps "I'm here" */
export type WalkInStatus = 'on' | 'idle' | 'off' | 'unavailable';

/** Fetch what is armable right now (server-side window + consent check live in
 *  my_armable_geofences, migration 0139) and hand the OS exactly that set.
 *
 *  A failed fetch KEEPS the regions already armed (armingPlan): a network blip at 5:30 AM must not
 *  leave the athlete unseen at 5:43. `kept: true` tells the caller nothing changed. Only a
 *  successful answer with nothing in its window disarms; sign-out disarms via LOCATION_DISARM. */
export async function refreshGeofences(nowMs: number = Date.now()): Promise<{
  armed: number; capped: number; state: PermissionState; kept?: boolean; walkIn: WalkInStatus; error?: string;
}> {
  const state = await getPermissionState();
  if (!walkInAllowed()) {
    await disarmAll();
    return { armed: 0, capped: 0, state, walkIn: 'off' };
  }
  if (state !== 'always' || !Location || !supabase) {
    // Without background permission we do NOT register anything — the athlete verifies by tapping.
    await disarmAll();
    return { armed: 0, capped: 0, state, walkIn: 'idle' };
  }
  let answer: { data?: unknown; error?: unknown; thrown?: boolean };
  try {
    answer = await supabase.rpc('my_armable_geofences', { p_limit: GEOFENCE_CAP });
  } catch {
    answer = { thrown: true };
  }
  const plan = armingPlan(answer, nowMs);
  if (plan.action === 'keep') {
    // The server could not be read: keep what is armed, but never past its own close.
    await pruneExpired(nowMs);
    return { armed: 0, capped: 0, state, kept: true, walkIn: 'on' };
  }
  if (plan.action === 'disarm') {
    await disarmAll();
    return { armed: 0, capped: 0, state, walkIn: 'idle' };
  }
  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK, plan.regions);
  } catch (e) {
    // NEVER silent again (final review C1: this catch once hid that iOS refused every arm). Log
    // it, and tell the proto walk-in is unavailable so it says "tap I'm here" instead.
    const error = String((e as Error)?.message ?? e);
    console.warn('[location] walk-in check-in could not arm:', error);
    return { armed: 0, capped: plan.capped, state, walkIn: 'unavailable', error };
  }
  scheduleCloseSweep(plan.regions, nowMs);
  // A non-zero `capped` is reported so the UI can TELL the athlete which commitments need a tap,
  // rather than leaving them silently unverified.
  return { armed: plan.regions.length, capped: plan.capped, state, walkIn: 'on' };
}

export async function disarmAll(): Promise<void> {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  if (!Location) return;
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch { /* nothing armed, or the module went away — either way we're disarmed */ }
}

/* ---------------------------------------------------------------- disarm at the close */

/** The regions the OS is watching for our task right now (the options startGeofencingAsync was
 *  given), or [] when nothing is registered. */
async function armedRegions(): Promise<Region[]> {
  if (!Location || !TaskManager) return [];
  try {
    if (!(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK))) return [];
    const opts = await TaskManager.getTaskOptionsAsync<{ regions?: Region[] }>(GEOFENCE_TASK);
    return Array.isArray(opts?.regions) ? opts.regions : [];
  } catch {
    return [];
  }
}

/** Drop every region whose window has closed, and `drop` (one whose event came in out of time).
 *  Re-registers the rest, or stops the task when none is left. No network: it works in a
 *  background wake with no signal. */
export async function pruneExpired(nowMs: number = Date.now(), drop: string | null = null): Promise<number> {
  if (!Location) return 0;
  const before = await armedRegions();
  if (!before.length) return 0;
  const keep = pruneRegions(before, nowMs, drop);
  if (keep.length === before.length) return keep.length;
  try {
    if (!keep.length) await disarmAll();
    else {
      await Location.startGeofencingAsync(GEOFENCE_TASK, keep);
      scheduleCloseSweep(keep, nowMs);
    }
  } catch (e) {
    console.warn('[location] could not drop a closed region:', String((e as Error)?.message ?? e));
  }
  return keep.length;
}

/* While the app is alive (foreground, or a background wake still running), disarm at the earliest
   close. iOS gives no way to run code at a set time in a suspended or killed app, so this is the
   best effort; the guarantee is the event-time window check in handleRegionEvent. */
let closeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCloseSweep(regions: Region[], nowMs: number) {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  const close = nextClose(regions);
  if (close == null) return;
  // setTimeout caps at ~24.8 days; a window is hours long, but clamp anyway.
  const wait = Math.min(Math.max(0, close - nowMs) + 1000, 2 ** 31 - 1);
  closeTimer = setTimeout(() => { closeTimer = null; void pruneExpired(); }, wait);
}

/* ---------------------------------------------------------------- one reading */

/** ONE position reading at Balanced accuracy, or null. Never throws, never hangs past the budget. */
async function currentPosition(): Promise<PositionFix | null> {
  if (!Location) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
    });
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* geofence.ts takes a plain (name, args) signature so it stays pure; the names it calls
   (verify_arrival_at, record_departure) are typed in database.types.ts. */
const rpc: RpcFn = (fn, args) =>
  (supabase as NonNullable<typeof supabase>).rpc(fn as never, args as never) as never;

/* ---------------------------------------------------------------- report + "I'm here" */

/** What an arrival report comes back with. `distance_m` is the server's measurement, rounded; no
 *  coordinate is ever returned. `reason` is a plain sentence when `within` is false. */
export type ArrivalResult = { within: boolean; reason: string | null; distance_m: number | null };

/* The server refuses with a short code or sentence; the athlete reads a plain one. */
function reasonFor(message: string): string {
  if (/not_authorized|no commitment for you/i.test(message)) return 'This check-in isn’t open for you';
  if (/no_place|no location to verify/i.test(message)) return 'Your coach hasn’t set a place for this';
  if (/bad_position/i.test(message)) return 'Couldn’t get a location fix';
  if (/cancelled/i.test(message)) return 'This was cancelled';
  // 0242 (final review I1): an arrival after the close is refused, never back-dated.
  if (/arrival_closed/i.test(message)) return 'Check-in for this has closed';
  if (/consent/i.test(message)) return 'A parent or guardian needs to allow location check-in';
  if (/switched off/i.test(message)) return 'Location check-in is switched off';
  return 'Couldn’t check you in. Try again';
}

/** Send ONE reading to verify_arrival_at (0242). The server measures the distance to the coach's
 *  place and records the verdict: `within: false` becomes 'unverified' with "Not at <place>",
 *  and it can never write 'missed'. The coordinate is not kept. */
export async function reportArrival(
  instanceId: string,
  source: 'geofence' | 'manual',
  coords: PositionFix['coords'],
): Promise<ArrivalResult> {
  const args = arrivalArgs(instanceId, source, { coords });
  if (!args) return { within: false, reason: 'Couldn’t get a location fix', distance_m: null };
  if (!supabase) return { within: false, reason: 'You’re offline', distance_m: null };
  try {
    const { data, error } = await rpc('verify_arrival_at', args);
    if (error) {
      const message = String((error as { message?: string })?.message ?? error);
      return { within: false, reason: reasonFor(message), distance_m: null };
    }
    const d = (data ?? {}) as { within?: boolean; distance_m?: number; unverified_reason?: string | null };
    const within = d.within === true;
    return {
      within,
      reason: within ? null : (d.unverified_reason || 'Not at the place your coach set'),
      distance_m: typeof d.distance_m === 'number' ? d.distance_m : null,
    };
  } catch {
    return { within: false, reason: 'Couldn’t check you in. Try again', distance_m: null };
  }
}

/** The "I'm here" path. Takes ONE reading and reports it with source 'manual'. The server decides;
 *  what comes back is the verdict and the distance, never a coordinate. */
export async function checkArrival(instanceId: string): Promise<ArrivalResult> {
  if (!Location) return { within: false, reason: 'Location is unavailable on this device', distance_m: null };
  if (!instanceId) return { within: false, reason: 'This check-in isn’t open for you', distance_m: null };
  const state = await getPermissionState();
  if (state === 'denied' || state === 'undetermined' || state === 'unavailable') {
    return { within: false, reason: 'Location permission is off', distance_m: null };
  }
  const fix = await currentPosition();
  if (!fix) return { within: false, reason: 'Couldn’t get a location fix', distance_m: null };
  return reportArrival(instanceId, 'manual', fix.coords);
}

/** Record a region EXIT (migration 0208). Writes commitment_responses.departed_at.
 *
 *  WHAT THIS DOES NOT DO, AND WHY THAT IS THE POINT. It does not decide whether the athlete
 *  actually left. Indoors, which is exactly where "classroom" commitments live, iOS fires
 *  spurious Exit events for a phone sitting perfectly still. Debouncing here would need a timer
 *  that survives the app being killed in the background, which is the one thing iOS does not
 *  promise. So the device reports the raw crossing and the SERVER decides: a re-entry erases the
 *  departure, and a surviving one is only believed after the grace has elapsed. See 0208.
 *
 *  record_departure cannot write `status` and refuses outright when there is no arrival to depart
 *  from, so a stray event can neither invent a departure nor mark anyone missed. The background
 *  task reaches it through handleRegionEvent; this export is the same call for foreground use. */
export async function reportDeparture(instanceId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('record_departure', { p_instance: instanceId });
    return !error;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- the background task */

/** Registered once at module scope (ProtoApp.tsx), as TaskManager requires: a region crossing can
 *  launch the app in the background, and the task must already be defined by then. Safe to call
 *  repeatedly and safe on a build without the modules. Registers nothing with the OS by itself:
 *  regions are only armed once the athlete grants background permission (LOCATION_ARM). */
export function registerGeofenceTask(): void {
  if (!TaskManager || !Location) return;
  try {
    if (TaskManager.isTaskDefined(GEOFENCE_TASK)) return;
    TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
      if (error || !data || !supabase) return;
      // Walk-in switched off by OTA (WALK_IN, the device-test fallback) while a region was still
      // armed: stop watching, send nothing.
      if (!walkInAllowed()) { await disarmAll(); return; }
      // BOTH edges are reported. An Enter sends ONE reading to verify_arrival_at (0242) and the
      // server measures it, or the bare region match when no reading can be had; an Exit goes to
      // record_departure (0208). An arrival is never
      // downgraded: verify_arrival coalesces arrived_at and record_departure cannot touch status.
      // An event outside the region's own window sends nothing and drops that region (I2).
      await handleRegionEvent(data, {
        rpc, position: currentPosition, now: Date.now,
        disarm: (identifier) => pruneExpired(Date.now(), identifier),
      });
    });
  } catch { /* a defineTask collision on fast refresh is harmless */ }
}
