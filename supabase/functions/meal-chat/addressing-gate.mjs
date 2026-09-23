// OnStandard — the server half of "is anyone actually talking to the AI?".
//
// The decision itself lives in _shared/ai-addressing.mjs, which is byte-identical to the proto's
// copy (`npm run lint:mirror`). This file is the part that is only true on the server: reading a
// request body, working out whether the caller is new enough to be judged, and refusing the turn
// before it can cost a token.
//
// Split out of index.ts as a plain module so `npm run test:fn` can exercise it without Docker,
// without Deno and without an API key — the send-push/logic.mjs precedent. A gate nobody can test
// is a gate nobody can trust.
import { shouldAiRespond } from '../_shared/ai-addressing.mjs';

/** Everyone the transcript PROVES is in the room. The client sends the full roster (it has the
 *  participants RPC); this is the floor when it does not, so "thanks coach" can still be attributed
 *  to the coach who actually spoke in the thread. */
export function participantsFromThread(thread) {
  const seen = new Map();
  for (const t of (Array.isArray(thread) ? thread : [])) {
    if (!t || typeof t !== 'object') continue;
    const role = String(t.senderRole || '');
    if (!role) continue;
    const id = typeof t.senderId === 'string' ? t.senderId : null;
    const key = id || ('role:' + role);
    if (!seen.has(key)) seen.set(key, { id, name: typeof t.senderName === 'string' ? t.senderName : null, role });
  }
  return [...seen.values()];
}

/** Does this caller speak the structured contract? A client that predates it sends `{role, text}`
 *  thread entries and NO speaker, and there is nothing to judge — silently muting it would be a
 *  worse bug than the one being fixed, so it is left alone and the OTA brings it forward.
 *
 *  THE MARKER IS THE SPEAKER, NOT THE THREAD. This first asked the thread for a structured entry,
 *  which is false for an EMPTY thread — so the very first message anyone sent in a room skipped the
 *  server gate entirely and was answered. The client gate still held, but the half that exists
 *  precisely so the client cannot be the only word on it was absent exactly where a conversation
 *  starts. A speaker carrying senderRole is the contract, at any thread length. */
export function isStructured(body, _thread) {
  const speaker = body && typeof body.speaker === 'object' && body.speaker ? body.speaker : null;
  return !!speaker && typeof speaker.senderRole === 'string' && !!speaker.senderRole;
}

/**
 * The verdict for one meal-chat request, or null when this request is not the kind the gate judges.
 *
 * Null means "carry on and answer": the coach's own modes are addressed to the AI by construction
 * (coachAsk is a button press; drafts and correction receipts are not conversation at all), and a
 * pre-contract client cannot be judged.
 *
 * @param body    the parsed request body
 * @param context body.context
 * @param modes   { coachMode, correctionUpdate, receiptRows }
 * @returns {{shouldRespond, intendedRecipient, confidence, reason}|null}
 */
export function gateVerdict(body, context, modes) {
  const m = modes || {};
  if (m.coachMode || m.correctionUpdate || m.receiptRows) return null;
  const thread = context && Array.isArray(context.thread) ? context.thread : [];
  if (!isStructured(body, thread)) return null;
  const speaker = body.speaker;
  // A wordless photo reaches this function with a stand-in question ("I sent a photo..."), so the
  // speaker's OWN text is what was actually said when the client says it sent a photo.
  const photo = speaker.photo === true || (typeof body.photoPath === 'string' && !!body.photoPath.trim());
  const text = photo && typeof speaker.text === 'string'
    ? speaker.text
    : (body.question != null && String(body.question)) || speaker.text || '';
  return shouldAiRespond(
    { ...speaker, text, photo },
    {
      participants: Array.isArray(body.participants) && body.participants.length
        ? body.participants
        : participantsFromThread(thread),
      history: thread,
    },
  );
}
