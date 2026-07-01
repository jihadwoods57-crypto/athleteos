// OnStandard — messaging model (P4, pure TS, no RN imports).
//
// Lightweight two-way messaging between an overseer (coach/parent/trainer) and an
// athlete. This is the PURE model + compose/validation/thread helpers; the actual
// delivery to a real person (push/email) is flag-gated to the P0 backend and stays
// the founder step (see src/lib/messaging). With the backend off, a sent message
// is saved locally and honestly labeled "not yet delivered" rather than pretending
// it reached anyone. Copy follows the shipped guardrails: factual, no em dash.
import type { ChatMsg, ChatWho } from './types';

/** Longest message we accept; keeps a thread glanceable and the input bounded. */
export const MAX_MESSAGE_LEN = 1000;

/** Delivery state of an outgoing message. 'local' = saved on device, not yet sent. */
export type MessageStatus = 'local' | 'sending' | 'sent';

/**
 * Normalize a draft into a sendable message body, or null if it is empty / only
 * whitespace. Collapses trailing whitespace and caps the length so a runaway paste
 * can't bloat the thread. Pure — the single guard both the store and any future
 * backend path share.
 */
export function composeMessage(draft: string): string | null {
  const trimmed = (draft ?? '').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_MESSAGE_LEN ? trimmed.slice(0, MAX_MESSAGE_LEN) : trimmed;
}

/** Append a message from `who` to a thread, ignoring an empty/whitespace draft. Non-mutating. */
export function appendMessage(thread: ChatMsg[], who: ChatWho, draft: string): ChatMsg[] {
  const text = composeMessage(draft);
  if (text === null) return thread;
  return [...thread, { who, text }];
}

/**
 * Honest one-line delivery status for the composer, so the UI never implies a
 * message reached a real person while the backend is off. When live, messages
 * deliver to the connected team; when off, they are kept on this device.
 */
export function messageDeliveryNote(isBackendLive: boolean): string {
  return isBackendLive
    ? 'Delivered to your connected team.'
    : 'Saved on this device. Connect your team to deliver messages.';
}

/** At or above this age an athlete is treated as an adult for messaging governance. */
export const MESSAGING_ADULT_AGE = 18;

/**
 * Who is in a thread, for the beta messaging governance check. `counterpartAuthorized`
 * is true only when the other party is an established relationship for THIS athlete —
 * a coach/trainer on a team the athlete belongs to, or an active guardian.
 */
export interface MessagingParticipants {
  athleteAge: number | null | undefined;
  counterpartAuthorized: boolean;
}

/**
 * Beta messaging governance (Trust & safety, Tier 2). Day-2 shipped athlete<->overseer
 * messaging with no age gate, so a minor athlete could sit in an unsupervised thread
 * with an arbitrary adult. For the closed beta (HS coaches + their athletes), a minor's
 * ONLY permitted counterpart is an authorized relationship; everyone else is blocked.
 * Fail-closed: a missing / non-finite age is treated as a minor. The real enforcement
 * is server-side RLS (migration 0006); this is the shared rule the UI reads so it never
 * offers a channel the backend would reject.
 */
export function messagingAllowed(p: MessagingParticipants): boolean {
  const age = typeof p.athleteAge === 'number' && Number.isFinite(p.athleteAge) ? p.athleteAge : 0;
  if (age >= MESSAGING_ADULT_AGE) return true; // adult athlete: standard channel
  return p.counterpartAuthorized === true; // minor: only an authorized relationship
}

/** Honest one-line note explaining why a minor's thread is limited, or '' when allowed. */
export function messagingGateNote(allowed: boolean): string {
  return allowed
    ? ''
    : 'Messaging with an athlete under 18 is limited to their coach and guardians.';
}
