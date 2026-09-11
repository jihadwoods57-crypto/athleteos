/* The coach's wake-up, armed as a REAL alarm on the phone.
 *
 * A notification is silenced by a Focus, by silent mode and by the volume slider. A coach's 5:45
 * that a Sleep Focus can mute is not a wake-up. So the native side arms an actual alarm (AlarmKit
 * on iOS 26, setAlarmClock on Android), and this module is what decides WHICH mornings it arms.
 *
 * The proto owns the roll-call rows, so this is the only place that knows. It sends the WHOLE set
 * every time and the native side reconciles: a dropped message is repaired by the next sync, and a
 * wake-up the coach deleted is cancelled rather than left ringing on a phone with nothing in the
 * app to turn it off.
 *
 * Dependency-free apart from the wake-up type, so the selection rules are unit tested rather than
 * inferred from a screen.
 */
import { WAKEUP_TYPE } from './wakeup-morning.js';

/** Never arm more than this. A runaway row set must not fill a phone with alarms. */
export const MAX_ALARMS = 14;

/** How far ahead to arm. Beyond this the app will have synced again many times over. */
export const HORIZON_DAYS = 7;

/**
 * Which of the athlete's commitments deserve an alarm, in the shape the bridge wants.
 *
 * The rules, each of which exists because its absence would ring a phone wrongly:
 *   - wake-ups ONLY (`morning_roll_call`). No other commitment type takes over a screen.
 *   - the morning must still be AHEAD. An alarm for a roll call that already closed would ring for
 *     something the athlete can no longer answer.
 *   - never one already decided. An athlete who answered last night's early wake-up from the app
 *     must not be woken by it anyway.
 *   - never one the coach excused.
 *   - one alarm per instance, nearest first, capped.
 *
 * @param {Array|null} rows commitment-data.js loadMine()/loadMineRange() output
 * @param {number} nowMs the athlete's own clock
 * @returns {Array<{instanceId:string, hour:number, minute:number, weekdays:number[], title:string}>}
 */
export function alarmsFor(rows, nowMs = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const horizon = nowMs + HORIZON_DAYS * 86400000;
  const seen = new Set();
  const out = [];

  for (const r of rows) {
    if (!r || r.type !== WAKEUP_TYPE) continue;
    const id = r.instance_id == null ? '' : String(r.instance_id);
    if (!id || seen.has(id)) continue;

    // A verdict means the clock has already had its say. `pending` is the only state a morning
    // still ahead of us can legitimately be in.
    const verdict = String(r.verdict || '');
    if (verdict && verdict !== 'pending') continue;
    if (r.status === 'excused' || r.status === 'acknowledged') continue;

    const at = Date.parse(r.starts_at || '');
    if (!isFinite(at) || at <= nowMs || at > horizon) continue;

    const d = new Date(at);
    out.push({
      instanceId: id,
      hour: d.getHours(),
      minute: d.getMinutes(),
      // A single dated instance, so a one-off. The row set is refreshed constantly and each
      // occurrence arrives as its own instance; a weekly recurrence here would double-arm.
      weekdays: [],
      title: alarmTitle(r),
      at,
    });
    seen.add(id);
  }

  out.sort((a, b) => a.at - b.at);
  return out.slice(0, MAX_ALARMS).map(({ at, ...rest }) => rest);
}

/** What the alarm says when it takes over the screen. The coach's own words if they wrote any. */
export function alarmTitle(row) {
  const t = String((row && (row.title || row.commitment_title)) || '').trim();
  return (t || 'Wake up').slice(0, 80);
}

/**
 * Arm them. Safe to call on every foreground beat: the native side reconciles, and outside the
 * app shell there is no bridge and this does nothing at all.
 * @returns {Promise<number>} how many are armed. 0 on a device that cannot set alarms.
 */
export async function syncWakeAlarms(rows, nowMs = Date.now()) {
  try {
    const n = window.OnStandardNative;
    if (!n || !n.wakeAlarms) return 0;
    return Number(await n.wakeAlarms.sync(alarmsFor(rows, nowMs))) || 0;
  } catch {
    return 0; // no bridge, or the shell is older than this feature
  }
}

/** What the app can honestly say about alarms on this device. Null when there is no bridge. */
export async function wakeAlarmState() {
  try {
    const n = window.OnStandardNative;
    if (!n || !n.wakeAlarms) return null;
    return await n.wakeAlarms.state();
  } catch {
    return null;
  }
}
