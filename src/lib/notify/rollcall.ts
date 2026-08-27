// OnStandard — lock-screen roll call, device half. Registers the "I'm Up" notification category,
// posts the signed code to roll-call-ack, and persists an offline retry queue. Native only.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  rollCallCategoryId, enqueueAck, dropAck, mergeLabels, type QueuedAck,
  COACH_DIGEST_CATEGORY, COACH_ACTION_SEEN, COACH_ACTION_NUDGE,
  enqueueCoachAction, dropCoachAction, type CoachAction, type QueuedCoachAction,
} from '@/core/rollcall';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const ACK_ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/roll-call-ack` : '';
const COACH_ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/roll-call-coach` : '';
const QUEUE_KEY = 'os:rollcall:ackQueue';
const COACH_QUEUE_KEY = 'os:rollcall:coachQueue';
const LABELS_KEY = 'os:rollcall:labels';

/** Register (idempotently) the notification category whose single action records "I'm Up" without
 *  opening the app. Returns the category id so the caller can match a push's categoryId. */
export async function registerRollCallCategory(label: string | null): Promise<string> {
  const id = rollCallCategoryId(label);
  if (Platform.OS === 'web') return id;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.setNotificationCategoryAsync(id, [
      { identifier: 'ACK', buttonTitle: (label ?? "I'm Up").slice(0, 24), options: { opensAppToForeground: false } },
    ]);
  } catch { /* best effort */ }
  return id;
}

/** POST the code to roll-call-ack. Returns true only on a recorded ack. */
export async function postRollCallAck(code: string): Promise<boolean> {
  if (!ACK_ENDPOINT || !code) return false;
  try {
    const res = await fetch(ACK_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && out.ok === true;
  } catch { return false; }
}

async function readQueue(): Promise<QueuedAck[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]') as QueuedAck[]; } catch { return []; }
}
async function writeQueue(q: QueuedAck[]): Promise<void> {
  try { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* best effort */ }
}

/** Queue a code that failed to post (offline), for retry on connectivity/foreground. */
export async function queueAck(code: string): Promise<void> {
  await writeQueue(enqueueAck(await readQueue(), code, Date.now()));
}

/** Try every queued code; drop the ones that land. Call on app foreground and on reconnect. */
export async function drainAckQueue(): Promise<void> {
  let q = await readQueue();
  for (const item of [...q]) {
    if (await postRollCallAck(item.code)) q = dropAck(q, item.code);
  }
  await writeQueue(q);
}

async function readLabels(): Promise<string[]> {
  try { return JSON.parse((await AsyncStorage.getItem(LABELS_KEY)) ?? '[]') as string[]; } catch { return []; }
}

/** Register the default category plus every coach label seen before, so pushed roll calls carry the
 *  "I'm Up" action even when the app is later killed. Call once at startup. Native only, best-effort. */
export async function ensureRollCallCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  await registerRollCallCategory(null); // the default RC::im-up
  for (const label of await readLabels()) await registerRollCallCategory(label);
}

/** Remember a coach label from an incoming roll-call push and register it now, so its custom button
 *  survives to the next launch. */
export async function rememberRollCallLabel(label: string | null): Promise<void> {
  if (Platform.OS === 'web' || !label) return;
  try {
    const next = mergeLabels(await readLabels(), label);
    await AsyncStorage.setItem(LABELS_KEY, JSON.stringify(next));
    await registerRollCallCategory(label);
  } catch { /* best effort */ }
}

/* ---------------------------------------------------------------- coach digest (2026-08-26) */

/** Register the coach's digest category: two buttons that act on a roll call without opening the
 *  app. Registered for EVERY signed-in user, not just coaches — iOS only draws buttons for a
 *  category registered on a PRIOR launch, and the app cannot know at startup whether the person
 *  holding the phone will be promoted to staff before their next launch. An unused category costs
 *  nothing; a missing one costs the whole feature the first time it matters. */
export async function registerCoachDigestCategory(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.setNotificationCategoryAsync(COACH_DIGEST_CATEGORY, [
      // "Got it" first: it is the safe, reversible one. iOS renders the first action closest to the
      // thumb, and the destructive-adjacent action ("push 12 teenagers") should never be the one a
      // half-awake coach hits by muscle memory.
      { identifier: COACH_ACTION_SEEN, buttonTitle: 'Got it', options: { opensAppToForeground: false } },
      { identifier: COACH_ACTION_NUDGE, buttonTitle: 'Nudge them', options: { opensAppToForeground: false } },
    ]);
  } catch { /* best effort */ }
}

/** POST a coach action to roll-call-coach. Resolves to `retry` only for failures worth replaying:
 *  a 429 means somebody already nudged (a success from the coach's point of view) and every 4xx
 *  means this code will never work, so neither is ever queued. */
export async function postCoachAction(
  code: string, action: CoachAction,
): Promise<'ok' | 'retry' | 'dead'> {
  if (!COACH_ENDPOINT || !code) return 'dead';
  try {
    const res = await fetch(COACH_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, action }),
    });
    if (res.ok) return 'ok';
    // 5xx is the server having a bad moment; the code is still good until its own deadline.
    return res.status >= 500 ? 'retry' : 'dead';
  } catch {
    return 'retry'; // no network — the classic lock-screen-in-a-dead-zone case
  }
}

async function readCoachQueue(): Promise<QueuedCoachAction[]> {
  try { return JSON.parse((await AsyncStorage.getItem(COACH_QUEUE_KEY)) ?? '[]') as QueuedCoachAction[]; } catch { return []; }
}
async function writeCoachQueue(q: QueuedCoachAction[]): Promise<void> {
  try { await AsyncStorage.setItem(COACH_QUEUE_KEY, JSON.stringify(q)); } catch { /* best effort */ }
}

/** Queue a coach action that could not be posted, for retry on foreground. */
export async function queueCoachAction(code: string, action: CoachAction): Promise<void> {
  await writeCoachQueue(enqueueCoachAction(await readCoachQueue(), code, action, Date.now()));
}

/** Try every queued coach action; drop the ones that land AND the ones that never will. A 'dead'
 *  result is dropped rather than retried forever — an expired code cannot become valid again, and
 *  leaving it in would let 50 dead codes evict live ones at the queue cap. */
export async function drainCoachQueue(): Promise<void> {
  let q = await readCoachQueue();
  for (const item of [...q]) {
    const r = await postCoachAction(item.code, item.action);
    if (r !== 'retry') q = dropCoachAction(q, item.code, item.action);
  }
  await writeCoachQueue(q);
}

/** Fire a coach action now, queueing it if the network is not there. The single entry point the
 *  notification handler uses, so the offline path can never be forgotten at a call site. */
export async function runCoachAction(code: string, action: CoachAction): Promise<void> {
  const r = await postCoachAction(code, action);
  if (r === 'retry') await queueCoachAction(code, action);
}
