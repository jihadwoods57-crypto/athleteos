/* Roll call v3 client calls (2026-09-24): the athlete's seen stamp and primer answer, the coach's
   arming board, "tell them now" and "Remind the N not set".

   LAZY: nothing on the boot graph imports this module (lint:boot), so it reads the Supabase client
   from window.sb itself, as wake-alarms.js does. (Its one import, commitment-data.js, is already
   eager, so it adds nothing to the boot graph.) A failed read is null (the fetcher contract: the
   caller shows an error state), never a fabricated empty answer. */

import { vcUid } from './commitment-data.js';

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
    const status = error && error.context && error.context.status;
    return { ok: false, reason: status === 429 ? 'rate_limited' : status === 403 ? 'not_authorized' : 'failed', data: null };
  } catch { return { ok: false, reason: 'failed', data: null }; }
}

/** Tell the athletes now (after Start or Save), instead of at the next cron minute. */
export async function notifyRollcall(commitmentId) {
  if (!commitmentId) return { sent: 0, reason: 'failed' };
  const r = await coachCall({ action: 'notify', commitment: commitmentId });
  return { sent: r.ok ? Number(r.data.pushed) || 0 : 0, reason: r.reason };
}

/** "Remind the N not set": the assignment push again, to everyone whose phone has not armed. */
export async function remindArm(instanceId) {
  if (!instanceId) return { sent: 0, reason: 'failed' };
  const r = await coachCall({ action: 'remind_arm', instance: instanceId });
  if (r.ok) ARMING.delete(instanceId);
  return { sent: r.ok ? Number(r.data.targeted) || 0 : 0, reason: r.reason };
}

export function _resetV3ForTests() { SEEN.clear(); PRIMER = undefined; PRIMER_UID = null; ARMING.clear(); }
