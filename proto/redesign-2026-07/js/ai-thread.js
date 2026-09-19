/* OnStandard — the ONE way a thread becomes context for the AI, with everyone's name still on it.
 *
 * WHAT IT REPLACES. Four renderers each built their own transcript, and all four built the same
 * lossy thing:
 *
 *     thread: threadMessages(comments).slice(-20).map((c) => ({ role: c.role, text: c.text }))
 *
 * Two coaches, a trainer and a parent all collapse to `role:'coach'`. A reply to the AI looks
 * exactly like a reply to a person. "Thank you Coach" arrives with nothing attached that says who
 * "Coach" is or that the line above it was theirs. The model was asked to behave like a member of
 * the room while being told less about the room than any person in it could see on screen.
 *
 * So this builds the transcript ONCE, with identity attached, and every renderer uses it. The same
 * entries feed the addressing decision (ai-addressing.js) on both the client and the server, which
 * is what makes the decision reproducible rather than a guess made twice.
 *
 * Pure: comments and participants in, plain objects out. No DOM, no clock, no fetch.
 */
import { mentionsIn, shouldAiRespond } from './ai-addressing.js';

/** Rows that are not speech. A reaction is an emoji, a private note never reaches the athlete, and
 *  the receipt/analysis rows are the app writing to itself — none of them is a conversational turn,
 *  but the receipt rows ARE worth showing the model as context, flagged as system. */
const NOT_SPEECH = ['reaction', 'note'];

/** meta.t values the app writes for its own records rather than as somebody talking. */
const SYSTEM_META = ['analysis_update', 'correction_receipt', 'pro_correction'];

const metaOf = (c) => {
  const m = c && c.meta;
  if (!m) return {};
  if (typeof m === 'string') { try { return JSON.parse(m) || {}; } catch { return {}; } }
  return typeof m === 'object' ? m : {};
};

/**
 * One thread row, as the AI should see it.
 *
 * @param comment  a meal_comments row
 * @param opts     { participants, selfId, fallbackNoun, aiName }
 * @returns {{ id, senderId, senderName, senderRole, text, at, system, replyToMessageId, replyToSender, mentions }}
 */
export function describeMessage(comment, opts) {
  const c = comment || {};
  const o = opts || {};
  const meta = metaOf(c);
  return {
    id: c.id || null,
    senderId: c.role === 'ai' ? null : (c.author_id || null),
    // The NAME, not "You" — the model is not the reader, and a transcript full of "You" is exactly
    // the identity loss this module exists to fix. authorName() in chat-view.js is for the screen.
    senderName: speakerName(c, o),
    senderRole: senderRole(c, o),
    text: String(c.text == null ? '' : c.text).slice(0, 300),
    at: c.created_at || null,
    system: SYSTEM_META.indexOf(String(meta.t || '')) !== -1,
    // No composer writes a per-message reply target yet, so this is null in practice today. It is
    // in the contract because the addressing decision ranks it ABOVE every guess, so the day a
    // reply affordance ships, the decision gets better with no change to the gate.
    replyToMessageId: meta.replyTo || meta.reply_to || null,
    replyToSender: meta.replyToSender || null,
    mentions: mentionsIn(c.text),
  };
}

/** The speaker's real name where the thread knows it, and an honest role noun where it does not. */
function speakerName(comment, opts) {
  const c = comment || {};
  const o = opts || {};
  if (c.role === 'ai') return o.aiName || 'AI Nutritionist';
  const hit = (o.participants || []).find((p) => p && p.id && p.id === c.author_id);
  if (hit && hit.name) return hit.name;
  if (c.role === 'athlete') return o.athleteName || 'Athlete';
  const noun = String(o.fallbackNoun || 'Coach');
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/** The participant's OWN role where the thread knows it — a trainer and a team coach both ride the
 *  'coach' column, and telling them apart is the difference between the AI reading "Coach Alex" and
 *  reading "Trainer Alex" in a client's private thread. */
function senderRole(comment, opts) {
  const c = comment || {};
  const o = opts || {};
  if (c.role === 'ai') return 'ai';
  if (c.role === 'athlete') return 'athlete';
  const hit = (o.participants || []).find((p) => p && p.id && p.id === c.author_id);
  if (hit && hit.role && hit.role !== 'coach') return String(hit.role);
  return String(o.fallbackNoun || c.role || 'coach').toLowerCase();
}

/**
 * The last `limit` speech rows of a thread, oldest -> newest, with identity preserved.
 * Reactions and private notes are dropped; system receipts are kept and flagged.
 */
export function buildAiThread(comments, opts, limit) {
  const rows = (Array.isArray(comments) ? comments : [])
    .filter((c) => c && NOT_SPEECH.indexOf(String(c.kind || '')) === -1 && c.text);
  const n = typeof limit === 'number' && limit > 0 ? limit : 20;
  return rows.slice(-n).map((c) => describeMessage(c, opts));
}

/**
 * The message the composer is about to send, in the same shape, before it exists as a row.
 * `role` is the sender's own role on this thread ('athlete' from an athlete composer).
 */
export function describeOutgoing(text, sender) {
  const s = sender || {};
  return {
    id: null,
    senderId: s.id || null,
    senderName: s.name || 'Athlete',
    senderRole: s.role || 'athlete',
    text: String(text == null ? '' : text),
    at: null,
    system: false,
    replyToMessageId: s.replyToMessageId || null,
    replyToSender: s.replyToSender || null,
    mentions: mentionsIn(text),
  };
}

/**
 * Everyone who can read this thread, as the addressing decision wants them: id, name, role — with
 * the AI included, because "is this message for the AI" is answered partly by knowing the AI is a
 * participant with a name rather than an implicit backstop.
 */
export function aiParticipants(participants, opts) {
  const o = opts || {};
  const list = (Array.isArray(participants) ? participants : [])
    .filter((p) => p && p.id)
    .map((p) => ({ id: p.id, name: p.name || null, role: p.kind === 'ai' ? 'ai' : String(p.role || p.kind || 'coach') }));
  if (!list.some((p) => p.role === 'ai')) list.push({ id: null, name: o.aiName || 'AI Nutritionist', role: 'ai' });
  return list;
}

/* The thread participants RPC returns team_staff's OWN role string ('head_coach',
   'position_coach', …) and 'guardian'. The addressing decision reasons in the words people
   actually type, so those collapse to the noun an athlete would use. */
const ROLE_ALIASES = {
  head_coach: 'coach', assistant_coach: 'coach', position_coach: 'coach', strength_coach: 'coach',
  coach: 'coach', trainer: 'trainer', guardian: 'parent', parent: 'parent',
  dietitian: 'dietitian', nutritionist: 'nutritionist', athlete: 'athlete', ai: 'ai',
};
export const normalizeRole = (role) => {
  const r = String(role || '').toLowerCase().trim();
  if (ROLE_ALIASES[r]) return ROLE_ALIASES[r];
  return r.indexOf('coach') !== -1 ? 'coach' : (r || 'coach');
};

/**
 * ONE call, for every composer: build the identity-preserving transcript, describe the message
 * about to be sent, and decide whether the AI is being spoken to.
 *
 * Every athlete composer in the app used to end in an unconditional `askAI(text)`. They now end in
 * `if (turn.decision.shouldRespond)`, and they all reach that decision through here so the three
 * threads cannot drift into three different ideas of when the AI should talk.
 *
 * @returns {{ decision, thread, outgoing, participants }} — `thread` and `outgoing` go to
 *          meal-chat as context so the server can reach the same verdict independently.
 */
export function decideAiTurn(opts) {
  const o = opts || {};
  const people = aiParticipants(
    (Array.isArray(o.participants) ? o.participants : []).map((p) => ({
      id: p && p.id, name: p && p.name, role: normalizeRole(p && (p.role || p.kind)),
    })),
    { aiName: o.aiName },
  );
  const buildOpts = {
    participants: people,
    fallbackNoun: o.fallbackNoun || 'Coach',
    aiName: o.aiName,
    athleteName: o.athleteName,
  };
  const thread = buildAiThread(o.comments, buildOpts, o.limit);
  const outgoing = describeOutgoing(o.text, o.self || { role: 'athlete' });
  const decision = shouldAiRespond(outgoing, { participants: people, history: thread, aiName: o.aiName });
  return { decision, thread, outgoing, participants: people };
}
