// AthleteOS — messaging delivery seam (P4, inert unless the backend is live).
//
// The pure thread/message model lives in core/messaging.ts; this is the DEVICE/
// network half: actually delivering an outgoing message to a real person. That is
// flag-gated to the P0 backend (isBackendLive) and stays the founder step — with
// the flag off, deliverMessage is a no-op and the message is kept locally + honestly
// labeled "not yet delivered" (see messageDeliveryNote). LOCAL only by default:
// nothing here pushes/emails a real person.
//
// Activate (founder, at go-live):
//   1) implement deliverMessage against the backend (insert into a `messages` table
//      under RLS so only the thread's two parties can read it; optionally a push)
//   2) it already gates on isBackendLive, so it stays inert until the flag flips.
import { isBackendLive } from '@/lib/supabase';
import type { ChatMsg } from '@/core';

/** Whether outgoing messages can actually be delivered (backend live). */
export const isMessagingLive = isBackendLive;

/**
 * Deliver an outgoing message to the connected team. No-op until the backend is
 * live; returns whether it was actually delivered (false = kept on device only).
 * Never sends to a real person while isBackendLive is off.
 */
export async function deliverMessage(_msg: ChatMsg): Promise<boolean> {
  if (!isBackendLive) return false;
  // Real impl (once wired): persist the message under RLS for the two parties and
  // optionally trigger a push. Returns true on a confirmed write.
  return false;
}
