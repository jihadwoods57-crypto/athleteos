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
 * Dependency-free apart from the wake-up type (the Supabase client is passed in), so the selection
 * rules and the code merge are unit tested rather than inferred from a screen.
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
 *   - the COACH must have asked for an alarm. `alarm` is resolved server-side (0234) and is true
 *     for every wake-up that predates the switch; a coach who turns it off leaves the athlete the
 *     ordinary notification. Taking over somebody's phone at 5:45 is the coach's call to make.
 *   - the morning must still be AHEAD. An alarm for a roll call that already closed would ring for
 *     something the athlete can no longer answer.
 *   - never one already decided. An athlete who answered last night's early wake-up from the app
 *     must not be woken by it anyway.
 *   - never one the coach excused.
 *   - one alarm per instance, nearest first, capped.
 *
 * @param {Array|null} rows commitment-data.js loadMine()/loadMineRange() output
 * @param {number} nowMs the athlete's own clock
 * @returns {Array<{instanceId:string, hour:number, minute:number, weekdays:number[], title:string, buttonLabel:string, at:number}>}
 */
export function alarmsFor(rows, nowMs = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const horizon = nowMs + HORIZON_DAYS * 86400000;
  const seen = new Set();
  const out = [];

  for (const r of rows) {
    if (!r || r.type !== WAKEUP_TYPE) continue;
    if (r.alarm === false) continue; // the coach turned the alarm off for this wake-up
    // A day the coach skipped or a rule they deleted (0215 sets the instance cancelled). The
    // verdict check below does not see it, so without this an alarm rang for a called-off morning.
    if (r.instance_status === 'cancelled' || r.skipped === true) continue;
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
      // The coach's OWN button text, the same string the in-app card and the lock screen use.
      // What they typed is what the athlete reads at 5:45.
      buttonLabel: alarmButtonLabel(r),
      at,
    });
    seen.add(id);
  }

  out.sort((a, b) => a.at - b.at);
  /* `at` STAYS in the request. It is the exact instant this dated morning rings, in epoch ms. The
     first build armed hour:minute with no date, and AlarmKit's relative schedule fires at the NEXT
     6:00 on the clock, so two mornings ahead (tomorrow and the day after, both at 6:00) collapsed
     into one alarm tomorrow and nothing the day after. The native side arms a FIXED alarm from
     `at` and keeps hour:minute only for binaries that predate the field. */
  return out.slice(0, MAX_ALARMS);
}

/** The alarm's action button. The coach's `action_label` if they set one, else the founder's
 *  default. Bounded hard: AlarmKit gives this button one short line and iOS truncates without
 *  telling anyone, and the coach composer already caps the field at 24. */
export function alarmButtonLabel(row) {
  const t = String((row && row.action_label) || '').trim();
  return (t || DEFAULT_BUTTON).slice(0, 24);
}

/** Used when the coach did not name the button. MIRRORS commitments.js DEFAULT_ACTION for
 *  `morning_roll_call`, so the alarm button, the lock-screen button and the in-app row all say
 *  the same word instead of the alarm inventing a second vocabulary. */
export const DEFAULT_BUTTON = 'I’m Up';

/** What the alarm says when it takes over the screen. The coach's own words if they wrote any. */
export function alarmTitle(row) {
  const t = String((row && (row.title || row.commitment_title)) || '').trim();
  return (t || 'Wake up').slice(0, 80);
}

/* ---------------------------------------------------------------- the window codes
 * The alarm is armed days ahead and rings with OnStandard closed, so the code that lets its Stop
 * button check in by itself has to be on the phone BEFORE the morning. roll-call-ack's mint
 * ({ action: 'codes' }, the athlete's own session) returns one WINDOW code per wake-up over the
 * next 7 days; each is valid only from 15 minutes before that morning opens to 10 minutes after it
 * closes, for this athlete and that instance alone.
 *
 * A missing code costs nothing but the shortcut: the alarm still arms, and its button records the
 * tap for the app to drain on the next open, which is what it always did. */

/** How long one mint is reused. Codes last days; this only stops a mint on every foreground beat. */
export const ACK_CODES_TTL_MS = 30 * 60 * 1000;
/** A mint slower than this is abandoned for this sync: arming must never wait on it. */
const ACK_CODES_TIMEOUT_MS = 6000;

/* { at, data, asked }: the last mint's answer (null when it failed) and every instance id that was
   about to be armed when it was asked. A FAILED mint and an id the mint had no code for are cached
   too, for the same TTL: a signed-out athlete, a mint route not deployed yet, or a morning the
   server will not code must not cost an edge-function call on every foreground beat. */
let ackCache = null;

/** Test seam. */
export function _resetAckCodes() { ackCache = null; }

/* A session change clears the cache: a sign-in right after a failed (401) mint gets codes at once
   instead of 30 minutes later, and a sign-out never leaves one athlete's codes for the next.
   Registered once per client. */
const watched = new WeakSet();
function watchSession(client) {
  try {
    if (!client || typeof client !== 'object' || watched.has(client)) return;
    watched.add(client);
    if (client.auth && typeof client.auth.onAuthStateChange === 'function') {
      client.auth.onAuthStateChange((event) => {
        // SIGNED_IN only clears a FAILED mint: supabase-js re-emits it when the app returns to the
        // foreground, and clearing good codes there would mint on every beat. A different athlete
        // signing in comes after a SIGNED_OUT, which always clears.
        if (event === 'SIGNED_OUT') ackCache = null;
        else if (event === 'SIGNED_IN' && ackCache && !ackCache.data) ackCache = null;
      });
    }
  } catch { /* the cache simply expires on its TTL */ }
}

/**
 * The mint's answer, cached. Asks again when the cache is stale or when an instance about to be
 * armed was never part of an ask (a wake-up the coach just added).
 * @param {object|null} client the Supabase client (window.sb)
 * @param {number} nowMs
 * @param {string[]} [needIds] instance ids about to be armed
 * @returns {Promise<{ok:boolean, ack_url:string, codes:Array}|null>} null when there is nothing usable
 */
export async function fetchAckCodes(client, nowMs = Date.now(), needIds = []) {
  const need = Array.isArray(needIds) ? needIds.map(String) : [];
  watchSession(client);
  if (ackCache && nowMs - ackCache.at >= 0 && nowMs - ackCache.at < ACK_CODES_TTL_MS) {
    if (need.every((id) => ackCache.asked.has(id))) return ackCache.data;
  }
  if (!client || !client.functions || typeof client.functions.invoke !== 'function') return null;
  const asked = new Set(need);
  const remember = (data) => {
    if (data) for (const c of data.codes) if (c && c.instance_id) asked.add(String(c.instance_id));
    ackCache = { at: nowMs, data, asked };
    return data;
  };
  let timer = null;
  try {
    const call = client.functions.invoke('roll-call-ack', { body: { action: 'codes' } });
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ data: null, error: 'timeout' }), ACK_CODES_TIMEOUT_MS); });
    const { data, error } = await Promise.race([call, late]);
    if (error || !data || data.ok !== true || !Array.isArray(data.codes)) return remember(null);
    return remember(data);
  } catch {
    return remember(null);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Attach each alarm's window code and the URL to post it to. Pure. Anything odd about the mint
 * (failed, not https, no code for this morning) leaves that alarm exactly as it was.
 */
export function withAckCodes(alarms, mint) {
  const list = Array.isArray(alarms) ? alarms : [];
  const url = mint && typeof mint.ack_url === 'string' ? mint.ack_url : '';
  if (!mint || mint.ok !== true || !Array.isArray(mint.codes) || !/^https:\/\//i.test(url)) return list;
  const byId = new Map();
  for (const c of mint.codes) {
    if (c && typeof c.instance_id === 'string' && typeof c.code === 'string' && c.code) byId.set(c.instance_id, c.code);
  }
  return list.map((a) => (byId.has(a.instanceId) ? { ...a, ackCode: byId.get(a.instanceId), ackUrl: url } : a));
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
    const alarms = alarmsFor(rows, nowMs);
    const mint = alarms.length ? await fetchAckCodes(window.sb, nowMs, alarms.map((a) => a.instanceId)) : null;
    return Number(await n.wakeAlarms.sync(withAckCodes(alarms, mint))) || 0;
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
