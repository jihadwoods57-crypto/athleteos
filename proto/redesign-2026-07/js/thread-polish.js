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
 *      fills a message that opens by addressing her ("@Nia" or "Nia,"), so the addressing gate routes it.
 *
 * Pure: no DOM and no clock (the views cache takes its clock and its fetch from the caller).
 * Loaded only by the thread screens, never at boot. */

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
/**
 * An old opener (one paragraph, no breaks) split the way the server now sends it: the sentence
 * carrying the ==highlight== is the move and stands alone (from its start to its own end, never a
 * short sentence pulled in beside it), whatever follows it (the pattern line) is its own text, and
 * the uncertainty line is the last. A cut that would fall inside a mark leaves the row whole: one
 * bubble is never wrong, a bad split is.
 */
export function splitOldRead(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return [];
  const sentences = (s.match(SENTENCES) || [s]).map((x) => x.trim()).filter(Boolean);
  if (sentences.length < 2) return [s];
  const cuts = new Set();
  const moveAt = sentences.findIndex((x) => x.includes('=='));
  if (moveAt !== -1) {
    // The move runs to the end of the sentence that closes its highlight.
    let end = moveAt;
    while (end < sentences.length - 1 && !marksClosed(sentences.slice(moveAt, end + 1).join(' '))) end += 1;
    if (moveAt > 0) cuts.add(moveAt);
    if (end + 1 < sentences.length) cuts.add(end + 1);
  }
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

/** Does this text carry the move (the one ==highlight== the opener writes)? The day line's
 *  "==That closes out your protein for the day==" is highlighted too, but it is news, not a thing
 *  to do, so it is not a move and wears no label. */
export function isMovePart(part) {
  const m = /==([^=\n]+?)==/.exec(String(part || ''));
  return !!m && !/^\s*that closes out\b/i.test(m[1]);
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
export function bubblesHtml(comment, esc, { body = '', head = '', after = '', photo = false, moveLabel = 'Your move' } = {}) {
  const parts = partsOf(comment, { photo });
  if (!parts) return `<div class="bubble">${head}${body}${after}</div>`;
  const opener = isAnalysisOpener(comment);
  let moved = false;
  const n = parts.length;
  return parts.map((p, i) => {
    const move = opener && !moved && isMovePart(p);
    if (move) moved = true;
    const cls = `bubble tp-b${i < n - 1 ? ' tp-mid' : ''}${move ? ' tp-move' : ''}`;
    return `<div class="${cls}">${i === 0 ? head : ''}${move ? `<span class="tp-lbl">${esc(moveLabel)}</span>` : ''}${richText(p, esc)}${i === n - 1 ? after : ''}</div>`;
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
 *                thread names them, and a viewer who is not staff in the room (a guardian,
 *                someone who has left) is never claimed as a coach.
 *   participantsReady  false until the room has loaded. The line WAITS for it: it never says
 *                "Seen by Coach" for want of a name, and an empty room names nobody.
 *   lastMineAt   ms of the athlete's newest own message. A view older than it is not shown: a
 *                receipt must never sit under words the coach could not have read (the 2026-08-06
 *                rule the day-level line already keeps).
 *   fmtTime      the screen's own clock formatter (local time)
 */
export function seenByLine({ views, selfId = null, participants = [], participantsReady = true, lastMineAt = 0, fmtTime = () => '' } = {}) {
  const room = Array.isArray(participants) ? participants.filter(Boolean) : [];
  if (!participantsReady || !room.length) return '';
  const byId = new Map(room.map((p) => [String(p.id || ''), p]));
  const seen = new Map();
  for (const v of Array.isArray(views) ? views : []) {
    const id = v && v.viewer_id ? String(v.viewer_id) : '';
    if (!id || (selfId && id === String(selfId))) continue;
    const at = Date.parse(v.seen_at || '');
    if (!Number.isFinite(at) || at < (Number(lastMineAt) || 0)) continue;
    const p = byId.get(id);
    const name = p && !NOT_STAFF.has(String(p.kind || '')) ? String(p.name || '').trim() : '';
    if (!name) continue;
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
 * The same Nia gate as the starters: her consent is yes and no guardian approval is pending.
 */
export function askChipsFor(visible, { sending = false, answered = null, consent = null, minorPending = false } = {}) {
  if (consent !== true || minorPending) return null;
  const list = Array.isArray(visible) ? visible.filter(Boolean) : [];
  const last = list[list.length - 1];
  if (!last || sending) return null;
  const ask = askOf(last);
  if (!ask) return null;
  if (answered && ask.id && answered.has(ask.id)) return null;
  return ask;
}

/** What a size chip sends: "@Nia the oats portion was regular." An @mention of her, so the
 *  addressing gate hands it to her in any room, and "the <food> portion was" reads right for a
 *  plural food ("the oats was" did not). */
export function askReplyText(food, size) {
  return `@Nia the ${String(food || 'food').trim()} portion was ${size}.`;
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

/**
 * One tap, one message, through the screen's own send path (chat-live.js beginSend, then the
 * screen's deliver). The chip is spent (`onAccepted`) only once the send is accepted: with a send
 * already in flight nothing happens and the chips stay; a repeat of what just went says so
 * (`onDuplicate`). Returns true when the message went.
 */
export async function quickSend(key, text, { beginSend, deliver, onAccepted = null, onDuplicate = null } = {}) {
  const claim = beginSend(key, { text, photo: null, replyTo: null });
  if (!claim || !claim.ok) {
    if (claim && claim.reason === 'duplicate' && typeof onDuplicate === 'function') onDuplicate();
    return false;
  }
  if (typeof onAccepted === 'function') onAccepted();
  await deliver(claim.item);
  return true;
}

/* ---------------- 4. Why this matters (goals and eating plan A2, 2026-09-25) ----------------
   Nia's opener carries one deterministic sentence in meta.why (meal-opener.ts, opener-why.ts): why
   the move she just made matters for THIS athlete's goal. It is not part of the text, so it draws as
   a quiet chip under her bubbles, "Why this matters for gaining", and a tap opens it into a bubble in
   the goal accent (teal); another tap closes it. The athlete's OWN threads only: the coach's view
   hides it (their thread is the plate and the athlete's words; the why is teaching aimed at the
   athlete, and "Why (for their goal)" would be one more thing between the coach and the reply). */

const WHY_LABEL = { gain: 'gaining', lose: 'losing fat', maintain: 'maintaining', perform: 'performing', train: 'your training' };

/** The why an opener row carries, or null. A provable minor is always "for your training", whatever
 *  the row says (the server already sends a minor the training family; this holds for an old row). */
export function whyOf(comment, { minor = false } = {}) {
  if (!isAnalysisOpener(comment)) return null;
  const m = metaOf(comment);
  const w = m && m.why;
  if (!w || typeof w !== 'object') return null;
  const text = String(w.text || '').replace(/[<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const key = minor ? 'train' : (Object.prototype.hasOwnProperty.call(WHY_LABEL, w.goal) ? w.goal : 'perform');
  return { id: String(comment.id || ''), text, label: `Why this matters for ${WHY_LABEL[key]}` };
}

/** The chips a reader opened, so a repaint keeps them open. Session-only, per row id. */
const WHY_OPEN = new Set();
const CHEV = '<svg class="tp-why-cv" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The chip, collapsed or open. One button: the whole bubble is the tap target both ways. */
export function whyChipHtml(why, esc) {
  if (!why) return '';
  const open = WHY_OPEN.has(why.id);
  return `<div class="msg ai tp-whyrow"><div class="av-sp"></div><div class="stack"><button type="button" class="tp-why${open ? ' open' : ''}" data-tp-why="${esc(why.id)}" aria-expanded="${open ? 'true' : 'false'}"><span class="tp-why-h">${esc(why.label)}${CHEV}</span><span class="tp-why-t">${esc(why.text)}</span></button></div></div>`;
}

/** A tap inside a thread: when it lands on a why chip, flip it in place (no repaint) and return true. */
export function toggleWhyAt(target) {
  const b = target && target.closest ? target.closest('[data-tp-why]') : null;
  if (!b) return false;
  const id = b.getAttribute('data-tp-why') || '';
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  b.classList.toggle('open', open);
  if (open) WHY_OPEN.add(id); else WHY_OPEN.delete(id);
  return true;
}

/* ---------------- who has seen this meal, read once and painted where it lives ----------------
   The meal page mounts again on every render, so two mounts can race one read. The rows live in
   one cache per screen module (one read in flight, shared, 30s fresh); what each THREAD last
   painted lives on that thread element. A mount whose thread was replaced never repaints, and the
   live one repaints whenever what it shows differs from what the cache now holds. */
export function makeViewsCache({ ttl = 30000, now = () => Date.now() } = {}) {
  let st = { mealId: null, rows: undefined, at: 0 };
  let inflight = null;
  return {
    /** undefined = not read yet; null = the read failed; [] or rows = the answer. */
    rowsFor(mealId) { return st.mealId === mealId ? st.rows : undefined; },
    warm(fetchViews, mealId) {
      if (!mealId || typeof fetchViews !== 'function') return Promise.resolve();
      if (st.mealId === mealId && st.rows !== undefined && now() - st.at < ttl) return Promise.resolve();
      if (inflight && inflight.mealId === mealId) return inflight.p;
      const p = Promise.resolve()
        .then(() => fetchViews([mealId]))
        .catch(() => null)
        .then((rows) => {
          st = { mealId, rows: Array.isArray(rows) ? rows : null, at: now() };
          inflight = null;
        });
      inflight = { mealId, p };
      return p;
    },
  };
}

/** A comparable key for what a thread shows of the views. */
export function viewsKey(rows) {
  return rows === undefined ? 'unread' : rows === null ? 'failed' : JSON.stringify(rows);
}
/** True when this thread is on screen and shows something other than `key`. */
export function needsSeenRepaint(el, key) {
  return !!el && el.isConnected === true && el.__tpSeen !== key;
}
export function markSeenPainted(el, key) {
  if (el) el.__tpSeen = key;
}
