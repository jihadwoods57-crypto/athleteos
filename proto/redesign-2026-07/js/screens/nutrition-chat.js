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
 */

import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, composer } from '../components.js';
import { threadMessages, reactionGroups, REACTION_EMOJI } from '../meal-intel.js';
import { stitchNutritionChat } from '../thread-stitch.js';
import {
  layoutThread, authorName, initialsFor, participantList, participantSummary,
  isAnalysisUpdate, quotedFor, isEscalated,
  dayLabelOf,
} from '../chat-view.js';
import { attachedPhoto, isPhotoOnly, bubblePhotoHtml, hydrateThreadPhotos } from '../chat-attach.js';
import { wireTapback } from '../tapback.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { cachedMealPhoto, warmMealPhotos } from '../photo-store.js';
import { scrollThreadToEnd } from '../keyboard.js';

/** How far back the stream reaches on open. A season is long; a fortnight is what a person
 *  actually scrolls, and "Load earlier" walks back from there. */
const WINDOW_DAYS = 14;
const PAGE = 200;

/* mealsError: the meals fetch FAILED (fetchRecentMeals returns null on failure, [] on truly
   none) — the two must never blur, because "log a meal first" said to an athlete with a year of
   logs is a fabrication, the exact lie the fetcher itself was cured of. */
let STATE = { uid: null, comments: [], meals: [], participants: [], oldestISO: null, more: true, error: false, mealsError: false };

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

/** One meal, as it enters the conversation. */
function dividerHtml(meal) {
  if (!meal) {
    return `<div class="nc-div earlier"><span>Earlier in the season</span></div>`;
  }
  const url = meal.photo_path ? cachedMealPhoto(meal.photo_path) : null;
  const name = String(meal.name || meal.type || 'Meal');
  const when = meal.logged_at ? `${dayLabel(meal.logged_at)} · ${fmtTime(meal.logged_at)}` : dayLabel(meal.day_date);
  const score = typeof meal.quality === 'number' ? meal.quality : null;
  return `
    <div class="nc-div">
      <span class="nc-thumb"${url ? ` style="background-image:url('${esc(url)}')"` : ''}>${url ? '' : icon('camera', 15)}</span>
      <span class="nc-meta">
        <b>${esc(name)}</b>
        <small>${esc(when)}</small>
      </span>
      ${score != null ? `<span class="nc-score">${score}</span>` : ''}
    </div>`;
}

export default {
  nav: 'athlete',

  render() {
    const people = participantList(STATE.uid === RT.userId ? STATE.participants : [], RT.userId);
    return `${backHead('Nutrition chat', participantSummary(people), 'home')}
    <button class="facepile" id="nc-members" aria-label="Who can see this conversation">
      <span class="fp">${people.slice(0, 4).map((p) => `<span class="fpav ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}">${p.kind === 'ai' ? icon('sparkle', 13) : esc(initialsFor(p.name))}</span>`).join('')}</span>
      <span class="names">${esc(participantSummary(people))}<small>${people.length} in this conversation</small></span>
      <span class="chev">${icon('chevron', 15)}</span>
    </button>
    <div class="thread nc-thread" id="nc-thread" role="log" aria-label="Nutrition chat">
      <div class="msg-status" id="nc-status">Loading your conversation…</div>
    </div>
    ${composer({ inputId: 'nc-msg', sendId: 'nc-send', placeholder: 'Reply about your latest meal…', sendLabel: 'Send', atEnd: true })}
    <div id="nc-note" style="min-height:18px"></div>`;
  },

  async mount(root) {
    const roles = await import('../roles.js');
    const threadEl = root.querySelector('#nc-thread');
    const noteEl = root.querySelector('#nc-note');
    let busy = false;
    const setNote = (t) => { if (noteEl) noteEl.innerHTML = t ? `<div class="mt-retry">${esc(t)}</div>` : ''; };

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
        return;
      }
      const { items } = stitchNutritionChat({ meals: STATE.meals, comments: msgs });
      // Lay each meal's messages out on their own, so a run and a time separator never straddle
      // a divider — a "9:07 AM" floating above yesterday's photo card reads as a bug.
      const html = [];
      if (STATE.more) html.push(`<button class="btn ghost sm" id="nc-earlier" style="align-self:center">Load earlier</button>`);
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        html.push(renderRun(run, STATE.participants, msgs));
        run = [];
      };
      for (const item of items) {
        if (item.type === 'divider') { flushRun(); html.push(dividerHtml(item.meal)); }
        else run.push(item.comment);
      }
      flushRun();
      threadEl.innerHTML = html.join('');
      // `.thread` is a flex column and has never had a scrollTop — the screen's scroller is
      // #viewport, so the old line here moved nothing. Unforced: "Load earlier" must not fling the
      // reader back to today the instant the older page paints.
      scrollThreadToEnd(threadEl);
      paintHeader();
      // Attached message photos resolve after paint (signed URLs are async), same as the meal
      // thread. Safe on every repaint.
      void hydrateThreadPhotos(threadEl, roles);
      // Fill in any meal photos that were not cached at paint time, then repaint once.
      warmMealPhotos(STATE.meals.map((m) => m.photo_path).filter(Boolean));
    };

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
          <div class="bubble">${escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : esc(c.text)}</div>
          ${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}
        </div>
      </div>`;
      }).join('');
    };

    const load = async ({ older = false } = {}) => {
      if (busy) return;
      busy = true;
      const beforeISO = older && STATE.comments.length ? STATE.comments[0].created_at : null;
      const [fetched, meals, people] = await Promise.all([
        roles.fetchMyMealThread(RT.userId, { beforeISO, limit: PAGE }),
        // null = the meals fetch FAILED (the fetcher's own contract); [] = truly no meals.
        older ? Promise.resolve(STATE.meals) : roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(WINDOW_DAYS)).catch(() => null),
        roles.fetchThreadParticipants(RT.userId).catch(() => []),
      ]);
      busy = false;
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
      paint();
    };

    root.addEventListener('click', (ev) => {
      const t = ev.target && ev.target.closest ? ev.target.closest('#nc-earlier, #nc-retry, #nc-members') : null;
      if (!t) return;
      if (t.id === 'nc-members') { openMembersSheet(participantList(STATE.participants, RT.userId)); return; }
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

    // The composer posts to the athlete's most recent meal: every message row belongs to a meal,
    // so there is no such thing as a message about nothing. The placeholder says which one.
    const input = root.querySelector('#nc-msg');
    const send = root.querySelector('#nc-send');
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text || busy) return;
      const latest = STATE.meals.length ? STATE.meals[0] : null;
      if (!latest) {
        // Only claim "no meals" when we actually KNOW there are none.
        setNote(STATE.mealsError
          ? "Couldn't check your recent meals. Give it a moment and try again."
          : 'Log a meal first. A message belongs to a plate.');
        return;
      }
      busy = true; setNote('');
      input.value = '';
      const posted = await roles.postMealComment(latest.id, RT.userId, RT.userId, 'athlete', text);
      busy = false;
      if (!posted) { setNote("Couldn't send that. Check your connection and try again."); input.value = text; return; }
      await load();
      // Forced: they just sent it and are watching for it to land.
      scrollThreadToEnd(root, { force: true });
    };
    if (send) send.addEventListener('click', submit);
    // isComposing: Enter inside an IME composition (CJK keyboards) is choosing a character,
    // not sending — firing submit there ships half a word.
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  },
};
