/* The meal thread, polished (founder-approved mockup, 2026-09-25). Three contained changes, all
 * drawn by the four thread renderers through here, so none of them can drift:
 *
 *   1. NIA'S READ AS SHORT TEXTS. The opener used to arrive as one tall paragraph. The server now
 *      separates its parts with a paragraph break (meal-opener.ts composeOpener) and every renderer
 *      draws each part as its own bubble: one sender line on top, one face beside the last, 5px
 *      between them, the way a person texts a breakdown. The part carrying the ==highlight== is
 *      the move and wears a "Your move" label. Rows written before the change carry no breaks, so
 *      the read is split by rule instead (splitOldRead), and left whole when the rule is unsure.
 *   2. "SEEN BY", PER MEAL. The foot used to say "Your coach hasn't opened this yet." It now says
 *      nothing until someone on staff has opened THIS meal (0229 meal_views), then one quiet line.
 *   3. TAP TO ANSWER. Nia's question about a portion gets Small / Regular / Large under it, and the
 *      athlete's own meal thread gets three starters above the box. Every chip either sends or
 *      fills a message that starts "Nia,", so the addressing gate (ai-addressing.js) routes it.
 *
 * Pure: no DOM, no clock, no state. Loaded only by the thread screens, never at boot. */

import { richText, isAnalysisOpener, isMealSuggest } from './chat-view.js';

/* ---------------- 1. Nia's read, as short texts ---------------- */

const metaOf = (c) => {
  let m = c && c.meta;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return null; } }
  return m && typeof m === 'object' ? m : null;
};

/** Every ==mark== opens and closes inside one text, or the split would break the highlight. */
const marksClosed = (s) => (String(s).match(/==/g) || []).length % 2 === 0;

/* Sentences, the server's own rule (meal-opener.ts readCore): a terminator followed by whitespace
   ends one, so "3.5 oz" never splits. */
const SENTENCES = /[\s\S]*?[.!?…]+(?=\s|$)|[\s\S]+$/g;
/* The uncertainty line's openers, every branch meal-opener.ts uncertaintyLine can write. */
const UNSURE = /^(?:I['’]m (?:least sure|not sure|estimating)\b|If anything was cooked or portioned)/;
/* "One meal left." belongs to the move that follows it, not to the read before it. */
const LEAD_IN_MAX = 20;

/**
 * An old opener (one paragraph, no breaks) split the way the server now sends it: before the first
 * sentence carrying a ==highlight== (the move), and before the uncertainty line. Anything the rule
 * cannot place cleanly (a highlight spanning sentences, a read that is only the move) stays whole:
 * one bubble is never wrong, a bad split is.
 */
export function splitOldRead(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return [];
  const sentences = (s.match(SENTENCES) || [s]).map((x) => x.trim()).filter(Boolean);
  if (sentences.length < 2) return [s];
  const cuts = new Set();
  let moveAt = sentences.findIndex((x) => x.includes('=='));
  if (moveAt > 1 && sentences[moveAt - 1].length <= LEAD_IN_MAX) moveAt -= 1;
  if (moveAt > 0) cuts.add(moveAt);
  const unsureAt = sentences.findIndex((x, i) => i > 0 && UNSURE.test(x));
  if (unsureAt > 0) cuts.add(unsureAt);
  if (!cuts.size) return [s];
  const parts = [];
  let cur = [];
  sentences.forEach((x, i) => {
    if (cuts.has(i) && cur.length) { parts.push(cur.join(' ')); cur = []; }
    cur.push(x);
  });
  if (cur.length) parts.push(cur.join(' '));
  return parts.every(marksClosed) ? parts : [s];
}

/**
 * The texts one AI row is drawn as. A paragraph break is a text boundary on ANY row of Nia's (the
 * server's new opener, or a chat reply written in paragraphs); an old opener is split by rule.
 * One text means one ordinary bubble.
 */
export function splitAiText(text, { opener = false } = {}) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (!s) return [];
  if (/\n[ \t]*\n/.test(s)) {
    const parts = s.split(/\n[ \t]*\n+/).map((x) => x.trim()).filter(Boolean);
    return parts.every(marksClosed) ? parts : [s];
  }
  return opener ? splitOldRead(s) : [s];
}

/** Does this text carry the move (the one ==highlight== the opener writes)? */
export function isMovePart(part) {
  return /==[^=\n]+?==/.test(String(part || ''));
}

/** The texts a row draws, or null when it is one ordinary bubble. Only Nia's plain rows split:
 *  a what-to-eat card, a photo, anything that is not hers keeps its single bubble. */
export function partsOf(comment, { photo = false } = {}) {
  if (!comment || comment.role !== 'ai' || photo || isMealSuggest(comment)) return null;
  const parts = splitAiText(comment.text, { opener: isAnalysisOpener(comment) });
  return parts.length > 1 ? parts : null;
}

/**
 * The bubble markup for one row. `body` is the renderer's own single-bubble text (richText,
 * personText or a suggestion card) and is used whenever the row does not split. `head` rides the
 * first bubble (an escalation chip, a photo), `after` the last one (offer chips, the reaction pill).
 * Split parts are drawn through richText, exactly as the whole row would have been. "Your move"
 * labels the first part carrying the highlight, on Nia's READ only (her chat replies use the same
 * mark for emphasis and are not a move).
 */
export function bubblesHtml(comment, esc, { body = '', head = '', after = '', photo = false } = {}) {
  const parts = partsOf(comment, { photo });
  if (!parts) return `<div class="bubble">${head}${body}${after}</div>`;
  const opener = isAnalysisOpener(comment);
  let moved = false;
  const n = parts.length;
  return parts.map((p, i) => {
    const move = opener && !moved && isMovePart(p);
    if (move) moved = true;
    const cls = `bubble tp-b${i < n - 1 ? ' tp-mid' : ''}${move ? ' tp-move' : ''}`;
    return `<div class="${cls}">${i === 0 ? head : ''}${move ? '<span class="tp-lbl">Your move</span>' : ''}${richText(p, esc)}${i === n - 1 ? after : ''}</div>`;
  }).join('');
}

/* ---------------- 2. "Seen by", per meal ---------------- */

const NOT_STAFF = new Set(['athlete', 'guardian', 'parent', 'ai', 'teammate']);

/**
 * The one line at the foot of the athlete's meal thread: "Seen by Coach Grinch · 12:44 PM", or
 * "Seen by Coach Grinch and 1 other · 12:44 PM". '' until someone on staff has opened this meal.
 *
 *   views        0229 meal_views rows for this meal ({viewer_id, seen_at}); the athlete's own is
 *                skipped
 *   participants meal_thread_participants rows ({id, name, kind}); a viewer is named as the
 *                thread names them. Once the room is known, a viewer who is not staff in it (a
 *                guardian, someone who has left) is not claimed as a coach. With no room at all
 *                (the read failed) a viewer is the caller's noun ("Coach"), as authorName does.
 *   lastMineAt   ms of the athlete's newest own message. A view older than it is not shown: a
 *                receipt must never sit under words the coach could not have read (the 2026-08-06
 *                rule the day-level line already keeps).
 *   fmtTime      the screen's own clock formatter (local time)
 */
export function seenByLine({ views, selfId = null, participants = [], lastMineAt = 0, fmtTime = () => '', fallbackNoun = 'Coach' } = {}) {
  const room = Array.isArray(participants) ? participants.filter(Boolean) : [];
  const byId = new Map(room.map((p) => [String(p.id || ''), p]));
  const noun = String(fallbackNoun || 'Coach');
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const seen = new Map();
  for (const v of Array.isArray(views) ? views : []) {
    const id = v && v.viewer_id ? String(v.viewer_id) : '';
    if (!id || (selfId && id === String(selfId))) continue;
    const at = Date.parse(v.seen_at || '');
    if (!Number.isFinite(at) || at < (Number(lastMineAt) || 0)) continue;
    let name = '';
    const p = byId.get(id);
    if (p) {
      if (NOT_STAFF.has(String(p.kind || ''))) continue;
      name = String(p.name || '').trim() || Noun;
    } else if (room.length) {
      continue;
    } else {
      name = Noun;
    }
    const prev = seen.get(id);
    if (!prev || at > prev.at) seen.set(id, { name, at, iso: v.seen_at });
  }
  const list = [...seen.values()].sort((a, b) => b.at - a.at);
  if (!list.length) return '';
  const others = list.length - 1;
  const who = others ? `${list[0].name} and ${others} other${others === 1 ? '' : 's'}` : list[0].name;
  const t = String(fmtTime(list[0].iso) || '');
  return `Seen by ${who}${t ? ` · ${t}` : ''}`;
}

/* ---------------- 3. Tap to answer ---------------- */

export const SIZE_CHIPS = [
  { size: 'small', label: 'Small' },
  { size: 'regular', label: 'Regular' },
  { size: 'large', label: 'Large' },
];

/** The food a row's meta.ask names, cleaned for a sentence, or ''. Only Nia's opener carries one,
 *  and only a PORTION question gets size chips: "Small" does not answer "which product is it". */
export function askOf(comment) {
  if (!isAnalysisOpener(comment)) return null;
  const m = metaOf(comment);
  const a = m && m.ask;
  if (!a || typeof a !== 'object') return null;
  if (a.aspect != null && a.aspect !== 'portion') return null;
  const food = String(a.food || '').replace(/[<>"`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  return food ? { id: String(comment.id || ''), food } : null;
}

/**
 * The size chips, or null. They show only while Nia's question is the newest thing in the thread:
 * the latest painted message is her opener carrying an ask, the athlete has not written since
 * (nothing of theirs is sending either), and they have not already answered it this session.
 */
export function askChipsFor(visible, { sending = false, answered = null } = {}) {
  const list = Array.isArray(visible) ? visible.filter(Boolean) : [];
  const last = list[list.length - 1];
  if (!last || sending) return null;
  const ask = askOf(last);
  if (!ask) return null;
  if (answered && ask.id && answered.has(ask.id)) return null;
  return ask;
}

/** What a size chip sends. Starts "Nia," so the addressing gate hands it to her in any room. */
export function askReplyText(food, size) {
  return `Nia, the ${String(food || 'food').trim()} was a ${size} portion.`;
}

export function askChipsHtml(ask, esc) {
  if (!ask) return '';
  return `<div class="tp-chips tp-ask" role="group" aria-label="${esc(`How big was the ${ask.food}?`)}">${SIZE_CHIPS.map((c) =>
    `<button type="button" class="fx-chip tp-chip" data-tp-size="${c.size}" data-tp-ask="${esc(ask.id)}" data-tp-food="${esc(ask.food)}">${c.label}</button>`).join('')}</div>`;
}

/** The starters above the athlete's box. `send` goes at once; the others fill the box and wait. */
export const COMPOSER_CHIPS = [
  { id: 'next', label: 'What should I eat next?', text: 'Nia, what should I eat next?', send: true },
  { id: 'more', label: 'It was more', text: 'Nia, it was more than that: ', send: false },
  { id: 'wrong', label: 'Wrong food', text: 'Nia, that’s not right, it was ', send: false },
];

export function composerChipOf(id) {
  return COMPOSER_CHIPS.find((c) => c.id === id) || null;
}

/**
 * Whether the starters show. Only on the athlete's OWN meal thread (never a coach, trainer or
 * parent account, never another screen), only once the meal is synced, only when Nia is on for them
 * (consent is yes, not a minor waiting on a guardian), and only while the box is empty.
 */
export function composerChipsVisible({ authRole = null, ownMeal = false, mealId = null, consent = null, minorPending = false, draft = '' } = {}) {
  if (authRole === 'coach' || authRole === 'trainer' || authRole === 'parent') return false;
  if (!ownMeal || !mealId) return false;
  if (consent !== true || minorPending) return false;
  return !String(draft || '').trim();
}

export function composerChipsHtml(esc, { hidden = false } = {}) {
  return `<div class="tp-chips tp-cmp" id="tp-cmp" role="group" aria-label="Quick messages to Nia"${hidden ? ' hidden' : ''}>${COMPOSER_CHIPS.map((c) =>
    `<button type="button" class="fx-chip tp-chip" data-tp-cmp="${c.id}">${esc(c.label)}</button>`).join('')}</div>`;
}
