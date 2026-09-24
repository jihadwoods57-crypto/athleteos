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

/** One morning to arm. `weekdays` is 1 = Sunday .. 7 = Saturday; EMPTY means fire once.
 *  `at` is the exact instant in epoch ms: a dated roll call rings ONCE, on its date. Without it
 *  the native side armed hour:minute against "the next time that reads on the clock", and two
 *  mornings at the same time on different days collapsed into one alarm. */
export type WakeAlarmRequest = {
  instanceId: string;
  hour: number;
  minute: number;
  weekdays?: number[];
  title?: string;
  /** The action button's text: the coach's own `action_label`, else the app's roll-call
   *  default. The proto supplies it; this layer only bounds it. */
  buttonLabel?: string;
  at?: number;
  /** The WINDOW code for this morning (roll-call-ack's mint), and the URL to post it to. With
   *  them the alarm's Stop checks in by itself, with OnStandard closed; without them it records
   *  the tap for the app to drain, which is what it always did. */
  ackCode?: string;
  ackUrl?: string;
};

export type WakeAlarmState = {
  supported: boolean;
  authorization: 'authorized' | 'denied' | 'notDetermined' | 'unsupported';
  armed: number;
  ids: string[];
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
/** What the server has been told per instance: `1@<ms>` armed for that instant, `0` not armed. Keyed
 *  on the TIME too: a moved morning is re-armed at a new instant and the server (0247) cleared its
 *  stale armed stamp, so it must hear it again. */
const reported = new Map<string, string>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One entry off `scheduledWakeAlarms()`, however native shaped it: iOS answers `{ id, state }`
 *  (AlarmKit's own UUID, which for a UUID instance id IS the instance id); Android answers
 *  `{ instanceId, at }` with no `id` and no `state` at all. */
function rawAlarmId(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as { id?: unknown; instanceId?: unknown };
  const raw = typeof o.id === 'string' ? o.id : typeof o.instanceId === 'string' ? o.instanceId : '';
  const id = raw.trim().toLowerCase();
  return UUID_RE.test(id) ? id : '';
}

/** Instance ids (lowercase UUIDs) of the alarms this device holds, however they were armed. AlarmKit
 *  ids ARE the instance UUID (RollCallAlarmScheduler.alarmID), so an alarm the push extension armed
 *  while the app was closed is found and reconciled like one this process armed. */
export function deviceAlarmIds(list: unknown): string[] {
  const out = new Set<string>();
  for (const a of Array.isArray(list) ? list : []) {
    const id = rawAlarmId(a);
    if (id) out.add(id);
  }
  return [...out];
}

/** Like `deviceAlarmIds`, but never includes one currently ALERTING (mid-ring): a full-sweep
 *  cancel must not silence a phone that is ringing right now for a morning still legitimately
 *  open. Android reports no state at all, so nothing is excluded there — the sweep only ever
 *  skips a ring it can actually see. */
export function cancelableDeviceAlarmIds(list: unknown): string[] {
  const out = new Set<string>();
  for (const a of Array.isArray(list) ? list : []) {
    const id = rawAlarmId(a);
    if (!id) continue;
    const state = a && typeof a === 'object' && typeof (a as { state?: unknown }).state === 'string'
      ? ((a as { state: string }).state).toLowerCase() : '';
    if (state === 'alerting') continue;
    out.add(id);
  }
  return [...out];
}

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

/** The exact instant, or 0 when the request carries none or names one already behind us. */
export function fixedAt(a: WakeAlarmRequest, nowMs: number = Date.now()): number {
  const t = Number(a.at);
  return Number.isFinite(t) && t > nowMs ? Math.round(t) : 0;
}

/** The code + URL pair native may hold, or nothing. A code without a URL cannot be posted, a URL
 *  without a code proves nothing, and only https ever leaves the phone: the code is a credential
 *  for one athlete's morning. Bounded so a runaway string never reaches the alarm's metadata. */
export function ackFor(a: WakeAlarmRequest): { ackCode: string; ackUrl: string } | null {
  const code = typeof a.ackCode === 'string' ? a.ackCode.trim() : '';
  const url = typeof a.ackUrl === 'string' ? a.ackUrl.trim() : '';
  if (!code || code.length > 2048 || !url || url.length > 512) return null;
  if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
  return { ackCode: code, ackUrl: url };
}

/**
 * Tell the server which of this athlete's mornings this phone will ring for. The reminder cron
 * reads it to send the 6:00 push SILENTLY where a real alarm is already going off, so the athlete
 * hears one alarm and not an alarm plus a chime plus a Live Activity alert. Best-effort and
 * diffed: only instances whose state changed are reported.
 */
async function reportArmed(armedAt: Map<string, number>, everSeen: Iterable<string>): Promise<void> {
  let rpc: ((fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>) | null = null;
  try {
    const { supabase } = require('@/lib/supabase/client') as {
      supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> } | null;
    };
    rpc = supabase ? supabase.rpc.bind(supabase) : null;
  } catch { rpc = null; }
  if (!rpc) return;
  for (const id of new Set([...armedAt.keys(), ...everSeen])) {
    const key = armedAt.has(id) ? `1@${armedAt.get(id) || 0}` : '0';
    if (reported.get(id) === key) continue;
    try {
      const { error } = await rpc('set_wake_alarm_armed', { p_instance: id, p_armed: armedAt.has(id) });
      if (!error) reported.set(id, key);
    } catch { /* the next sync says it again */ }
  }
}

/** Serializes `syncWakeAlarms`: a simple in-flight promise chain, not a lock. Two calls can land
 *  close together (a foreground beat and a Continue tap, or two foreground beats), and each reads
 *  `lastArmed` to decide what to cancel — running them concurrently lets the second start from a
 *  `lastArmed` the first hasn't finished updating yet, so it can cancel an alarm the first just
 *  armed a moment ago. Chaining onto the SAME promise (success or failure) makes every call wait
 *  for the previous one's cancel-then-arm to finish before it reads shared state. */
let syncTail: Promise<number> = Promise.resolve(0);

export function syncWakeAlarms(alarms: WakeAlarmRequest[], opts: { complete?: boolean } = {}): Promise<number> {
  const run = () => syncWakeAlarmsOnce(alarms, opts);
  const next = syncTail.then(run, run);
  syncTail = next;
  return next;
}

/**
 * Arm exactly this set of mornings, and nothing else.
 *
 * @returns how many are actually armed. Zero is a legitimate answer on an unsupported device and
 *   is NOT an error — the caller uses `wakeAlarmState()` to tell "cannot" from "none to arm".
 */
async function syncWakeAlarmsOnce(alarms: WakeAlarmRequest[], opts: { complete?: boolean } = {}): Promise<number> {
  const mod = live();
  if (!mod || !mod.isAlarmSupported()) {
    lastArmed = [];
    return 0;
  }

  // ARM ONLY WHAT THE ATHLETE ALREADY ALLOWED (review pass 2026-09-23, G-P2). Scheduling an alarm
  // while nobody has been asked makes AlarmKit put up its own permission question, and this sync
  // runs on Home load, so the question used to arrive with nothing on screen to explain it. Until
  // the athlete says yes from the roll call's Continue primer (wakeAlarmState({ ask: true })), the
  // set is treated as empty: anything armed before is cancelled and nothing new is scheduled.
  let authorized = false;
  try { authorized = mod.alarmAuthorizationState() === 'authorized'; } catch { authorized = false; }
  const wanted = authorized ? (Array.isArray(alarms) ? alarms : []).filter(isUsable) : [];
  const wantedIds = new Set(wanted.map((a) => a.instanceId.toLowerCase()));

  // Cancel first. If arming later fails, the athlete is left with no alarm rather than a stale one
  // firing for a morning their coach has already called off. `complete` (the proto loaded the whole
  // 14 days) widens this to every alarm the DEVICE holds, including ones the push extension armed
  // while the app was closed; a partial row set only ever cancels what this process armed.
  const previously = [...lastArmed];
  let onDevice: string[] = [];
  if (opts.complete === true) {
    try { onDevice = cancelableDeviceAlarmIds(mod.scheduledWakeAlarms()); } catch { onDevice = []; }
  }
  for (const id of new Set([...previously, ...onDevice])) {
    if (!wantedIds.has(id.toLowerCase())) {
      try { mod.cancelWakeAlarm(id); } catch { /* best effort */ }
    }
  }

  const armed: string[] = [];
  const armedAt = new Map<string, number>();
  for (const a of wanted) {
    try {
      const title = (a.title || 'Wake up').slice(0, 80);
      // 24 is the coach composer's own cap. AlarmKit gives this button one short line and iOS
      // truncates silently, so a longer string would just disappear off the end.
      const buttonLabel = (a.buttonLabel || 'I’m Up').slice(0, 24);
      const at = fixedAt(a);
      // A DATED alarm where the binary can take one. `scheduleWakeAlarmAt` is newer than the
      // module's first build, so its absence (an older binary receiving this JS over the air)
      // falls back to hour:minute, which is what that binary always did.
      const id = at && typeof mod.hasDatedAlarms === 'function' && mod.hasDatedAlarms()
        ? await mod.scheduleWakeAlarmAt({ instanceId: a.instanceId, at, title, buttonLabel, ...(ackFor(a) ?? {}) })
        : await mod.scheduleWakeAlarm({
            instanceId: a.instanceId,
            hour: a.hour,
            minute: a.minute,
            weekdays: cleanWeekdays(a.weekdays),
            title,
            buttonLabel,
          });
      // An empty id means the device refused it (permission revoked, or no AlarmKit). Recording it
      // anyway would make the next sync think it needs cancelling, which is harmless but noisy;
      // not recording it keeps `lastArmed` an honest list of what is really set.
      if (id) { armed.push(a.instanceId); armedAt.set(a.instanceId, at || 0); }
    } catch { /* one bad morning must not cost the rest */ }
  }

  lastArmed = armed;
  void reportArmed(armedAt, [...previously, ...onDevice]);
  return armed.length;
}

/**
 * The athlete answered this morning (in the app, or the tap drained from the alarm). The alarm
 * for it must not ring: a queued offline answer at 5:58 followed by a 6:00 alarm for the same
 * roll call is exactly the "why is it still going off" an athlete remembers. Safe for an instance
 * that never had one.
 */
export function cancelWakeAlarmFor(instanceId: string): void {
  const id = String(instanceId || '');
  if (!id) return;
  const mod = live();
  if (!mod) return;
  try { mod.cancelWakeAlarm(id); } catch { /* best effort */ }
  lastArmed = lastArmed.filter((x) => x !== id);
  // Only THIS instance changed state; the rest of `lastArmed` is untouched and must not be told
  // again (it would resend `p_armed:true` with a fabricated instant of 0 for every other morning).
  void reportArmed(new Map(), [id]);
}

/** What the app can honestly tell the athlete about alarms on this device. Asks the system
 *  question only when `ask` is true: the roll call's Continue primer (G-P2). */
export async function wakeAlarmState(opts: { ask?: boolean } = {}): Promise<WakeAlarmState> {
  const mod = live();
  if (!mod) return { supported: false, authorization: 'unsupported', armed: 0, ids: [] };
  let supported = false;
  try { supported = mod.isAlarmSupported(); } catch { supported = false; }
  if (!supported) return { supported: false, authorization: 'unsupported', armed: 0, ids: [] };

  let authorization: WakeAlarmState['authorization'] = 'unsupported';
  try { authorization = mod.alarmAuthorizationState(); } catch { /* leave unsupported */ }
  // Ask once, and only when the athlete tapped Continue on the primer that explains it.
  if (authorization === 'notDetermined' && opts.ask === true) {
    try { authorization = await mod.requestAlarmAuthorization(); } catch { /* leave as is */ }
  }

  let armed = 0;
  let ids: string[] = [];
  try {
    const list = mod.scheduledWakeAlarms();
    armed = list.length;
    ids = deviceAlarmIds(list);
  } catch { armed = 0; ids = []; }
  return { supported, authorization, armed, ids };
}

/** Test seam: forget what this process believes is armed. */
export function _resetWakeAlarms(): void {
  lastArmed = [];
  reported.clear();
  syncTail = Promise.resolve(0);
}
