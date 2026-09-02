// OnStandard — lock-screen roll call, pure half. Category id derivation (kept in sync with the
// reminder edge fn) and the offline ack-retry queue reducer. No RN imports.
const MAX_QUEUE = 50;

/** Stable notification-category id for a coach action label. MUST match rollCallCategoryId in
 *  supabase/functions/_shared/rollcall-category.ts. Deno's edge module graph and React Native's
 *  src/ cannot import each other, so this is a deliberate hand-kept mirror — the test below pins
 *  the same cases both sides must agree on. A drift here does not throw; it just means a push
 *  arrives with no buttons, which looks exactly like the feature not existing. */
export function rollCallCategoryId(label: string | null): string {
  const slug = (label ?? 'Im Up').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return 'RC::' + slug;
}

/** The button on a LATE roll-call push (0211): a fixed product label the device registers every
 *  launch, so rollCallCategoryId(CHECK_IN_LABEL) always has buttons when the "You're late" push
 *  lands. MUST match CHECK_IN_LABEL in supabase/functions/_shared/rollcall-category.ts. */
export const CHECK_IN_LABEL = 'Check in now';

/** The Android channel every roll-call push names (high importance, sound, visible on the lock
 *  screen). Created by the device at launch; the server stamps `channelId` on the push.
 *  MUST match ROLLCALL_CHANNEL in supabase/functions/_shared/rollcall-category.ts. */
export const ROLLCALL_CHANNEL = 'rollcall';

/** What to do with a lock-screen ack after the POST: keep it, retry it later, or drop it.
 *  null status = no network (retry). 5xx = the server's bad moment (retry). Any other non-2xx is a
 *  decided answer (expired code, closed roll call, flag off) that no retry can change (dead), and
 *  replaying it forever would keep a dead code in storage until the queue cap evicted a live one. */
export type AckOutcome = 'ok' | 'retry' | 'dead';
export function ackOutcome(status: number | null, okFlag: boolean): AckOutcome {
  if (status == null) return 'retry';
  if (status >= 200 && status < 300 && okFlag) return 'ok';
  if (status >= 500) return 'retry';
  return 'dead';
}

/** The background task name expo-notifications runs for a custom action pressed while the app is
 *  NOT in the foreground on Android (ExpoHandlingDelegate.handleNotificationResponse →
 *  runTaskManagerTasks). Registered once at startup; without it a killed app's "I'M UP" waits for
 *  the next launch. iOS background-launches the app for the action instead and replays the response
 *  to the listener, so the same router below handles both. */
export const ROLLCALL_BG_TASK = 'onstandard-rollcall-action';

/** What a notification response asks the app to do. Pure, so the live listener, the cold-start
 *  replay and the Android background task all route through one tested function.
 *    ack    a lock-screen "I'M UP" / "CHECK IN NOW": record it, never open the app
 *    coach  a coach digest action ("Got it" / "Nudge them"): act, never open the app
 *    route  a tap on the notification body: open the app on that screen
 *    null   nothing actionable */
export type NotificationIntent =
  | { kind: 'ack'; code: string; actionLabel: string | null }
  | { kind: 'coach'; code: string; action: CoachAction }
  | { kind: 'route'; route: string }
  | null;

export function routeNotificationResponse(resp: unknown): NotificationIntent {
  const r = resp as
    | { actionIdentifier?: string; notification?: { request?: { content?: { data?: Record<string, unknown> } } } }
    | null | undefined;
  const data = r?.notification?.request?.content?.data ?? {};
  const code = typeof data.code === 'string' ? data.code : '';
  const label = typeof data.action_label === 'string' ? data.action_label : null;
  if (r?.actionIdentifier === 'ACK' && code) return { kind: 'ack', code, actionLabel: label };
  const coach = coachActionFor(r?.actionIdentifier);
  if (coach && typeof data.coach_code === 'string' && data.coach_code) return { kind: 'coach', code: data.coach_code, action: coach };
  // Any other custom action must never fall through to a deep link: an action is not a tap.
  if (r?.actionIdentifier && r.actionIdentifier !== 'expo.modules.notifications.actions.DEFAULT' && r.actionIdentifier !== 'ACK') {
    return null;
  }
  const route = typeof data.route === 'string' && /^[a-z0-9/_-]{1,64}$/i.test(data.route) ? data.route : '';
  return route ? { kind: 'route', route } : null;
}

/** Button titles are uppercased at registration so the lock screen reads I'M UP / CHECK IN NOW.
 *  The category id is derived from the RAW label, so the server contract is unchanged. */
export function buttonTitleFor(label: string | null): string {
  return (label ?? "I'm Up").slice(0, 24).toUpperCase();
}

export type QueuedAck = { code: string; queuedAt: number };

export function enqueueAck(q: QueuedAck[], code: string, now: number): QueuedAck[] {
  if (!code || q.some((x) => x.code === code)) return q;
  return [...q, { code, queuedAt: now }].slice(-MAX_QUEUE);
}

export function dropAck(q: QueuedAck[], code: string): QueuedAck[] {
  return q.filter((x) => x.code !== code);
}

/** Merge a coach action-label into the persisted set: dedupe, drop empties, keep the most recent `cap`. */
export function mergeLabels(existing: string[], label: string, cap = 20): string[] {
  if (!label || existing.includes(label)) return existing;
  return [...existing, label].slice(-cap);
}

/* ---------------------------------------------------------------- coach digest (2026-08-26) */

/** The COACH digest category: "Got it" / "Nudge them" on the L3 escalation push, answered without
 *  opening the app. Fixed rather than derived — unlike the athlete's button, both labels are
 *  product copy, so there is nothing per-commitment to slug.
 *  MUST match COACH_DIGEST_CATEGORY in supabase/functions/_shared/rollcall-category.ts. */
export const COACH_DIGEST_CATEGORY = 'RCC::digest';

/** iOS action identifiers on that category. The device sends these back verbatim in the
 *  notification response, so they are a wire contract with ProtoApp's handler. */
export const COACH_ACTION_SEEN = 'DIGEST_SEEN';
export const COACH_ACTION_NUDGE = 'DIGEST_NUDGE';

export type CoachAction = 'seen' | 'nudge';

/** Every action this app registers, with the one option that matters: none of them opens the app.
 *  Asserted by the test so a future label cannot quietly regress into a foreground launch. */
export const ACTION_OPTIONS = { opensAppToForeground: false } as const;

/** Map an iOS action identifier to the verb roll-call-coach expects, or null when the response is
 *  a plain tap (which must route into the app instead). */
export function coachActionFor(actionIdentifier: string | null | undefined): CoachAction | null {
  if (actionIdentifier === COACH_ACTION_SEEN) return 'seen';
  if (actionIdentifier === COACH_ACTION_NUDGE) return 'nudge';
  return null;
}

export type QueuedCoachAction = { code: string; action: CoachAction; queuedAt: number };

/** Queue a coach action that failed to post. Keyed on code+action, so a coach who pressed "Got it"
 *  and then "Nudge them" on the same digest keeps both — deduping on code alone would silently
 *  drop the second, and they are not the same intent. */
export function enqueueCoachAction(
  q: QueuedCoachAction[], code: string, action: CoachAction, now: number,
): QueuedCoachAction[] {
  if (!code || q.some((x) => x.code === code && x.action === action)) return q;
  return [...q, { code, action, queuedAt: now }].slice(-MAX_QUEUE);
}

export function dropCoachAction(
  q: QueuedCoachAction[], code: string, action: CoachAction,
): QueuedCoachAction[] {
  return q.filter((x) => !(x.code === code && x.action === action));
}
