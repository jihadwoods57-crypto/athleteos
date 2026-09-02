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

import { S, RT, act, mealDetail } from '../state.js';
import { MEAL_KEYS } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, composer } from '../components.js';
import { threadMessages, reactionGroups, REACTION_EMOJI, contextForChat } from '../meal-intel.js';
import { stitchNutritionChat } from '../thread-stitch.js';
import {
  layoutThread, authorName, initialsFor, participantList, participantSummary,
  isAnalysisUpdate, quotedFor, isEscalated,
  memoryOfferOf, memoryOfferChips,
  dayLabelOf,
} from '../chat-view.js';
import { attachedPhoto, isPhotoOnly, bubblePhotoHtml, hydrateThreadPhotos } from '../chat-attach.js';
import { wireTapback } from '../tapback.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { cachedMealPhoto, warmMealPhotos } from '../photo-store.js';
import { scrollThreadToEnd, focusComposer } from '../keyboard.js';
import { wireReadMore } from '../thread-readmore.js';

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
   instead of waiting for a refetch. Module scope for the same reason EXPANDED_BUBBLES is. */
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

/* Long AI bubbles the athlete has opened, keyed on each bubble's own text head. MODULE scope, so
   an expansion survives every repaint — and this screen repaints on every poll tick. */
const EXPANDED_BUBBLES = new Set();

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

  render() {
    // The room is not named until the participants land. It used to render the facepile from an
    // empty list, which appends the AI and nothing else — so the first frame of a thread with a
    // coach in it read "AI Nutritionist · 1 in this conversation". A room stated wrong for a beat
    // is still a room stated wrong; say nothing until it is known.
    return `${backHead('Nutrition chat', '', 'home')}
    <button class="facepile" id="nc-members" aria-label="Who can see this conversation">
      <span class="fp"></span>
      <span class="names">Loading the room<small>Who can read this</small></span>
      <span class="chev">${icon('chevron', 15)}</span>
    </button>
    <div class="thread nc-thread" id="nc-thread" role="log" aria-label="Nutrition chat">
      <div class="msg-status" id="nc-status">Loading your conversation…</div>
    </div>
    <div class="nc-target" id="nc-target" hidden></div>
    ${composer({ inputId: 'nc-msg', sendId: 'nc-send', placeholder: 'Ask about this meal…', sendLabel: 'Send', atEnd: true })}
    <div id="nc-note" style="min-height:18px"></div>`;
  },

  async mount(root) {
    const roles = await import('../roles.js');
    const threadEl = root.querySelector('#nc-thread');
    const noteEl = root.querySelector('#nc-note');
    let busy = false;
    // LIVE: the AI is composing. The same indicator the meal thread has, for the same reason —
    // the reply is written server-side, so without it the athlete's question just sits there.
    let aiTyping = false;
    const setNote = (t, retry) => { if (noteEl) noteEl.innerHTML = t ? `<div class="mt-retry"${retry ? ' id="nc-retry-ai"' : ''}>${esc(t)}</div>` : ''; };

    // render() runs before any data exists, so the header would otherwise be stuck reading
    // "AI Nutritionist · 1 in this conversation" — the participants land a moment later and the
    // room has to be named correctly, not almost.
    const paintHeader = () => {
      const btn = root.querySelector('#nc-members');
      if (!btn) return;
      const people = participantList(STATE.participants, RT.userId);
      btn.querySelector('.fp').innerHTML = people.slice(0, 4).map((p) =>
        `<span class="fpav ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}">${p.kind === 'ai' ? icon('sparkle', 13) : esc(initialsFor(p.name))}</span>`).join('');
      btn.querySelector('.names').innerHTML = `${esc(participantSummary(people))}<small>${people.length} in this conversation</small>`;
      const sub = root.querySelector('.back-head .hs');
      if (sub) sub.textContent = participantSummary(people);
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
      el.innerHTML = `<span class="nct-label">Replying about</span>
        <span class="nct-meal">${esc(mealLabel(meal))}</span>
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
      const msgs = threadMessages(STATE.comments);
      if (!msgs.length && !STATE.meals.length) {
        // Empty because there IS nothing, or empty because the meals fetch died? Opposite
        // messages — one invites a first log, the other must not pretend the logs are gone.
        threadEl.innerHTML = STATE.mealsError
          ? `<div class="msg-status">Couldn't load your meals right now. Your logs are safe. <span class="link" id="nc-retry" role="button">Try again</span></div>`
          : `<div class="msg-status">Nothing here yet. Log a meal and the AI Nutritionist starts the conversation.</div>`;
        paintTarget();
        return;
      }
      const { items } = stitchNutritionChat({ meals: STATE.meals, comments: msgs });
      // Lay each meal's messages out on their own, so a run and a time separator never straddle
      // a divider — a "9:07 AM" floating above yesterday's photo card reads as a bug.
      const html = [];
      if (STATE.more) html.push(`<button class="btn ghost sm" id="nc-earlier" style="align-self:center">Load earlier</button>`);
      const latest = latestMeal(STATE.meals);
      const targetId = REPLY_TO || (latest ? latest.id : null);
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        html.push(renderRun(run, STATE.participants, msgs));
        run = [];
      };
      for (const item of items) {
        if (item.type === 'divider') { flushRun(); html.push(dividerHtml(item.meal, targetId)); }
        else run.push(item.comment);
      }
      flushRun();
      if (aiTyping) html.push(typingRow());
      threadEl.innerHTML = html.join('');
      // `.thread` is a flex column and has never had a scrollTop — the screen's scroller is
      // #viewport, so the old line here moved nothing. Unforced: "Load earlier" must not fling the
      // reader back to today the instant the older page paints.
      scrollThreadToEnd(threadEl);
      paintHeader();
      paintTarget();
      // A long opener clamps to four lines with a Read more, exactly as it does on the meal
      // thread. composeOpenerText is WRITTEN against this control (see meal-opener.ts): it packs
      // history, timing and its uncertainty line after the core on the promise that the client
      // clamps them. Without it this screen rendered the full 1000 characters as one wall.
      wireReadMore(threadEl, EXPANDED_BUBBLES);
      // Attached message photos resolve after paint (signed URLs are async), same as the meal
      // thread. Safe on every repaint.
      void hydrateThreadPhotos(threadEl, roles);
      // Fill in any meal photos that were not cached at paint time, then repaint once.
      warmMealPhotos(STATE.meals.map((m) => m.photo_path).filter(Boolean));
    };

    // LIVE: the same typing row the meal thread paints, so a question visibly reaches someone.
    const typingRow = () => `
      <div class="msg ai typing" id="nc-ai-typing">
        <div class="av">${icon('sparkle', 15)}</div>
        <div class="stack"><div class="who">AI Nutritionist is typing<span class="sr-only">, a reply is on its way</span></div>
        <div class="bubble tdots"><span></span><span></span><span></span></div></div>
      </div>`;
    const setTyping = (on) => { aiTyping = !!on; paint(); };

    const renderRun = (list, participants, allMsgs) => {
      const lastMsg = list.length ? list[list.length - 1] : null;
      return layoutThread(list, { fmtTime, fmtDay: dayKey, fmtDayLabel: dayLabelOf }).map((item) => {
        if (item.type === 'time') return `<div class="tsep">${esc(item.label)}</div>`;
        const c = item.comment;
        const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
        const who = authorName(c, participants, RT.userId, S.coach.noun);
        const update = isAnalysisUpdate(c);
        const escalated = isEscalated(c);
        const quoted = update ? quotedFor(c, allMsgs) : null;
        // Reactions are meal-level rows (0049); as on the meal thread they sit on the run's
        // LAST bubble, the one the eye lands on. STATE.comments still holds the reaction rows
        // that threadMessages filters out of the display.
        const rx = c === lastMsg && c.meal_id
          ? reactionGroups((STATE.comments || []).filter((x) => x && x.meal_id === c.meal_id))
          : [];
        // Attached photo above the text; the stand-in caption is suppressed under its own image.
        const photo = attachedPhoto(c);
        const photoOnly = isPhotoOnly(c);
        return `
      <div class="msg ${mine ? 'athlete' : c.role === 'ai' ? 'ai' : 'coach'}${item.firstOfRun ? '' : ' cont'}${rx.length ? ' has-rx' : ''}"${c.meal_id ? ` data-meal-id="${esc(c.meal_id)}"` : ''}>
        ${!mine && item.firstOfRun ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : esc(initialsFor(who))}</div>` : '<div class="av-sp"></div>'}
        <div class="stack">
          ${item.firstOfRun && !mine ? `<div class="who">${esc(who)}</div>` : ''}
          ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : ''}
          ${''/* No "Updated analysis" badge (founder: robotic). The quote stem above already
               shows what a correction reply answers. The escalation badge stays: "this reached
               your coach" is a fact worth labeling, exactly as the meal thread labels it. */}
          <div class="bubble">${escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : esc(c.text)}${offerChips(c)}</div>
          ${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}
        </div>
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
      if (t.id === 'nc-retry-ai') { setNote(''); void askAI(lastAsk.text, lastAsk.mealId); return; }
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
    wireTapback({
      root,
      scope: '#nc-thread',
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
    let lastAsk = { text: '', mealId: null };
    const askAI = async (text, mealId) => {
      if (!mealId) return;
      lastAsk = { text, mealId };
      const meal = mealById(STATE.meals, mealId);
      try {
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
          thread: threadMessages(STATE.comments).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
        });
        setTyping(true);
        const c = typeof window !== 'undefined' ? window.sb : null;
        if (!c || !c.functions) { setTyping(false); return; }
        // Structured corrections only for TODAY's plates: correctMeal rewrites the day record,
        // and an older meal is not in it. The flag is the capability contract meal-chat keys the
        // apply_correction tool on, so it is sent only when the handler below can actually act.
        const slot = todaySlotFor(mealId);
        const { data, error } = await c.functions.invoke('meal-chat', {
          body: {
            mealId, question: text, context,
            ...(slot ? { canApplyCorrection: true } : {}),
            // "I render the remember-this chips": unlocks the remember tool server-side.
            canRemember: true,
          },
        });
        setTyping(false);
        if (error || !data || data.error) {
          // The vendored supabase-js throws FunctionsHttpError on any non-2xx, so `data` is null
          // and the function's JSON error body never reaches it — parse it off error.context,
          // the same way the meal thread does.
          let parsed = data && data.error ? data : null;
          if (!parsed && error && error.context && typeof error.context.json === 'function') {
            parsed = await error.context.json().catch(() => null);
          }
          if (parsed && parsed.error === 'limit') setNote("You've hit today's AI coaching limit. Back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach your AI Nutritionist. Your message was sent. Tap to try again.", true);
          return;
        }
        setNote('');
        // A fresh offer is pending by definition; mark it so the chips draw before the refetch
        // of pending facts catches up.
        if (data.memory && data.memory.id && PENDING_IDS) PENDING_IDS.add(String(data.memory.id));
        // THE CORRECTION LOOP, as the meal thread closes it: the athlete stated a fact about their
        // own food and the AI called apply_correction instead of arguing. Applied deterministically
        // to today's record; the AI's acknowledgment row is already persisted server-side.
        if (data.correction && data.correction.item && slot) {
          const cr = data.correction;
          const live = mealDetail(slot);
          const applied = await act.correctMeal(slot, {
            kind: 'item', item: cr.item, newName: cr.newName || undefined,
            quantity: cr.quantity || undefined,
            per: cr.per || {}, add: cr.add || undefined, minutesLate: live ? live.minutesLate : undefined,
          }, { skipAiUpdate: true });
          // A correction that did not land must say so: the AI's "updating now" is already in the
          // thread, and silence here would leave that promise standing over unchanged numbers.
          if (!applied) setNote("That didn't line up with anything in this meal's read, so your numbers haven't changed. Open the meal to fix it there.");
          else if (applied.unpriced && applied.unpriced.length) setNote(`Added what I could price. No numbers on file for ${applied.unpriced.join(' or ')}, so it isn't counted yet. Open the meal to add it.`);
        }
        await load();
        startBurst();
        scrollThreadToEnd(root, { force: true });
      } catch {
        setTyping(false);
        setNote("Couldn't reach your AI Nutritionist. Your message was sent. Tap to try again.", true);
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
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text || busy) return;
      const target = REPLY_TO ? mealById(STATE.meals, REPLY_TO) : latestMeal(STATE.meals);
      if (!target) {
        // Only claim "no meals" when we actually KNOW there are none.
        setNote(STATE.mealsError
          ? "Couldn't check your recent meals. Give it a moment and try again."
          : 'Log a meal first. A message belongs to a plate.');
        return;
      }
      busy = true; setNote('');
      input.value = '';
      const posted = await roles.postMealComment(target.id, RT.userId, RT.userId, 'athlete', text);
      busy = false;
      if (!posted) { setNote("Couldn't send that. Check your connection and try again."); input.value = text; return; }
      await load();
      // Forced: they just sent it and are watching for it to land.
      scrollThreadToEnd(root, { force: true });
      // And now the room answers. Without this the athlete was typing into a conversation whose
      // only other named participant could not hear them.
      startBurst();
      void askAI(text, target.id);
    };
    if (send) send.addEventListener('click', submit);
    // isComposing: Enter inside an IME composition (CJK keyboards) is choosing a character,
    // not sending — firing submit there ships half a word.
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  },
};
