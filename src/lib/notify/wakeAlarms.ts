// OnStandard — arming the coach's wake-up as a real alarm.
//
// The proto owns the roll-call rows, so it is the only thing that knows which mornings a coach has
// assigned. This module is the narrow seam between that knowledge and the two native alarm APIs:
// AlarmKit on iOS 26, `setAlarmClock` on Android.
//
// RECONCILE, NEVER APPEND. `syncWakeAlarms` takes the WHOLE set that should be armed and cancels
// anything on the device that is not in it. That makes the call idempotent, makes a dropped
// message harmless (the next sync repairs it), and means a coach who deletes a wake-up does not
// leave an alarm ringing on an athlete's phone with nothing in the app to turn it off. Appending
// would have all three of those failure modes.
//
// EVERY CALL DEGRADES TO NOTHING. The native module is absent on web, in Expo Go, and in every
// binary built before it existed — and AlarmKit itself is absent below iOS 26. An athlete on an
// older phone keeps exactly the roll-call notification they have today.
import { Platform } from 'react-native';

/** One morning to arm. `weekdays` is 1 = Sunday .. 7 = Saturday; EMPTY means fire once. */
export type WakeAlarmRequest = {
  instanceId: string;
  hour: number;
  minute: number;
  weekdays?: number[];
  title?: string;
};

export type WakeAlarmState = {
  supported: boolean;
  authorization: 'authorized' | 'denied' | 'notDetermined' | 'unsupported';
  armed: number;
};

type LiveModule = typeof import('../../../modules/rollcall-live');

function live(): LiveModule | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('../../../modules/rollcall-live') as LiveModule;
  } catch {
    return null;
  }
}

/** The last set the proto asked for, so a cancel can find alarms the device still holds. */
let lastArmed: string[] = [];

/** A request is only usable if it names an instance and a real time on the clock. */
export function isUsable(a: WakeAlarmRequest | null | undefined): a is WakeAlarmRequest {
  if (!a || typeof a.instanceId !== 'string' || !a.instanceId) return false;
  if (!Number.isInteger(a.hour) || a.hour < 0 || a.hour > 23) return false;
  if (!Number.isInteger(a.minute) || a.minute < 0 || a.minute > 59) return false;
  return true;
}

/** Weekdays, cleaned: integers 1..7, deduped, ordered. Anything else is dropped rather than
 *  guessed, because a wrong weekday is an alarm at 5:45 on the wrong morning. */
export function cleanWeekdays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  const out = new Set<number>();
  for (const d of days) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Arm exactly this set of mornings, and nothing else.
 *
 * @returns how many are actually armed. Zero is a legitimate answer on an unsupported device and
 *   is NOT an error — the caller uses `wakeAlarmState()` to tell "cannot" from "none to arm".
 */
export async function syncWakeAlarms(alarms: WakeAlarmRequest[]): Promise<number> {
  const mod = live();
  if (!mod || !mod.isAlarmSupported()) {
    lastArmed = [];
    return 0;
  }

  const wanted = (Array.isArray(alarms) ? alarms : []).filter(isUsable);
  const wantedIds = new Set(wanted.map((a) => a.instanceId));

  // Cancel first. If arming later fails, the athlete is left with no alarm rather than a stale one
  // firing for a morning their coach has already called off.
  for (const id of lastArmed) {
    if (!wantedIds.has(id)) {
      try { mod.cancelWakeAlarm(id); } catch { /* best effort */ }
    }
  }

  const armed: string[] = [];
  for (const a of wanted) {
    try {
      const id = await mod.scheduleWakeAlarm({
        instanceId: a.instanceId,
        hour: a.hour,
        minute: a.minute,
        weekdays: cleanWeekdays(a.weekdays),
        title: (a.title || 'Wake up').slice(0, 80),
      });
      // An empty id means the device refused it (permission revoked, or no AlarmKit). Recording it
      // anyway would make the next sync think it needs cancelling, which is harmless but noisy;
      // not recording it keeps `lastArmed` an honest list of what is really set.
      if (id) armed.push(a.instanceId);
    } catch { /* one bad morning must not cost the rest */ }
  }

  lastArmed = armed;
  return armed.length;
}

/** What the app can honestly tell the athlete about alarms on this device. */
export async function wakeAlarmState(): Promise<WakeAlarmState> {
  const mod = live();
  if (!mod) return { supported: false, authorization: 'unsupported', armed: 0 };
  let supported = false;
  try { supported = mod.isAlarmSupported(); } catch { supported = false; }
  if (!supported) return { supported: false, authorization: 'unsupported', armed: 0 };

  let authorization: WakeAlarmState['authorization'] = 'unsupported';
  try { authorization = mod.alarmAuthorizationState(); } catch { /* leave unsupported */ }
  // Ask once if nobody has been asked. Doing it here rather than at launch puts the system prompt
  // next to the coach's wake-up card, where the reason for it is on screen.
  if (authorization === 'notDetermined') {
    try { authorization = await mod.requestAlarmAuthorization(); } catch { /* leave as is */ }
  }

  let armed = 0;
  try { armed = mod.scheduledWakeAlarms().length; } catch { armed = 0; }
  return { supported, authorization, armed };
}

/** Test seam: forget what this process believes is armed. */
export function _resetWakeAlarms(): void {
  lastArmed = [];
}
