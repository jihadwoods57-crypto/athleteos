// OnStandard — rollcall-live, the JS surface of the native Wake-Up Roll Call module.
//
// EVERY EXPORT DEGRADES TO NOTHING. The module is absent on web, absent in Expo Go, and absent in
// any binary built before it existed — which includes builds #26 and #27, still in the field and
// still receiving OTA updates. So the module is required OPTIONALLY and every call is guarded.
// This is the same rule the HealthKit integration learned (native-build-debt-2026-08-20): an OTA
// reaches binaries that predate the native code it calls.
import { Platform } from 'react-native';

export type PushToStartTokenEvent = { token: string };
export type ActivityTokenEvent = { token: string; instanceId: string };
export type PendingTap = { instanceId: string; at: number };

export type AlarmAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'unsupported';
/** A wake-up to arm. `weekdays` is 1 = Sunday .. 7 = Saturday; EMPTY means fire once. */
export type WakeAlarm = {
  instanceId: string;
  hour: number;
  minute: number;
  weekdays?: number[];
  title?: string;
  buttonLabel?: string;
};

type NativeModule = {
  isLiveActivitySupported: () => boolean;
  isAlarmSupported?: () => boolean;
  alarmAuthorizationState?: () => AlarmAuthorization;
  requestAlarmAuthorization?: () => Promise<AlarmAuthorization>;
  scheduleWakeAlarm?: (instanceId: string, hour: number, minute: number, weekdays: number[], title: string, buttonLabel: string) => Promise<string>;
  cancelWakeAlarm?: (instanceId: string) => void;
  scheduledWakeAlarms?: () => Array<Record<string, unknown>>;
  startPushToStartObserver: () => void;
  endLiveActivity: (instanceId: string) => Promise<void>;
  activeInstanceIds?: () => string[];
  drainPendingTaps?: () => PendingTap[];
  isPresentationOverrideActive?: () => boolean;
  canPostPromotedNotifications?: () => boolean;
  addListener: (event: string, cb: (payload: never) => void) => { remove: () => void };
};

let cached: NativeModule | null | undefined;

function native(): NativeModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === 'web') return cached;
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core') as {
      requireOptionalNativeModule: (n: string) => NativeModule | null;
    };
    cached = requireOptionalNativeModule('RollCallLive');
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether this device can show a Live Activity at all: iOS 16.1+, and not switched off. */
export function isLiveActivitySupported(): boolean {
  try { return native()?.isLiveActivitySupported() ?? false; } catch { return false; }
}

/** Start watching both ActivityKit token streams. Idempotent; call once at launch. */
export function startPushToStartObserver(): void {
  try { native()?.startPushToStartObserver(); } catch { /* best effort */ }
}

/** Subscribe to push-to-start tokens (per device). Returns an unsubscribe. */
export function onPushToStartToken(cb: (e: PushToStartTokenEvent) => void): () => void {
  try {
    const sub = native()?.addListener('onPushToStartToken', cb as never);
    return () => { try { sub?.remove(); } catch { /* best effort */ } };
  } catch { return () => {}; }
}

/** Subscribe to per-activity update tokens. Returns an unsubscribe. */
export function onActivityToken(cb: (e: ActivityTokenEvent) => void): () => void {
  try {
    const sub = native()?.addListener('onActivityToken', cb as never);
    return () => { try { sub?.remove(); } catch { /* best effort */ } };
  } catch { return () => {}; }
}

/** Taps made on the Live Activity's own button while the app was not running. */
export function drainPendingTaps(): PendingTap[] {
  try { return native()?.drainPendingTaps?.() ?? []; } catch { return []; }
}

/** End this device's card for one roll call (the athlete answered in the app). */
export async function endLiveActivity(instanceId: string): Promise<void> {
  try { await native()?.endLiveActivity(instanceId); } catch { /* best effort */ }
}

/** Instance ids with a card on screen right now. Device QA only. */
export function activeInstanceIds(): string[] {
  try { return native()?.activeInstanceIds?.() ?? []; } catch { return []; }
}

/** Android: did our notification presentation override actually win? Device QA only — it fails
 *  silently, so without this "the countdown did not appear" has half a dozen causes. */
export function isPresentationOverrideActive(): boolean {
  try { return native()?.isPresentationOverrideActive?.() ?? false; } catch { return false; }
}

/** Android 16: will this phone honour a Live Update promotion? */
export function canPostPromotedNotifications(): boolean {
  try { return native()?.canPostPromotedNotifications?.() ?? false; } catch { return false; }
}

/* ------------------------------------------------------------------ the wake-up alarm */
/* A Live Activity is a card on the lock screen. THIS is the thing that wakes somebody up: it
   overrides Focus and silent mode, which nothing else in this app can do. iOS 26 and up via
   AlarmKit; Android via setAlarmClock. Everything degrades to nothing everywhere else, exactly
   like the Live Activity half above. */

/** Whether this build and this device can arm a real alarm at all. */
export function isAlarmSupported(): boolean {
  try { return native()?.isAlarmSupported?.() ?? false; } catch { return false; }
}

/** The current permission, without prompting. */
export function alarmAuthorizationState(): AlarmAuthorization {
  try { return native()?.alarmAuthorizationState?.() ?? 'unsupported'; } catch { return 'unsupported'; }
}

/** Ask for permission. iOS prompts; Android reports what the manifest already granted. */
export async function requestAlarmAuthorization(): Promise<AlarmAuthorization> {
  try { return (await native()?.requestAlarmAuthorization?.()) ?? 'unsupported'; } catch { return 'unsupported'; }
}

/** Arm (or replace) the wake-up for one roll-call instance. Resolves to '' when it could not be
 *  armed, which is not an error: an athlete on iOS 18 has done nothing wrong. */
export async function scheduleWakeAlarm(a: WakeAlarm): Promise<string> {
  try {
    return (await native()?.scheduleWakeAlarm?.(
      a.instanceId, a.hour, a.minute, a.weekdays ?? [], a.title || 'Wake up',
      a.buttonLabel || 'I’m Up',
    )) ?? '';
  } catch { return ''; }
}

/** Cancel one. Safe for an instance that never had an alarm. */
export function cancelWakeAlarm(instanceId: string): void {
  try { native()?.cancelWakeAlarm?.(instanceId); } catch { /* best effort */ }
}

/** Everything armed right now. Device QA only. */
export function scheduledWakeAlarms(): Array<Record<string, unknown>> {
  try { return native()?.scheduledWakeAlarms?.() ?? []; } catch { return []; }
}
