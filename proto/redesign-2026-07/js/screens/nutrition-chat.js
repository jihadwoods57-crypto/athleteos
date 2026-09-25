/* Nutrition chat — the whole season in one conversation.
 *
 * A meal thread used to reset at every plate: a question asked on Tuesday's dinner was gone by
 * Wednesday's breakfast, and the coach's point about one burrito bowl had no relationship to the
 * next. This screen is the same rows read a different way — every message across every meal,
 * merged chronologically, with each meal entering the stream as a card carrying its photo, name,
 * timing and score. The thread doubles as a nutrition log, and "same plate as Thursday?" becomes
 * a sentence the athlete can actually write, because Thursday is right there in the scroll.
 *
 * Storage did not move. meal_comments stays keyed to a meal, and so does every RLS rule that
 * hangs off it — this reads exactly the rows the athlete could already read one plate at a time.
 *
 * THE ROOM CAN HEAR YOU NOW (critique 2026-08-28). For most of this screen's life its composer
 * called postMealComment and stopped. No invoke, no typing state, no poll, no realtime — while
 * the header listed the AI Nutritionist in the facepile, the members sheet promised it "reads
 * every meal and answers questions", and the empty state said it would start the conversation.
 * An athlete typed a question into a room where the one named participant structurally could not
 * hear them. The meal thread, the trust thread and the coach's view all invoked meal-chat; this
 * screen, the one the product calls the conversation, did not. Everything below marked LIVE is
 * that gap being closed.
 */

import { S, RT, act, mealDetail, athleteContextForAnalysis } from '../state.js';
import { MEAL_KEYS, DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, composer, aiDisclaimer } from '../components.js';
import { decideAiTurn } from '../ai-thread.js';
import { threadMessages, reactionGroups, REACTION_EMOJI, contextForChat } from '../meal-intel.js';
import { foodMemory, warmFoodMemory } from '../food-memory-data.js';
import { remainingToday } from '../food-memory.js';
import { stitchNutritionChat } from '../thread-stitch.js';
import {
  layoutThread, visibleThread, MUTED_HIDDEN_NOTE,
  authorName, initialsFor, participantList, participantSummary,
  AI_NAME, NIA_MARK, whoHtml, facesHtml, composerPrompt, escalationChip,
  isAnalysisUpdate, quotedFor, isEscalated,
  memoryOfferOf, memoryOfferChips,
  mealSuggestOf, fillMealSuggestion, mealSuggestHtml,
  dayLabelOf, msgRowClass, timeSepHtml, deliveredHtml, msgTimeHtml, richText,
  isCorrectionReceipt, receiptCardHtml, playFreshReceipts, reactionAnchor, replyQuote, replyQuoteHtml, replyTargetMeta,
  personText, workingLabel,
} from '../chat-view.js';
import { bubblesHtml } from '../thread-polish.js';
import { wireChatTimes } from '../chat-times.js';
import { attachedPhoto, isPhotoOnly, bubblePhotoHtml, hydrateThreadPhotos, postChatMessage } from '../chat-attach.js';
import {
  beginSend, endSend, takeFailed, setAiWorking,
  setReply, replyOf, clearReply, paintReplyChip, noteArrivals, syncLive, syncJump,
  bindLive, wireThreadTaps, holdThread, followThread,
} from '../chat-live.js';
import { FILTERED_NOTE } from '../content-filter.js';
import { hydrateAvatars } from '../avatar.js';
import { wireTapback } from '../tapback.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { ensureAiConsent, isConsentSkip, noteAiConsentRequired, aiMinorPending, AI_MINOR_LINE } from '../ai-consent.js';

/** The line when the AI stays quiet because AI replies are off (0243). */
const AI_OFF_REPLY_NC = 'Nia is off, so she stays quiet. Your message is posted. Turn on Nia in Privacy on your Profile.';
import { cachedMealPhoto, warmMealPhotos } from '../photo-store.js';
import { scrollThreadToEnd, focusComposer } from '../keyboard.js';

/** How far back the stream reaches on open. A season is long; a fortnight is what a person
 *  actually scrolls, and "Load earlier" walks back from there. */
const WINDOW_DAYS = 14;
const PAGE = 200;

/* mealsError: the meals fetch FAILED (fetchRecentMeals returns null on failure, [] on truly
   none) — the two must never blur, because "log a meal first" said to an athlete with a year of
   logs is a fabrication, the exact lie the fetcher itself was cured of. */
let STATE = { uid: null, comments: [], meals: [], participants: [], oldestISO: null, more: true, error: false, mealsError: false };

/* MEMORY OFFERS (2026-09-02). Which pending facts still need the athlete's yes or no. `pending`
   is null until the fetch lands (unknown, so an offer row shows its chips) and a Set of ids
   after; `answered` is what they tapped THIS session, so the chips vanish on the very next paint
   instead of waiting for a refetch. Module scope, so it survives every repaint. */
let PENDING_IDS = null;
const ANSWERED_FACTS = new Set();

/** TODAY's slot for a meal id, or null when the plate is not on today's board. Only today's
 *  meals live in the day record that correctMeal rewrites, so only they can take a structured
 *  correction from this screen; an older plate keeps the reply-only contract, where the prompt's
 *  rule 9 makes the AI accept a correction plainly in prose. */
function todaySlotFor(mealId) {
  if (!mealId) return null;
  for (const k of MEAL_KEYS) {
    const d = mealDetail(k);
    if (d && d.mealId === mealId) return k;
  }
  return null;
}

/** Per-item detail for the AI, the same shape the meal thread sends: today's canonical record
 *  when the plate is today's (it carries corrections), else what the meals row stored. Without
 *  it this screen's AI could only discuss totals and apply_correction had nothing to aim at. */
function foodsFor(meal) {
  const slot = meal ? todaySlotFor(meal.id) : null;
  const live = slot ? mealDetail(slot) : null;
  const src = live && Array.isArray(live.detectedRich) && live.detectedRich.length
    ? live.detectedRich
    : (meal && Array.isArray(meal.detected) ? meal.detected : []);
  return src.slice(0, 12).map((d) => {
    if (!d) return null;
    if (typeof d === 'string') return { name: d };
    return { name: d.name, per: d.per, basis: d.basis, product: d.product, brand: d.brand, quantity: d.quantity };
  }).filter((d) => d && d.name);
}

/* The live-state key for this screen (chat-live.js): one conversation across every meal, so one
   outbox, one reply and one typing row, whichever plate a message is aimed at. */
const NC = 'nutrition-chat';

/* WHICH PLATE THE COMPOSER IS ANSWERING.
 *
 * Every message row belongs to a meal, so there is no such thing as a message about nothing. This
 * screen used to resolve that silently to `STATE.meals[0]` and describe it in a placeholder as
 * "your latest meal". Two things were wrong with that. The small one: fetchRecentMeals orders
 * day_date DESC then logged_at ASC, so meals[0] is the FIRST meal of the newest day — today's
 * breakfast, not the plate the athlete just ate. The large one: this screen exists so an athlete
 * can scroll to Thursday and ask about Thursday, and the answer landed on today regardless, with
 * nothing on screen saying so.
 *
 * So the target is explicit and always named. Tap any meal card in the stream to aim at it; the
 * strip above the composer says which plate you are on at all times, and clears back to the
 * genuinely-latest one. Null means "the latest plate", resolved by logged_at, not by list order.
 */
let REPLY_TO = null;


const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
};
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayLabel = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(today.getTime() - 86400000);
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

/** The genuinely most recent plate. NOT meals[0]: the fetcher sorts day_date DESC, logged_at ASC,
 *  which puts the newest day's EARLIEST meal at the front of the list. */
export function latestMeal(meals) {
  let best = null, bestAt = -Infinity;
  for (const m of (meals || [])) {
    if (!m || !m.id) continue;
    const at = Date.parse(m.logged_at || m.day_date || '');
    const key = isFinite(at) ? at : -Infinity;
    if (key >= bestAt) { bestAt = key; best = m; }
  }
  return best;
}

const mealById = (meals, id) => (meals || []).find((m) => m && m.id === id) || null;

/** "Dinner · Thursday" — how a plate is named anywhere the athlete has to choose one. */
export function mealLabel(meal) {
  if (!meal) return '';
  const name = String(meal.name || meal.type || 'Meal');
  const when = meal.logged_at ? dayLabel(meal.logged_at) : dayLabel(meal.day_date);
  return when ? `${name} · ${when}` : name;
}

/** One meal, as it enters the conversation.
 *
 *  A BUTTON, not a div (2026-08-28): the card is now also how you aim the composer at that plate,
 *  which is the gesture this screen was always describing in its own header and never offered. */
function dividerHtml(meal, selectedId) {
  if (!meal) {
    return `<div class="nc-div earlier"><span>Earlier in the season</span></div>`;
  }
  const url = meal.photo_path ? cachedMealPhoto(meal.photo_path) : null;
  const name = String(meal.name || meal.type || 'Meal');
  const when = meal.logged_at ? `${dayLabel(meal.logged_at)} · ${fmtTime(meal.logged_at)}` : dayLabel(meal.day_date);
  const score = typeof meal.quality === 'number' ? meal.quality : null;
  const sel = selectedId && meal.id === selectedId;
  return `
    <button type="button" class="nc-div${sel ? ' sel' : ''}" data-meal-id="${esc(meal.id)}"
      aria-pressed="${sel ? 'true' : 'false'}"
      aria-label="Reply about ${esc(mealLabel(meal))}">
      <span class="nc-thumb"${url ? ` style="background-image:url('${esc(url)}')"` : ''}>${url ? '' : icon('camera', 15)}</span>
      <span class="nc-meta">
        <b>${esc(name)}</b>
        <small>${esc(when)}</small>
      </span>
      ${score != null ? `<span class="nc-score">${score}</span>` : ''}
    </button>`;
}

export default {
  nav: 'athlete',
  // The conversation owns the bottom of the screen, the same as the meal thread (meal.js
  // `thread.hideTabs`). With the tab capsule up, the sticky dock parked ~140px above the edge
  // and the bubbles scrolled visibly between the composer and the tab bar (audit 2026-09-22).
  // Back is the header chevron.
  hideTabs: true,

  render() {
    // The room is not named until the participants land. It used to render the facepile from an
    // empty list, which appends the AI and nothing else — so the first frame of a thread with a
    // coach in it read "AI Nutritionist · 1 in this conversation". A room stated wrong for a beat
    // is still a room stated wrong; say nothing until it is known.
    // The header is the room, as the phone draws a group: the back chevron at the left and the
    // faces stacked in the centre with the names beneath. The faces are the one button, and it
    // opens the members sheet exactly as the old pill did. (backHead is not used because its
    // title would sit where the faces belong; the `.bk` markup is the router's own.)
    return `<div class="back-head nc-head">
      <div class="bk" data-back="home" role="button" aria-label="Back">${icon('back', 20)}</div>
      <h1 class="sr-only">Chat with ${AI_NAME}</h1>
      <button class="facepile fp-hero" id="nc-members" aria-label="Who can see this conversation">
        <span class="fp"></span>
        <span class="names">Loading the room</span>
      </button>
    </div>
    <div class="thread nc-thread" id="nc-thread" role="log" aria-label="Chat with ${AI_NAME}">
      <div class="msg-status" id="nc-status">Loading your conversation…</div>
    </div>
    <div class="chat-dock dock-end">
      ${aiDisclaimer()}
      <div class="nc-target" id="nc-target" hidden></div>
      <div id="nc-note" class="cmp-note" role="status"></div>
      ${composer({ inputId: 'nc-msg', sendId: 'nc-send', placeholder: composerPrompt(S.coach.hasCoach, S.coach.noun), sendLabel: 'Send', atEnd: true })}
    </div>`;
  },

  async mount(root, { sub } = {}) {
    const roles = await import('../roles.js');
    // ARRIVING FROM A PLATE (2026-09-14). The meal page's "Open" and "N earlier messages" carry
    // the meal id as the sub-route, and this screen opens WITH that plate selected and its card
    // scrolled into view, rather than dumping the athlete at the bottom of a fortnight. The jump
    // happens once, on the first paint that has the card; after that the thread behaves as it
    // always has. A plate outside the loaded window simply falls back to the latest.
    let JUMP_TO = sub ? String(sub) : null;
    if (JUMP_TO) REPLY_TO = JUMP_TO;
    const threadEl = root.querySelector('#nc-thread');
    const noteEl = root.querySelector('#nc-note');
    let busy = false;
    const setNote = (t, retry) => { if (noteEl) noteEl.innerHTML = t ? `<div class="mt-retry"${retry ? ' id="nc-retry-ai"' : ''}>${esc(t)}</div>` : ''; };

    // render() runs before any data exists, so the header would otherwise be stuck reading
    // "AI Nutritionist · 1 in this conversation" — the participants land a moment later and the
    // room has to be named correctly, not almost.
    const paintHeader = () => {
      const btn = root.querySelector('#nc-members');
      if (!btn) return;
      const people = participantList(STATE.participants, RT.userId);
      // Real faces where they exist (meal.js's facepile pattern): the monogram stays as the
      // fallback span and hydrateAvatars upgrades it after paint. Never on 'ai'.
      btn.querySelector('.fp').innerHTML = facesHtml(people, esc);
      hydrateAvatars(btn);
      // "You, Coach Brown, AI Nutritionist" with the count and a small chevron on the same
      // line, which is how the phone says "this is a group, tap for the members".
      btn.querySelector('.names').innerHTML = `${esc(participantSummary(people))}<small>${people.length}${icon('chevron', 11)}</small>`;
    };

    /* THE PLATE THE COMPOSER IS AIMED AT, said out loud. Always rendered when there is a meal to
       name, never only when the athlete has chosen one: the default target is a fact about where
       their message will land, and a default nobody stated is exactly how this screen used to
       send Thursday's question to today's breakfast. */
    const paintTarget = () => {
      const el = root.querySelector('#nc-target');
      const input = root.querySelector('#nc-msg');
      if (!el) return;
      const latest = latestMeal(STATE.meals);
      const picked = REPLY_TO ? mealById(STATE.meals, REPLY_TO) : null;
      const meal = picked || latest;
      if (!meal) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      // The plate is one tap away: its name opens it (today's on the live meal page, an older
      // one on its past-meal view), so "which meal is this about" is never a scroll hunt.
      const slotNow = todaySlotFor(meal.id);
      const go = slotNow ? `meal-thread/${slotNow}` : `meal-view/${meal.id}`;
      el.innerHTML = `<span class="nct-label">Replying about</span>
        <button type="button" class="nct-meal" data-go="${esc(go)}" aria-label="${esc(`Open ${mealLabel(meal)}`)}">${esc(mealLabel(meal))}</button>
        ${picked && latest && picked.id !== latest.id
          ? `<button type="button" class="nct-clear" id="nc-target-clear">Latest instead</button>`
          : `<span class="nct-hint">Tap a meal above to switch</span>`}`;
      if (input) input.setAttribute('aria-label', `Message about ${mealLabel(meal)}`);
    };

    const paint = () => {
      if (!threadEl) return;
      if (STATE.error) {
        threadEl.innerHTML = `<div class="msg-status">Couldn't load your conversation. Your logs are safe either way. <span class="link" id="nc-retry" role="button">Try again</span></div>`;
        return;
      }
      // Chronological, whatever order the page arrived in: quote stems, the Delivered tag and the
      // arrival count all read "the message before" and "the newest" off this list.
      const at = (c) => { const t = Date.parse((c && c.created_at) || ''); return Number.isFinite(t) ? t : 0; };
      const msgs = threadMessages(STATE.comments).slice().sort((a, b) => at(a) - at(b));
      if (!msgs.length && !STATE.meals.length) {
        // Empty because there IS nothing, or empty because the meals fetch died? Opposite
        // messages — one invites a first log, the other must not pretend the logs are gone.
        threadEl.innerHTML = STATE.mealsError
          ? `<div class="msg-status">Couldn't load your meals right now. Your logs are safe. <span class="link" id="nc-retry" role="button">Try again</span></div>`
          : `<div class="msg-status">Nothing here yet. Log a meal and Nia starts the conversation.</div>`;
        paintTarget();
        return;
      }
      const { items } = stitchNutritionChat({ meals: STATE.meals, comments: msgs });
      { const a = noteArrivals(NC, visibleThread(msgs, RT.mutedUsers), RT.userId); FRESH = a.fresh; ARRIVED += a.added; }
      // Lay each meal's messages out on their own, so a run and a time separator never straddle
      // a divider — a "9:07 AM" floating above yesterday's photo card reads as a bug.
      const html = [];
      if (STATE.more) html.push(`<button class="btn ghost sm" id="nc-earlier" style="align-self:center">Load earlier</button>`);
      const latest = latestMeal(STATE.meals);
      const targetId = REPLY_TO || (latest ? latest.id : null);
      // Once per repaint, not once per meal segment — renderRun anchors against this.
      const visAll = visibleThread(msgs, RT.mutedUsers);
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        html.push(renderRun(run, STATE.participants, visAll));
        run = [];
      };
      for (const item of items) {
        if (item.type === 'divider') { flushRun(); html.push(dividerHtml(item.meal, targetId)); }
        else run.push(item.comment);
      }
      flushRun();
      // Where the reader is, read BEFORE the new rows land (chat-live.js holdThread).
      const hold = holdThread(threadEl, NC);
      const arrived = FRESH.size > 0 || ARRIVED > 0;
      threadEl.innerHTML = html.join('');
      // The outbox bubble and the AI at work (chat-live.js), after the paint that wiped them.
      const sending = syncLive(threadEl, NC, { esc, imgSrc: safeImg });
      hydrateAvatars(threadEl);   // 0206: message monograms upgrade to real faces, as on the meal thread
      // `.thread` is a flex column and has never had a scrollTop — the screen's scroller is
      // #viewport, so the old line here moved nothing. Unforced: "Load earlier" must not fling the
      // reader back to today the instant the older page paints.
      const jump = JUMP_TO ? threadEl.querySelector(`.nc-div[data-meal-id="${CSS.escape(JUMP_TO)}"]`) : null;
      if (jump) {
        JUMP_TO = null;
        jump.scrollIntoView({ block: 'start', behavior: 'instant' });
        // The header is glass over the scroller; without this the card lands under it.
        const vp = threadEl.closest('.viewport');
        const head = root.querySelector('.nc-head');
        if (vp && head) vp.scrollTop -= head.getBoundingClientRect().height + 8;
      }
      else followThread(hold, { force: sending, smooth: arrived });
      paintHeader();
      paintTarget();
      // FULL MESSAGES, ALWAYS (founder 2026-09-22): no Read more on any renderer. The read is
      // long on purpose; the bubble's measure keeps it readable (screens.css .msg .stack).
      syncJump(threadEl, NC, { dock: root.querySelector('.chat-dock'), added: ARRIVED, always: true });
      ARRIVED = 0;
      // Attached message photos resolve after paint (signed URLs are async), same as the meal
      // thread. Safe on every repaint.
      void hydrateThreadPhotos(threadEl, roles);
      playFreshReceipts(threadEl);   // an arriving receipt counts up (chat-view.js)
      // Fill in any meal photos that were not cached at paint time, then repaint once.
      warmMealPhotos(STATE.meals.map((m) => m.photo_path).filter(Boolean));
    };

    // LIVE: the AI at work, through the shared hook (chat-live.js setAiWorking), labelled from
    // the thread so a photo read says so.
    const setTyping = (on) => setAiWorking(NC, on, {
      label: on ? workingLabel(visibleThread(threadMessages(STATE.comments), RT.mutedUsers)) : '',
    });
    // Arrivals: counted once per paint across every meal segment, for the entrances and the
    // jump pill's unread count.
    let FRESH = new Set();
    let ARRIVED = 0;

    // `visAll` arrives from paint() (computed once per repaint, not once per meal segment):
    // the post-mute-filter view of the whole window, for the Delivered anchor and quote stems.
    const renderRun = (list, participants, visAll) => {
      // Anchors keyed to the last VISIBLE message (visibleThread is layoutThread's own mute
      // filter): keyed pre-filter, muting the newest author swallowed the run's reaction pill
      // and the Delivered tag with a bubble layoutThread never painted.
      const vis = visibleThread(list, RT.mutedUsers);
      // Every author in THIS meal's discussion muted: say so under its card (trust.js's own
      // state), or the segment is a divider over silence that reads as a broken screen.
      if (list.length && !vis.length) return `<div class="msg-status">${MUTED_HIDDEN_NOTE}</div>`;
      const lastMsg = vis.length ? vis[vis.length - 1] : null;
      const rxAt = reactionAnchor(vis);
      const newest = visAll.length ? visAll[visAll.length - 1] : null;
      return layoutThread(list, { muted: RT.mutedUsers, fmtTime, fmtDay: dayKey, fmtDayLabel: dayLabelOf }).map((item) => {
        if (item.type === 'time') return timeSepHtml(item, esc);
        const c = item.comment;
        /* A filed correction receipt renders as the card, not as a bubble — the same record the
           athlete sees in their own thread (chat-view isCorrectionReceipt). */
        if (isCorrectionReceipt(c)) return receiptCardHtml(c, esc, { fresh: FRESH.has(String(c.id)), first: item.firstOfRun });
        const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
        const who = authorName(c, participants, RT.userId, S.coach.noun);
        const update = isAnalysisUpdate(c);
        const escalated = isEscalated(c);
        // From the filtered list: a quote stem must not resurface a muted author's words.
        const quoted = update ? quotedFor(c, visAll) : null;
        const rq = quoted ? '' : replyQuoteHtml(replyQuote(c, visAll, RT.mutedUsers, (x) => (x.role === 'athlete' && (!x.author_id || x.author_id === RT.userId) ? 'You' : authorName(x, participants, RT.userId, S.coach.noun))), esc);
        // Reactions are meal-level rows (0049); as on the meal thread they sit on the run's
        // LAST bubble, the one the eye lands on. STATE.comments still holds the reaction rows
        // that threadMessages filters out of the display.
        const rx = c === rxAt && c.meal_id
          ? reactionGroups((STATE.comments || []).filter((x) => x && x.meal_id === c.meal_id))
          : [];
        // Attached photo above the text; the stand-in caption is suppressed under its own image.
        const photo = attachedPhoto(c);
        const photoOnly = isPhotoOnly(c);
        // The face rides the LAST bubble of a run, the name the first: the phone's layout, and
        // chat-view.js msgRowClass's contract (`last` carries the tail).
        const cls = msgRowClass({ mine, role: c.role, firstOfRun: item.firstOfRun, lastOfRun: item.lastOfRun, hasRx: rx.length > 0, photoOnly })
          + (FRESH.has(String(c.id)) ? ' in' : '');
        return `
      <div class="${cls}" data-cid="${esc(String(c.id || ''))}"${c.meal_id ? ` data-meal-id="${esc(c.meal_id)}"` : ''}>
        ${!mine && item.lastOfRun ? `<div class="av"${c.role !== 'ai' && c.author_id ? ` data-avatar-uid="${esc(c.author_id)}"` : ''}>${c.role === 'ai' ? NIA_MARK : `<span data-avatar-fallback>${esc(initialsFor(who))}</span>`}</div>` : '<div class="av-sp"></div>'}
        <div class="stack">
          ${item.firstOfRun && !mine ? whoHtml(who, c.role === 'ai', esc) : ''}
          ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : rq}
          ${''/* No "Updated analysis" badge (founder: robotic). The quote stem above already
               shows what a correction reply answers. The escalation badge stays: "this reached
               your coach" is a fact worth labeling, exactly as the meal thread labels it. */}
          ${bubblesHtml(c, esc, {
            photo: !!photo,
            head: `${escalated ? `<span class="esc">${escalationChip(c, S.coach)}</span>` : ''}${bubblePhotoHtml(photo, esc)}`,
            body: photoOnly ? '' : bubbleText(c),
            after: `${offerChips(c)}${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}`,
          })}
          ${deliveredHtml({ mine, isLast: c === newest })}
        </div>
        ${msgTimeHtml(c, fmtTime, esc)}
      </div>`;
      }).join('');
    };

    // The Yes / No under a remember-this reply, while the fact is still pending. Once answered
    // (this session, or on any earlier one the fetch knows about) the bubble is just a reply.
    const offerChips = (c) => {
      const offer = memoryOfferOf(c);
      if (!offer) return '';
      if (ANSWERED_FACTS.has(offer.id)) return '';
      if (PENDING_IDS && !PENDING_IDS.has(offer.id)) return '';
      return memoryOfferChips(offer, esc);
    };

    // What should I eat (2026-09-10), exactly as the meal thread draws it: the AI framed it and
    // Food Memory fills it at paint time against the live day, the same remaining math Plan > Ask
    // uses. A tap stages the meal through Plan's own one-tap re-log path.
    const suggestRemaining = () => {
      const PS = S.planStyle || {}, T = S.planTargets || {}, c = S.dayConsumed || {};
      return remainingToday({
        proteinSoFar: c.protein, kcalSoFar: c.kcal,
        proteinTarget: PS.showMacros ? T.protein : null, kcalTarget: PS.showCalories ? T.calories : null,
      });
    };
    const suggestItems = () => { const fm = foodMemory(RT.userId); return fm ? fm.items : []; };
    const bubbleText = (c) => {
      const sug = mealSuggestOf(c);
      if (!sug) return c.role === 'ai' ? richText(c.text, esc) : personText(c.text, esc);
      return mealSuggestHtml(sug, fillMealSuggestion(sug, suggestItems(), suggestRemaining()), esc);
    };

    const load = async ({ older = false } = {}) => {
      if (busy) return;
      busy = true;
      const beforeISO = older && STATE.comments.length ? STATE.comments[0].created_at : null;
      const [fetched, meals, people, pending] = await Promise.all([
        roles.fetchMyMealThread(RT.userId, { beforeISO, limit: PAGE }),
        // null = the meals fetch FAILED (the fetcher's own contract); [] = truly no meals.
        older ? Promise.resolve(STATE.meals) : roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(WINDOW_DAYS)).catch(() => null),
        roles.fetchThreadParticipants(RT.userId).catch(() => []),
        // Which remember-this offers are still open. null on failure = unknown, so chips stay.
        act.pendingMemoryFacts().then((rows) => new Set((rows || []).map((f) => String(f.id)))).catch(() => null),
      ]);
      busy = false;
      if (pending) PENDING_IDS = pending;
      if (fetched && fetched.error) {
        // An older page that fails must not tear down the conversation already on screen —
        // losing a fortnight of scroll to one dropped request reads as the app eating the thread.
        if (older && STATE.comments.length) { setNote("Couldn't load earlier messages. Try again."); paint(); return; }
        STATE.error = true; paint(); return;
      }
      const rows = Array.isArray(fetched) ? fetched : [];
      const mealsKnown = Array.isArray(meals);
      STATE = {
        uid: RT.userId,
        comments: older ? rows.concat(STATE.comments) : rows,
        // On failure keep what we had; stale meals beat a thread stripped of its plates.
        meals: mealsKnown ? meals : STATE.meals,
        mealsError: older ? STATE.mealsError : !mealsKnown,
        participants: Array.isArray(people) ? people : [],
        oldestISO: rows.length ? rows[0].created_at : STATE.oldestISO,
        // A short page means we have reached the start of what there is.
        more: rows.length >= PAGE,
        error: false,
      };
      // A chosen plate that has aged out of the window is no longer a target the athlete can see;
      // fall back to the latest rather than posting to a meal that is not on screen.
      if (REPLY_TO && !mealById(STATE.meals, REPLY_TO)) REPLY_TO = null;
      paint();
    };

    root.addEventListener('click', (ev) => {
      // Aim the composer at a plate. The card IS the control, so the gesture matches the sentence
      // the screen has always invited: "same plate as Thursday?".
      const card = ev.target && ev.target.closest ? ev.target.closest('.nc-div[data-meal-id]') : null;
      if (card) {
        const id = card.getAttribute('data-meal-id');
        const latest = latestMeal(STATE.meals);
        REPLY_TO = (latest && id === latest.id) ? null : id;
        paint();
        focusComposer(root.querySelector('#nc-msg'));
        return;
      }
      // A remember-this answer. The tap is the ONLY thing that lets a chat-heard fact bind; the
      // chips go on the next paint and the confirmation itself is state.js's, shared with the
      // meal thread's pending-fact row.
      // A suggested usual meal: stage it through the same confirm gate Plan's one-tap re-log
      // uses (plan.js data-fm-log), so it is reviewed before it counts.
      const fm = ev.target && ev.target.closest ? ev.target.closest('[data-fm-log]') : null;
      if (fm) {
        if (act.stageSavedMeal(fm.getAttribute('data-fm-log'))) location.hash = '#meal-analysis';
        return;
      }
      const fx = ev.target && ev.target.closest ? ev.target.closest('[data-fact]') : null;
      if (fx) {
        const id = fx.getAttribute('data-fact');
        ANSWERED_FACTS.add(id);
        if (PENDING_IDS) PENDING_IDS.delete(id);
        void act.confirmMemoryFact(id, fx.getAttribute('data-keep') === '1');
        paint();
        return;
      }
      const t = ev.target && ev.target.closest ? ev.target.closest('#nc-earlier, #nc-retry, #nc-members, #nc-target-clear, #nc-retry-ai') : null;
      if (!t) return;
      if (t.id === 'nc-members') { openMembersSheet(participantList(STATE.participants, RT.userId)); return; }
      if (t.id === 'nc-target-clear') { REPLY_TO = null; paint(); focusComposer(root.querySelector('#nc-msg')); return; }
      if (t.id === 'nc-retry-ai') { setNote(''); void askAI(lastAsk.text, lastAsk.mealId, lastAsk.turn); return; }
      if (t.id === 'nc-retry') { STATE.error = false; paint(); void load(); return; }
      t.disabled = true; t.textContent = 'Loading…';
      void load({ older: true });
    });

    await load();

    // Attached photos open in the shared full-screen viewer; delegated on the thread element
    // because every paint replaces the <img> nodes.
    threadEl.addEventListener('click', (ev) => {
      const im = ev.target && ev.target.closest ? ev.target.closest('img.bimg') : null;
      if (!im || !im.src) return;
      openImageViewer(im.src, 'Photo attached to this message', im);
    });

    /* Tapback parity with the meal thread (press and hold a bubble). Reactions are meal-level
       rows, and this thread spans many meals, so the target is the pressed bubble's own meal:
       a capture-phase tracker records the data-meal-id under the finger before the long press
       resolves, since the picker itself only hands back the emoji. */
    let rxBusy = false;
    let rxMealId = null;
    const trackPress = (ev) => {
      const msg = ev.target && ev.target.closest ? ev.target.closest('.msg[data-meal-id]') : null;
      if (msg) rxMealId = msg.getAttribute('data-meal-id') || null;
    };
    threadEl.addEventListener('pointerdown', trackPress, true);
    threadEl.addEventListener('contextmenu', trackPress, true);
    // A reply answers one message, and a message belongs to a plate: replying also aims the
    // composer at that message's meal, so the answer lands in the same meal's thread.
    const startReply = (row) => {
      const id = row && row.getAttribute('data-cid');
      const c = threadMessages(STATE.comments).find((x) => x && String(x.id) === id);
      if (!c) return;
      const mineRow = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
      const who = mineRow ? 'You' : authorName(c, STATE.participants, RT.userId, S.coach.noun);
      setReply(NC, replyTargetMeta(c, who));
      if (c.meal_id && mealById(STATE.meals, c.meal_id)) {
        const latest = latestMeal(STATE.meals);
        REPLY_TO = latest && latest.id === c.meal_id ? null : c.meal_id;
        paintTarget();
      }
      paintReplyChip(root.querySelector('.chat-dock'), NC, esc);
      focusComposer(root.querySelector('#nc-msg'));
    };
    // Drag the conversation left to see when each message was sent; one message right to reply.
    wireChatTimes({ root, scope: '#nc-thread', onReply: startReply });
    wireTapback({
      root,
      scope: '#nc-thread',
      onReply: startReply,
      emoji: REACTION_EMOJI,
      mine: () => new Set((STATE.comments || [])
        .filter((x) => x && x.kind === 'reaction' && x.author_id === RT.userId && (!rxMealId || x.meal_id === rxMealId))
        .map((x) => String(x.text))),
      onReact: async (emoji) => {
        if (!emoji || !rxMealId || rxBusy) return;
        rxBusy = true;
        // TOGGLE, mirroring the meal thread: no uniqueness constraint backs reaction rows, so an
        // un-toggled control would let one athlete write unbounded rows.
        const existing = (STATE.comments || []).find((x) => x && x.kind === 'reaction'
          && x.author_id === RT.userId && x.meal_id === rxMealId && String(x.text) === emoji);
        const ok = existing
          ? await roles.deleteMealComment(existing.id)
          : await roles.postMealComment(rxMealId, RT.userId, RT.userId, 'athlete', emoji, 'reaction');
        if (ok) await load(); else setNote("Couldn't save that reaction. Try again.");
        rxBusy = false;
      },
    });

    /* ---- LIVE: reaching the AI ---------------------------------------------------------------
       Reaches the AI for an ALREADY-POSTED question, exactly as the meal thread does: the
       athlete's comment lands in meal_comments once, and a retry re-runs only this, so a failed
       reply can never duplicate the question. The AI's row is persisted server-side by meal-chat,
       so success is followed by a refetch, never by appending data.reply by hand. */
    let lastAsk = { text: '', mealId: null, turn: null };
    const askAI = async (text, mealId, turn = null) => {
      if (!mealId) return;
      lastAsk = { text, mealId, turn };
      // AI CONSENT (0243): ask the first time; after a Not now the AI stays quiet, said plainly.
      if (!(await ensureAiConsent(RT.userId, { role: 'athlete' }))) { setNote(aiMinorPending(RT.userId) ? `Your message is posted. ${AI_MINOR_LINE}` : AI_OFF_REPLY_NC); return; }
      const meal = mealById(STATE.meals, mealId);
      // Visible from the moment it is asked, not after two fetches (2026-09-22).
      setTyping(true);
      try {
        // Saved usual meals, so the AI can name what THEY eat and a suggest_meal bubble has
        // something to fill from. Cached a minute; a cold miss just means an empty list.
        await warmFoodMemory(roles, RT.userId).catch(() => null);
        const ex = S.exec || {};
        const dp = S.mealDayProgress || {};
        // contextForChat's 8KB clamp drops from the FRONT of recentMeals, so recent meals go in
        // oldest→newest or the clamp discards the newest instead of the oldest. STATE.meals is
        // day_date DESC, so reversing gives ascending.
        const recentAscending = (STATE.meals || []).slice().reverse();
        const context = contextForChat({
          meal: meal ? {
            name: meal.name, slot: meal.type,
            macros: { protein: meal.protein, carbs: meal.carbs, fat: meal.fat, kcal: meal.kcal },
            fiber: meal.fiber, quality: meal.quality, note: meal.note,
            // The plate is not necessarily today's. This screen's whole point is that an athlete
            // can ask about Thursday, so the AI is told WHEN the plate it is discussing was eaten
            // — without it, "how does this fit my day" would be answered against the wrong day.
            loggedAt: meal.logged_at, day: meal.day_date,
            // Per-item provenance, as the meal thread sends it: which item carries which value
            // and where it came from. This screen used to send totals only, so its AI could
            // neither discuss a single item honestly nor aim a correction at one.
            foods: foodsFor(meal),
          } : {},
          plan: { goal: RT.profile && RT.profile.baseGoal, targets: S.planTargets, allergies: RT.allergies },
          exec: { met: ex.met, total: ex.total, score: ex.score, possible: ex.possible, next: ex.now && ex.now.title },
          day: { proteinSoFar: dp.proteinSoFar, proteinTarget: dp.proteinTarget, mealsRemaining: dp.mealsRemaining },
          recentMeals: recentAscending.map((m) => ({ type: m.type, protein: m.protein, kcal: m.kcal, quality: m.quality, date: m.day_date })),
          // Identity-preserving transcript (ai-thread.js) — see the note in meal.js.
          thread: turn ? turn.thread : threadMessages(STATE.comments).slice(-20).map((c) => ({ role: c.role, senderId: c.author_id || null, text: String(c.text).slice(0, 300) })),
          usualMeals: suggestItems(),
        });
        const c = typeof window !== 'undefined' ? window.sb : null;
        if (!c || !c.functions) { setTyping(false); return; }
        // Structured corrections only for TODAY's plates: correctMeal rewrites the day record,
        // and an older meal is not in it. The flag is the capability contract meal-chat keys the
        // apply_correction tool on, so it is sent only when the handler below can actually act.
        const slot = todaySlotFor(mealId);
        const { data, error } = await c.functions.invoke('meal-chat', {
          body: {
            mealId, question: text, context,
            // WHO IS EATING (founder 2026-09-13). Same builder the meal read uses, so this
            // screen and the thread describe the same athlete: sport, position spelled out,
            // level, bodyweight, training or rest day.
            ...athleteContextForAnalysis(),
            // The addressing decision, re-checked server-side (ai-addressing.js).
            ...(turn ? { speaker: turn.outgoing, addressing: turn.decision, participants: turn.participants } : {}),
            ...(slot ? { canApplyCorrection: true, canConfirmCorrection: true } : {}),
            // "I render the remember-this chips": unlocks the remember tool server-side.
            canRemember: true,
            // "I fill a suggest_meal bubble from Food Memory": unlocks the suggest_meal tool.
            canSuggestMeal: true,
          },
        });
        setTyping(false);
        // Same verdict, reached server-side: the AI was not addressed, so it stays quiet.
        if (data && data.silent) return;
        if (isConsentSkip(data)) { noteAiConsentRequired(RT.userId); setNote(aiMinorPending(RT.userId) ? `Your message is posted. ${AI_MINOR_LINE}` : AI_OFF_REPLY_NC); return; }
        if (error || !data || data.error) {
          // The vendored supabase-js throws FunctionsHttpError on any non-2xx, so `data` is null
          // and the function's JSON error body never reaches it — parse it off error.context,
          // the same way the meal thread does.
          let parsed = data && data.error ? data : null;
          if (!parsed && error && error.context && typeof error.context.json === 'function') {
            parsed = await error.context.json().catch(() => null);
          }
          if (parsed && parsed.error === 'limit') setNote("Nia is out of replies for today. Back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach Nia. Your message was sent. Tap to try again.", true);
          return;
        }
        setNote('');
        // A fresh offer is pending by definition; mark it so the chips draw before the refetch
        // of pending facts catches up.
        if (data.memory && data.memory.id && PENDING_IDS) PENDING_IDS.add(String(data.memory.id));
        // THE CORRECTION LOOP, as the meal thread closes it (correction-turn.js): applied first,
        // then Nia says what happened, in the thread, from the server. Never a line under the box.
        if (data.correction && slot && (data.pending || data.correction.item || ['missed', 'more'].some((k) => Array.isArray(data.correction[k]) && data.correction[k].length))) {
          setTyping(true);
          const live = mealDetail(slot);
          const { runChatCorrection } = await import('../correction-turn.js');
          const res = await runChatCorrection({
            act, sb: c, uid: RT.userId, slot, mealId, meta: DAY.slotMacros[slot] || live || {}, data, said: text,
            minutesLate: live ? live.minutesLate : undefined,
          });
          setTyping(false);
          if (res.note) setNote(res.note);
        }
        // Not forced: load()'s paint carries a reader who was at the end to Nia's reply, and a
        // reader who scrolled up while she was typing is not yanked (the pill says she answered).
        await load();
        startBurst();
      } catch {
        setTyping(false);
        setNote("Couldn't reach Nia. Your message was sent. Tap to try again.", true);
      }
    };

    /* ---- LIVE: the thread keeps itself current ------------------------------------------------
       Two mechanisms, for the reason the meal thread has two: realtime is the fast path and a
       socket fails SILENTLY (a dropped connection, an expired token, a table never added to the
       publication), where a poll just retries. So the poll is the floor and simply runs slower
       once the socket confirms. Without either, an AI reply that lands a second after the refetch
       stayed invisible until the athlete left the screen and came back. */
    let rtLive = false;
    let burstUntil = 0;
    const BASE_MS = 20000, SLOW_MS = 60000, BURST_MS = 2500, FOCUS_MS = 8000;
    let tick = null;
    const tickDelay = () => {
      if (Date.now() < burstUntil) return BURST_MS;
      const el = root.querySelector('#nc-msg');
      if (el && typeof document !== 'undefined' && document.activeElement === el) return FOCUS_MS;
      return rtLive ? SLOW_MS : BASE_MS;
    };
    // A self-rescheduling timeout, not setInterval: the delay is re-decided every tick.
    const scheduleTick = () => {
      try { clearTimeout(tick); } catch { /* first */ }
      tick = setTimeout(async () => {
        if (typeof document === 'undefined' || !document.hidden) {
          if (!busy) await load().catch(() => {});
        }
        if (root.isConnected) scheduleTick();   // stop rescheduling once the screen is gone
      }, tickDelay());
    };
    const startBurst = (ms = 20000) => { burstUntil = Date.now() + ms; scheduleTick(); };
    scheduleTick();

    void (async () => {
      try {
        const c = typeof window !== 'undefined' ? window.sb : null;
        if (!c || typeof c.channel !== 'function' || !RT.userId) return;
        // Scoped to the ATHLETE, not to one meal: this screen is every meal they have. RLS still
        // decides what the socket may deliver, exactly as it decides what the fetch may read.
        const ch = c.channel(`nutrition_chat:${RT.userId}`)
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'meal_comments', filter: `athlete_id=eq.${RT.userId}` },
            () => { if (root.isConnected && !busy) void load().catch(() => {}); })
          .subscribe((status) => {
            rtLive = status === 'SUBSCRIBED';
            scheduleTick();   // going live relaxes the poll now; losing it tightens it back up
          });
        // Close the socket when the athlete leaves. The channel is created per mount here (unlike
        // the meal thread's cross-mount reuse) because its filter is the user, which never
        // changes within a session, and one screen owning one channel is the simpler contract.
        const watch = setInterval(() => {
          if (root.isConnected) return;
          clearInterval(watch);
          try { clearTimeout(tick); } catch { /* already fired */ }
          try { void ch.unsubscribe(); } catch { /* already gone */ }
        }, 5000);
      } catch { /* no realtime — the poll above is the whole mechanism */ }
    })();

    // The composer posts to the plate named in the strip above it: the athlete's chosen meal, or
    // their genuinely-latest one. Every message row belongs to a meal, so there is no such thing
    // as a message about nothing — but which meal is now stated, not guessed.
    const input = root.querySelector('#nc-msg');
    const send = root.querySelector('#nc-send');
    const dockEl = () => root.querySelector('.chat-dock');
    /* ONE SEND IS ONE INTENT (2026-09-22): lock, outbox bubble and duplicate window in
       chat-live.js, so the bubble shows the instant Send is tapped and a failed one stays as
       "Not delivered" with a retry. The post goes through postChatMessage, the same door the
       other three composers use, which also brings this one the content filter it never had. */
    const deliver = async (item, target) => {
      const res = await postChatMessage(roles, {
        mealId: target.id, athleteId: RT.userId, authorId: RT.userId, role: 'athlete',
        text: item.text, replyTo: item.replyTo || null,
      });
      endSend(NC, item.lid, { ok: res.ok });
      if (!res.ok) {
        if (res.error === 'filtered') {
          takeFailed(NC, item.lid);
          if (input && !input.value) input.value = item.text;
          setNote(FILTERED_NOTE);
        }
        return;
      }
      const text = item.text;
      // THE COACH HEARS IT (founder 2026-09-15). This composer posted and told nobody; the meal
      // thread's own composer already did. Same call, same kind, after the row landed.
      act.notifyCoachEvent({
        kind: `athlete_message:${target.id}`, urgent: true,
        title: `${S.athlete.first || 'Your athlete'} asked about ${mealLabel(target)}`,
        body: `${text.slice(0, 140)} · Tap to open the conversation.`,
        route: `coach-meal/${target.id}`,
      });
      await load();
      // Forced: they just sent it and are watching for it to land.
      scrollThreadToEnd(root, { force: true });
      /* And now the room answers — IF the room was talking to it. The unconditional askAI here
         is what made the AI reply to "yes coach". Same gate as the meal thread. */
      const turn = decideAiTurn({
        text,
        comments: STATE.comments,
        participants: STATE.participants || [],
        self: { id: RT.userId, name: S.athlete.first || 'Athlete', role: 'athlete' },
        athleteName: S.athlete.first || 'Athlete',
        fallbackNoun: S.coach.noun,
      });
      if (!turn.decision.shouldRespond) return;
      startBurst();
      void askAI(text, target.id, turn);
    };
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      const target = REPLY_TO ? mealById(STATE.meals, REPLY_TO) : latestMeal(STATE.meals);
      if (!target) {
        // Only claim "no meals" when we actually KNOW there are none.
        setNote(STATE.mealsError
          ? "Couldn't check your recent meals. Give it a moment and try again."
          : 'Log a meal first. A message belongs to a plate.');
        return;
      }
      const claim = beginSend(NC, { text, replyTo: replyOf(NC) });
      if (!claim.ok) { if (claim.reason === 'duplicate') setNote('You just sent that.'); return; }
      claim.item.mealId = target.id;
      setNote('');
      input.value = '';
      clearReply(NC);
      paintReplyChip(dockEl(), NC, esc);
      await deliver(claim.item, target);
    };
    const retryItem = async (item) => {
      const target = mealById(STATE.meals, item.mealId) || latestMeal(STATE.meals);
      if (!target) return;
      const claim = beginSend(NC, { text: item.text, replyTo: item.replyTo });
      if (!claim.ok) return;
      claim.item.mealId = target.id;
      await deliver(claim.item, target);
    };
    const placeLive = () => {
      if (!threadEl || !threadEl.isConnected) return;
      const hold = holdThread(threadEl, NC);
      const sending = syncLive(threadEl, NC, { esc, imgSrc: safeImg });
      followThread(hold, { force: sending, smooth: true });
    };
    bindLive(NC, { sync: placeLive, onRetry: retryItem });
    placeLive();
    paintReplyChip(dockEl(), NC, esc);
    wireThreadTaps({ root, scope: '#nc-thread', key: NC });
    if (send) send.addEventListener('click', submit);
    // isComposing: Enter inside an IME composition (CJK keyboards) is choosing a character,
    // not sending — firing submit there ships half a word.
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  },
};
