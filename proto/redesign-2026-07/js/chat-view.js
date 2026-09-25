/* Turning meal_comments rows into something that reads like a conversation — pure, no DOM.
 *
 * WHY THIS EXISTS. The thread used to render every non-athlete bubble as the literal string
 * "Coach" with a hardcoded "M" avatar, and stamped a timestamp under every single message. That
 * was survivable when a thread was a two-party accountability note capped at a handful of
 * messages. It is not survivable now: the athlete, their coach, Nia (the AI nutritionist), and later a
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
import { weekdayLongDate } from './fmt-date.js';
import { rankForRemaining } from './food-memory.js';
import { icon } from './icons.js';

/** Messages closer together than this belong to the same moment — no clock between them. */
export const GROUP_GAP_MS = 10 * 60 * 1000;

/* WHO NIA IS (2026-09-24). The AI nutritionist has a name, and it is written HERE once: every
   bubble, facepile, members row, typing line and header reads these, so the app cannot call her
   two different things. "AI" stays in the subtitle on purpose: that is the disclosure. */
export const AI_NAME = 'Nia';
export const AI_TITLE = 'OnStandard Nutritionist';
/** Nia's face: a quiet "N" on the AI blue surface (.nia-n), sized by its container. Not the
 *  sparkle: that glyph means "ask the AI", and a participant gets a participant's mark. */
export const NIA_MARK = '<span class="nia-n" aria-hidden="true">N</span>';

/** The sender line for the first bubble of a run: a person's name, or Nia with her title (or a
 *  caller's own subtitle, which still ends in "· AI"). `sub` must be plain, already-safe text. */
export function whoHtml(name, isAi, esc, sub = AI_TITLE) {
  return isAi
    ? `<div class="who">${AI_NAME}<span class="who-sub">${sub} · AI</span></div>`
    : `<div class="who">${esc(name)}</div>`;
}

/** How each kind of participant is introduced. `kind` comes from meal_thread_participants (0158),
 *  which returns real team_staff roles, plus the two client-side constants. */
const KINDS = {
  athlete: { ic: 'user', noun: 'You', access: 'This is their own log' },
  // No icon on Nia's kind line: her mark is the avatar, and the sparkle means an action.
  ai: { ic: '', noun: AI_TITLE, access: 'AI. Reads every meal and answers questions' },
  head_coach: { ic: 'clipboard', noun: 'Head coach', access: 'Sees this athlete’s meals and scores' },
  assistant_coach: { ic: 'clipboard', noun: 'Assistant coach', access: 'Sees this athlete’s meals and scores' },
  position_coach: { ic: 'clipboard', noun: 'Position coach', access: 'Sees this athlete’s meals and scores' },
  coordinator: { ic: 'clipboard', noun: 'Coordinator', access: 'Sees this athlete’s meals and scores' },
  s_and_c: { ic: 'dumbbell', noun: 'Strength coach', access: 'Sees this athlete’s meals and scores' },
  athletic_trainer: { ic: 'stethoscope', noun: 'Athletic trainer', access: 'Sees this athlete’s meals and scores' },
  // A HUMAN on staff (0204), named for what they are so nobody mistakes them for Nia.
  nutritionist: { ic: 'heart', noun: 'Team nutritionist', access: 'Sees this athlete’s meals and scores' },
  team_admin: { ic: 'fileText', noun: 'Team admin', access: 'Sees this athlete’s meals and scores' },
  readonly: { ic: 'eye', noun: 'Staff', access: 'Can read this thread' },
  trainer: { ic: 'biceps', noun: 'Trainer', access: 'Sees this athlete’s meals and scores' },
  // 0081: a guardian reads ONLY a scoped summary (day, daily score, grade). Never meals or photos.
  guardian: { ic: 'shield', noun: 'Parent or guardian', access: 'Sees daily scores and grades only, never meals or photos' },
  // A squad-board row (squad.js): not in any thread, but a person whose name and score you see,
  // and so a person you can report or mute (Guideline 1.2).
  teammate: { ic: 'user', noun: 'Teammate', access: 'On the squad board with you' },
};
const FALLBACK = { ic: 'user', noun: 'Staff', access: 'Can read this thread' };

export function participantMeta(kind) {
  return KINDS[String(kind || '')] || FALLBACK;
}

/** "Coach Brown" -> "CB". One letter is fine; three is a logo, not an avatar. */
export function initialsFor(name) {
  return initialsOf(name, '?');
}

/* The order a person would introduce the room in: the athlete, their coaches, a human
   nutritionist or dietitian, then Nia last. (Guardians are never in a meal thread; see below.) */
const STAFF_KINDS = ['head_coach', 'assistant_coach', 'position_coach', 'coordinator', 'coach', 's_and_c', 'athletic_trainer', 'team_admin', 'readonly', 'nutritionist', 'dietitian'];
const rankOf = (k) => (k === 'athlete' ? 0 : k === 'nutritionist' || k === 'dietitian' ? 2 : STAFF_KINDS.indexOf(k) !== -1 || k === 'trainer' ? 1 : 3);

/**
 * The facepile list: who to show, in the order a person would introduce them.
 * Your own row reads "You". Nia is a constant, not a profile row, so she is appended here rather
 * than invented by the database.
 */
export function participantList(rows, selfId) {
  /* A guardian is NOT in the room (guardian ruling 2026-09-24): 0081 took meals and meal photos
     away from guardians, but meal_thread_participants (0158) still lists them, so a parent showed
     in the facepile and the members sheet as someone reading the meal chat. They cannot. */
  const list = Array.isArray(rows) ? rows.filter((p) => p && String(p.kind || '') !== 'guardian') : [];
  const out = list.map((p) => (p.id && selfId && p.id === selfId
    ? { ...p, name: 'You', kind: String(p.kind || 'athlete'), self: true }
    : { ...p, kind: String(p.kind || '') }));
  // Array.prototype.sort is stable, so people of one rank keep the database's order.
  out.sort((a, b) => rankOf(a.kind) - rankOf(b.kind));
  out.push({ id: null, name: AI_NAME, kind: 'ai' });
  return out;
}

/** The one-line header: "You, Coach Brown, Nia". */
export function participantSummary(list) {
  return (list || []).map((p) => p.name).filter(Boolean).join(', ');
}

/** The overlapping faces of a participants header. Nia wears her mark; people wear their photo
 *  (hydrated by uid) over an initials fallback. */
export function facesHtml(people, esc, n = 4) {
  return (people || []).slice(0, n).map((p) => (p.kind === 'ai'
    ? `<span class="fpav ai">${NIA_MARK}</span>`
    : `<span class="fpav ${p.self ? 'self' : 'other'}"${p.id ? ` data-avatar-uid="${esc(p.id)}"` : ''}><span data-avatar-fallback>${esc(initialsFor(p.name))}</span></span>`)).join('');
}

/** What a conversation is called, from who is in it (2026-09-24): "Team discussion" only when team
 *  staff are in the room, "Discussion" with a personal trainer (or a parent), and "Chat with Nia"
 *  when it is the athlete and her alone. `guess` ({hasCoach, noun}) covers the beat before the
 *  participants land (or an RPC that failed), so a thread with a coach never reads as solo.
 *  `msgs`: a thread that holds a past coach's messages (they have since left) is not a chat with
 *  Nia alone, even with nobody else in the room today. */
export function threadTitle(list, guess, msgs) {
  const people = (list || []).filter((p) => p && p.kind !== 'ai' && p.kind !== 'athlete');
  if (!people.length) {
    if (guess && guess.hasCoach) return guess.noun === 'coach' ? 'Team discussion' : 'Discussion';
    const pastHuman = (Array.isArray(msgs) ? msgs : []).some((c) => c && c.role === 'coach');
    return pastHuman ? 'Discussion' : `Chat with ${AI_NAME}`;
  }
  return people.some((p) => STAFF_KINDS.indexOf(p.kind) !== -1) ? 'Team discussion' : 'Discussion';
}

/** The athlete's message box: Nia alone, or a room that also holds their coach or trainer. */
export function composerPrompt(hasHuman, noun) {
  return hasHuman ? `Message your ${noun || 'coach'} or ask ${AI_NAME}…` : `Ask ${AI_NAME} about this meal…`;
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
  if (comment.role === 'ai') return AI_NAME;
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
/** The mute filter alone: exactly the messages layoutThread will paint for this reader.
 *  Exported so a renderer can slice, count and anchor on the SAME list it draws. Anchoring on
 *  the pre-filter list is how the meal thread lost its reactions: the pill was keyed to a last
 *  message whose author was muted, so layoutThread never painted the bubble that carried it. */
export function visibleThread(msgs, muted = null) {
  const hide = muted && (muted instanceof Set ? muted : new Set(Array.isArray(muted) ? muted.map(String) : []));
  return (Array.isArray(msgs) ? msgs : []).filter(Boolean)
    .filter((c) => !(hide && hide.size && c.author_id && hide.has(String(c.author_id))));
}

/** The one sentence every thread shows when the mute filter leaves nothing to paint. A thread
 *  with messages in it must never render as blank or claim "no messages yet" — both are lies. */
export const MUTED_HIDDEN_NOTE = 'Messages from people you blocked are hidden.';

export function layoutThread(msgs, { fmtTime = () => '', fmtDay = null, fmtDayLabel = null, muted = null } = {}) {
  /* `muted`: author ids this reader has blocked (RT.mutedUsers). Dropped HERE, in the one pure
     layout every thread renderer shares, so a block holds in all four and cannot be forgotten by
     the next one. Grouping and day separators are computed on what remains, so a muted run never
     leaves a headless "3 hours later" gap behind. */
  const list = visibleThread(msgs, muted);
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
      // `day` / `time` are the two halves Messages sets in two weights ("Today" bold, the clock
      // regular). The day is named on a day change AND on the first separator of the thread,
      // where it was always missing: a thread opening on a bare "9:07 AM" never said which day.
      // `label` keeps its old shape for the callers and tests that print it whole.
      const sayDay = fmtDay && (newDay || !prev);
      const day = sayDay ? String((fmtDayLabel || fmtDay)(at) || '') : '';
      if (label) out.push({ type: 'time', label, at, day, time: String(fmtTime(c.created_at) || '') });
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
 *  is fmt-date's, so every separator in the app spells a day the same way. */
export function dayLabelOf(ms, now = Date.now()) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const today = new Date(now);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(today.getTime() - 86400000);
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return weekdayLongDate(d);
}

/** Is this the AI's re-read after a correction? (0157 `meta.t`.) */
export function isAnalysisUpdate(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'analysis_update');
}

/** Is this the AI's original read of the plate? */
export function isAnalysisOpener(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'analysis');
}

/** The chip over Nia's decline, athlete side. The row says whether a coach was actually told
 *  (meta.coach, 2026-09-24); older rows fall back to whether this athlete has a coach at all. */
export function escalationChip(comment, coach) {
  const told = comment && comment.meta && typeof comment.meta.coach === 'boolean'
    ? comment.meta.coach : !!(coach && coach.hasCoach && coach.kind !== 'trainer');
  return told ? `${AI_NAME} sent this to your coach` : `${AI_NAME} can’t answer this one`;
}

/** Is this the AI's decline-and-hand-off message (flag_for_coach)? */
export function isEscalated(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'escalated');
}

/* ---------------- Memory offers (2026-09-02) ----------------
   The AI heard a lasting fact ("I'm lactose intolerant") and wrote it as a PENDING memory fact.
   meal-chat marks the reply row meta { t: 'memory_offer', factId, kind, value, ask } so the two
   athlete-facing renderers can draw a Yes / No under the bubble. The chips are built here, once,
   because the last time a bubble affordance lived in one renderer only (the old clamp) it took six
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
  return `<div class="mo-ask">${esc(plainText(offer.ask))}</div>
    <div class="fq-chips">
      <button type="button" class="fx-chip" data-fact="${esc(offer.id)}" data-keep="1">Yes, remember</button>
      <button type="button" class="fx-chip" data-fact="${esc(offer.id)}" data-keep="0">No, one-off</button>
    </div>`;
}

/* ---------------- Meal suggestions (2026-09-10) ----------------
   The athlete asked what to eat and the AI called suggest_meal. meal-chat persists the reply as
   plain text (framing + fallback, complete on its own) with meta { t: 'meal_suggest', proteinGap,
   kcalGap, framing, fallback }. The two athlete-facing renderers draw the framing line and then
   up to three of the athlete's OWN saved meals, ranked by the same rule Plan > Ask uses, each one
   tap from being staged. The other renderers (coach.js, trust.js) show the text and lose nothing.
   Only `role: 'ai'` rows count, as for memory offers: a client can write meta on its own rows. */
export function isMealSuggest(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'meal_suggest');
}

/** { proteinGap, kcalGap, framing, fallback } for a suggestion row, or null. */
export function mealSuggestOf(comment) {
  if (!isMealSuggest(comment)) return null;
  const m = comment.meta;
  const n = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 ? x : null; };
  const framing = String(m.framing || '').trim();
  const fallback = String(m.fallback || '').trim();
  return {
    proteinGap: n(m.proteinGap) || 0,
    kcalGap: n(m.kcalGap),
    framing: framing || fallback || String(comment.text || '').trim(),
    fallback: fallback || framing || String(comment.text || '').trim(),
  };
}

/**
 * The deterministic fill: the athlete's saved meals that FIT what is left of the day, at most
 * `max`. `remaining` is the client's own remainingToday() (a null target stays null); when the
 * client has no target the model's stated gap stands in, so a suggestion is still ranked against
 * the number the athlete was just told. A meal that runs past what is left does not fit.
 */
export function fillMealSuggestion(sug, items, remaining, max = 3) {
  const r = remaining || {};
  const rem = {
    protein: r.protein != null ? r.protein : (sug && sug.proteinGap > 0 ? sug.proteinGap : null),
    kcal: r.kcal != null ? r.kcal : (sug && sug.kcalGap != null ? sug.kcalGap : null),
  };
  // A protein gap is closed by protein: a saved black coffee ranks (it has calories) but it is
  // not an answer to "how do I hit my protein", so it is dropped whenever protein is the ask.
  return rankForRemaining(items || [], rem, Math.max(max, 6))
    .filter((s) => !s.over && s.item && s.item.id && (rem.protein == null || (Number(s.item.protein) || 0) > 0))
    .slice(0, max)
    .map(({ item }) => ({
      id: String(item.id), name: String(item.name || 'Saved meal'),
      protein: Math.round(Number(item.protein) || 0), kcal: Math.round(Number(item.kcal) || 0),
    }));
}

/** "Chicken and rice · 42g protein · 620 kcal": the same fragment Plan > Ask prints. */
export function pickLabel(p) {
  const bits = [];
  if (p.protein) bits.push(`${p.protein}g protein`);
  if (p.kcal) bits.push(`${p.kcal} kcal`);
  return bits.length ? `${p.name} · ${bits.join(' · ')}` : p.name;
}

/** The bubble body. Picks render as tap targets on `[data-fm-log]`, the selector Plan already
 *  delegates to act.stageSavedMeal; with no fitting pick the fallback sentence stands in, so the
 *  bubble is never a framing line over nothing. `esc` is passed in like memoryOfferChips takes it. */
export function mealSuggestHtml(sug, picks, esc) {
  if (!sug) return '';
  const list = Array.isArray(picks) ? picks : [];
  /* Nia's words, drawn like every other row of hers (richText: escaped first, then the marks).
     This bubble alone printed them through esc(), so the one figure she bolded arrived as
     "**180g**" (founder's iPhone, 2026-09-24): the what-to-eat reply is the only AI row that
     never reached richText. */
  if (!list.length) return richText(sug.framing === sug.fallback ? sug.framing : `${sug.framing} ${sug.fallback}`, esc);
  return `${richText(sug.framing, esc)}<div class="fq-chips">${list.map((p) =>
    `<button type="button" class="fx-chip" data-fm-log="${esc(p.id)}">${esc(pickLabel(p))}</button>`).join('')}</div>`;
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

/* ---------------- THE CORRECTION RECEIPT, AS A MESSAGE (founder 2026-09-17) ----------------
   "I want the updated macros to stay in the team discussion group chat. Even after I exit out of
   the meal log."

   It did not, because it was never in the chat. The receipt was ephemeral client state: ONE
   module-level slot on meal.js, keyed to a meal, stamped with a two-minute TTL, revealed by an
   animation. So it died three ways — leave the screen and come back, wait two minutes, or make a
   SECOND correction and watch the first receipt get overwritten by it. The founder's own
   screenshots show all of that: the first receipt gone, and a bare sparkle avatar where the
   second one should be.

   A receipt is a record, so it is now a row in meal_comments like every other thing that happened
   in this conversation — written service-side as an unforgeable 'ai' row (the client cannot insert
   one; see 0046's insert policy), carrying its figures in `meta` and a plain-English sentence in
   `text`. That means it survives navigation, reloads and any number of later corrections, the
   coach sees it in their copy of the thread, and a renderer that has never heard of this meta
   still shows the true sentence instead of an empty bubble. */
export function isCorrectionReceipt(comment) {
  return !!(comment && comment.role === 'ai' && comment.meta && comment.meta.t === 'correction_receipt'
    && Array.isArray(comment.meta.rows) && comment.meta.rows.length);
}

/** The receipt's figures, bounded on the way out. A stored row is data from the wire like any
 *  other, so nothing here trusts its shape: labels are clamped, values must be finite numbers,
 *  and a row missing either end of the move is dropped rather than rendered as a half-change. */
export function correctionRowsOf(comment) {
  if (!isCorrectionReceipt(comment)) return [];
  /* null, undefined and '' all coerce to 0 through Number(), which would turn a row missing one
     end of its move into a confident "0 to 93". Reject the non-numbers before coercing. */
  const num = (v) => {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return isFinite(n) ? Math.round(n) : null;
  };
  return comment.meta.rows.slice(0, 6).map((r) => {
    if (!r) return null;
    const from = num(r.from), to = num(r.to);
    if (from == null || to == null) return null;
    return {
      label: String(r.label || '').replace(/[<>]/g, '').slice(0, 24),
      unit: String(r.unit || '').replace(/[<>]/g, '').slice(0, 4),
      from, to,
      score: r.score === true,
      band: String(r.band || '').replace(/[^a-z]/g, '').slice(0, 8),
    };
  }).filter((r) => r && r.label);
}

/** The bubble a meal's reactions ride: the last painted message that IS a bubble. A receipt is
 *  drawn as a card with no bubble to carry the pill, so anchoring on it (a receipt is often the
 *  newest row) made every reaction on the meal vanish. */
export function reactionAnchor(visible) {
  const list = Array.isArray(visible) ? visible : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && !isCorrectionReceipt(list[i])) return list[i];
  return null;
}

/** The sentence a receipt carries as its `text` — what the thread shows anywhere the card is not
 *  drawn (an older client, the season-long thread, a notification preview). Kept honest and short:
 *  it states the same moves the card animates. */
export function correctionReceiptText(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.label);
  if (!list.length) return 'Updated this meal.';
  return `Updated: ${list.map((r) => `${r.label} ${r.from}${r.unit || ''} to ${r.to}${r.unit || ''}`).join(', ')}.`;
}

/* ---------------- The row, as Messages draws it (2026-09-14) ----------------
   Four renderers paint the same bubble, and every courtesy that lived in one of them alone took
   weeks to reach the others (the clamp, memory chips). These helpers are the shared shape of a
   row: its classes, its separator, and its receipt. Markup is the renderer's; the RULES are here. */

/** The class list for a message row.
 *  - `athlete` sits on the right; `coach` and `ai` on the left
 *  - `cont` is a repeat inside a run (no name, tighter gap); `last` closes the run and carries the
 *    tail and the sender's face, the way Messages puts the face on the LAST bubble, not the first
 *  - `photo` is an image alone, drawn edge to edge with no bubble padding and no tail */
export function msgRowClass({ mine, role, firstOfRun = true, lastOfRun = true, hasRx = false, photoOnly = false } = {}) {
  const side = mine ? 'athlete' : role === 'ai' ? 'ai' : 'coach';
  const cls = ['msg', side];
  if (!firstOfRun) cls.push('cont');
  if (lastOfRun) cls.push('last');
  if (hasRx) cls.push('has-rx');
  if (photoOnly) cls.push('photo');
  return cls.join(' ');
}

/** "<b>Today</b> 9:07 AM": the day in the heavier weight, the clock in the lighter. Falls back to
 *  the whole label when a caller's layout has no day halves (an older shape, or a test). */
export function timeSepHtml(item, esc) {
  if (!item) return '';
  const day = String(item.day || '');
  const time = String(item.time || '');
  if (!day && !time) return `<div class="tsep">${esc(String(item.label || ''))}</div>`;
  return `<div class="tsep">${day ? `<b>${esc(day)}</b>` : ''}${day && time ? ' ' : ''}${esc(time)}</div>`;
}

/** The one receipt this app can state truthfully under a sent bubble. A row that came back from
 *  the database was DELIVERED; nothing here knows it was read, so nothing here says so. Only the
 *  newest message in the thread wears it, and only when it is the reader's own. */
export function deliveredHtml({ mine, isLast } = {}) {
  return mine && isLast ? '<div class="dlv">Delivered</div>' : '';
}

/** The per-message clock revealed by dragging the thread left (chat-times.js). Present on every
 *  row and invisible until the drag, exactly as Messages keeps it. */
export function msgTimeHtml(comment, fmtTime, esc) {
  const t = comment && fmtTime ? String(fmtTime(comment.created_at) || '') : '';
  return t ? `<span class="mt" aria-hidden="true">${esc(t)}</span>` : '';
}

/* ---------------- The AI, with emphasis (2026-09-14) ----------------
   The AI's rows may carry three marks, written server-side (meal-opener.ts, meal-chat): **bold**
   for the figure or instruction that matters most, __underline__ for a point to hold onto, and
   ==colour== for the one line that IS the advice. This is the ONLY place they are drawn, and it
   escapes FIRST: the marks are matched on already-escaped text, so nothing a row carries can open
   a tag. Newlines become line breaks, as Messages keeps them. Only `role: 'ai'` rows go through
   here; a person's bubble prints their asterisks as asterisks. */
export function richText(text, esc) {
  let s = esc(String(text == null ? '' : text));
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  /* A pair the model left open ("your **180g target") has nothing to draw, and printing it is
     the raw-markdown look the founder saw. Dropped, never guessed at: the words stay plain. */
  s = s.replace(/\*\*/g, '');
  s = s.replace(/__([^_\n]+?)__/g, '<u>$1</u>');
  s = s.replace(/==([^=\n]+?)==/g, '<em class="hl">$1</em>');
  return linkify(s).replace(/\r?\n/g, '<br>');
}

/* LINKS (2026-09-22). A pasted https link in any bubble is a link, as Messages makes it. Works
   on ALREADY-ESCAPED text, so the href can only ever carry what esc() let through, and only
   https: router.js hands https anchors to the system browser (openUrl), which is the one path
   that cannot strand the WebView. Trailing sentence punctuation stays outside the link. */
const URL_RE = /\bhttps:\/\/[^\s<>"']+/g;
export function linkify(escaped) {
  return String(escaped == null ? '' : escaped).replace(URL_RE, (m) => {
    const tail = (m.match(/[.,!?;:)]+$/) || [''])[0];
    const url = tail ? m.slice(0, -tail.length) : m;
    if (url.length < 12) return m;
    return `<a class="blink" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

/** A person's bubble: escaped, newlines kept, links live. No marks: only the AI's rows are
 *  parsed for emphasis, so a person's asterisks stay asterisks. */
export function personText(text, esc) {
  return linkify(esc(String(text == null ? '' : text))).replace(/\r?\n/g, '<br>');
}

/** The text of an AI row with its marks stripped: for previews, notifications, clipboard. */
export function plainText(text) {
  return String(text == null ? '' : text).replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/\*\*/g, '').replace(/__([^_\n]+?)__/g, '$1').replace(/==([^=\n]+?)==/g, '$1');
}

/* ---------------- Replies (2026-09-22) ----------------
   Swipe a message right, or hold it and pick Reply, and your next message carries a quote of
   it, as Messages does. meal_comments has no reply column, so the pointer rides `meta.replyTo`
   on the sender's OWN row (0157: clients may write meta on their own rows; nothing server-side
   reads this key). Written by a client, so nothing here trusts it: every field is clamped, the
   id must look like an id, and the quote is re-read from the LIVE message when it is on screen,
   so what is quoted is what was said, not what a client claimed was said. */

const cleanId = (v) => { const x = String(v == null ? '' : v).slice(0, 64); return /^[A-Za-z0-9_-]+$/.test(x) ? x : ''; };
const metaOf = (c) => {
  let m = c && c.meta;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return null; } }
  return m && typeof m === 'object' ? m : null;
};
const photoOf = (c) => { const m = metaOf(c); return !!(m && typeof m.photo === 'string' && m.photo); };
const excerpt = (t) => {
  const s = plainText(String(t || '')).replace(/\s+/g, ' ').trim();
  return s === 'Sent a photo' ? '' : s.slice(0, 140);
};

/** The reply pointer a row carries, bounded, or null. */
export function replyRefOf(comment) {
  const m = metaOf(comment);
  const r = m && m.replyTo;
  if (!r || typeof r !== 'object') return null;
  const id = cleanId(r.id);
  if (!id) return null;
  return {
    id,
    aid: cleanId(r.aid) || null,
    who: String(r.who || '').replace(/[<>]/g, '').slice(0, 40),
    text: String(r.text || '').slice(0, 160),
    photo: r.photo === true,
  };
}

/** What a new message stores about the one it answers: who, a short plain excerpt, and whether
 *  it was a photo. `who` is the name the replier SAW on screen. */
export function replyTargetMeta(comment, who) {
  if (!comment) return null;
  const id = cleanId(comment.id);
  if (!id) return null;
  const out = { id, who: String(who || '').slice(0, 40), text: excerpt(comment.text) };
  const aid = cleanId(comment.author_id);
  if (aid) out.aid = aid;
  if (photoOf(comment)) out.photo = true;
  return out;
}

/** The quote to draw above a reply, or null. `visible` is the painted (mute-filtered) list, so a
 *  reply to a muted person never resurfaces their words; an original outside the loaded window
 *  falls back to the stored excerpt, unless its stored author is muted. */
export function replyQuote(comment, visible, muted = null, nameOf = null) {
  const ref = replyRefOf(comment);
  if (!ref) return null;
  const hit = (Array.isArray(visible) ? visible : []).find((c) => c && String(c.id) === ref.id);
  // The name is the READER's name for that person (the replier stored theirs: a coach's "Marcus"
  // is the athlete's own "You"), so a live original is named by the caller's own rule.
  if (hit) {
    const who = typeof nameOf === 'function' ? String(nameOf(hit) || ref.who) : ref.who;
    return { id: ref.id, who, text: excerpt(hit.text), photo: photoOf(hit), live: true };
  }
  const hide = muted && (muted instanceof Set ? muted : new Set(Array.isArray(muted) ? muted.map(String) : []));
  if (ref.aid && hide && hide.has(ref.aid)) return null;
  return { id: ref.id, who: ref.who, text: ref.text, photo: ref.photo, live: false };
}

/** The quote as markup: the stem and a chip, and the chip is a button that scrolls to the
 *  original (chat-live.js wires `[data-jump]`). */
export function replyQuoteHtml(q, esc) {
  if (!q) return '';
  const body = q.text || (q.photo ? 'Photo' : '');
  if (!body) return '';
  const who = q.who ? `<b>${esc(q.who)}</b> ` : '';
  return `<button type="button" class="quote rq" data-jump="${esc(q.id)}" aria-label="${esc(`Reply to ${q.who || 'a message'}: ${body}. Show the original`)}"><span class="stem"></span><span class="qtext">${who}${esc(body)}</span></button>`;
}

/* ---------------- Receipts, one card for every renderer ----------------
   An action the AI took (a food added, a macro changed, the score moved) lands as a compact card
   IN the conversation, not as a sentence about one. Four renderers drew this card from four
   copies of the same markup; this is the one copy. `meta.note` (optional, written server-side)
   is the one line that says why, e.g. "Added from Jihad's photo at Coach Brooks' request". */
export function receiptNoteOf(comment) {
  if (!isCorrectionReceipt(comment)) return '';
  return String(comment.meta.note || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/* `first`: this receipt opens a run of Nia's rows (layoutThread's firstOfRun). It carries her name
   then, because the reply after it is in the same run and so shows no name of its own: without
   this, a correction receipt and Nia's answer read as an anonymous card and an unsigned bubble. */
export function receiptCardHtml(comment, esc, { fresh = false, first = false } = {}) {
  const rows = correctionRowsOf(comment);
  if (!rows.length) return '';
  const note = receiptNoteOf(comment);
  const id = esc(String(comment.id || ''));
  return `
        <div class="msg ai last rcpt${fresh ? ' in' : ''}" data-cid="${id}" data-receipt="${id}">
          <div class="av">${NIA_MARK}</div>
          <div class="stack rcpt-stack">${first ? whoHtml(AI_NAME, true, esc) : ''}
          <div class="corr-card in landed" role="status">
            <div class="corr-head">${icon('check', 14)}<span>Updated</span></div>
            ${note ? `<div class="corr-note">${esc(note)}</div>` : ''}
            ${rows.map((r) => `
              <div class="corr-row${r.score ? ' corr-score' : ''}">
                <span class="ck">${esc(r.label)}</span>
                <span class="cv"><i class="was">${esc(String(r.from) + r.unit)}</i>${icon('arrowRight', 12)}<b class="${esc(r.band)}">${esc(String(r.to) + r.unit)}</b></span>
              </div>`).join('')}
          </div></div>
        </div>`;
}

/* ---------------- The AI at work ----------------
   One typing row for every renderer. With no label it is the three dots, as Messages draws a
   person typing. With a label it says what the AI is actually doing ("Reading the photo"),
   because a photo read takes long enough that three dots start to look like nothing. */
export function typingRowHtml(esc, { label = '' } = {}) {
  const say = String(label || '').slice(0, 40);
  return `
        <div class="msg ai last typing live-row" id="ai-typing">
          <div class="av">${NIA_MARK}</div>
          <div class="stack"><div class="who">${AI_NAME} is ${say ? esc(say.toLowerCase()) : 'typing'}<span class="sr-only">, a reply is on its way</span></div>
          <div class="bubble tdots${say ? ' tlabel' : ''}"><span></span><span></span><span></span>${say ? `<em>${esc(say)}…</em>` : ''}</div></div>
        </div>`;
}

/** What the AI is doing, read off the thread: a photo someone sent that no AI row has answered
 *  yet means the model is looking at a picture. `msgs` is chronological. */
export function workingLabel(msgs) {
  const list = (Array.isArray(msgs) ? msgs : []).filter(Boolean);
  for (let i = list.length - 1; i >= 0 && i >= list.length - 4; i--) {
    const c = list[i];
    if (c.role === 'ai') return '';
    if (photoOf(c)) return 'Reading the photo';
  }
  return '';
}

/* ---------------- The outbox, drawn ----------------
   A message you sent appears the instant you send it, as Messages shows it, with "Sending…"
   under it until the row is confirmed, and "Not delivered" with a retry if it never is. The
   state lives in chat-live.js; this is the bubble. `imgSrc` is the caller's safeImg. */
export function pendingRowHtml(item, esc, imgSrc, { fresh = false } = {}) {
  if (!item) return '';
  const failed = item.state === 'failed';
  const text = String(item.text || '');
  const photo = item.photo && item.photo.dataUrl && imgSrc ? imgSrc(item.photo.dataUrl) : '';
  const photoOnly = !!photo && !text;
  const q = item.replyTo ? replyQuoteHtml(item.replyTo, esc) : '';
  return `
        <div class="msg athlete last pend live-row${photoOnly ? ' photo' : ''}${failed ? ' failed' : ''}${fresh ? ' in' : ''}" data-lid="${esc(item.lid)}">
          <div class="stack">
            ${q}
            <div class="bubble">${photo ? `<img class="bimg" src="${photo}" alt="Photo you are sending" />` : ''}${text ? personText(text, esc) : ''}</div>
            ${failed
              ? `<button type="button" class="dlv out-retry" data-out-retry="${esc(item.lid)}">${icon('alert', 13)} Not delivered. Tap to try again</button>`
              : '<div class="dlv" role="status">Sending…</div>'}
          </div>
        </div>`;
}
