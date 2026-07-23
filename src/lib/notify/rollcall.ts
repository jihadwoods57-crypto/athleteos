// OnStandard — lock-screen roll call, device half. Registers the "I'm Up" notification category,
// posts the signed code to roll-call-ack, and persists an offline retry queue. Native only.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rollCallCategoryId, enqueueAck, dropAck, mergeLabels, type QueuedAck } from '@/core/rollcall';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const ACK_ENDPOINT = supaUrl ? `${supaUrl}/functions/v1/roll-call-ack` : '';
const QUEUE_KEY = 'os:rollcall:ackQueue';
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
