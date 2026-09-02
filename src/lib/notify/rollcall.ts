// OnStandard — lock-screen roll call, device half. Registers the "I'm Up" notification category,
// posts the signed code to roll-call-ack, and persists an offline retry queue. Native only.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  rollCallCategoryId, enqueueAck, dropAck, mergeLabels, type QueuedAck,
  COACH_DIGEST_CATEGORY, COACH_ACTION_SEEN, COACH_ACTION_NUDGE,
  enqueueCoachAction, dropCoachAction, type CoachAction, type QueuedCoachAction,
  CHECK_IN_LABEL, ROLLCALL_CHANNEL, ackOutcome, type AckOutcome,
  ROLLCALL_BG_TASK, ACTION_OPTIONS, buttonTitleFor, routeNotificationResponse,
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
    // ACTION_OPTIONS: opensAppToForeground:false. Acknowledging roll call must never visually
    // launch OnStandard; the tap is recorded from the lock screen and the notification dismisses.
    await Notifications.setNotificationCategoryAsync(id, [
      { identifier: 'ACK', buttonTitle: buttonTitleFor(label), options: { ...ACTION_OPTIONS } },
    ]);
  } catch { /* best effort */ }
  return id;
}

/** POST the code to roll-call-ack with the moment of the tap on the device clock. The server keeps
 *  its own receipt as the verdict's input; the device time is evidence for a delayed sync only.
 *  'ok' on a recorded ack (review included); 'retry' when a later attempt could still land it (no
 *  network, 5xx); 'dead' for a decided refusal (expired, closed with no evidence, flag off). */
export async function postRollCallAck(code: string, tappedAtMs?: number): Promise<AckOutcome> {
  if (!ACK_ENDPOINT || !code) return 'dead';
  try {
    const body: Record<string, unknown> = { code };
    if (typeof tappedAtMs === 'number' && Number.isFinite(tappedAtMs)) body.tapped_at = new Date(tappedAtMs).toISOString();
    const res = await fetch(ACK_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return ackOutcome(res.status, out.ok === true);
  } catch { return 'retry'; }
}

/** The Android channel roll-call pushes name (0211). Without it a 6 AM push rides the default
 *  channel at default importance: no heads-up, no sound on some launchers. Idempotent; Android only.
 *  bypassDnd is deliberately NOT requested: OnStandard does not claim to override Do Not Disturb. */
export async function ensureRollCallChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.setNotificationChannelAsync(ROLLCALL_CHANNEL, {
      name: 'Roll call',
      description: 'Wake-up roll calls and check-ins your coach scheduled.',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  } catch { /* best effort */ }
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

/** Try every queued code; drop the ones that land AND the ones that never will (an expired code
 *  or a closed roll call cannot become valid again). Call on app foreground and on reconnect. */
export async function drainAckQueue(): Promise<void> {
  let q = await readQueue();
  for (const item of [...q]) {
    // The queue entry's `queuedAt` IS the moment of the tap; the replay carries it as evidence.
    if (await postRollCallAck(item.code, item.queuedAt) !== 'retry') q = dropAck(q, item.code);
  }
  await writeQueue(q);
}

/** Fire an ack now, queueing it only when a retry could still land it. The single entry point the
 *  notification handler, the cold-start replay and the Android background task all use, so the
 *  offline path can never be forgotten at a call site. `tappedAt` defaults to now: the tap moment. */
export async function runRollCallAck(code: string, tappedAt: number = Date.now()): Promise<void> {
  const r = await postRollCallAck(code, tappedAt);
  if (r === 'retry') await writeQueue(enqueueAck(await readQueue(), code, tappedAt));
}

/* ---------------------------------------------------------------- Android background task
   expo-notifications runs the registered task for a custom action pressed while the app is not in
   the foreground (ExpoHandlingDelegate.handleNotificationResponse → runTaskManagerTasks), which
   includes the app being killed. Without this, an Android "I'M UP" from a dead app sat as a pending
   response until the next launch. Defined at module load (TaskManager requires that) and registered
   once at startup. iOS does not use this path: it background-launches the app for the action and
   the normal listener / cold-start replay in ProtoApp handles it. */
let BG_DEFINED = false;
export function defineRollCallBackgroundTask(): void {
  if (Platform.OS === 'web' || BG_DEFINED) return;
  BG_DEFINED = true;
  try {
    const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
    TaskManager.defineTask(ROLLCALL_BG_TASK, async ({ data, error }: { data?: unknown; error?: unknown }) => {
      if (error || !data) return;
      // The task receives the serialized NotificationResponse; route it exactly as a live one.
      const intent = routeNotificationResponse(data);
      if (intent?.kind === 'ack') await runRollCallAck(intent.code);
      else if (intent?.kind === 'coach') await runCoachAction(intent.code, intent.action);
      // A plain tap opens the app; nothing to do here.
    });
  } catch { /* best effort: no task-manager on this binary means the pending-response path */ }
}
defineRollCallBackgroundTask();

export async function registerRollCallBackgroundTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.registerTaskAsync(ROLLCALL_BG_TASK);
  } catch { /* best effort */ }
}

async function readLabels(): Promise<string[]> {
  try { return JSON.parse((await AsyncStorage.getItem(LABELS_KEY)) ?? '[]') as string[]; } catch { return []; }
}

/** Register the default category plus every coach label seen before, so pushed roll calls carry the
 *  "I'm Up" action even when the app is later killed. Call once at startup. Native only, best-effort. */
export async function ensureRollCallCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  await ensureRollCallChannel();
  await registerRollCallCategory(null); // the default RC::im-up
  // The late push's button (0211). Product copy, so it is never "remembered" from a push; it has
  // to be registered here or the "You're late" notification arrives with no way to answer it.
  await registerRollCallCategory(CHECK_IN_LABEL);
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
      { identifier: COACH_ACTION_SEEN, buttonTitle: 'Got it', options: { ...ACTION_OPTIONS } },
      { identifier: COACH_ACTION_NUDGE, buttonTitle: 'Nudge them', options: { ...ACTION_OPTIONS } },
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
