/* Roll call v3 client calls (2026-09-24): the athlete's seen stamp and primer answer, the coach's
   arming board, "tell them now" and "Remind the N not set".

   LAZY: nothing on the boot graph imports this module (lint:boot), so it reads the Supabase client
   from window.sb itself, as wake-alarms.js does. (Its one import, commitment-data.js, is already
   eager, so it adds nothing to the boot graph.) A failed read is null (the fetcher contract: the
   caller shows an error state), never a fabricated empty answer. */

import { vcUid, remindMissing } from './commitment-data.js';

const sb = () => (typeof window !== 'undefined' && window.sb) || null;

/* ---------------------------------------------------------------- seen (the athlete) */
const SEEN = new Set();

/** Stamp this roll call seen (0247 mark_rollcall_seen), once per id per session. No id = every
 *  roll call. A failure is retried on the next call. */
export async function markRollcallSeen(commitmentId = null) {
  const key = `${vcUid() || ''}:${commitmentId || '*'}`;   // per account: a sign-out never carries it
  if (SEEN.has(key)) return false;
  const c = sb();
  if (!c) return false;
  SEEN.add(key);
  try {
    const { error } = await c.rpc('mark_rollcall_seen', { p_commitment: commitmentId || null });
    if (error) { SEEN.delete(key); return false; }
    return true;
  } catch { SEEN.delete(key); return false; }
}

/* ---------------------------------------------------------------- the primer answer (the athlete) */
let PRIMER;   // undefined = never read; null = the read failed; { at, answer }
let PRIMER_UID = null;   // whose answer PRIMER is: another account on this phone reads its own

/** The account's answer to the alarm primer (0247 alarm_primer_state). null = the read failed,
 *  which is NOT "never answered": the caller must not ask on a failed read. */
export async function primerState(force = false) {
  const uid = vcUid();
  if (PRIMER !== undefined && !force && PRIMER_UID === uid) return PRIMER;
  const c = sb();
  if (!c) return null;
  PRIMER_UID = uid;
  try {
    const { data, error } = await c.rpc('alarm_primer_state');
    PRIMER = error || !data || typeof data !== 'object' || Array.isArray(data)
      ? null : { at: data.at || null, answer: data.answer || null };
  } catch { PRIMER = null; }
  return PRIMER;
}

/** Record the answer on the account (0247 set_alarm_primer). This session's copy updates at once,
 *  so a failed write still does not ask again before the next launch. */
export async function setPrimer(answer) {
  if (answer !== 'continue' && answer !== 'not_now') return false;
  PRIMER = { at: new Date().toISOString(), answer };
  PRIMER_UID = vcUid();
  const c = sb();
  if (!c) return false;
  try {
    const { data, error } = await c.rpc('set_alarm_primer', { p_answer: answer });
    return !error && data === true;
  } catch { return false; }
}

/* ---------------------------------------------------------------- the coach */
const ARMING = new Map();   // instanceId -> { at, data, seeded }
const ARMING_FRESH_MS = 15000;

export function armingFor(instanceId) { const a = ARMING.get(instanceId); return a ? a.data : null; }

/** Who will ring for one morning (0247 rollcall_arming). null = failed or not staff. */
export async function loadArming(instanceId, force = false) {
  const hit = ARMING.get(instanceId);
  if (hit && (hit.seeded || (!force && Date.now() - hit.at < ARMING_FRESH_MS))) return hit.data;
  const c = sb();
  if (!c || !instanceId) return null;
  try {
    const { data, error } = await c.rpc('rollcall_arming', { p_instance: instanceId });
    if (error || !data || typeof data !== 'object') return null;
    ARMING.set(instanceId, { at: Date.now(), data });
    return data;
  } catch { return null; }
}

/** Harness seam (render tests only): a seeded board never refetches. */
export function seedArmingForHarness(instanceId, data) { ARMING.set(instanceId, { at: Date.now(), data, seeded: true }); }

async function coachCall(body) {
  const c = sb();
  if (!c) return { ok: false, reason: 'failed', data: null };
  try {
    const { data, error } = await c.functions.invoke('roll-call-coach', { body });
    if (!error && data && data.ok) return { ok: true, reason: 'ok', data };
    const ctx = error && error.context;
    const status = ctx && ctx.status;
    if (status === 429) return { ok: false, reason: 'rate_limited', data: null };
    // 404: the morning already started, or the roll call is paused or not a wake-up. A decided
    // answer, never "check your connection".
    if (status === 404) return { ok: false, reason: 'no_instance', data: null };
    if (status === 403) {
      // 403 is both "not staff" and the switch being off; the body says which.
      let why = null;
      try { why = typeof ctx.json === 'function' ? ((await ctx.json()) || {}).error : null; } catch { why = null; }
      return { ok: false, reason: why === 'flag_off' ? 'flag_off' : 'not_authorized', data: null };
    }
    return { ok: false, reason: 'failed', data: null };
  } catch { return { ok: false, reason: 'failed', data: null }; }
}

/** Tell the athletes now (after Start or Save), instead of at the next cron minute. A press inside
 *  the server's 60 s cooldown is `cooldown`: nothing sent now, the cron says it within the minute. */
export async function notifyRollcall(commitmentId) {
  if (!commitmentId) return { sent: 0, reason: 'failed' };
  const r = await coachCall({ action: 'notify', commitment: commitmentId });
  if (r.ok && r.data.cooldown) return { sent: 0, reason: 'cooldown' };
  return { sent: r.ok ? Number(r.data.pushed) || 0 : 0, reason: r.reason };
}

/* The "tell them now" that Start or Save fires on its way to the roll call screen, kept here so the
   screen it lands on can say how it went (the setup screen is gone by the time it answers). */
const TOLD = new Map();   // commitmentId -> { state: 'sending' | notifyRollcall's reason, sent, at, done }
export function tellAthletesNow(commitmentId) {
  if (!commitmentId) return Promise.resolve({ sent: 0, reason: 'failed' });
  const done = notifyRollcall(commitmentId).then((r) => {
    TOLD.set(commitmentId, { state: r.reason, sent: r.sent, at: Date.now(), done });
    return r;
  });
  TOLD.set(commitmentId, { state: 'sending', sent: 0, at: Date.now(), done });
  return done;
}
/** How the last tell went, for two minutes after it answered. null = nothing to say. */
export function toldState(commitmentId, nowMs = Date.now()) {
  const t = TOLD.get(commitmentId);
  if (!t) return null;
  if (t.state !== 'sending' && nowMs - t.at > 120000) return null;
  return t;
}
/** Harness seam: the landing line in a given state. */
export function seedToldForHarness(commitmentId, state, sent = 0) {
  TOLD.set(commitmentId, { state, sent, at: Date.now(), done: new Promise(() => {}), watched: true, refreshed: true });
}

/** "Nudge the N not up" from the roll call screen: the same function as the board's, but read so
 *  the switch being off (flag_off) says so. A transport failure falls back to remindMissing, whose
 *  RPC path is the board's own fallback. */
export async function nudgeAll(instanceId) {
  if (!instanceId) return { sent: 0, reason: 'failed' };
  const r = await coachCall({ action: 'nudge', instance: instanceId });
  if (r.ok) return { sent: Number(r.data.targeted) || 0, reason: 'ok' };
  return r.reason === 'failed' ? remindMissing(instanceId) : { sent: 0, reason: r.reason };
}

/** "Remind the N not set": the assignment push again, to everyone whose phone has not armed.
 *  `nobody` = everyone armed between the read and the tap (nothing sent, no cooldown spent). */
export async function remindArm(instanceId) {
  if (!instanceId) return { sent: 0, reason: 'failed' };
  const r = await coachCall({ action: 'remind_arm', instance: instanceId });
  if (r.ok) ARMING.delete(instanceId);
  if (r.ok && !(Number(r.data.targeted) > 0)) return { sent: 0, reason: 'nobody' };
  return { sent: r.ok ? Number(r.data.targeted) || 0 : 0, reason: r.reason };
}

export function _resetV3ForTests() { SEEN.clear(); PRIMER = undefined; PRIMER_UID = null; ARMING.clear(); TOLD.clear(); }
