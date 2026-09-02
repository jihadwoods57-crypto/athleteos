/* Turning meal_comments rows into something that reads like a conversation — pure, no DOM.
 *
 * WHY THIS EXISTS. The thread used to render every non-athlete bubble as the literal string
 * "Coach" with a hardcoded "M" avatar, and stamped a timestamp under every single message. That
 * was survivable when a thread was a two-party accountability note capped at a handful of
 * messages. It is not survivable now: the athlete, their coach, the AI nutritionist — and later a
 * trainer, a parent, a dietitian — are all in one running conversation, and a person deserves to
 * know who is talking to them.
 *
 * The rules here are the ones every messaging app already taught people to expect:
 *   - a run of messages from the same person is ONE block, not a stack of repeated name labels
 *   - the clock appears when time has actually passed, not on every line
 *   - people have names
 * Getting these wrong doesn't break anything; it just makes the room feel like software instead
 * of like a staff. That is why they are pinned by tests.
 */

import { initialsOf } from './initials.js';

/** Messages closer together than this belong to the same moment — no clock between them. */
export const GROUP_GAP_MS = 10 * 60 * 1000;

/** How each kind of participant is introduced. `kind` comes from meal_thread_participants (0158),
 *  which returns real team_staff roles, plus the two client-side constants. */
const KINDS = {
  athlete: { ic: 'user', noun: 'You', access: 'This is their own log' },
  // 'sparkle', not 'bot': every facepile and thread bubble introduces the AI with the sparkle
  // glyph, and the members sheet opens FROM the facepile — the same participant must not change
  // faces mid-gesture.
  ai: { ic: 'sparkle', noun: 'AI Nutritionist', access: 'Reads every meal and answers questions' },
  head_coach: { ic: 'clipboard', noun: 'Head coach', access: 'Sees this athlete’s meals and scores' },
  assistant_coach: { ic: 'clipboard', noun: 'Assistant coach', access: 'Sees this athlete’s meals and scores' },
  s_and_c: { ic: 'dumbbell', noun: 'Strength coach', access: 'Sees this athlete’s meals and scores' },
  athletic_trainer: { ic: 'stethoscope', noun: 'Athletic trainer', access: 'Sees this athlete’s meals and scores' },
  team_admin: { ic: 'fileText', noun: 'Team admin', access: 'Sees this athlete’s meals and scores' },
  readonly: { ic: 'eye', noun: 'Staff', access: 'Can read this thread' },
  trainer: { ic: 'biceps', noun: 'Trainer', access: 'Sees this athlete’s meals and scores' },
  guardian: { ic: 'shield', noun: 'Parent or guardian', access: 'Sees this athlete’s meals and scores' },
};
const FALLBACK = { ic: 'user', noun: 'Staff', access: 'Can read this thread' };

export function participantMeta(kind) {
  return KINDS[String(kind || '')] || FALLBACK;
}

/** "Coach Brown" -> "CB". One letter is fine; three is a logo, not an avatar. */
export function initialsFor(name) {
  return initialsOf(name, '?');
}

/**
 * The facepile list: who to show, in the order a person would introduce them.
 * The athlete is always first and always reads "You" — it is their thread. The AI is a constant,
 * not a profile row, so it is appended here rather than invented by the database.
 */
export function participantList(rows, selfId) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const self = list.find((p) => p.id && selfId && p.id === selfId);
  const others = list.filter((p) => !(p.id && selfId && p.id === selfId));
  const out = [];
  if (self) out.push({ ...self, name: 'You', kind: 'athlete', self: true });
  for (const p of others) out.push({ ...p, kind: String(p.kind || '') });
  out.push({ id: null, name: 'AI Nutritionist', kind: 'ai' });
  return out;
}

/** The one-line header: "You, Coach Brown, AI Nutritionist". */
export function participantSummary(list) {
  return (list || []).map((p) => p.name).filter(Boolean).join(', ');
}

/**
 * Who wrote this message, for display.
 *
 * Falls back by ROLE rather than to a blank: an unresolved author is far better shown by their
 * role than as nothing, and the participants RPC can legitimately be unavailable (an older
 * database, an offline load, a staff member who has since left the team). `fallbackNoun` lets the
 * caller supply the word its own screen uses — "trainer" for a client, "coach" for a team athlete.
 */
export function authorName(comment, participants, selfId, fallbackNoun) {
  if (!comment) return '';
  if (comment.role === 'ai') return 'AI Nutritionist';
  if (comment.author_id && selfId && comment.author_id === selfId) return 'You';
  const hit = (participants || []).find((p) => p.id && p.id === comment.author_id);
  if (hit && hit.name && !hit.self) return hit.name;
  if (comment.role === 'athlete') return 'Athlete';
  // The operator lane is shared: the same `coach` role carries a team coach, a personal trainer,
  // and anyone else with view access. Calling a client's trainer "Coach" is a small lie the
  // client would notice, so the caller passes the noun their own screen already uses.
  const noun = String(fallbackNoun || 'Coach');
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * Lay a message list out the way a chat app does.
 *
 * Returns a flat list of `{type:'time', label, at}` and `{type:'msg', comment, ...}` items:
 *   - `firstOfRun` — show the name and avatar; a repeat within a run shows neither
 *   - `lastOfRun`  — the bubble that carries the tail/receipt
 *   - a time separator appears only when the gap since the last message is real (GROUP_GAP_MS)
 *
 * `fmtTime` is injected so this module holds no clock and no locale — the same input produces
 * the same output on a CI box in UTC and on a phone in New York.
 *
 * `fmtDay` is the COMPARE key ("did the day change?"); `fmtDayLabel` is what the separator
 * PRINTS. They used to be one function, and every call site passed its machine key — so a
 * thread crossing midnight printed "2026-7-24 · 11:58 PM" (zero-indexed month and all) as a
 * separator. When fmtDayLabel is absent, fmtDay still labels, which keeps old callers working.
 */
export function layoutThread(msgs, { fmtTime = () => '', fmtDay = null, fmtDayLabel = null } = {}) {
  const list = (Array.isArray(msgs) ? msgs : []).filter(Boolean);
  const out = [];
  let prev = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const at = Date.parse(c.created_at || '');
    const prevAt = prev ? Date.parse(prev.created_at || '') : NaN;
    const gap = !prev || !isFinite(at) || !isFinite(prevAt) || (at - prevAt) >= GROUP_GAP_MS;
    const newDay = fmtDay && prev && isFinite(at) && isFinite(prevAt) && fmtDay(at) !== fmtDay(prevAt);
    if ((gap || newDay) && isFinite(at)) {
      const label = newDay && fmtDay ? `${(fmtDayLabel || fmtDay)(at)} · ${fmtTime(c.created_at)}` : fmtTime(c.created_at);
      if (label) out.push({ type: 'time', label, at });
    }
    const sameSpeaker = prev && prev.author_id === c.author_id && prev.role === c.role && !gap && !newDay;
    const next = list[i + 1];
    const nextSame = next && next.author_id === c.author_id && next.role === c.role
      && isFinite(Date.parse(next.created_at || '')) && isFinite(at)
      && (Date.parse(next.created_at) - at) < GROUP_GAP_MS;
    out.push({ type: 'msg', comment: c, firstOfRun: !sameSpeaker, lastOfRun: !nextSame });
    prev = c;
  }
  return out;
}

/** The one human day label every thread shares: "Today", "Yesterday", then "Monday, Aug 24".
 *  `now` is an explicit argument (tests pass it; screens take the default) — the one deliberate
 *  relaxation of this module's no-clock rule, contained to a default parameter. The weekday line
 *  uses the device locale on purpose: a separator is glanceable furniture, not record data. */
export function dayLabelOf(ms, now = Date.now()) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const today = new Date(now);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(today.getTime() - 86400000);
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Is this the AI's re-read after a correction? (0157 `meta.t`.) */
export function isAnalysisUpdate(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'analysis_update');
}

/** Is this the AI's original read of the plate? */
export function isAnalysisOpener(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'analysis');
}

/** Is this the AI's decline-and-hand-off message (flag_for_coach)? */
export function isEscalated(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'escalated');
}

/* ---------------- Memory offers (2026-09-02) ----------------
   The AI heard a lasting fact ("I'm lactose intolerant") and wrote it as a PENDING memory fact.
   meal-chat marks the reply row meta { t: 'memory_offer', factId, kind, value, ask } so the two
   athlete-facing renderers can draw a Yes / No under the bubble. The chips are built here, once,
   because the last time a bubble affordance lived in one renderer only (read-more) it took six
   weeks to notice the other three never had it. Only `role: 'ai'` rows count: clients can write
   meta on their own rows, and an athlete must not be able to forge an offer about themselves. */
export function isMemoryOffer(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'memory_offer' && comment.meta.factId);
}

/** { id, kind, value, ask } for an offer row, or null. */
export function memoryOfferOf(comment) {
  if (!isMemoryOffer(comment)) return null;
  const m = comment.meta;
  const value = String(m.value || '').trim();
  return {
    id: String(m.factId),
    kind: String(m.kind || ''),
    value,
    ask: String(m.ask || '').trim() || (value ? `Remember that: ${value}?` : 'Remember that?'),
  };
}

/** The confirmation under an offer bubble. `esc` is passed in, as bubblePhotoHtml takes it, so
 *  this module stays free of a components.js import. Tapping is delegated on `[data-fact]`,
 *  the selector the meal thread has used for pending facts since 0019 landed. */
export function memoryOfferChips(offer, esc) {
  if (!offer || !offer.id) return '';
  return `<div class="mo-ask">${esc(offer.ask)}</div>
    <div class="fq-chips">
      <button type="button" class="fx-chip" data-fact="${esc(offer.id)}" data-keep="1">Yes, remember</button>
      <button type="button" class="fx-chip" data-fact="${esc(offer.id)}" data-keep="0">No, one-off</button>
    </div>`;
}

/**
 * The message an update is answering — the athlete's correction just above it.
 *
 * Shown as a quoted line so the fix and the new read read as one exchange rather than two
 * unrelated remarks. Returns null when there is nothing to quote, which is the honest outcome
 * for a correction made through the chip panel rather than typed into the thread.
 */
export function quotedFor(comment, msgs) {
  if (!isAnalysisUpdate(comment)) return null;
  const list = Array.isArray(msgs) ? msgs : [];
  const i = list.indexOf(comment);
  if (i < 1) return null;
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    if (list[j] && list[j].role === 'athlete' && list[j].text) return list[j];
  }
  return null;
}
