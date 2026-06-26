// AthleteOS — messaging model (P4, pure TS, no RN imports).
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
