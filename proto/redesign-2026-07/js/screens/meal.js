import { S, RT, tier, act, MEAL, mealDetail, fmtClock, liveWeightPct, athleteContextForAnalysis, AI_OFF_LINE } from '../state.js';
import { FILTERED_NOTE } from '../content-filter.js';
import { DAY, slotDeadline, dayStandard } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, nonLiveBadge, composer, segBar, skeletonRows, sayStatus, aiDisclaimer } from '../components.js';
import { reveal, buzz } from '../motion.js';
import { playPerfectMoment } from '../perfect-moment.js';
import { scoreMoveBar, playScoreMove } from '../score-move.js';
import {
  openingMessage, openingSummary, qualityBand, scoreReasons, coachFocus, reactionGroups, threadMessages,
  contextForChat, applyFoodEdit, hasUserEdits, restrictionConflicts,
  estimateConfidence, estRange, mealPatterns, scoreRubric, coachThreadStatus,
  REACTION_EMOJI,
} from '../meal-intel.js';
import {
  attachedPhoto, isPhotoOnly, wireComposerAttach, postChatMessage,
  bubblePhotoHtml, hydrateThreadPhotos,
} from '../chat-attach.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { ensureAiConsent, isConsentSkip, noteAiConsentRequired, aiMinorPending, AI_MINOR_LINE, meetNiaDue, markMeetNia, MEET_NIA_TEXT } from '../ai-consent.js';
import { openMealQuestions, autoShownFor, markAutoShown } from '../meal-questions-sheet.js';
import { hydrateAvatars } from '../avatar.js';
import { wireTapback } from '../tapback.js';
import { scrollThreadToEnd, focusComposer } from '../keyboard.js';
import { recentRows, warmRecent as warmRecentShared } from '../recent-meals.js';
import { foodMemory, warmFoodMemory } from '../food-memory-data.js';
import { remainingToday } from '../food-memory.js';
import { decideAiTurn } from '../ai-thread.js';
import {
  layoutThread, visibleThread, MUTED_HIDDEN_NOTE,
  authorName, initialsFor, participantList, participantSummary, participantMeta,
  AI_NAME, AI_TITLE, NIA_MARK, whoHtml, facesHtml, threadTitle, composerPrompt, escalationChip,
  isAnalysisOpener, isAnalysisUpdate, isEscalated, quotedFor,
  memoryOfferOf, memoryOfferChips,
  mealSuggestOf, fillMealSuggestion, mealSuggestHtml,
  dayLabelOf, msgRowClass, timeSepHtml, deliveredHtml, msgTimeHtml, richText,
  isCorrectionReceipt, receiptCardHtml, playFreshReceipts, reactionAnchor, replyQuote, replyQuoteHtml, replyTargetMeta,
  personText, workingLabel,
} from '../chat-view.js';
import { wireChatTimes } from '../chat-times.js';
import {
  beginSend, endSend, takeFailed, setAiWorking, aiWorkingOf,
  setReply, replyOf, clearReply, paintReplyChip, noteArrivals, syncLive, syncJump,
  bindLive, wireThreadTaps, holdThread, followThread,
} from '../chat-live.js';

/* The meal score chip's ring, drawn as the brand dial (docs/brand/LOGO.md): a 300° gauge with
   a 60° gap at 6 o'clock and the signature --ring-a/b/c sweep — the same silhouette as the day
   score ring and the mark itself. Status color (good/mid/low) lives on the chip's NUMBER, never
   the arc: score surfaces wear the sweep, green stays status-only. Keeps .sc-arc/.ring-arc +
   data-off so reveal()/windBack drive it unchanged. */
export function miniDial(score) {
  const c = 31, r = 26, A0 = 120, SWEEP = 300;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + Math.cos(a) * r).toFixed(2)} ${(c + Math.sin(a) * r).toFixed(2)}`;
  };
  const d = `M ${pt(A0)} A ${r} ${r} 0 1 1 ${pt(60)}`;
  const off = (100 - score).toFixed(1);
  // The seated jewel at the tip, scaled from the mark (bezel 0.875×, core 0.5× of the band) —
  // the chip wore the sweep but not the marker, which left it half a dial (founder 2026-08-10:
  // every working ring IS the logo). Track moves off --hairline onto the mark's own glass.
  const light = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  const tipA = ((A0 + (score / 100) * SWEEP) * Math.PI) / 180;
  const tx = c + Math.cos(tipA) * r, ty = c + Math.sin(tipA) * r;
  const jewel = score >= 6 ? (light
    ? `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3.1" fill="#FFFFFF" stroke="#DBEAFE" stroke-width="1"/>
       <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="1.75" fill="#2563EB"/>`
    : `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3.1" fill="#0F172A"/>
       <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="1.75" fill="#FFFFFF"/>`) : '';
  return `<svg class="sc-ring" width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
    <defs>
      <linearGradient id="scg" gradientUnits="userSpaceOnUse" x1="12.5" y1="53.9" x2="37.2" y2="5">
        <stop offset="0%" stop-color="var(--ring-a)"/>
        <stop offset="50%" stop-color="var(--ring-b)"/>
        <stop offset="100%" stop-color="var(--ring-c)"/>
      </linearGradient>
    </defs>
    <path d="${d}" fill="none" stroke="var(--ring-track)" stroke-width="3.5" stroke-linecap="round"/>
    <path class="ring-arc sc-arc" d="${d}" fill="none" stroke="url(#scg)" stroke-width="3.5" stroke-linecap="round"
      pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>
    ${jewel}
  </svg>`;
}

/* Recent same-athlete meals (14d) for REAL historical patterns in the AI opening — shared cache
   (recent-meals.js; state.js's _postMealOpener reads the same rows); the mount repaints once
   when rows land. */
async function warmRecent(rolesMod, uid) {
  const before = recentRows(uid);
  const rows = await warmRecentShared(rolesMod, uid);
  if (rows && rows !== before && location.hash.startsWith('#meal-')) window.__render && window.__render();
}

// Thread cache (deep audit 2026-08-19). The router remounts this screen on every render, and
// each mount awaited a full comment fetch and tore down + rebuilt the realtime channel — a
// network round trip and a socket handshake per REPAINT, not per visit. Keyed on mealId: a
// same-meal remount paints the last known thread instantly and verifies with the cheap probe,
// and the channel survives remounts by calling through _liveThreadRefresh (always the newest
// mount's refresh) instead of a closure over a dead mount's DOM.
const THREAD_CACHE = { mealId: null, comments: [], lastKnownAt: null, fp: null };
let _liveThreadRefresh = null;  // set by every thread mount; the persistent channel's only door
let _liveThreadRtStatus = null; // lets the persistent channel re-tune the CURRENT mount's poll
let _threadRtLive = false;      // survives remounts so a reused live socket still relaxes the poll

/* Pending memory facts (0019): things the athlete's corrections SUGGEST but which must never bind
   until they say so. Cached with the same idiom as RECENT/RECEIPT; the thread renders at most one
   confirmation at a time, so a correction spree can't turn into an interrogation. */
let PENDING_FACTS = { uid: null, rows: [], at: 0 };
/* Fact ids the AI has offered inside this thread (memory_offer rows), refreshed on every paint,
   so the derived pending-fact row above the composer never asks about one of them twice. */
const OFFERED_IN_THREAD = new Set();
/* Offers the athlete answered this session: the chips go on the next paint, before any refetch. */
const ANSWERED_FACTS = new Set();
async function warmPendingFacts(uid, { force = false } = {}) {
  if (!uid) return;
  if (!force && PENDING_FACTS.uid === uid && Date.now() - PENDING_FACTS.at < 60000) return;
  const rows = await act.pendingMemoryFacts().catch(() => []);
  PENDING_FACTS = { uid, rows: rows || [], at: Date.now() };
  if (location.hash.startsWith('#meal-')) window.__render && window.__render();
}

/* Coach day-receipt (0043) for the athlete-visible "Reviewed by Coach" state — same cache idiom. */
let RECEIPT = { uid: null, date: null, reviewed: false, at: 0 };
async function warmReceipt(rolesMod, uid, dateISO) {
  if (!uid) return;
  if (RECEIPT.uid === uid && RECEIPT.date === dateISO && Date.now() - RECEIPT.at < 60000) return;
  const rows = await rolesMod.fetchMyDayReceipts(uid, dateISO).catch(() => []);
  // Keep the rows, not just the boolean: the thread names WHO looked, which is the whole
  // difference between "reviewed" as a status and "Coach Brown saw this" as a fact.
  RECEIPT = { uid, date: dateISO, reviewed: !!(rows && rows.length), rows: rows || [], at: Date.now() };
}

/* Who is in the conversation (0158). Same session-cache idiom: membership does not change
   between two paints, and every mount would otherwise re-ask. */
let PARTICIPANTS = { uid: null, rows: [], at: 0 };
/* THE NOTE SURVIVES THE REPAINT (2026-09-14). setNote() writes into #chat-note, and the caller
   usually calls window.__render() a line later, which rebuilds the screen and takes the note with
   it. Module scope, keyed to the meal and stamped, so it is restored on the next paint and cannot
   bleed onto another plate. It is a calm system line now (2026-09-24), and nothing about a
   correction is ever said there: Nia says it in the thread (correction-turn.js). The live receipt
   card that used to share this slot is gone too; the filed receipt counts up as it arrives
   (chat-view.js playFreshReceipts), on every screen that shows the thread. */
let CHAT_NOTE = null;
const CHAT_NOTE_TTL_MS = 120000;
/** Returns true only when this call actually FETCHED something new — the caller repaints on that
 *  and nothing else. A warm that repaints unconditionally is a render loop: every mount asks,
 *  the cache answers instantly, the repaint remounts, and the screen never settles. It also
 *  silently undoes the thread's own paint, so the athlete sits on "Loading the thread…" forever. */
async function warmParticipants(rolesMod, uid) {
  if (!uid) return false;
  if (PARTICIPANTS.uid === uid && Date.now() - PARTICIPANTS.at < 300000) return false;
  const rows = await rolesMod.fetchThreadParticipants(uid).catch(() => []);
  PARTICIPANTS = { uid, rows: rows || [], at: Date.now() };
  return PARTICIPANTS.rows.length > 0;
}

/* One Nutrition tile, the settled meal page's shape (.nut-tiles .nt), so the pre-log check and
   the logged plate read as one family (2026-09-22). `v` is trusted markup built from numbers. */
const NUT_ICONS = { protein: 'biceps', carbs: 'bars', fat: 'droplet', cals: 'flame' };
const nutTile = (k, v, label) => `<div class="nt${k === 'protein' ? ' lead' : ''}"><span class="nt-ic ${k}">${icon(NUT_ICONS[k], 16)}</span><div class="nt-v">${v}</div><div class="nt-k">${label}</div></div>`;

export function macroRow(m) {
  // Per figure (0142): protein/carbs/fat behind showMacros, the calorie figure behind
  // showCalories — a professional can hide calories alone, and the prescription must hold
  // on every cell, not just the row.
  const cells = [];
  // An unread figure prints a dash, never "nullg" (unknown is not 0; same rule as the tiles).
  const g = (v) => (v == null ? '—' : `${v}<i>g</i>`);
  if (S.planStyle.showMacros) cells.push(
    nutTile('protein', g(m.protein), 'Protein'),
    nutTile('carbs', g(m.carbs), 'Carbs'),
    nutTile('fat', g(m.fat), 'Fat'),
  );
  if (S.planStyle.showCalories) cells.push(nutTile('cals', `${m.cals}`, 'Calories'));
  return cells.length ? `<div class="nut-tiles${cells.length === 3 ? ' three' : cells.length <= 2 ? ' two' : ''}">${cells.join('')}</div>` : '';
}

/** The meal score on a photograph: the brand dial holding the numeral alone, the band word on
 *  the photo scrim above it (2026-09-22). `button` makes the dial the door to "Why did this meal
 *  score N?" (data-open="rub"); pass it only where that drawer renders. Shared by the logged
 *  meal's hero and the pre-log check, so the two cannot drift. */
export function mealDialHtml(score, { id = '', button = false } = {}) {
  const band = qualityBand(score);
  const word = band ? (band.label === 'Strong' ? 'Strong meal' : band.label) : '';
  const label = `Meal score ${score}${word ? `, ${word}` : ''}`;
  const tag = button ? 'button' : 'div';
  const attrs = button ? ` type="button" data-open="rub" aria-label="${esc(label)}. Why this score"` : ` role="img" aria-label="${esc(label)}"`;
  return `<div class="lm-score">
        ${word ? `<span class="lm-band" aria-hidden="true">${esc(word)}</span>` : ''}
        <${tag} class="scorechip big ${band ? band.cls : ''}"${id ? ` id="${id}"` : ''}${attrs}>
        ${miniDial(score)}
        <span class="v" data-count="${score}">${score}</span>
      </${tag}>
      </div>`;
}

/* ---------- Analyzing interstitial (branded loading) ---------- */
export const analyzing = {
  tab: 'camera',
  hideTabs: true,
  transient: true,
  render() {
    const img = safeImg((MEAL && MEAL.photoDataUrl) || S.logging.img);
    const nonLive = MEAL && MEAL.live === false;
    return `
    <div class="analyzing">
      <!-- Same data-vt="plate" as the photo on the confirm screen and the hero on the thread:
           one key, one photograph, carried the whole length of the flow instead of being thrown away
           and redrawn at each step. -->
      <div class="scanbox" data-vt="plate">
        <div class="img" style="background-image:url('${img}')"></div>
        <div class="scanline"></div>
      </div>
      ${nonLive ? `<div style="display:flex;justify-content:center;padding-top:10px">${nonLiveBadge()}</div>` : ''}
      <div class="phase" id="an-phase" role="status">Nia is reviewing your meal<span class="dots"></span></div>
      <div class="phase-sub" id="an-sub">Detecting foods and portions</div>
    </div>`;
  },
  async mount(root, { sub: slotArg } = {}) {
    analysis._editing = false; // a fresh analysis never opens in edit mode
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    const onScreen = () => location.hash.startsWith('#analyzing');
    /* HONEST PHASE COPY (2026-08-14). This used to be a three-beat ladder on setTimeout:
       "Estimating macros" at 1.4s, "Almost there" at 3.8s. Neither line knew anything. The
       read had either landed or it had not, and the screen narrated stages it could not
       observe — on the one surface whose entire job is reading the athlete's proof. In a
       product whose spine is that the number is honest, the wait should not be theater.

       What IS true and worth saying is elapsed time. Past a few seconds this is a slow read,
       and saying so beats inventing a stage. One beat, and it only fires if the read genuinely
       has not landed yet. */
    const slotKey = slotArg || (MEAL && MEAL.key) || null;
    const landed = () => {
      if (!slotKey || !DAY.meals[slotKey]) return false;   // analysis still in flight
      return !(DAY.slotMacros[slotKey] || {}).pending;      // applyAnalysisResult clears it
    };
    const SLOW_MS = 4200;
    const slowTimer = setTimeout(() => {
      if (!phase || !onScreen() || landed()) return;
      phase.innerHTML = `Still reading<span class="dots"></span>`;
      if (sub) sub.textContent = 'A careful read takes a few seconds';
    }, SLOW_MS);
    const clearPhases = () => clearTimeout(slowTimer);

    /* ---- WATCH MODE: the meal is ALREADY logged and the outbox owns the read. ----
       This is the path the camera takes now. Two things it must never do: start its own analysis
       (the outbox job is already running one, and a second vision call is real money), or hold the
       athlete here (the meal is committed — nothing downstream is waiting on this screen).

       So it is a bounded moment, not a gate: MIN_MS guarantees the scan actually registers even
       when the read comes back in 300ms, MAX_MS guarantees it is never a wait. Either way the next
       screen is the thread, which already states the pending case honestly ("Logged and counting.
       The breakdown lands here in a few seconds"). */
    const slot = slotKey;
    if (slot && DAY.meals[slot]) {
      /* The dwell. MIN_MS is the floor so the scan actually registers as something that
         happened; MAX_MS is the ceiling so this is a moment, never a gate — the meal is already
         committed and nothing downstream waits on this screen.
         The ceiling was once 3200, below a real vision call, so the athlete was handed off
         mid-read almost every time; 9000 clears a typical call instead of cutting it off.
         The FLOOR came down from 2600 to 1000 (2026-08-14). 2600 was chosen when `pending` was
         never persisted and the screen always bailed instantly, so the floor was doing the work
         of the whole wait. With pending fixed the floor's only job is to keep a landed-in-300ms
         read from flashing past — 1000ms does that. Anything beyond it was the app holding an
         athlete in front of a finished answer, roughly eight manufactured seconds a day for
         someone who logs four meals. */
      const MIN_MS = 1000, MAX_MS = 9000;
      /* How long the completion beat below is given before the hand-off. Long enough for the line
         to finish its run (--dur-2) and the halo to arrive, short enough that it is a landing and
         not a second wait. It is spent INSIDE the floor rather than after it (see `leaveAt`), so a
         read that lands in 300ms still hands off at exactly MIN_MS — the beat costs a fast read
         nothing at all, and only a genuinely slow one pays for it. */
      const BEAT_MS = 420;
      const t0 = Date.now();
      const reduced = (() => {
        try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch { return false; }
      })();

      /* THE RESOLUTION. The scan stops sweeping and finishes its run, the wash lifts off the
         photograph, and the box takes the halo the app puts under a number that has just landed.
         See the block above `.scanbox.read` in flows.css for why those are the two marks. */
      const finishScan = () => {
        const line = root.querySelector('.scanline');
        if (line) {
          /* Pin where the sweep actually IS before killing it. Dropping the animation resets the
             element to its base transform in the same style recalc, so a transition declared after
             that would start from translateY(0) — the line would jump to the top of the box and
             then slide down, which is the opposite of finishing. Parsed off the computed matrix
             (m42 is the y translate) rather than through DOMMatrix, which is one more API to be
             missing in an old WebView for no gain. */
          try {
            const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(line).transform || '');
            const y = m ? (parseFloat(m[1].split(',')[5]) || 0) : 0;
            line.style.animation = 'none';
            line.style.transform = `translateY(${y}px)`;
            void line.offsetWidth;   // commit the pinned position as the transition's start
            line.style.transition = 'transform var(--dur-2) var(--ease-out-quart), opacity var(--dur-1) linear var(--dur-1)';
            line.style.transform = 'translateY(188.6px)';   // the bottom of the 230px box, per @keyframes scan
            line.style.opacity = '0';
          } catch { line.style.display = 'none'; }
        }
        const box = root.querySelector('.scanbox');
        if (box) box.classList.add('read');
        /* textContent, which takes the animated `.dots` span with it — the ellipsis meant "still
           working" and nothing is still working. */
        if (phase) phase.textContent = 'Nia’s read is ready';
        if (sub) sub.textContent = 'Your breakdown is ready';
      };

      /* TWO EXITS, because there are two different truths to tell.
         The read landed → 'resolve': nothing slides, the document dissolves, and the plate travels
         into the hero. The photograph became its answer, and the motion says exactly that.
         The ceiling ran out → 'push': the analysis is genuinely STILL RUNNING and the thread will
         show it landing. That is a step forward in a flow, not a resolution, and dressing it as one
         would have the motion claim an answer arrived when it did not. */
      const leave = (dir) => { clearPhases(); if (onScreen()) window.__go('meal-thread/' + slot, { dir, vt: 'plate' }); };
      let beatAt = 0;
      const tick = () => {
        if (!root.isConnected || !onScreen()) { clearPhases(); return; }
        const waited = Date.now() - t0;
        if (waited >= MAX_MS && !beatAt) { leave('push'); return; }
        if (beatAt) {
          if (Date.now() >= beatAt) leave('resolve'); else setTimeout(tick, 60);
          return;
        }
        if (landed()) {
          clearPhases();                     // nothing is "still reading"; the slow line must not fire
          /* Reduced motion gets no beat — there is no sweep to finish and no halo to bloom, so
             holding the athlete an extra 420ms would buy them nothing. It still gets the FLOOR,
             though: MIN_MS is not about animation, it is about the screen registering as something
             that happened, and a motionless screen shown for 110ms registers as a flicker. */
          if (!reduced) finishScan();
          beatAt = Math.max(Date.now() + (reduced ? 0 : BEAT_MS), t0 + MIN_MS);
          if (Date.now() >= beatAt) { leave('resolve'); return; }
          setTimeout(tick, 60);
          return;
        }
        setTimeout(tick, 110);
      };
      setTimeout(tick, 110);
      return;
    }

    if (MEAL && MEAL.photoBase64 && !MEAL.result) {
      // REAL analysis via the analyze-meal edge function.
      const r = await act.runAnalysis();
      // startsWith, not equality: the camera navigates to '#analyzing/<slot>', and the exact
      // compare treated the sub-routed hash as "navigated away" — the screen then neither
      // advanced nor failed, it just sat on a dead scanline.
      if (!location.hash.startsWith('#analyzing')) return; // navigated away
      // THE CLARIFYING MOMENT: the model asked what the photo can't show — collect answers
      // before committing a number. A confident read goes straight to the analysis.
      if (r.ok) { location.hash = r.kind === 'questions' ? '#meal-questions' : '#meal-analysis'; return; }
      // Failure state: stop the "still scanning" animation and give a real >=44px recovery
      // button instead of a 13px gray text tap — the old sub-line was nearly invisible at the
      // exact moment the athlete's core action broke. A fast failure can land before a queued
      // phase timer, which would overwrite this copy — cancel them all.
      clearPhases();
      const sl = root.querySelector('.scanline');
      if (sl) sl.style.display = 'none';
      // AI reads are off (0243): not a failure. Say so, and offer the two ways forward.
      if (r.aiOff) {
        const minor = aiMinorPending(RT.userId);
        if (phase) phase.textContent = minor ? 'Waiting on a parent.' : 'Nia is off.';
        if (sub) sub.textContent = minor ? `Nothing was sent. ${AI_MINOR_LINE} Until then, log the meal with Search.` : 'Nothing was sent. Turn on Nia to have this photo read, or log the meal with Search.';
        root.querySelector('.analyzing').insertAdjacentHTML('beforeend', `<div class="aic-off an-aioff">
          ${minor ? '' : `<button class="btn primary sm" id="an-ai-on">${icon('sparkle', 17)} Turn on Nia</button>`}
          <button class="btn ghost sm" data-go="food-search">${icon('search', 17)} Log with Search</button></div>`);
        const on = root.querySelector('#an-ai-on');
        if (on) on.addEventListener('click', async () => {
          if (await ensureAiConsent(RT.userId, { role: 'athlete', ask: true })) window.__render && window.__render();
        });
        return;
      }
      // One honest headline, always. r.error rides the sub only when it is short and reads like
      // a sentence: status codes and stack fragments help nobody standing over a plate.
      if (phase) phase.textContent = "Couldn't read this plate.";
      if (sub) {
        const errTxt = typeof r.error === 'string' ? r.error.trim() : '';
        const human = errTxt && errTxt.length <= 90 && !/[{}<>\n]/.test(errTxt)
          && !/\b[45]\d{2}\b/.test(errTxt) && !/(error code|exception|stack|traceback|undefined)/i.test(errTxt);
        sub.textContent = `Nothing was logged. Your photo is still here.${human ? ` ${errTxt}` : ''}`;
      }
      // Retake is the primary way out. The second button is the only place in the app where someone
      // knows exactly what broke AND is already looking at it — a bug report filed from here needs
      // no reconstruction, and the screen it came from is attached automatically.
      root.querySelector('.analyzing').insertAdjacentHTML('beforeend',
        `<div style="height:18px"></div>
         <button class="btn primary sm" id="an-retry" style="width:100%">${icon('camera', 18)} Retake photo</button>
         <div style="height:10px"></div>
         <button class="btn ghost sm" id="an-report" style="width:100%">${icon('message', 17)} Tell us what happened</button>`);
      root.querySelector('#an-retry').addEventListener('click', () => { location.hash = '#camera'; });
      root.querySelector('#an-report').addEventListener('click', async () => {
        const { openFeedback } = await import('./feedback.js');
        openFeedback('analysis-failed', 'bug');
        window.__go ? window.__go('feedback') : (location.hash = '#feedback');
      });
      return;
    }
    // No photo → nothing to analyze. Send them back to capture instead of a fabricated analysis.
    // (startsWith: a cold launch can land on '#analyzing/<slot>' with sessionStorage cleared —
    // the exact compare left that case stranded on the scanline forever.)
    if (location.hash.startsWith('#analyzing')) location.hash = '#camera';
  },
};

/* Open the clarifying sheet for a meal that is waiting on the athlete. One entry point for the
   thread bubble, the breakdown button and the automatic open, so the three cannot drift. */
function askPendingQuestions(M) {
  if (!M || !Array.isArray(M.pendingQuestions) || !M.pendingQuestions.length) return false;
  return openMealQuestions({
    questions: M.pendingQuestions,
    // The plate when the detail already has it, the sparkle tile when it does not. The thumbnail
    // is context, never a reason to hold the ask back, and photo-store is a dynamic import here so
    // reaching for its cache would be a click-time ReferenceError in a bundler-free app.
    photo: M.img || M.photoDataUrl || null,
    slot: String(M.name || M.slot || 'meal').toLowerCase(),
    onAnswer: (answers) => act.answerPendingQuestions(M.slot, answers),
    onSkip: () => act.skipPendingQuestions(M.slot),
  });
}

/* ---------- The Clarifying Moment (Honest Vision) ----------
   The model was genuinely unsure about something that moves the macros (hidden protein,
   portion, prep), so instead of fabricating a number it asks the athlete. They answer what the
   camera can't see, we finalize, and the number they get is one they can trust. Every other app
   guesses silently; this is the honest difference. */
export const mealQuestions = {
  tab: 'camera',
  hideTabs: true,
  transient: true,
  render() {
    const qs = (MEAL && Array.isArray(MEAL.questions)) ? MEAL.questions : [];
    // Deep-link / stale entry with nothing to ask: send them back to capture, never a blank screen.
    if (!qs.length) { if (location.hash === '#meal-questions') location.hash = '#camera'; return ''; }
    const img = safeImg((MEAL && MEAL.photoDataUrl) || S.logging.img);
    return `
    ${/* The header counts what is actually being asked. It said "Two quick things" for a list
          the model builds at 1 to 3 questions, so a single-question screen opened by promising
          two and a three-question screen undercounted itself. Small, but this screen's entire
          pitch is that it does not guess. */''}
    ${backHead(qs.length === 1 ? 'One quick thing' : qs.length === 2 ? 'Two quick things' : `${qs.length} quick things`, 'So your numbers are exact', 'camera')}
    ${/* The photo carries no caption (audit 2026-09-22): a "The camera can't see everything"
          badge on it said what the lead line under it says, twice in one glance. */''}
    ${img ? `<div class="mq-photo" style="background-image:url('${img}')"><div class="mq-grad"></div></div>` : ''}
    <div class="mq-lead">A photo can't show what's hidden under or off the plate. Answer these and your read is dead on.</div>
    <div class="mq-list">
      ${qs.map((q, i) => `
        <label class="mq-item">
          <div class="mq-q"><span class="mq-n">${i + 1}</span><span>${esc(q)}</span></div>
          <input class="mq-input" data-qi="${i}" type="text" autocomplete="off" enterkeyhint="${i === qs.length - 1 ? 'done' : 'next'}"
            placeholder="Your answer" aria-label="${esc(q)}" />
        </label>`).join('')}
    </div>
    <div class="mq-actions">
      <button class="btn primary" id="mq-go">${icon('check', 18)} Get my result</button>
      <button class="mq-skip" id="mq-skip">Skip, just estimate</button>
    </div>
    <div class="mq-note">${icon('lock', 12)} Your answers only sharpen this meal's numbers. Nothing else changes.</div>`;
  },
  mount(root) {
    // render() bails to #camera when there is nothing to ask, but the router calls mount()
    // unconditionally (router.js:280) — so without this guard a stale/deep-link entry threw
    // "Cannot read properties of null" and left the screen dead.
    const goBtn = root.querySelector('#mq-go');
    const skipBtn = root.querySelector('#mq-skip');
    if (!goBtn || !skipBtn) return;
    const inputs = () => Array.from(root.querySelectorAll('.mq-input'));
    const answers = () => {
      const a = [];
      inputs().forEach((el) => { a[+el.dataset.qi] = el.value; });
      return a;
    };
    let busy = false;
    const finish = async (ans) => {
      if (busy) return;
      busy = true;
      const go = root.querySelector('#mq-go');
      const skip = root.querySelector('#mq-skip');
      if (go) { go.disabled = true; go.innerHTML = `${icon('sparkle', 18)} Nia is reading your meal…`; }
      if (skip) skip.style.pointerEvents = 'none';
      const r = await act.finalizeAnalysis(ans);
      if (location.hash !== '#meal-questions') return; // navigated away mid-call
      if (r.ok) { location.hash = '#meal-analysis'; return; }
      // Failure: restore the controls and surface an honest, tappable recovery.
      busy = false;
      if (go) { go.disabled = false; go.innerHTML = `${icon('check', 18)} Get my result`; }
      if (skip) skip.style.pointerEvents = '';
      let err = root.querySelector('#mq-err');
      if (!err) {
        root.querySelector('.mq-actions').insertAdjacentHTML('afterend',
          `<div id="mq-err" class="mq-err">${icon('x', 14)} <span></span></div>`);
        err = root.querySelector('#mq-err');
      }
      err.querySelector('span').textContent = r.error || "Couldn't get your result. Check your connection and try again.";
    };
    goBtn.addEventListener('click', () => finish(answers()));
    skipBtn.addEventListener('click', () => finish([]));
    // Enter on the last field submits; Enter elsewhere advances to the next field.
    inputs().forEach((el, i, arr) => el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (i < arr.length - 1) arr[i + 1].focus(); else finish(answers());
    }));
  },
};

/**
 * The derived inputs for the AI opening rows: the short summary, the long-form read, and the one
 * follow-up question.
 *
 * THIS LIVES AT MODULE SCOPE FOR A REASON. These were computed inside render() and referenced
 * inside mount()'s paint() — a plain ReferenceError that fired on EVERY thread load, which meant
 * paint() threw before it wrote a single message to the DOM. The visible symptom was the whole
 * point of the feature going missing: the athlete saw the render-time analysis card and never saw
 * one actual message, so a meal thread with a coach reply in it looked like an empty AI report.
 * It survived because the thread only paints when the meal has a server row, and the screenshot
 * harness had never seeded one.
 */
function openingInputs(M) {
  const goal = RT.profile && RT.profile.baseGoal;
  // Real context for the opening (upgrade 2026-07-16): the day's actual protein math, the
  // engine's score credit for THIS log, and historical patterns only when history exists.
  const dayP = S.mealDayProgress;
  const recent = recentRows(RT.userId) || [];
  const patterns = mealPatterns(recent, {
    slot: M.slot,
    mealProteinBar: dayP.proteinTarget > 0 ? Math.round(dayP.proteinTarget / 4) : 0,
  });
  const sum = openingSummary({
    quality: M.score, macros: M.macrosRaw || M.macros, fiber: M.fiber, highlights: M.highlights, late: M.late, goal,
    detected: M.detectedRich, source: M.source, deadlineClock: M.deadlineLabel,
    day: dayP,
  // Plan style (0142): an Intuitive read never quotes a macro figure and never grades the
  // plate — the AI's job there is to help the athlete notice a pattern, not to hand them a
  // number. Same analysis underneath; the professional still sees all of it.
    numbers: S.planStyle.showMacros, tone: S.planStyle.tone,
    });
  // The long-form read is the edge function's own prose (M.analysis). Two ways it may be shown:
  // the style permits numbers at all, OR the server STAMPED it as written for this exact style
  // (analyze-meal's styleApplied, slice 8 — which also enforces the language rail server-side).
  // Anything else — an old deploy with no stamp, or a stamp from a style the athlete has since
  // left — is suppressed rather than regex-scrubbed: a half-redacted paragraph reads worse than
  // the honest short summary, and a stale stamp is not evidence about today's prose.
  // Both flags (or the stamp): a paragraph can quote any figure, so one hidden figure
  // means only stamped prose — written for this exact style — may show.
  const styleSafeProse = (S.planStyle.showMacros && S.planStyle.showCalories) || M.styleApplied === S.planStyle.key;
  const fullText = openingMessage({
    name: M.name, quality: M.score, note: M.note,
    analysis: styleSafeProse ? M.analysis : null,
    highlights: M.highlights, goal, coachTargets: S.planTargets, late: M.late, minutesLate: M.minutesLate,
    detected: M.detectedRich, source: M.source, day: dayP, patterns,
    impact: S.mealScoreImpact(M.slot),
    });
  /* The "Was the chicken cooked with oil, butter, or neither?" chip bubble is GONE (founder,
     2026-08-06). It was an unprompted interrogation in the middle of a conversation the athlete
     did not start: the AI's read had already landed, and the thread's next voice was the machine
     asking THEM for homework. Team Discussion is a conversation between people, not an intake
     form. The capability is not lost — cooking/sauce/portion/food corrections are one sentence
     to the AI in this same thread, and land on the name, numbers and score together (2026-09-02).
     The RENDER PATH went with it on 2026-09-14: `fq` was hardcoded null here and openingBlockHtml
     still carried an fqRow() that drew chips no handler had ever read, so anything that set `fq`
     again would have shipped buttons that do nothing. Dead code that only misleads is worse than
     no code; the capability lives in followUpQuestion() (meal-intel.js) with its own tests. */
  // Only prose the model wrote may be signed Nia; the rest of the fallback is this device's.
  return { sum, fullText, modelProse: !!(styleSafeProse && M.analysis) };
}

/**
 * The AI rows at the top of a meal thread. Derived from the meal's own state, never stored, so a
 * comments refetch can never wipe them.
 *
 * Four states, because a meal is now logged BEFORE the AI has read it:
 *   pending   — the read is in flight. The meal already counts; this says so plainly.
 *   questions — the model needs something the camera can't show. Asked here, in the thread,
 *               instead of on a blocking screen the athlete had to sit through.
 *   failed    — the read did not land. The meal stays logged as photo proof; retry is offered.
 *   result    — the normal case: summary, optional full analysis, and one follow-up question.
 */
/** The thread's line when the AI stays quiet because AI replies are off (0243). */
const AI_OFF_REPLY_ON = 'Nia is off, so she stays quiet. Your message is posted. Turn on Nia in Privacy on your Profile.';
/** I6: a minor waiting on a parent is told why, and never offered the switch. */
const aiOffReply = () => (aiMinorPending(RT.userId) ? `Your message is posted. ${AI_MINOR_LINE}` : AI_OFF_REPLY_ON);

export function openingBlockHtml(M, { sum, fullText, modelProse = false, hasPersistedRead = false, part = 'all' } = {}) {
  /* `part` exists because these rows live at two different points in time. The lead (the read
     itself, or its pending/failed/questions state) is the OLDEST thing in the thread and paints
     above the messages; the tail (the follow-up question, the memory confirmation) is the AI
     speaking NOW and belongs after the newest message — rendering it above older bubbles read
     as the thread being out of order. paint() asks for each half where it belongs; 'all' keeps
     the render()-time call (no messages yet) working unchanged. */
  const wrap = (lead, tail) => (part === 'lead' ? lead : part === 'tail' ? tail : lead + tail);
  /* The app's own notices ABOUT Nia's read (reading, failed, questions waiting, a fact to keep).
     They wear her mark because they are about her, but they are not signed by her and they speak
     of her in the third person: nothing scripted is ever presented as Nia talking (R3). */
  const aiRow = (inner, id) => `
      <div class="msg ai last nia-status"${id ? ` id="${id}"` : ''}>
        <div class="av">${NIA_MARK}</div>
        <div class="stack">
        <div class="bubble">${inner}</div></div>
      </div>`;

  /* AI reads are off (0243): the athlete said Not now, or never answered. This is not the AI
     speaking (the AI never saw the photo), so it is a plain notice with the way to turn it on. */
  if (M && M.analysisFailed === 'ai_off') {
    return wrap(`
      <div class="aic-off mt-aioff" id="analysis-ai-off" role="status">
        <span>${esc(aiMinorPending(RT.userId) ? `This meal has no numbers yet. It still counts as proof and for timing. ${AI_MINOR_LINE}` : AI_OFF_LINE)}</span>
        ${aiMinorPending(RT.userId) ? '' : `<button type="button" class="btn ghost sm" id="mt-ai-on">${icon('sparkle', 15)} Turn on Nia</button>`}
      </div>`, '');
  }
  if (M && M.analysisFailed) {
    const capacity = M.analysisFailed === 'capacity';
    // photo_lost: the device's photo budget dropped the bytes before they uploaded. There is
    // nothing left to read, so no retry chip — offering one would be a dead button.
    const lost = M.analysisFailed === 'photo_lost';
    return wrap(aiRow(`
          <div style="font-weight:700">${capacity ? "Nia couldn't get to this one today." : lost ? "Nia couldn't read this one." : "Nia couldn't read this plate."}</div>
          <div style="margin-top:4px;color:var(--text-2)">${lost
            ? "The photo couldn't be kept on this device, so there's nothing left to read. The log still counts for timing."
            : `It's logged and counts for timing either way. Your photo is the proof.${capacity ? '' : ' Worth another try?'}`}</div>
          ${M.rereadError ? `<div class="mt-warnline">Couldn't fetch the photo just now. Try again in a moment.</div>` : ''}
          ${capacity || lost ? '' : `<div class="fq-chips"><button class="fx-chip" id="mt-retry-analysis">${icon('sparkle', 13)} Read it again</button></div>`}`, 'analysis-failed'), '');
  }

  if (M && Array.isArray(M.pendingQuestions) && M.pendingQuestions.length) {
    const qs = M.pendingQuestions.slice(0, 3);
    // Count its own questions: this bubble promised "Two" over one question as easily as three.
    const qHead = qs.length === 1 ? 'Nia has one quick question' : qs.length === 2 ? 'Nia has two quick questions' : `Nia has ${qs.length} quick questions`;
    /* The bubble states the ask and hands it to the sheet; it does not re-draw the form. It used
       to carry a full copy of the inputs, which put a blocking question in a chat bubble below a
       "Back to Home" button, at the same visual weight as a message. Two forms for one answer also
       meant two places to keep in sync. The sheet (js/meal-questions-sheet.js) is the form now,
       and it comes up on its own when this meal is opened. */
    return wrap(aiRow(`
          <div style="font-weight:700">${qHead}. Answer and your numbers are exact.</div>
          <div style="margin-top:3px;color:var(--text-2)">${qs.length === 1 ? 'A photo can’t show what’s under or off the plate.' : 'A photo can’t show what’s under or off the plate. It takes a moment.'}</div>
          <div class="fq-chips">
            <button class="fx-chip" id="mq-thread-go">${icon('sparkle', 13)} ${qs.length === 1 ? 'Answer it' : 'Answer them'}</button>
            <button class="fx-chip" id="mq-thread-skip">Skip, just estimate</button>
          </div>`, 'mq-bubble'), '');
  }

  if (M && M.pending) {
    return wrap(aiRow(`
          <div style="font-weight:700">Nia is reading your plate<span class="dots"></span></div>
          <div style="margin-top:4px;color:var(--text-2)">Logged and counting. The breakdown lands here in a few seconds. You don't have to wait on this screen.</div>`, 'analysis-pending'), '');
  }

  // ONE pending-fact confirmation, and only when it is about a food on THIS plate — an inferred
  // dislike is weak evidence, so it is worth a single tap in context, never a queue of prompts.
  const plate = new Set((M && Array.isArray(M.detectedRich) ? M.detectedRich : [])
    .map((d) => String((d && d.name) || '').toLowerCase()).filter(Boolean));
  // A fact the AI offered IN the thread (2026-09-02, meta memory_offer) already has its Yes / No
  // under that bubble; asking it again here would be the interrogation this row exists to avoid.
  const unoffered = (PENDING_FACTS.rows || []).filter((f) => f && !OFFERED_IN_THREAD.has(String(f.id)));
  const askFact = unoffered.find((f) => f.kind === 'dislike' && plate.has(String(f.value).toLowerCase()))
    || unoffered[0] || null;
  const confirmRow = askFact ? `
      <div class="msg ai last nia-status" id="fact-confirm">
        <div class="av">${NIA_MARK}</div>
        <div class="stack">
        <div class="bubble">
          ${esc(askFact.kind === 'dislike'
            ? `You took ${askFact.value} off a plate. Should Nia skip it in future reads?`
            : `Should Nia remember: ${askFact.kind.replace(/_/g, ' ')} (${askFact.value})?`)}
          <div class="fq-chips">
            <button class="fx-chip" data-fact="${esc(askFact.id)}" data-keep="1">Yes, remember</button>
            <button class="fx-chip" data-fact="${esc(askFact.id)}" data-keep="0">No, one-off</button>
          </div>
        </div></div>
      </div>` : '';
  const tail = meetNiaRow(M) + confirmRow;

  // THE READ ITSELF IS NOW A REAL MESSAGE (2026-07-28). analyze-meal composes it and persists it
  // as an `ai` row, so it lives in the thread the athlete can reply to, reference tomorrow, and
  // scroll back through with their coach. This derived block only fills in when that row is not
  // there: meals logged before the change, and the rare case where the thread write did not land.
  // Without the fallback those meals would show a breakdown with nothing said about it.
  if (hasPersistedRead) return wrap('', tail);

  // ONE VOICE (founder, 2026-08-02). This is the bubble the athlete sees the instant the read
  // lands locally, before the persisted `ai` row comes back from the server a beat later. It used
  // to be a REPORT CARD — "What went well / Biggest opportunity / Next time" over a "View full
  // analysis" expander — while the persisted message that replaced it seconds later was a plain
  // conversational paragraph. Same read, two different voices, arriving one after the other: that
  // is most of why the AI felt like a second process running behind the breakdown instead of one
  // nutritionist talking. Both ends now say the same thing the same way, so the swap is invisible.
  // `sum` stays as the floor for the rare read with no prose in it at all.
  const body = fullText
    ? richText(fullText, esc)
    : [sum && sum.wentWell, sum && sum.opportunity, sum && sum.next].filter(Boolean).map(esc).join(' ');
  if (!body) return wrap('', tail);

  // Nia's name goes only on words a model wrote: the read carries analyze-meal's own prose
  // (`modelProse`, from openingInputs). Anything composed on this device alone is a "Quick read",
  // not Nia (R3, 2026-09-24): openingMessage() always returns text, so fullText proves nothing.
  if (!modelProse) {
    return wrap(`
      <div class="msg coach last quick-read">
        <div class="av">${icon('flash', 14)}</div>
        <div class="stack"><div class="who">Quick read</div>
        <div class="bubble">${body}</div></div>
      </div>`, tail);
  }
  return wrap(`
      <div class="msg ai last">
        <div class="av">${NIA_MARK}</div>
        <div class="stack">${whoHtml(AI_NAME, true)}
        <div class="bubble">${body}</div></div>
      </div>`, tail);
}

/* MEET NIA, for people who said yes before she had a name (ai-consent.js meetNiaDue). One short
   message in the next meal thread with a read in it, marked shown the moment it is drawn and kept
   on THAT meal for the rest of this session, so a repaint never makes it vanish mid-read. */
let MEET_NIA_ON = null;
function meetNiaRow(M) {
  if (!M || !M.mealId) return '';
  if (MEET_NIA_ON !== M.mealId) {
    if (!meetNiaDue(RT.userId)) return '';
    MEET_NIA_ON = M.mealId;
    markMeetNia(RT.userId);
  }
  return `
      <div class="msg ai last" id="meet-nia">
        <div class="av">${NIA_MARK}</div>
        <div class="stack">${whoHtml(AI_NAME, true)}
        <div class="bubble">${esc(MEET_NIA_TEXT)}</div></div>
      </div>`;
}

/* ---------- Meal Analysis (AI, pre-log) ----------
   Founder structure (2026-07-15), each fact exactly once:
     photo (with timing vs the slot deadline) → editable breakdown (what + how much) →
     estimated macros → ONE detailed AI analysis → log.
   The old page rendered the AI note three times (planMatch + AI Feedback + thread opener) and
   macros/foods twice (componentsRead + chips/macroRow) — all of that is consolidated here. */

/** "Captured 1:42 PM" + "18 min before the 2:00 PM deadline": real clock math, never canned.
 *  Two parts (2026-09-22) so the status line can set them as its own segments and colour only a
 *  miss: the whole sentence used to be green and wrap into two green lines under the photo. */
function captureTimingParts(capturedAtMin, slot) {
  if (capturedAtMin == null) return null;
  const dl = slotDeadline(slot);
  const when = `Captured ${fmtClock(capturedAtMin)}`;
  if (capturedAtMin > dl) return { when, rel: `${capturedAtMin - dl} min past the ${fmtClock(dl)} deadline`, late: true };
  return { when, rel: `${dl - capturedAtMin} min before the ${fmtClock(dl)} deadline`, late: false };
}

export const analysis = {
  tab: 'camera',
  hideTabs: true,
  transient: true,
  render() {
    // Nothing staged (a deep link, a refresh after the plate was logged, a back-swipe into a
    // cleared flow): there is no read to check, so go back to the camera the way #analyzing does,
    // rather than painting "0g" tiles over an empty breakdown with a live Log button (A15).
    if (!MEAL.result) {
      if (location.hash.startsWith('#meal-analysis')) location.hash = MEAL.key ? `#camera/${MEAL.key}` : '#camera';
      return '';
    }
    const L = S.logging;
    const slot = MEAL.key || 'dinner';
    const already = !!DAY.meals[slot];
    const nonLive = MEAL.live === false;
    const timing = captureTimingParts(L.capturedAtMin, slot);
    const rich = (MEAL.result && Array.isArray(MEAL.result.detectedRich) && MEAL.result.detectedRich.length)
      ? MEAL.result.detectedRich
      : L.foods.map((f) => ({ name: f, confidence: 'high' }));
    const edited = hasUserEdits(MEAL.result);
    // Source-honest labels (WS7): a typed nutrition label is EXACT, never "estimated from photo".
    const src = MEAL.source;
    const srcLabel = edited ? 'Edited by you'
      : src === 'label' ? 'Exact, from the nutrition label'
      : src === 'manual' ? 'Entered by you'
      : 'Estimated from photo';
    // INTUITIVE (0142), same two rules the settled thread already lives by (see showNums and
    // styleSafeProse above): no macro or calorie figure reaches the athlete, and long AI prose
    // shows only when the style permits numbers or the server stamped it for this exact style.
    // This screen predates the gate and was the named leak in PRODUCT.md's red line — the
    // numbers are still computed, stored and sent; hiding is presentation only. Per figure:
    // the section renders when either flag is on; macroRow drops the cells the flags hide.
    // Prose needs BOTH flags (or the stamp) — a paragraph can quote any figure.
    const showNums = S.planStyle.showMacros || S.planStyle.showCalories;
    const styleSafeProse = (S.planStyle.showMacros && S.planStyle.showCalories) || L.styleApplied === S.planStyle.key;
    const img = safeImg(L.img);
    /* THE SAME FAMILY AS THE LOGGED MEAL (2026-09-22, the 09-15 restructure carried back one
       step). The timing is one muted status line under the title, not a green sentence wrapping
       under the photo; the photo is the hero and the score rides it as the same dial; then
       stacked sections separated by space: the plate (editable), Nutrition (the logged page's
       own tiles), the AI's read as plain text, and the one line saying what logging does. No
       card around the read, no status-green box around an informational sentence. */
    const statusBits = [
      ...(timing ? [`<span>${esc(timing.when)}</span>`, `<span class="${timing.late ? 'late' : 'ontime'}">${esc(timing.rel)}</span>`]
        : [`<span>${nonLive ? 'From your gallery' : 'Captured just now'}</span>`]),
    ].join('<span class="lm-dot">·</span>');
    return `
    ${backHead(`${L.name} Analysis`, already ? 'Already logged' : 'Check it before it counts', 'camera')}
    <div class="lm-status ma-status">${statusBits}</div>

    <div class="photo-hero lm-hero ma-hero${img ? '' : ' ph-nophoto'}"${img ? ` style="background-image:url('${img}')"` : ''}>
      <div class="ph-grad"></div>
      ${nonLive ? `<div class="lm-prov">${nonLiveBadge()}</div>` : ''}
      ${L.score != null ? mealDialHtml(L.score) : ''}
    </div>

    <section class="lm-sec ma-plate">
      <div class="lm-h"><h2>On the plate</h2><button type="button" class="ma-edit" id="edit-foods">Edit</button></div>
      <section class="card ma-foods" id="foods">
      ${rich.map((d) => `
        <div class="food-row" data-name="${esc(d.name)}">
          <span class="conf-dot ${esc(d.confidence)}"></span>
          <span class="fr-name">${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="Nia is not sure. Confirm or remove">?</span>' : ''}</span>
          <span class="fr-qty">${d.quantity ? esc(d.quantity) : ''}</span>
        </div>`).join('')}
      <div class="food-row fr-add" id="food-add" hidden>
        <span class="conf-dot high"></span>
        <input class="fr-in name" id="add-name" maxlength="60" placeholder="Add item (e.g. 2 eggs off-frame)" aria-label="Food name" />
        <input class="fr-in qty" id="add-qty" maxlength="12" placeholder="Qty" aria-label="Quantity" />
        <button class="fr-ok" id="add-ok" aria-label="Add">${icon('check', 15)}</button>
      </div>
      ${edited ? `<div class="ma-edited">${MEAL.result && MEAL.result.recomputed ? 'Edited by you. Macros and score recalculated from the foods listed.' : 'Edited by you. Macros stay the AI’s estimate.'}</div>` : ''}
      </section>
    </section>

    ${showNums ? `<section class="lm-sec lm-nut">
      <div class="lm-h"><h2>Nutrition</h2><span class="lm-conf">${esc(srcLabel)}</span></div>
      ${macroRow(L.macros)}
    </section>` : ''}

    ${(() => {
      // REAL restriction comparison (spec §18.3/§18.4): name-level match of detected foods
      // vs saved restrictions. A severe hit is a loud pre-confirm alert that names the
      // allergen and its uncertainty; a clean pass NEVER claims guaranteed safety.
      if (!RT.allergies.length && !RT.restrictions) return '';
      const cf = restrictionConflicts(rich, RT.restrictions || { allergies: RT.allergies.map((n) => ({ name: String(n).split('·')[0].trim(), severity: /severe/i.test(String(n)) ? 'severe' : 'moderate' })) });
      // A second-pass verify allergen catch isn't in `rich` (the first read missed it) — fold it in.
      const vAll = (MEAL.result && Array.isArray(MEAL.result.verifyAllergens)) ? MEAL.result.verifyAllergens : [];
      const severeHits = [...new Set([...cf.severe, ...vAll])];
      if (severeHits.length) return `
      <div class="ma-restrict" style="display:flex;gap:10px;padding:13px 14px;border-radius:var(--r-tile);background:var(--red-surface);border:1.5px solid var(--red-border)">
        ${icon('bell', 17, 'style="color:var(--red);flex:none;margin-top:1px"')}
        <div><div style="font-size:var(--t-sm);font-weight:800;color:var(--red-bright)">Possible severe allergen: ${esc(severeHits.join(', '))}</div>
        <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:3px;line-height:1.45">A detected food may contain it. The read can't see every ingredient or cross-contact. Check the label or ask staff before you eat or log this.</div></div>
      </div>`;
      if (cf.moderate.length || cf.noted.length) return `
      <div class="ma-restrict" style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--amber-surface);border:1px solid var(--amber-border)">
        ${icon('bell', 15)} <span style="font-size:var(--t-sm);font-weight:700;color:var(--amber-bright)">Heads up: this may contain ${esc([...cf.moderate, ...cf.noted].join(', '))} from your restrictions.</span>
      </div>`;
      return `
      <div class="ma-restrict" style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--surface-2);border:1px solid var(--hairline)">
        ${icon('shield', 15)} <span style="font-size:var(--t-sm);font-weight:600;color:var(--text-2)">Compared with your saved restrictions. No matches detected. Detection can miss ingredients or cross-contact; always verify severe allergens yourself.</span>
      </div>`;
    })()}

    <section class="lm-sec ma-read">
      ${/* Signed Nia only over the model's own paragraph (R3); the short fallback line is the app's. */''}
      ${styleSafeProse && L.analysis
        ? `<div class="ma-who"><span class="nia-av ma-av">${NIA_MARK}</span> Nia’s read<span class="who-sub">${AI_TITLE} · AI</span></div>`
        : `<div class="ma-who ma-quick">${icon('flash', 14)} Quick read</div>`}
      <p>${esc((styleSafeProse ? L.analysis : '') || L.ai)}</p>
    </section>

    ${already ? '' : `<p class="ma-counts">Logging this counts toward Nutrition (${liveWeightPct('nutrition')}%) and closes 1 of ${S.remainingCount} remaining tonight.</p>`}

    <div class="btn-row ma-actions">
      ${src === 'manual' ? `<button class="btn ghost sm" style="flex:1" data-go="food-search">${icon('search', 17)} Edit plate</button>`
        : src === 'label' ? `<button class="btn ghost sm" style="flex:1" data-go="label-scan">${icon('barcode', 17)} Edit label</button>`
        : `<button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>`}
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-back="home">Back to Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-thread/${slot}">${icon('check', 18)} Log ${esc(L.name)}</button>`}
    </div>
    `;
  },
  mount(root) {
    // Tapping the pre-log photo opens it full-screen too (§6.1) — same viewer as the thread.
    // role + tabindex make it keyboard-openable via the router's Enter/Space net; the viewer
    // restores focus here on close.
    const hero = root.querySelector('.photo-hero');
    if (hero && MEAL.photoDataUrl) {
      hero.style.cursor = 'zoom-in';
      hero.setAttribute('tabindex', '0');
      hero.setAttribute('role', 'button');
      hero.setAttribute('aria-label', 'View photo full screen');
      hero.addEventListener('click', () => openImageViewer(MEAL.photoDataUrl, 'Meal photo', hero));
    }
    // Edit mode (real editing, not a dead button): remove / rename / set quantity / add.
    // Every mutation goes through applyFoodEdit so MEAL.result.detectedRich and .detected stay
    // in lockstep — act.logMeal reads the arrays, not the DOM — then recomputeStagedMeal
    // propagates it: totals + quality recompute deterministically from the remaining per-food
    // macros and removed foods leave the prose (Tier 1 session isolation). When a food can't
    // be priced the totals honestly stay the AI's estimate and the hint says so. Repaint via
    // __render so the rendered rows always mirror the arrays (no hand-synced DOM state).
    const btn = root.querySelector('#edit-foods');
    const box = root.querySelector('#foods');
    if (!btn || !box) return;
    const editing = analysis._editing;
    if (editing) {
      btn.textContent = 'Done';
      box.classList.add('editing');
      const addRow = root.querySelector('#food-add');
      if (addRow) addRow.hidden = false;
      // Per-row edit affordances: name/qty become inputs, ✕ removes.
      box.querySelectorAll('.food-row:not(.fr-add)').forEach((row) => {
        const name = row.getAttribute('data-name');
        const nameEl = row.querySelector('.fr-name');
        const qtyEl = row.querySelector('.fr-qty');
        const item = MEAL.result && (MEAL.result.detectedRich || []).find((d) => d && d.name === name);
        row.insertAdjacentHTML('beforeend', `<button type="button" class="cm-rm" aria-label="Remove ${esc(name)}">${icon('x', 14)}</button>`);
        row.querySelector('.cm-rm').addEventListener('click', (e) => {
          e.stopPropagation();
          const op = { kind: 'remove', name };
          if (applyFoodEdit(MEAL.result, op)) { act.recomputeStagedMeal(op); analysis._editing = true; window.__render(); }
        });
        if (nameEl) {
          nameEl.innerHTML = `<input class="fr-in name" maxlength="60" value="${esc(name)}" aria-label="Food name" />`;
          nameEl.querySelector('input').addEventListener('change', (e) => {
            const op = { kind: 'rename', name, newName: e.target.value };
            if (applyFoodEdit(MEAL.result, op)) act.recomputeStagedMeal(op);
            analysis._editing = true; window.__render();
          });
        }
        if (qtyEl) {
          qtyEl.innerHTML = `<input class="fr-in qty" maxlength="12" value="${esc((item && item.quantity) || '')}" placeholder="Qty" aria-label="Quantity" />`;
          qtyEl.querySelector('input').addEventListener('change', (e) => {
            const op = { kind: 'quantity', name, quantity: e.target.value };
            if (applyFoodEdit(MEAL.result, op)) act.recomputeStagedMeal(op);
            analysis._editing = true; window.__render();
          });
        }
      });
      const addOk = root.querySelector('#add-ok');
      if (addOk) addOk.addEventListener('click', () => {
        const n = root.querySelector('#add-name'), q = root.querySelector('#add-qty');
        const op = { kind: 'add', name: n && n.value, quantity: q && q.value };
        if (applyFoodEdit(MEAL.result, op)) {
          act.recomputeStagedMeal(op);
          analysis._editing = true; window.__render();
        }
      });
    }
    btn.addEventListener('click', () => { analysis._editing = !analysis._editing; window.__restate(); });
  },
};
analysis._editing = false;

/* ---------- Meal Thread — the ONE post-log surface (execution summary + honest
   breakdown + team discussion + next action). Post-log data is immutable: this page
   only renders; food editing stays in the pre-log analysis screen. Numbers come from
   S.exec / RT.lastMove / mealDetail — nothing here recomputes score math. ---------- */
/* ---------- The read card + the breakdown, shared by TODAY's meal and a PAST one (2026-09-14) ----------
   The founder opened an older logged meal and it wore a different design from today's: the past-meal
   screen (trust.js mealView) was a simpler twin written separately. Sections 2 and 3 of the meal
   thread now live here, as one function both screens call, so the two cannot drift again. `M` is
   the mealDetail() shape (trust.js builds it from a meals row: see pastMealDetail); `exec` is the
   day's execution summary (null for a past plate); `past` turns off the day projection and the
   re-read link, which only make sense while the day is live. Returns the two blocks as strings. */
/** The read's small controls: "See details", the info mark on the score chip, the confidence line.
 *  Each opens the "Why did this meal score N?" row and brings it into view. `holder` remembers the
 *  open state across the repaints this screen does constantly (comments, participants landing).
 *  Shared by the athlete thread, the coach's meal screen and the past-meal page, which all render
 *  the same read. Idempotent per node. */
export function wireReadControls(root, holder = null) {
  if (!root) return;
  const rub = root.querySelector('.rub');
  if (rub && holder && !rub.dataset.lmWired) {
    rub.dataset.lmWired = '1';
    rub.addEventListener('toggle', () => { holder._rubOpen = rub.open; });
  }
  root.querySelectorAll('[data-open="rub"]').forEach((b) => {
    if (b.dataset.lmWired) return;
    b.dataset.lmWired = '1';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = root.querySelector('.rub');
      if (!d) return;
      d.open = true;
      if (holder) holder._rubOpen = true;
      try { d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* older engines */ }
    });
  });
}

/* "Wrong meal?" — the one correction the chat could never make (impeccable critique 2026-09-16).
 *
 * Deliberately the LAST thing in the already-collapsed breakdown disclosure: correcting which
 * slot a plate belongs to, or taking it back entirely, is rare, and putting it anywhere nearer
 * the top would offer an escape hatch to an athlete whose real problem is that the score is low.
 * The honest-accountability line holds either way: deleting drops the score, and the coach's row
 * goes with it, so this is a repair, never a way out.
 *
 * Move targets are OPEN slots only, so a correction can never overwrite a second plate. Move is
 * one tap because it is reversible (move it straight back). Delete arms first, because it is not.
 */
function correctionRow(slot) {
  const targets = act.moveTargetsFor(slot) || [];
  const moves = targets.map((t) =>
    `<button type="button" class="btn ghost sm" data-move="${esc(t.key)}">Move to ${esc(t.title)}</button>`).join('');
  return `<div class="mcx" role="group" aria-label="Correct this meal">
    <div class="mcx-k">Wrong meal?</div>
    <div class="mcx-acts">
      ${moves || '<span class="mcx-none">Every other slot today already has a meal in it.</span>'}
      <button type="button" class="btn ghost sm danger" data-unlog="${esc(slot)}">Delete</button>
    </div>
    <div class="mcx-s" id="mcx-status"></div>
  </div>`;
}

export function mealReadHtml(M, { exec = null, past = false, viewer = 'athlete', targets = null, planStyle = null, dayTotals = null, athleteName = '' } = {}) {
  // `viewer`: 'athlete' (the default, second person) or 'coach' (the professional reading an
  // athlete's plate: full figures, the athlete named in the third person, no self-service links).
  // `targets` / `planStyle` override the signed-in user's own (S.planTargets / PS) so a
  // coach sees the ATHLETE's targets and every figure, whatever their own account's style is.
  // `dayTotals`: { protein, cals } banked by the DAY through this plate, this plate included —
  // what the "after this meal" bars measure. Today's own plate falls back to the live day
  // (S.dayTotalsThrough); a past plate's caller sums that day's stored rows; a caller with no
  // day context at all (the coach opening one row from the inbox) passes nothing and gets no
  // day bars, because the alternative is a day figure that is not the day's.
  const you = viewer !== 'coach';
  // The athlete's first name for the coach's third-person lines (review pass C-M8): "Good balance
  // for Marcus's goals", never "your goals" on a screen the athlete is not reading.
  const whose = you ? 'your' : (athleteName ? `${String(athleteName).split(' ')[0]}'s` : 'their');
  const PS = planStyle || S.planStyle || {};
    // ---- 2. PHOTO + MEAL QUALITY (feedback 2026-07-16: quality is a separate concept from
    // compliance — banded color, its own label, and a one-line WHY so 58 never reads as green
    // success or an arbitrary number). Provenance badges live here; name/timing not repeated.
    const band = qualityBand(M.score);
    // The top 2-3 reasons the score is what it is (founder 2026-08-04: the score must be
    // immediately explainable) — same componentStates arithmetic as the number itself.
    // The RAW figures (null kept): `macros` coerces a missing one to 0, which the scoring helpers
    // would judge as a measured zero ("Fat in range" under a dash; A-B4).
    const judged = M.macrosRaw || M.macros;
    const reasons = scoreReasons({ macros: judged, fiber: M.fiber, detected: M.detectedRich, minutesLate: M.minutesLate });
    // Coach's Focus (founder 2026-08-05): the one line to remember, from the same judgments.
    const dayProgCF = S.mealDayProgress || {};
    const nextMealCF = exec && exec.now && exec.now.proof === 'photo' ? exec.now.title : null;
    const focus = coachFocus({
      macros: judged, fiber: M.fiber, detected: M.detectedRich, minutesLate: M.minutesLate,
      nextMealName: nextMealCF,
      dayGap: (Number(dayProgCF.proteinTarget) || 0) - (Number(dayProgCF.proteinSoFar) || 0),
      mealsRemaining: Number(dayProgCF.mealsRemaining) || 0,
      numbers: PS.showMacros,
    });
    // Expandable score rubric (upgrade 2026-07-16): the observable components behind the
    // number, each marked exact or estimated — same math as the feedback, so they agree.
    const rub = scoreRubric({
      quality: M.score, minutesLate: M.minutesLate, macros: judged, fiber: M.fiber,
      detected: M.detectedRich, source: M.source, userNote: M.userNote, photoQ: M.photoQ,
    });
    const RUB_DOT = { met: 'g', partial: 'a', miss: 'r' };
    // ---- Nutrition facts, computed BEFORE the photo block because they now render inside the
    // read card (founder 2026-08-10: the read and the numbers were two boxes saying almost the
    // same thing — they are one card now, so the screen stacks confirm / photo / read, done).
    // A read still in flight (or one that failed) has no numbers to correct — the correction
    // affordances only appear once the analysis has settled.
    const settled = !M.pending && !M.analysisFailed && !(Array.isArray(M.pendingQuestions) && M.pendingQuestions.length);
    const T = targets || S.planTargets || {};
    const fromPhoto = M.source !== 'label' && M.source !== 'manual';
    const conf = estimateConfidence(M.source, M.detectedRich);
    /* The heading this feeds used to read "Estimated Nutrition · estimated from photo · high
       confidence" — the word twice, over two lines, on the app's most-read card. Worse on the
       other two branches: it announced an EXACT typed nutrition label as "Estimated Nutrition",
       which is the one thing line 544 above exists to prevent. The heading is now just
       "Nutrition" and the provenance is stated once, in `provShort` below, where it can be true
       for all three. (The long-form `srcLabel` that lived here fed only the Intuitive plate
       heading, which reads `provShort` too since 2026-09-22.) */
    // Photo estimates present as estimates (~ prefix on tiles; the full range lives in the
    // rubric). Label/manual values stay exact — no false hedging on real numbers.
    const tilde = fromPhoto ? '~' : '';
    // null and 0 are different facts (the 2026-09-08 rule, now inside the one read card): a figure
    // the read never returned prints as a dash, a measured zero prints 0. Today's mealDetail()
    // coerces to 0 upstream (the live read always returns all four); a stored past row keeps its
    // nulls in `macrosRaw` (trust.js pastMealDetail), and that is what the tiles read.
    const raw = M.macrosRaw || M.macros;
    const mg = (v, unit) => (v == null ? '—' : `${tilde}${v}${unit}`);
    const shownFigures = [
      ...(PS.showMacros ? [raw.protein, raw.carbs, raw.fat] : []),
      ...(PS.showCalories ? [raw.cals] : []),
    ];
    const someMissing = shownFigures.some((v) => v == null);
    // THE PROJECTION. A bar that only shows what is banked answers "how much of the day is done",
    // but the athlete reads it as a verdict — 81 of 180g at dinner looks like failing when it is
    // squarely on pace. So each bar also carries what is still COMING: the meals left today at
    // the share this athlete's plan expects. Real engine numbers or nothing; never a flattering
    // guess. `dayProg` is the same source the AI's day sentence uses, so the two always agree.
    const dayProg = S.mealDayProgress || {};
    // A PAST plate projects nothing: its day is over, so the bars show what was banked and no ghost.
    const mealsLeft = past ? 0 : Math.max(0, Number(dayProg.mealsRemaining) || 0);
    const project = (target, soFar) => {
      if (!target || !mealsLeft) return null;
      const gap = Math.max(0, target - (Number(soFar) || 0));
      return gap ? Math.round(gap / Math.max(1, mealsLeft)) * mealsLeft : 0;
    };
    // THE DAY, NOT THE PLATE. These bars sit under "Today after this meal" and print "74g left",
    // so the figure on them is the day's running total through this plate — never the plate's own
    // macros, which is what they showed until 2026-09-16 and why a 106g lunch was followed by a
    // 35g dinner reading as the day going backwards. `dayTotals` comes from the caller
    // (S.dayTotalsThrough for today's live plate); with no day context there is no day to draw,
    // so the bars stand down and the Nutrition tiles above carry the plate's own figures alone.
    const dayT = dayTotals || (!past && you ? S.dayTotalsThrough(M.slot) : null);
    // The ghost forecasts what the REST of today will add, so it belongs only on the day's latest
    // plate. Open this morning's breakfast at night and you are reading a moment that has already
    // passed: its bar shows what was banked by then, and forecasting forward from it would draw a
    // day that never happened.
    const latestPlate = !!dayT && dayT.protein === (Number(dayProg.proteinSoFar) || 0);
    // Per figure (0142): each bar rides its own surface flag — a professional can hide
    // calories alone, and the calorie bar (value AND target) must go with them.
    const targetBars = (dayT ? [
      ...(PS.showMacros ? [['Protein', dayT.protein, T.protein, 'g', latestPlate ? project(T.protein, dayT.protein) : null]] : []),
      ...(PS.showCalories ? [['Calories', dayT.cals, T.calories, '', null]] : []),
    ] : []).filter(([, v, target]) => target && v != null);
    // paceNote quotes a protein figure, so it rides showMacros like the protein bar — the card
    // can be visible for the calorie bar alone.
    const projectedTotal = PS.showMacros && T.protein ? (Number(dayProg.proteinSoFar) || 0) + (project(T.protein, dayProg.proteinSoFar) || 0) : null;
    const paceNote = projectedTotal && mealsLeft
      ? `On pace for about ${projectedTotal}g if your ${mealsLeft === 1 ? 'last meal lands' : `last ${mealsLeft} meals land`} on plan`
      : '';
    // THE EMPTY READ. A settled photo meal whose every macro is zero isn't a light meal — it's a
    // read that came back with nothing in it (the truncated-report bug, now fixed at the source,
    // but these meals are already in people's days). Correction chips are useless here, because
    // every rule scales or nudges the stored numbers and all of those are zero. The only honest
    // move is to offer the read again.
    const emptyRead = settled && fromPhoto
      && !M.macros.protein && !M.macros.carbs && !M.macros.fat && !M.macros.cals;
    const rereadNote = `<div class="est-note" style="margin-top:8px">These numbers didn't land. The read came back empty, so nothing was measured.${!past && M.mealId ? ` <span class="link" id="mt-reread" role="button" tabindex="0">Re-read this meal</span>` : ''}${M.rereadError ? ` <b style="color:var(--text-2)">Couldn't fetch the photo just now. Try again in a moment.</b>` : ''}</div>`;
    // INTUITIVE (0142): no macro or calorie figure reaches the athlete. The plate itself, what
    // was on it, and how it landed still do — the composition IS the feedback. Every number is
    // still computed and still stored (the professional needs them, and under-fueling is a
    // safety signal); this gate is presentation only. `showMacros` is the athlete's own
    // opt-in-able switch, so someone who WANTS their numbers back can have them. Per figure:
    // the card renders when either flag is on; each cell rides its own flag below.
    const showNums = PS.showMacros || PS.showCalories;
    /* THE READ, RESTRUCTURED (founder 2026-09-15). "Fewer containers, heavier typography, larger
       visual moments, and less information competing at the same level. The food photo and the
       meal score should be what your eye lands on within half a second."
       So: the photo is the hero and the score rides on it, with its word. What follows is stacked
       sections separated by space and a heading each, never nested bordered cards: What stood out,
       Nutrition, Today after this meal, then two plain rows (why the score, the detected foods).
       Provenance is said ONCE, in sentence case, inside the Nutrition heading, so the figures carry
       no tilde and no uppercase strip announces it a second time. The day score is a footnote of
       the Today section, not a second hero. Inner class names the tests and reveal() reach
       (#meal-scorechip, .sr-row, .rub, .bd-wrap, #mt-reread) are unchanged. */
    const cap = (t) => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '');
    const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
    const stdNow = typeof dayStandard === 'function' ? dayStandard() : null;
    const mealsReq = stdNow && stdNow.mealsRequired > 0 ? stdNow.mealsRequired : 4;
    const perMeal = T.protein > 0 ? Math.round(T.protein / mealsReq) : null;
    // The second line under each verdict row: what to do about it, in one clause. Derived from
    // the same component judgment as the label, and figure-free unless the plan shows figures.
    const hintFor = (r) => {
      const l = r.label || '';
      if (/^Protein solid/.test(l)) return 'Carries the plate';
      if (/^Protein/.test(l)) return perMeal && PS.showMacros ? `Try to get about ${perMeal}g next time` : 'Lead the next plate with protein';
      if (/^Carbs balanced/.test(l)) return 'Good fuel for the work';
      if (/^Carb-heavy/.test(l)) return 'Trade some for protein next time';
      if (/^Fat in range/.test(l)) return `Good balance for ${whose} goals`;
      if (/^Fat/.test(l)) return 'Go lighter on oils and cheese';
      if (/^Good fiber/.test(l)) return 'Produce is showing';
      if (/^Produce showing/.test(l)) return 'In the photo. Fiber was not measured';
      if (/^Fiber light/.test(l)) return 'Add fruit, veggies or higher fiber carbs';
      // Not "Nothing green on the plate": that is a claim about the photo, and the photo can show
      // edamame and lettuce while the fiber estimate reads zero (audit 2026-09-22). Say what to do.
      if (/^No fiber/.test(l)) return 'Add fruit, veg or a fiber carb';
      if (/^Good timing/.test(l)) return 'Landed in the window';
      if (/^Logged/.test(l)) return M.minutesLate > 0 ? `${M.minutesLate} min past the window` : 'Past the window';
      return '';
    };
    const stoodOut = band && reasons.length ? `
    <section class="lm-sec lm-stood">
      <div class="lm-h"><h2>What stood out</h2></div>
      <div class="sr-rows">
        ${[...reasons].sort((a, b) => (a.state === 'met' ? -1 : 1) - (b.state === 'met' ? -1 : 1)).map((r) => {
          const hint = hintFor(r);
          return `
        <div class="sr-row ${r.state}"><span class="sr-ic">${icon(r.state === 'met' ? 'check' : r.state === 'partial' ? 'arrowUp' : 'x', 14)}</span><div class="sr-b"><div class="sr-t">${esc(r.label)}</div>${hint ? `<div class="sr-s">${esc(hint)}</div>` : ''}</div></div>`;
        }).join('')}
      </div>
    </section>` : '';
    // Provenance, once, in the heading's own sentence case.
    // One muted line, right of the heading (the founder's own wording): "Estimated from photo ·
    // Medium confidence". An exact label or a typed entry has no confidence to state.
    const provShort = M.source === 'label' ? 'Exact, from the label'
      : M.source === 'manual' ? (you ? 'Entered by you' : 'Entered by the athlete')
      : `Estimated from photo · ${cap(conf)} confidence`;
    const NUT_ICON = { protein: 'biceps', carbs: 'bars', fat: 'droplet', cals: 'flame' };
    const plain = (v, unit) => (v == null ? '—' : `${fmtN(v)}${unit}`);
    const tile = (k, v, unit, label) => `<div class="nt${k === 'protein' ? ' lead' : ''}"><span class="nt-ic ${k}">${icon(NUT_ICON[k], 16)}</span><div class="nt-v">${plain(v, unit)}</div><div class="nt-k">${label}</div></div>`;
    const tiles = [
      ...(PS.showMacros ? [tile('protein', raw.protein, '<i>g</i>', 'Protein'), tile('carbs', raw.carbs, '<i>g</i>', 'Carbs'), tile('fat', raw.fat, '<i>g</i>', 'Fat')] : []),
      ...(PS.showCalories ? [tile('cals', raw.cals, '', 'Calories')] : []),
    ];
    const nutrition = settled && showNums ? `
    <section class="lm-sec lm-nut">
      <div class="lm-h"><h2>Nutrition</h2><span class="lm-conf">${esc(provShort)}</span></div>
      ${emptyRead ? rereadNote : `
      <div class="nut-tiles${tiles.length === 3 ? ' three' : tiles.length <= 2 ? ' two' : ''}">${tiles.join('')}</div>
      ${someMissing ? `<div class="est-note">A dash means we do not have that number for this meal. It is not a zero.</div>` : ''}`}
    </section>` : '';
    // THE DAY, as a footnote of the Today section and never a second hero (founder 2026-09-15:
    // "the daily score can be a subtle contextual indicator rather than another giant metric").
    // Athlete's own live day only: a coach reading a plate, or a past plate, has no day credit.
    const move = you && !past && RT.lastMove && (RT.lastMove.what || '').toLowerCase() === M.slot ? RT.lastMove : null;
    const justLogged = !!move && !move._played;
    const dupFlagged = M.flagged === 'dup';
    const toTier = justLogged ? tier(move.to) : null;
    const firstEver = justLogged && !(DAY.scoreHistory || []).some((h) => h && h.date && h.date < String(DAY.date));
    const dayFoot = you && !past && exec ? `
      <div class="lm-day">
      ${justLogged && !dupFlagged ? scoreMoveBar({
        from: move.from, to: move.to, uid: 'mt',
        head: `<div class="score-line">
        <span class="k">Daily score</span>
        <span class="from">${move.from}</span>
        <span class="arr">${icon('arrowRight', 14)}</span>
        <span class="to ${toTier.cls}" data-sm-count="${move.to}">${move.to}</span>
        <span class="gain ${toTier.cls}">+${move.gain}</span>
        ${toTier.name !== tier(move.from).name ? `<span class="tier-chip ${toTier.cls}" data-sm-tier="▲ " data-sm-base="tier-chip">▲ ${esc(toTier.name)}</span>` : ''}
      </div>`,
      }) + (firstEver ? '<div class="sm-first">First one in. From here the number is live: every meal, every check-in, every day.</div>' : '') : ''}
      ${(() => {
        if (justLogged || dupFlagged) return '';
        const gain = S.mealScoreImpact(M.slot) || 0;
        // Neutral ('n') on purpose: no day number sits in this row for a tier colour to belong
        // to, and a 2-of-4 day is under 60 by construction (see .status-pill.inprog).
        return gain > 0 ? `
      <div class="score-line">
        <span class="k">Daily score</span>
        <span class="gain n">+${gain} from this meal</span>
      </div>` : '';
      })()}
      <div class="prog-line">
        ${segBar(exec.met, exec.total, `${exec.met} of ${exec.total} completed today`)}
        <span class="pk">${exec.met} of ${exec.total} in today${S.streakDays > 0 ? ` · ${S.streakDays} day streak` : ''}</span>
      </div>
      </div>` : '';
    const todayRows = targetBars.map(([k, v, target, u, projected]) => {
      const now = Math.min(100, Math.round((v / target) * 100));
      const ahead = projected != null ? Math.max(0, Math.min(100 - now, Math.round((projected / target) * 100))) : 0;
      const left = Math.max(0, target - v);
      return `
      <div class="tb-row">
        <span class="tb-k"${k === 'Protein' && paceNote ? ` title="${esc(paceNote)}"` : ''}>${k}</span>
        <div class="tb-track"><div class="tb-fill" style="width:${now}%"></div>${ahead ? `<div class="ghostb" style="left:${now}%;width:${ahead}%"></div>` : ''}</div>
        <span class="tb-v"><span><b>${fmtN(v)}</b> / ${fmtN(target)}${u}</span><small>${left ? `${fmtN(left)}${u} left` : 'Target met'}</small></span>
      </div>`;
    }).join('');
    const today = settled && showNums && (targetBars.length || dayFoot) ? `
    <section class="lm-sec lm-today">
      ${targetBars.length ? `<div class="lm-h"><h2>${past ? 'That day after this meal' : 'Today after this meal'}</h2>${you && !past ? `<button type="button" class="lm-more" data-go="plan">View daily targets ${icon('chevron', 14)}</button>` : ''}</div>
      ${todayRows}` : ''}
      ${dayFoot}
    </section>` : '';
    /* THE DIAL IS THE NUMBER, AND THE DOOR TO WHY (audit 2026-09-22; mealDialHtml). The band word used to sit
       inside the ring under the numeral, where every band's word ("Strong meal", "Perfect plate",
       "Needs work") is as wide as the ring's inner chord: its corners ran onto the arc, and a
       28px info mark covered the arc's end. The word now rides above the dial on the same photo
       scrim as "View photo", the ring holds the numeral alone, and the dial itself opens "Why did
       this meal score N?" (an 88px target instead of 28). It is a button ONLY when that drawer
       renders: an Intuitive read or an unsettled one has no rubric, and the old info mark opened
       nothing there. */
    const hasRub = settled && showNums && !!band && M.score != null && rub.rows.length > 0;
    const photoBlock = `
    <!-- The plate, blurred, as the screen's own backdrop. Same <img> src as the hero (assigned once
         in mount), so this costs no second fetch. Decorative and behind everything. -->
    <div class="meal-backdrop" aria-hidden="true"><img id="meal-backdrop-img" alt="" decoding="async"/></div>
    <div class="photo-hero lm-hero" id="meal-hero" data-vt="plate">
      <img id="meal-photo" alt="Photo of this meal" decoding="async"/>
      <div class="ph-grad"></div>
      ${M.live === false ? `<div class="lm-prov">${nonLiveBadge()}</div>` : ''}
      <div class="lm-view" aria-hidden="true">${icon('image', 15)} View photo</div>
      ${M.score != null ? mealDialHtml(M.score, { id: 'meal-scorechip', button: hasRub }) : ''}
    </div>
    ${stoodOut}${nutrition}${today}`;

    // ---- 3. DETECTED FOODS + CORRECTIONS (feedback 2026-07-16; the value strip and day bars
    // moved into the read card above, founder 2026-08-10). Detected foods are rows with
    // portions + an honest estimate note; the correction affordances live with them. ----
    const foodRows = M.detectedRich.map((d) => `
      <div class="food-row">
        <span class="conf-dot ${esc(d.confidence || 'high')}"></span>
        <span class="fr-name">${esc(d.name)}</span>
        <span class="fr-qty">${d.quantity ? `${fromPhoto ? '~ ' : ''}${esc(d.quantity)}` : ''}</span>
        ${d.basis === 'label' ? '<span class="rx-tag">label read</span>' : d.basis === 'database' ? '<span class="rx-tag">known product</span>' : ''}
      </div>`).join('');
    const corrLog = (M.corrections || []).length;
    // While the read is in flight there are no numbers yet — and a macro row of zeros reads as a
    // measurement, not an absence. Show the honest placeholder instead of "0g protein · 0 cal",
    // and withhold the "Correct the analysis" link until there is something to correct.
    //
    // ONE PROCESS (founder, 2026-08-02). The card used to carry its own sentence — "Reading the
    // plate. The numbers fill in here when it lands." — directly above an AI bubble saying
    // "Reading your plate… the breakdown lands here in a few seconds". Two narrators announcing
    // one wait is exactly what made the breakdown and the nutritionist read as separate systems.
    // The AI keeps the words; the card shows what it IS — cells quietly filling in. The failure
    // line stays, because that is a fact about the card, not a second commentary on the wait.
    /* Five dashes and no reason was the whole problem. The tiles look identical whether the read
       is still running or the model asked a question three scrolls down, and only one of those is
       something the athlete can do anything about. The waiting shimmer now belongs to the actual
       wait, and a blocked breakdown says who it is waiting on and opens the sheet. */
    const needsAnswer = Array.isArray(M.pendingQuestions) && M.pendingQuestions.length > 0;
    const breakdown = !settled ? `
    <h2 class="eyebrow" style="margin-top:16px">Meal Breakdown</h2>
    <section class="card pad" style="margin-top:8px">
      <div class="macro-row five">
        ${['Protein', 'Carbs', 'Fat', 'Calories', 'Fiber'].map((k) => `
        <div class="macro"><div class="mv${M.pending && !needsAnswer ? ' mv-wait' : ''}" style="color:var(--text-3)">—</div><div class="mk">${k}</div></div>`).join('')}
      </div>
      ${needsAnswer ? `<div class="mq-blocked">
        <div class="mqb-t">${M.pendingQuestions.length === 1 ? 'One answer from you and these are exact.' : `${M.pendingQuestions.length} answers and these are exact.`}</div>
        <button class="btn primary sm" id="mq-open-breakdown" type="button">${icon('sparkle', 15)} Answer</button>
      </div>` : ''}
      ${M.analysisFailed ? `<div class="est-note" style="margin-top:10px">No numbers for this one. The photo is still your proof that the meal happened.</div>` : ''}
    </section>` : !showNums ? `
    ${/* The Intuitive read's plate section wears the 09-15 section shape (a heading with its
          provenance once, beside it), not the old uppercase eyebrow whose "· estimated from
          photo" fell onto its own line. No foods, no heading over nothing. */''}
    <section class="lm-sec lm-plate">
    ${foodRows ? `<div class="lm-h"><h2>What was on the plate</h2><span class="lm-conf">${esc(provShort)}</span></div>
    <div class="lm-plate-rows">${foodRows}</div>` : ''}
    ${M.userNote ? `<div class="est-note"><b class="est-k">${you ? 'Your note' : 'Their note'}:</b> ${esc(M.userNote)}</div>` : ''}
    <div class="est-note">${you ? `Your plan tracks how food leaves you feeling rather than calorie and macro counts. Your ${esc(S.coach.noun)} can still see the full numbers.` : 'This plan tracks how food leaves the athlete feeling rather than counts. You see the full numbers.'}</div>
    ${emptyRead ? rereadNote : ''}
    </section>` : `
    ${/* The Estimated Nutrition panel that opened this section lives inside the read card now
          (founder 2026-08-10) — what remains here is the detail drawer: foods, notes,
          corrections, and the correction panel itself. */''}
    <section class="lm-rows">
    ${band && M.score != null && rub.rows.length ? `<details class="rub"${thread._rubOpen ? ' open' : ''}>
      <summary><span class="lm-ric">${icon('sparkle', 16)}</span><span class="lm-rt">Why did this meal score ${M.score}?</span>${icon('chevron', 16)}</summary>
      <div class="rub-body">
        ${rub.rows.map(r => `
        <div class="rub-row">
          <span class="bd-req-dot ${RUB_DOT[r.state] || 'muted'}"></span>
          <span class="rk">${esc(r.k)}</span>
          <span class="rn">${esc(r.note)}</span>
          <span class="rx-tag">${r.exact ? 'exact' : 'estimated'}</span>
        </div>`).join('')}
        <div class="rub-fine">Exact items are facts (timing, what you submitted). Estimated items come from the photo read and move when you correct it in the chat.</div>
      </div>
    </details>` : ''}
    <details class="bd-wrap"${thread._bdOpen ? ' open' : ''}>
      ${/* No card inside this card (audit 2026-09-22): the foods are plain rows in the drawer's own
            surface. A read with no foods is not "Detected foods · 0 items", a drawer that opens
            onto nothing: it is the meal's details (the notes, the disclaimer, the correction row),
            and the summary says so. */''}
      <summary><span class="lm-ric">${icon('clipboard', 16)}</span><span class="lm-rt">${M.detectedRich.length ? `Detected foods<small>${M.detectedRich.length} item${M.detectedRich.length === 1 ? '' : 's'}</small>` : 'Meal details'}</span>${icon('chevron', 16)}</summary>
      <div class="bd-body">
      ${foodRows ? `<div class="bd-foods">${foodRows}</div>` : ''}
      ${/* "No targets" is claimed off the RAW targets, not the visible bars: a target a
            professional chose to hide still exists, and this line must not say otherwise. */''}
      ${targetBars.length || T.protein || T.calories ? '' : `<div class="est-note">${you ? "No coach targets set yet, so there's nothing to measure against. These are this meal's totals." : 'No targets set for this athlete yet, so there is nothing to measure against. These are this meal\'s totals.'}</div>`}
      ${PS.showMacros && M.fiber != null ? `<div class="est-note" style="margin-top:8px">~${M.fiber}g fiber estimated. The full component read is under "Why did this meal score ${M.score != null ? M.score : 'this'}?".</div>` : ''}
      ${M.userNote ? `<div class="est-note" style="margin-top:8px"><b style="color:var(--text-2)">${you ? 'Your note' : 'Their note'}:</b> ${esc(M.userNote)}</div>` : ''}
      ${corrLog ? `<div class="est-note" style="margin-top:8px;color:var(--blue-bright)"><b style="color:var(--blue-bright)">${you ? 'Corrected by you' : 'Corrected by the athlete'}</b>: ${corrLog} correction${corrLog === 1 ? '' : 's'} applied. The AI's original estimate is kept for reference${(() => {
        if (!M.orig) return '';
        const bits = [];
        if (PS.showMacros) bits.push(`~${M.orig.protein}g protein`);
        if (PS.showCalories) bits.push(`~${M.orig.kcal} kcal`);
        return bits.length ? ` (was ${bits.join(' · ')})` : '';
      })()}.</div>` : ''}
      ${/* The two entry points into the correction panel live HERE, with the numbers they correct
            (founder, 2026-08-02). Both render for a manually logged meal too. */''}
      ${/* THE CHAT IS THE CORRECTION SURFACE (founder, 2026-09-02). The "Correct the analysis"
            chip panel that lived here is gone: a second, form-shaped way to fix a read next to
            a conversation that already does it was two systems for one job. Anything the chips
            could do (oil, sauce, a drink, a side, a portion, a different food) is one sentence
            to the AI Nutritionist, and every correction from the chat lands wholesale: the
            food's name, the meal title, per-item macros, totals, the score, and the coach's
            copy. This line only points at the composer. */''}
      ${emptyRead || !you ? '' : M.mealId ? `<div class="est-note">${fromPhoto ? 'Estimated from the photo. ' : ''}Something off or left out? <span class="link" id="tell-ai" role="button" tabindex="0">Tell Nia below</span> and the name, numbers and score update together.</div>` : ''}
      ${emptyRead ? '' : aiDisclaimer()}
      ${/* WRONG MEAL? (impeccable critique 2026-09-16.)
            The chat above corrects what the plate WAS. Nothing corrected whether it should exist
            at all, or which slot it belonged to — so a lunch photographed at 2pm on a day
            breakfast was never logged stayed filed under breakfast permanently, in the row the
            coach reads, and the athlete's only recourse was to say so in the thread and hope.
            Today's own meals only: these act on DAY, and a past day is not loaded to be edited. */''}
      ${(!you || past) ? '' : correctionRow(M.slot)}
      </div>
    </details>
    </section>`;
    return { photoBlock, breakdown };
}

export const thread = {
  tab: 'home',
  // Founder feedback 2026-07-16: the tab bar + camera FAB covered the composer, and "take
  // another photo" is the wrong primary action on a meal that's already logged. Nav hides
  // here; the back head carries the exit (the header's back control, 2026-09-23).
  hideTabs: true,
  render({ sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    const e = S.exec;

    if (!M.logged) {
      return `
      ${backHead(M.name, 'Not logged yet', 'home')}
      <div class="state-demo">
        <div class="sd-ic">${icon('camera', 24)}</div>
        <div class="sd-t">${esc(M.name)} isn't logged yet</div>
        <div class="sd-s">Log it with a photo and its full breakdown (foods, macros, your team's take) lives here.</div>
      </div>
      <button class="btn green" data-go="camera/${M.slot}">${icon('camera', 18)} Log ${esc(M.name)}</button>
      <div style="height:10px"></div>`;
    }

    // ---- 1. THE STATUS LINE (founder 2026-09-15). The logged confirmation used to be a bordered
    // green card carrying the timing, the day score's move, and the day's progress, all above the
    // photo it was competing with. It is one slim row under the title now: check, slot, time,
    // verdict, and the coach's receipt. The day score and the day's progress moved under "Today
    // after this meal" (mealReadHtml), where they are context for the bars, not a second hero.
    const move = RT.lastMove && (RT.lastMove.what || '').toLowerCase() === M.slot ? RT.lastMove : null;
    const justLogged = !!move && !move._played;
    const dupFlagged = M.flagged === 'dup';
    const cStatus = coachThreadStatus({
      mealId: M.mealId, hasCoach: S.coach.hasCoach, comments: [], noun: S.coach.noun,
      dayReviewed: RECEIPT.uid === RT.userId && RECEIPT.date === String(DAY.date) && RECEIPT.reviewed,
    });
    const lateLabel = M.minutesLate > 0 ? `${M.minutesLate} min late` : M.late ? 'Late, still counts' : 'On time';
    // The slot is named here only when the title names the FOOD. With no dish from the read the
    // title already reads "Lunch", and "Lunch / ✓ Lunch · 1:06 PM" said it twice (audit 2026-09-22).
    const statusBits = [
      ...(M.dish ? [`<span class="lm-slot">${esc(M.name)}</span>`] : []),
      ...(M.loggedAt ? [`<span>${esc(M.loggedAt)}</span>`] : []),
      `<span class="${M.minutesLate > 0 || M.late ? 'late' : 'ontime'}">${esc(lateLabel)}</span>`,
    ].join('<span class="lm-dot">·</span>');
    const execTop = `
    <div class="lm-status">
      <span class="lm-ck${justLogged ? ' pop' : ''}">${icon('check', 12)}</span>
      ${statusBits}
      ${cStatus.label ? `<span class="lm-dot">·</span><span id="coach-status">${esc(cStatus.label)}</span>` : ''}
    </div>
    ${dupFlagged ? `<div class="lm-dup">Duplicate photo · recorded, but it doesn't count. Coach can see the flag.</div>` : ''}`;

    const { photoBlock, breakdown } = mealReadHtml(M, { exec: e });


    // ---- 4. GROUPCHAT — the SINGLE AI-insight surface. Feedback 2026-07-16: the opening
    // used to be a wall of text nobody reads. Now it's the 5-second structured summary
    // (derived, never stored) with the full openingMessage paragraph behind an expander.
    // Quick actions make it feel like a chat, not a report. ----
    const { sum, fullText, modelProse } = openingInputs(M);

    // WHO IS IN THE ROOM. A messaging surface that hides its own audience is a privacy problem
    // wearing a UI problem's clothes — an athlete typing "I skipped breakfast" deserves to know
    // their coach and their mother can both read it before they hit send. Overlapping faces
    // rather than emoji, because these are people.
    const people = participantList(PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [], RT.userId);
    const discTitle = threadTitle(people, S.coach, THREAD_CACHE.mealId === M.mealId ? THREAD_CACHE.comments : []);
    // THE CONVERSATION'S OWN HEADER (2026-09-14). One row, the way the phone names a group at
    // the top of a thread: the faces, the title, who is in it, and the way to the whole
    // conversation. The faces are the members button; "Open" carries this plate into the full
    // chat, aimed at it (nutrition-chat/<mealId>). It replaces an uppercase eyebrow, an inline
    // text link and a separate pill that together said the same thing three ways.
    const facepile = !M.mealId ? '' : `
    <button class="facepile disc-fp" id="meal-members" aria-label="Who can see this conversation">
      <span class="fp">${facesHtml(people, esc)}</span>
      <span class="names"><b>${discTitle}</b><small>${esc(participantSummary(people))}</small></span>
    </button>`;

    const discussion = `
    <section class="disc" id="meal-disc" aria-labelledby="disc-title">
    <h2 class="sr-only" id="disc-title">${discTitle}</h2>
    <div class="disc-head">
      ${facepile || `<div class="disc-fp"><span class="names"><b>${discTitle}</b></span></div>`}
      ${M.mealId ? `<button type="button" class="disc-open" id="open-full-chat" aria-label="Open the full conversation at this meal">Open ${icon('chevron', 14)}</button>` : ''}
    </div>
    ${/* The `#rx-strip` that used to sit here is gone: paint() has cleared it on every repaint
          since reactions moved onto the bubble they belong to, so it was an element whose only
          job was to be emptied. */''}
    ${/* The "Earlier · <last message>" teaser row is GONE (founder, 2026-08-11): it opened the
          exact same full chat as "View full chat" two lines above it — two controls, one
          destination, and the teaser's preview text doubled as a third voice above the thread.
          The in-thread "View N earlier messages" seam (#thread-more) stays: that one carries
          information this screen truncated. */''}
    <div class="thread" id="meal-thread" role="log" aria-label="Meal conversation">
      ${openingBlockHtml(M, { sum, fullText, modelProse })}
      ${/* Loading is a skeleton shaped like the messages it stands in for, and only when there
            is no cached thread to paint instantly. The id stays: the mount removes it on load
            and rewrites it in place on failure. */''}
      ${M.mealId
        ? `<div id="thread-status">${THREAD_CACHE.mealId === M.mealId ? '' : skeletonRows(2, 'Loading the thread')}</div>`
        : `<div class="msg-status" id="thread-status">${S.coach.hasCoach ? `Syncs when connected · your ${esc(S.coach.noun)} sees this log either way.` : 'Syncs when connected · this log is saved either way.'}</div>`}
    </div>
    ${M.mealId ? `
    ${/* "Ask a question" went first (founder, 2026-08-02): it carried data-qa="" — no prefill at
          all — so its whole effect was to focus the composer directly beneath it, whose
          placeholder already reads "Ask about this meal…".
          The reaction row went with it, and for the same reason. Four emoji parked permanently
          above the composer are not messaging mechanics; every thread the athlete has ever used
          puts them behind a press-and-hold on the message being reacted to, and so does this one
          now (tapback.js, wired in mount). What is left between the last message and the box you
          type in is: nothing. */''}
    ${/* THE DOCK, scoped to this section (screens.css .disc .chat-dock): sticky to the bottom of
          the screen only while the discussion is on screen, so it rides up to meet you the moment
          the conversation scrolls into view and never covers the plate or the breakdown above. */''}
    <div class="chat-dock disc-dock dock-end">
    ${/* The note sits ABOVE the box, as calm small print (screens.css .cmp-note). */''}
    <div id="chat-note" class="cmp-note" role="status"></div>
    ${composer({ inputId: 'meal-msg', sendId: 'meal-send', placeholder: composerPrompt(S.coach.hasCoach, S.coach.noun), sendLabel: 'Send', attachId: 'meal-attach', atEnd: true })}
    <div class="composer-attach-pending" id="meal-attach-pending" hidden></div>
    </div>` : ''}
    </section>`;

    // ---- 4. DAY COMPLETE ----
    // The Next Action row is GONE from this screen (founder, 2026-08-17). It rendered between
    // "you logged dinner" and the dinner itself, so an athlete who opened a meal was handed a
    // DIFFERENT task — frequently wearing the warning colour and a LATE pill — before they saw a
    // single thing they had eaten. Nothing is lost by cutting it: Home builds the identical row
    // from the same exec engine (S.exec.now), which is where "what do I do next" belongs. This
    // screen's job is the meal.
    //
    // The day-complete moment below is NOT that row and does not go with it. It fires only once
    // the whole day is closed, so it is about this day FINISHING rather than a next task
    // (founder 2026-08-11: "we can do better than the 'that's everything, you're OnStandard'
    // tag"). The green checkbox card read as one more status row; a complete day is the
    // product's whole point, so it gets the product's own mark: the brand dial carrying the
    // score (score surfaces wear the blue→teal sweep, per the design law), the tier it earned,
    // and the one fact nothing else on this screen states — when the day locks. Tappable into
    // the breakdown, same as Home's celebration hero.
    const dayTier = e.celebration ? tier(e.score) : null;
    const next = e.celebration ? `
    <section class="day-sealed" data-go="score-breakdown" role="button" tabindex="0"
      aria-label="Day complete. Daily Score ${e.score}, ${esc(dayTier.name)}. Open the score breakdown">
      <div class="ds-dial">${miniDial(e.score)}<span class="ds-n">${e.score}</span></div>
      <div class="ds-body">
        <div class="ds-t">Everything's in.</div>
        <div class="ds-s">${S.streakDays > 0 ? `Day ${S.streakDays} locks at midnight` : 'Locks at midnight · that starts your streak'}</div>
      </div>
      <span class="tier-chip ${dayTier.cls}" style="margin-top:0">${esc(dayTier.name)}</span>
    </section>` : '';

    // Wrapped so the blurred photo backdrop inside photoBlock has a containing block and a stacking
    // context of its OWN. The obvious shortcut — positioning #view — is shared by every screen and
    // breaks any absolutely-positioned overlay rendered inside one (it threw the quick-log sheet
    // off the top of the screen); see .meal-screen in screens.css.
    // The header used to repeat the timing verdict the confirm card states one line below it —
    // "Breakfast / On time" immediately above "Breakfast logged / Logged 8:24 AM · on time".
    // Three facts, each said twice. This file's own rule is each fact exactly once, so the verdict
    // now lives only in the card (which carries the real clock time with it). The header keeps the
    // meal's name, and keeps the duplicate-photo flag — a different fact nothing else states.
    // `next` is the day-complete seal ONLY, and is empty on every ordinary logged meal (founder
    // 2026-08-17 — see the block above for why the Next Action row that used to share this slot
    // is gone). The screen is confirm → photo → score → conversation → details.
    // The title names the FOOD when the read gave us a name for it, and the slot otherwise
    // (M.dish is null unless it says more than the slot already does). The sub-line stays empty
    // on purpose: the confirm card one line below already reads "Dinner logged · Logged 6:55 PM ·
    // on time", so naming the slot up here too would state it twice on the screen whose own rule
    // is each fact exactly once. The coach could see a name for their athlete's plate and the
    // athlete could not; this is the read side of that fix.
    // THE EXIT IS THE HEADER'S BACK CONTROL (composer upgrade, 2026-09-23). "Back to Home" sat
    // under the message box as a full button, so the bottom of this screen was a pill floating
    // over a grey band with an exit slab beneath it (the founder's screenshot). The 2026-09-07
    // ruling put the exit last; the founder's 2026-09-23 ask is that the bottom be ONE flush bar
    // like Messages. So the way out is the back chevron at the top of the page (backHead below,
    // sticky, falling back to Home), the same as every other pushed screen, and the message box
    // is the last thing on the screen, flush with its bottom edge (.chat-dock.dock-end).
    return `<div class="meal-screen">${backHead(M.dish || M.name, dupFlagged ? 'Duplicate photo' : '', 'home')}${execTop}${next}${photoBlock}${breakdown}${discussion}</div>`;
  },

  async mount(root, { sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    /* The score move — one keyed sweep, resumable, retired only once it has actually finished.
       score-move.js owns the choreography now; the copy of the recovery confirm's count-up that
       used to live here is gone. `_played` is set from onDone, which fires when the sweep lands OR
       when a later mount finds the move already spent, so a repaint mid-sweep adopts the new node
       and carries on instead of deleting the line out from under it.
       In-memory until the next save, so worst case it replays once after a reload — acceptable, and
       the same trade the old flag made. */
    const mv = RT.lastMove && (RT.lastMove.what || '').toLowerCase() === slot ? RT.lastMove : null;
    if (mv && !mv._played) {
      playScoreMove(root, {
        key: `move:${slot}:${DAY.date}:${mv.from}-${mv.to}`,
        from: mv.from, to: mv.to,
        onDone: () => { mv._played = true; },
      });
    }
    if (!M.logged) return;
    /* The ask comes to the athlete, once. A meal whose numbers are waiting on an answer opens its
       sheet the first time that meal is opened this session, after the screen's own entrance has
       finished so the two are not animating over each other. Every later visit leaves it to the
       bubble's chip and the breakdown's button, because a sheet that reappears on every visit is
       the app arguing with someone who already chose to read their thread first. */
    if (Array.isArray(M.pendingQuestions) && M.pendingQuestions.length) {
      const key = `${slot}:${DAY.date}`;
      if (!autoShownFor(key)) {
        markAutoShown(key);
        setTimeout(() => {
          // Still the same screen, still unanswered: a drain can land while the timer waits.
          const now = mealDetail(slot);
          if (!root.isConnected || !now || !Array.isArray(now.pendingQuestions) || !now.pendingQuestions.length) return;
          askPendingQuestions(now);
        }, 420);
      }
    }

    // The score arrives. This chip is the moment the product is built around, and it sat there as
    // static text. The choreography (wait until it is actually looked at, wind the arc back, draw,
    // count up, one 'success' haptic) now lives in motion.js so the daily score and the breakdown
    // ring play the SAME moment instead of three different amounts of it. The slot prefix keeps the
    // key stable while mealId is still null on a locally-logged, not-yet-synced meal.
    // whenSeen: the chip sits ~1100px down a 390x844 thread, so playing it on mount would spend the
    // moment off-screen. It observes the CHIP, which is small enough for the ratio to be reachable.
    reveal(root.querySelector('#meal-scorechip'), {
      key: `meal:${M.slot}:${M.mealId || ''}`, whenSeen: true,
      // A 100 takes the whole screen for three seconds (perfect-moment.js). It hangs off the
      // reveal rather than off mount so the celebration fires when the athlete is actually
      // LOOKING at the number, and inherits the reveal's once-per-meal key for free.
      onPlay: () => { if (Number(M.score) >= 100) playPerfectMoment({ slotLabel: M.name, dish: M.dish, score: M.score }); },
    });

    const roles = await import('../roles.js');
    // Delegation target for render-injected content (the memory chips, the tapback picker):
    // #view is REPLACED on every render, so listeners attached here die with the paint —
    // never the persistent device root, which would stack one listener per mount.
    const viewEl = root.querySelector('#view') || root;
    // Real history for patterns + the coach day-receipt for the status line (both cached,
    // both repaint-once). Fired in the background — the screen never waits on them.
    void warmRecent(roles, RT.userId);
    void warmPendingFacts(RT.userId);
    // Names for the facepile and the bubbles. A repaint when it lands, because "Coach" becoming
    // "Coach Brown" mid-scroll is the whole point.
    void warmParticipants(roles, RT.userId).then((fetched) => { if (fetched) window.__render && window.__render(); });
    void warmReceipt(roles, RT.userId, String(DAY.date)).then(() => {
      const el = root.querySelector('#coach-status');
      // The receipt landed after first paint: upgrade "Sent to <noun>" → "<Noun> opened your day".
      // Same wording coachThreadStatus produces, so the two can never disagree mid-scroll.
      if (el && RECEIPT.reviewed && /^Sent to /.test(el.textContent)) {
        el.textContent = `${S.coach.noun.charAt(0).toUpperCase()}${S.coach.noun.slice(1)} opened your day`;
      }
    });

    // ---- Corrections happen in the chat (founder, 2026-09-02) ----
    // The chip panel is gone; the only control left is a pointer to the composer.
    // Breakdown expander state survives the exec-tick re-render; `toggle` fires only on user
    // changes, never on the initial `open` attribute.
    const bdWrap = root.querySelector('.bd-wrap');
    if (bdWrap) bdWrap.addEventListener('toggle', () => { thread._bdOpen = bdWrap.open; });
    wireReadControls(root, thread);
    /** Put the cursor in the thread composer: the one place a correction is made. Through
     *  keyboard.js's focusComposer, which brings the conversation down onto the keys — this
     *  was a local `const focusComposer` doing scrollIntoView({block:'center'}), which SHADOWED
     *  the import for the whole of mount(), so prefill() at the bottom of this file was calling
     *  it while its own comment claimed the opposite (adversarial review, 2026-09-03). */
    const focusMealComposer = () => focusComposer(root.querySelector('#meal-msg'));
    const tellAi = root.querySelector('#tell-ai');
    if (tellAi) tellAi.addEventListener('click', focusMealComposer);

    /* "Wrong meal?" (impeccable critique 2026-09-16). Move is one tap: it is reversible, and the
       only targets offered are open slots, so nothing can be overwritten. Delete ARMS FIRST and
       names the consequence in between, the same two-step Home uses for spending a pass — it is
       the one action here that cannot be undone, and it sits in a row of look-alike buttons.
       Arming disarms itself after a few seconds and on a tap anywhere else, so an armed Delete is
       never left lying around for a later thumb. */
    const mcxStatus = root.querySelector('#mcx-status');
    const say = (msg, error) => { if (mcxStatus) sayStatus(mcxStatus, msg, { error: !!error }); };
    let armedDel = null, armTimer = null;
    const disarmDel = () => {
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
      if (armedDel && armedDel.isConnected) {
        armedDel.innerHTML = armedDel.dataset.idle;
        armedDel.classList.remove('armed');
      }
      armedDel = null;
    };
    root.querySelectorAll('[data-move]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        disarmDel();
        const to = b.getAttribute('data-move');
        if (!act.moveMeal(M.slot, to)) { say('That slot just filled up. Pick another one.', true); return; }
        // The route names the OLD slot, which is now open, so staying put would render an empty
        // read. Follow the meal to where it went.
        location.hash = `#meal-detail/${to}`;
      });
    });
    const delBtn = root.querySelector('[data-unlog]');
    if (delBtn) {
      delBtn.dataset.idle = delBtn.innerHTML;
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (armedDel !== delBtn) {
          disarmDel();
          armedDel = delBtn;
          delBtn.classList.add('armed');
          // Name what it costs. "Delete" alone never said the score moves or that the coach sees it.
          delBtn.innerHTML = 'Delete for good?';
          say('This drops your score and removes it from your coach’s view.');
          armTimer = setTimeout(() => { disarmDel(); say(''); }, 4500);
          return;
        }
        disarmDel();
        const slot = delBtn.getAttribute('data-unlog');
        if (!act.unlogMeal(slot)) { say('Could not remove that one. Try again in a moment.', true); return; }
        // This screen IS the meal that was just removed, so staying here would render a read of
        // something that no longer exists. Home is where the now-open slot lives.
        location.hash = '#home';
      });
    }
    root.addEventListener('click', (ev) => { if (armedDel && !armedDel.contains(ev.target)) { disarmDel(); say(''); } }, true);
    // Photo: the in-session capture, else a signed Storage URL so it survives a reload. Resolved
    // through photo-store (NOT a raw one-shot signedMealPhotoUrl): the cache retries a missing
    // object after NEG_TTL, and the outbox calls invalidateMealPhoto + __render the moment a
    // retried upload lands — so a photo that arrives seconds after this paint fills itself in.
    // The URL is set as an img.src property (not HTML), so no injection risk; best-effort.
    const photo = root.querySelector('#meal-photo');
    if (photo) {
      /* Fast path, and it has to be BEFORE the await. The morph that carries the plate onto this
         screen snapshots the hero at the end of this mount, and everything after the dynamic import
         below happens in a later frame — so the photo we were handed seconds ago in MEAL.photoDataUrl
         was landing after the frame that needed it, and the flow ended on an empty gradient box that
         filled in a beat later. Assigned as a property, not HTML, exactly like the resolve below.
         Deliberately does NOT touch .ph-nophoto or the backdrop: this only brings forward a photo
         the code below would have shown anyway, and every honesty path after it still runs and
         still wins. A photo we do not already hold takes the slow road exactly as before. */
      if (M.img) { photo.src = M.img; photo.style.display = 'block'; }
      const store = await import('../photo-store.js');
      let url = M.img;
      if (!url && RT.userId && M.hasPhoto) {
        url = await store.resolveMealPhoto(store.todayMealPhotoPath(RT.userId, String(DAY.date), M.slot));
      }
      const hero = root.querySelector('#meal-hero');
      // The honest empty state. A meal that claims a photo the bucket can't serve (upload still
      // in flight, or lost before the upload got its retry queue) collapses the frame and says
      // so — a full-height empty box reads as broken, because it is.
      const noPhoto = (label) => {
        if (!hero || !root.isConnected) return;
        photo.style.display = 'none';
        hero.classList.add('ph-nophoto');
        if (!hero.querySelector('.ph-wait')) hero.insertAdjacentHTML('beforeend', `<div class="ph-wait">${icon('image', 15)} <span></span></div>`);
        hero.querySelector('.ph-wait span').textContent = label;
      };
      if (url) {
        // A signed URL can point at an object that was never stored (rows written before the
        // upload had a retry queue). onerror keeps the honest placeholder, not a broken frame.
        photo.onerror = () => noPhoto("This photo didn't sync from the device.");
        photo.src = url; photo.style.display = 'block';
        // Same URL into the blurred backdrop — one decode, two uses.
        const back = root.querySelector('#meal-backdrop-img');
        if (back) back.src = url;
        // Tapping the meal photo opens the original full-screen (§6.1) — a DOM overlay, so
        // closing returns to this exact scroll position with zero navigation.
        if (hero) {
          hero.style.cursor = 'zoom-in';
          hero.setAttribute('tabindex', '0');
          hero.setAttribute('role', 'button');
          hero.setAttribute('aria-label', 'View photo full screen');
          hero.addEventListener('click', () => openImageViewer(url, `${M.name} photo`, hero));
        }
      } else if (M.hasPhoto) {
        // Still owed by the outbox → "syncing"; otherwise it never made it off the device.
        const { getJob, jobKey } = await import('../meal-outbox.js');
        const job = RT.userId ? getJob(jobKey(RT.userId, DAY.date, M.slot)) : null;
        noPhoto(job && job.needUpload && !job.dead ? 'Photo syncing from your device…' : "This photo didn't sync from the device.");
      }
    }
    // The "View full analysis" expander is gone with the report card it belonged to (2026-08-02):
    // the AI's read is now one paragraph in one bubble, whether it arrives locally or from the
    // server, so there is no second half of it left to hide behind a toggle.
    if (!M.mealId) return;

    const threadEl = root.querySelector('#meal-thread');
    const statusEl = root.querySelector('#thread-status');
    let threadBusy = false;
    // Rewrites #thread-status in place into an honest failure block + Retry. Reuses statusEl so
    // the existing success-path statusEl.remove() still cleans it up once a load succeeds.
    const showThreadError = () => {
      if (!statusEl) return;
      statusEl.style.cssText = 'align-self:stretch;text-align:center;padding:14px 12px;border-radius:var(--r-tile);background:var(--surface-1);border:1px solid var(--hairline);margin-top:2px';
      statusEl.innerHTML = `<div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);line-height:1.4">Couldn't load the discussion. Your log is safe, coach can still see it.</div>
        <button class="btn ghost sm" id="thread-retry" style="margin-top:10px">${icon('wifiOff', 15)} Try again</button>`;
      const retryBtn = statusEl.querySelector('#thread-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        if (threadBusy) return;
        threadBusy = true;
        refresh().finally(() => { threadBusy = false; });
      });
    };
    let gen = 0; // stale-response guard: only the newest refresh paints
    // A same-meal remount starts from the cache instead of an empty thread — the awaited
    // network fetch below then downgrades to the cheap probe.
    const cacheHit = THREAD_CACHE.mealId === M.mealId;
    let comments = cacheHit ? THREAD_CACHE.comments : [];
    // Server-sourced cursor for the poll's cheap probe (scale pass 2026-08-18) — the max
    // created_at from the last successful FULL fetch. Deliberately not a client clock reading:
    // clock skew between this device and Postgres could push the cursor past a row that's
    // legitimately new, which is exactly the silent-miss class of bug a scale fix must not add.
    let lastKnownAt = cacheHit ? THREAD_CACHE.lastKnownAt : null;
    let rxBusy = false; // one reaction write at a time — double-taps must not race into two rows

    // Message timestamps (feedback 2026-07-16: real chat mechanics). Local clock format;
    // '' for rows without a parseable created_at, so nothing renders rather than "NaN".
    const fmtMsgTime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      let h = d.getHours();
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${mm} ${ap}`;
    };
    // Resolved names for this thread, and the day key that decides when a date separator is due.
    // dayKey is LOCAL: a message at 11:58pm and one at 12:01am are different days to the athlete,
    // whatever UTC thinks.
    const participants = PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [];
    const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

    // The AI is composing something: the plate is being read, or a question is being answered.
    // The flag lives in chat-live.js, keyed to this meal, so a repaint (or a re-mount) cannot
    // drop it and any screen showing this thread draws the same typing row (typingRowHtml).

    const corrKey = String(M.mealId || M.slot || '');

    // The Yes / No under a remember-this reply (2026-09-02), while the fact is still pending.
    // "Still pending" is what the pending-facts fetch says, once it has said anything for this
    // athlete; before that, an offer row shows its chips rather than hiding a live question.
    const offerChips = (c) => {
      const offer = memoryOfferOf(c);
      if (!offer) return '';
      if (ANSWERED_FACTS.has(offer.id)) return '';
      const known = PENDING_FACTS.uid === RT.userId;
      if (known && !(PENDING_FACTS.rows || []).some((f) => f && String(f.id) === offer.id)) return '';
      return memoryOfferChips(offer, esc);
    };

    // What should I eat (2026-09-10): the AI framed it, Food Memory fills it. Ranked at paint
    // time against the LIVE day (the same remaining math Plan > Ask uses), so a meal logged since
    // the reply still moves the picks, and a tap on one stages it exactly as Plan does.
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

    const paint = () => {
      if (!threadEl) return;
      const msgs = threadMessages(comments);
      OFFERED_IN_THREAD.clear();
      for (const c of msgs) { const o = memoryOfferOf(c); if (o) OFFERED_IN_THREAD.add(o.id); }
      // COACH ATTENTION, three DISTINCT facts that must never contradict each other on one
      // screen (founder spec 2026-08-06 — the header said "Reviewed by Coach" while the thread
      // tail said "Coach hasn't reviewed this meal yet."):
      //   replied  — a coach actually wrote on THIS meal (comment/reaction row);
      //   reviewed — the coach marked the athlete's DAY reviewed (coach_views receipt);
      //   seen     — the coach opened the day (a view receipt exists, "Seen by <name>").
      // The header states the strongest one; the tail placeholder renders ONLY when none of the
      // three holds, and says "seen", which is the thing it can honestly claim.
      const coachSeen = (Array.isArray(comments) ? comments : []).some((c) => c && c.role === 'coach');
      const dayReviewed = RECEIPT.uid === RT.userId && RECEIPT.date === String(DAY.date) && RECEIPT.reviewed;
      const daySeen = (RECEIPT.rows || []).length > 0;
      // Upgrade the header status line from the real thread: a coach row = they actually replied.
      const csEl = root.querySelector('#coach-status');
      const Noun = S.coach.noun.charAt(0).toUpperCase() + S.coach.noun.slice(1);
      if (csEl && coachSeen) csEl.textContent = `${Noun} replied`;
      const tail = [];
      if (!msgs.length && !aiWorkingOf(M.mealId)) tail.push('No replies yet. Ask Nia about this meal below.');
      if (S.coach.hasCoach && !coachSeen && !dayReviewed && !daySeen) tail.push(`Your ${S.coach.noun} hasn't opened this yet.`);

      // The pending / clarifying / failed rows are DERIVED, because they describe a read that has
      // not landed and so has nothing persisted to show. The READ ITSELF is now a real message in
      // `msgs`, so the derived summary only fills in for meals logged before that change.
      const hasPersistedRead = msgs.some(isAnalysisOpener);
      // Recomputed from the LIVE meal, not captured from render: a read that lands while this
      // screen is open (or a correction the athlete just made) has to change what these rows say.
      const live = mealDetail(M.slot) || M;
      // Two halves at two points in time: the read (or its pending state) is the thread's oldest
      // row and paints first; the follow-up question / memory confirmation is the AI speaking NOW
      // and paints after the newest message. One openingInputs() call feeds both.
      const openingInp = { ...openingInputs(live), hasPersistedRead };
      const openingLead = openingBlockHtml(live, { ...openingInp, part: 'lead' });
      const openingTail = openingBlockHtml(live, { ...openingInp, part: 'tail' });

      // PREVIEW, NOT TRANSCRIPT (founder spec 2026-08-06): the meal page shows the tail of the
      // conversation — the read, the latest exchange — and the COMPLETE athlete–coach–AI
      // discussion lives on the dedicated chat screen. Slicing here (after the status logic
      // above, which must see everything) keeps this screen scannable; the "View earlier
      // messages" line inside the thread is the honest seam to the full history.
      const PREVIEW_MSGS = 4;
      // Slice, count and anchor on what THIS READER sees (visibleThread is layoutThread's own
      // mute filter). Anchored pre-filter, the reaction pill and Delivered tag rode a last
      // message whose bubble was never painted — muting the newest author silently swallowed
      // the meal's reactions — and four muted rows could blank the whole preview while the
      // real conversation hid behind "earlier messages".
      const visible = visibleThread(msgs, RT.mutedUsers);
      if (msgs.length && !visible.length) tail.push(MUTED_HIDDEN_NOTE);
      const shown = visible.slice(-PREVIEW_MSGS);
      const hiddenCount = visible.length - shown.length;
      const lastMsg = visible.length ? visible[visible.length - 1] : null;
      // New since the last paint: their entrance (fresh) and, when the reader is scrolled back,
      // the jump pill's count (added). chat-live.js keeps this per meal across re-mounts.
      const { fresh, added } = noteArrivals(M.mealId, visible, RT.userId);
      const rxAt = reactionAnchor(visible);
      const nameOfRow = (x) => (x.role === 'athlete' && (!x.author_id || x.author_id === RT.userId) ? 'You' : authorName(x, participants, RT.userId, S.coach.noun));
      const rows = layoutThread(shown, { muted: RT.mutedUsers, fmtTime: fmtMsgTime, fmtDay: dayKey, fmtDayLabel: dayLabelOf }).map((item) => {
        if (item.type === 'time') return timeSepHtml(item, esc);
        const c = item.comment;
        /* A FILED RECEIPT. Same card the live one draws, but from a persisted meal_comments row,
           so it is still here after the athlete leaves and comes back — and a second correction
           files a second receipt instead of overwriting the first. Historical ones land on their
           final values with no count-up: the animation belongs to the change as it happens, not
           to a record of it being re-read. */
        if (isCorrectionReceipt(c)) return receiptCardHtml(c, esc, { fresh: fresh.has(String(c.id)), first: item.firstOfRun });
        const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
        const who = authorName(c, participants, RT.userId, S.coach.noun);
        const update = isAnalysisUpdate(c);
        const escalated = isEscalated(c);
        // From `visible`, like every other anchor: a quote stem must not paint a muted
        // person's words under a bubble the filter kept. No stem is the honest render.
        const quoted = update ? quotedFor(c, visible) : null;
        // A reply someone composed (swipe or hold > Reply): the quote of what it answers.
        const rq = quoted ? '' : replyQuoteHtml(replyQuote(c, visible, RT.mutedUsers, nameOfRow), esc);
        // Reactions belong to the whole thread (0049 keys them to the meal, not to a message), so
        // they sit on the LAST bubble in it — the one the eye lands on. Putting them on the last
        // message of every run repeated the same pill down the page as if four people had each
        // reacted separately.
        const rx = c === rxAt ? reactionGroups(comments) : [];
        // An attached photo renders ABOVE the text, and the text is suppressed when it is only the
        // NOT-NULL stand-in — a bubble reading "Sent a photo" under the photo it is describing is
        // noise. The src is filled in after paint (signed URLs are async); until then the element
        // is a sized placeholder, so the thread does not reflow when images land.
        const photo = attachedPhoto(c);
        const photoOnly = isPhotoOnly(c);
        // The face rides the LAST bubble of a run, the name the first (chat-view.js msgRowClass;
        // `last` carries the tail). `in` is the one row the athlete just sent, rising from the box.
        const cls = msgRowClass({ mine, role: c.role, firstOfRun: item.firstOfRun, lastOfRun: item.lastOfRun, hasRx: rx.length > 0, photoOnly })
          + (fresh.has(String(c.id)) ? ' in' : '');
        return `
        <div class="${cls}" data-cid="${esc(String(c.id || ''))}">
          ${!mine && item.lastOfRun ? `<div class="av"${c.role !== 'ai' && c.author_id ? ` data-avatar-uid="${esc(c.author_id)}"` : ''}>${c.role === 'ai' ? NIA_MARK : `<span data-avatar-fallback>${esc(initialsFor(who))}</span>`}</div>` : '<div class="av-sp"></div>'}
          <div class="stack">
            ${item.firstOfRun && !mine ? whoHtml(who, c.role === 'ai', esc) : ''}
            ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : rq}
            ${/* The "Updated analysis" badge is gone (founder 2026-08-05: robotic) — a correction
                  reply is just the AI's next message, like a person texting back. The quote stem
                  above already shows WHAT it answers. The escalation badge stays: "this reached
                  your coach" is a fact worth labeling. */''}
            <div class="bubble">${escalated ? `<span class="esc">${escalationChip(c, S.coach)}</span>` : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : bubbleText(c)}${offerChips(c)}${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}</div>
            ${deliveredHtml({ mine, isLast: c === lastMsg })}
          </div>
          ${msgTimeHtml(c, fmtMsgTime, esc)}
        </div>`;
      }).join('');

      /* THE RECEIPT MUST BE TRUE (founder, 2026-08-06). Three things were wrong with it:
           1. It never compared TIME. `coach_views.seen_at` is when the coach opened the day; the
              line rendered under the newest message regardless. A coach who looked at 9am and an
              athlete who wrote at 8pm produced "Seen by Coach Brown" sitting directly beneath a
              message the coach could not possibly have read. That is the one thing a read receipt
              must never do, so the receipt now only renders when seen_at is AFTER the last
              message in the thread.
           2. It said "Seen", which reads as "saw this message". coach_views is a DAY receipt.
              It now says what it actually knows — the coach opened the day — and stamps the time,
              which is both more honest and more reassuring than a bare word.
           3. `viewer_name` is written from S.operatorIdentity.handle, so it can be a handle
              rather than a display name; it is only shown when it looks like a name. */
      const lastMsgAt = visible.length
        ? Math.max(...visible.map((c) => { const t = Date.parse(c && c.created_at); return isNaN(t) ? 0 : t; }))
        : 0;
      const freshReceipt = (RECEIPT.rows || [])
        .map((r) => ({ ...r, _at: Date.parse(r && r.seen_at) }))
        .filter((r) => !isNaN(r._at) && r._at >= lastMsgAt)
        .sort((a, b) => b._at - a._at)[0] || null;
      const seen = freshReceipt
        ? (() => {
            const nm = String(freshReceipt.viewer_name || '').trim();
            const who = /^[A-Za-z][A-Za-z.'\- ]+$/.test(nm) ? nm : `Your ${S.coach.noun}`;
            return `${esc(who)} opened your day · ${esc(fmtMsgTime(freshReceipt.seen_at))}`;
          })()
        : '';

      // COACH LEADS, AI ASSISTS (founder 2026-08-04): when a coach has spoken on this meal,
      // their latest word is PINNED above the AI's opener so the human's voice frames the
      // machine's. A pin, not a move — the message stays in the chronological flow below
      // (deduping would break layoutThread runs, last-bubble reactions, and quoted replies).
      // From `visible`, not `msgs`: the pin must never resurface words whose bubble the mute
      // filter dropped — a pinned quote from a blocked coach is the block failing where it
      // matters most, at the top of the screen.
      const lastCoach = [...visible].reverse().find((c) => c && c.role === 'coach' && !isPhotoOnly(c) && String(c.text || '').trim());
      // The pin exists to SURFACE a coach word that scrolled out of the preview. When that same
      // message is one of the four bubbles right below it, the pin is a duplicate two inches
      // above its original — so it only renders when its message is not already on screen.
      const coachPin = lastCoach && !shown.includes(lastCoach) ? (() => {
        const who = authorName(lastCoach, participants, RT.userId, S.coach.noun);
        return `<div class="coach-pin">
          <div class="cp-head"><span class="cp-av"${lastCoach.author_id ? ` data-avatar-uid="${esc(lastCoach.author_id)}"` : ''}><span data-avatar-fallback>${esc(initialsFor(who))}</span></span><span class="cp-who">${esc(who)}</span><span class="cp-tag">${icon('pin', 11)} Pinned</span></div>
          <div class="cp-text">${esc(String(lastCoach.text || ''))}</div>
        </div>`;
      })() : '';
      const earlierBtn = hiddenCount > 0
        ? `<button class="cont-earlier" id="thread-more">${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'} ${icon('chevron', 13)}</button>`
        : '';
      // No bubble to carry the reaction pill (every message muted, or a coach who only ever
      // reacted): the coach view keeps a bare strip for exactly this, and losing the reactions
      // with the bubbles is the vanishing the post-filter anchors exist to stop. Mute-filtered,
      // so a muted person's own reaction never paints above the line saying they are hidden.
      const strandedRx = !visible.length ? reactionGroups(visibleThread(comments, RT.mutedUsers)) : [];
      const strandedRxHtml = strandedRx.length
        ? `<div class="rx-strip">${strandedRx.map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('')}</div>`
        : '';
      // Where the reader is, read BEFORE the new rows land (chat-live.js holdThread): measured
      // after, a reader resting on the newest message is one Nia reply short of the end.
      const hold = holdThread(threadEl, M.mealId);
      threadEl.innerHTML = coachPin + openingLead + earlierBtn + rows + strandedRxHtml + openingTail
        // THE FOOT (2026-09-24): what the thread says about itself, one centred line of small print
        // at the very end. `th-foot` keeps the typing row and a bubble being sent ABOVE it
        // (chat-live.js syncLive), so Nia's dots never open up under "your coach hasn't opened this".
        + (seen ? `<div class="seen th-foot">${seen}</div>` : '')
        + (tail.length ? `<div class="msg-status th-foot">${tail.join(' ')}</div>` : '');
      hydrateAvatars(threadEl);   // 0206: message monograms upgrade to real faces
      // FULL MESSAGES, ALWAYS (founder 2026-09-22). The Read more clamp is gone from every
      // renderer: the AI's read is long on purpose (2026-09-07 ruling) and a message you have to
      // open is a message half-sent. Line length is held by the bubble's own measure (screens.css).
      // The outbox bubble and the typing row, placed after the paint that just wiped them.
      // The live rows go back in and the reader who was at the end follows the newest message
      // (gliding when something arrived); someone scrolled up reading the breakdown stays where
      // they put themselves, and the pill tells them what came in.
      placeLive(hold, fresh.size > 0 || added > 0);
      syncJump(threadEl, M.mealId, { dock: root.querySelector('#meal-disc .chat-dock'), added });
      void hydrateThreadPhotos(threadEl, roles);
      playFreshReceipts(threadEl, { onLand: () => buzz('reveal') });
    };
    // The live rows (chat-live.js): the bubble being sent and the AI at work. Re-placed after
    // every paint and on every change of that state, never by a re-render (it would rebuild the
    // box someone may be typing in).
    const placeLive = (hold = null, arrived = true) => {
      const el = root.querySelector('#meal-thread');
      if (!el) return;
      const h = hold || holdThread(el, M.mealId);
      const sending = syncLive(el, M.mealId, { esc, imgSrc: safeImg });
      followThread(h, { force: sending, smooth: arrived });
    };

    // The AI-at-work hook, labelled from the thread: a photo nobody has answered yet means the
    // model is reading a picture, and it says so rather than showing three dots for ten seconds.
    // `label` overrides the derived one: a turn carrying a photo says what the AI is doing.
    const setTyping = (on, label = '') => setAiWorking(M.mealId, on, { label: on ? (label || workingLabel(visibleThread(threadMessages(comments), RT.mutedUsers))) : '' });
    let lastFetchFp = cacheHit ? THREAD_CACHE.fp : null;   // fingerprint of the last painted fetch (see refresh below)
    // opts.probe: only the idle poll tick passes this (see scheduleTick below). Every other
    // caller — initial mount, send, reaction toggle, retry, the realtime doorbell — wants the
    // truth right now and calls refresh() with no args, which always does the full fetch.
    const refresh = async (opts = {}) => {
      const myGen = ++gen;
      const probeSince = opts.probe && lastKnownAt ? lastKnownAt : null;
      const fetched = await roles.fetchMealComments(M.mealId, probeSince);
      if (myGen !== gen) return;
      if (fetched && fetched.unchanged) return; // the cheap probe found nothing new — no repaint to do
      if (fetched && fetched.error) { lastFetchFp = null; THREAD_CACHE.fp = null; showThreadError(); return; }
      // Identical payload = identical thread: skip the innerHTML rebuild. The post-send burst
      // poll (2.5s x ~8) used to fetch AND repaint even when nothing had arrived, which could
      // swap the DOM under a reader's thumb mid-scroll. Cleared on error above so the retry
      // fetch always repaints over the error row even when the data itself didn't change.
      const fp = JSON.stringify(fetched);
      const changed = fp !== lastFetchFp;
      lastFetchFp = fp;
      comments = fetched; if (statusEl) statusEl.remove();
      for (const row of Array.isArray(comments) ? comments : []) {
        if (row && row.created_at && (!lastKnownAt || row.created_at > lastKnownAt)) lastKnownAt = row.created_at;
      }
      // Write-through so the NEXT remount of this meal starts warm instead of refetching.
      THREAD_CACHE.mealId = M.mealId; THREAD_CACHE.comments = comments;
      THREAD_CACHE.lastKnownAt = lastKnownAt; THREAD_CACHE.fp = fp;
      // Professional corrections ride the thread (0199, meta t:'pro_correction'): the pro's
      // device corrected the meals ROW; this device owns today's slotMacros and the score, so
      // the correction applies HERE, once per comment, through the same engines as every other
      // correction. A full re-render (not just paint) so the corrected numbers reach the
      // nutrition strip above the thread — applyProCorrection's applied-ids marker makes the
      // re-mounted refresh a no-op, so this cannot loop.
      let proApplied = false;
      for (const c of Array.isArray(comments) ? comments : []) {
        // 'ai_addition' (2026-09-22): food the AI added from this athlete's own photo or words
        // at their coach's request. Same engine, same once-per-id marker (state.js).
        if (c && c.meta && (c.meta.t === 'pro_correction' || c.meta.t === 'ai_addition')) {
          if (act.applyProCorrection(M.slot, c)) proApplied = true;
        }
      }
      if (proApplied && window.__render) { window.__render(); return; }
      if (changed) paint();
    };
    if (cacheHit) {
      // Warm start: the cached rows are already correct as of the last fetch, so paint them now
      // and let the cheap probe confirm — a full fetch only happens if something actually landed.
      if (statusEl) statusEl.remove();
      paint();
      void refresh({ probe: true }).catch(() => {});
    } else {
      await refresh();
    }

    // (The "Earlier · <last message>" continuity teaser that used to be fetched and filled here
    // is gone — founder 2026-08-11. "View full chat" in the section header is the one door to
    // the full conversation, and it needs no fetch to justify itself.)

    // Open the member list. Built from the same resolved rows the header shows, so what the
    // athlete taps is exactly what they were looking at.
    const membersBtn = root.querySelector('#meal-members');
    if (membersBtn) membersBtn.addEventListener('click', () => {
      openMembersSheet(participantList(PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [], RT.userId));
    });

    // Keep the thread live while it is open, so a coach's reply does not sit unseen until the
    // athlete navigates away and back. Paused while the tab is hidden — a backgrounded screen has
    // nobody reading it.
    //
    // TWO MECHANISMS, deliberately, and the ordering matters:
    //
    //   1. REALTIME is the accelerator. It carries no data into the UI — the callback only calls
    //      refresh(), which re-reads through the normal RLS-scoped SELECT. That is the whole
    //      security argument: 0069 exists because 0068 leaked private coach notes to athletes, and
    //      a realtime payload is delivered by a different auth path than the one that bug was
    //      fixed in. By treating the socket as a doorbell rather than a delivery, a
    //      mis-scoped subscription can at worst cause a redundant fetch that returns nothing new.
    //      It can never render a row the athlete could not already have read.
    //
    //   2. POLLING remains the floor, NOT dead code. A websocket fails silently — a dropped
    //      socket, an expired token, a publication that was never migrated — where a poll just
    //      retries. So the interval stays, and simply runs slower once realtime is confirmed live.
    //
    // The interval is adaptive because the old flat 15s was wrong in both directions: too slow in
    // the seconds after you send (when you are actually watching for a reply) and too costly at
    // rest, since every tick refetched up to 200 full rows.
    try { clearInterval(window.__threadTick); } catch { /* first mount */ }
    // Tear the socket down only when this mount is for a DIFFERENT meal. A same-meal remount
    // (every router repaint) reuses the live channel — rebuilding it per paint was the deep
    // audit's per-repaint handshake cost, and reconnecting also dropped rtLive back to false,
    // tightening the poll for no reason.
    const channelReused = !!(window.__threadChannel && window.__threadChannelMealId === M.mealId);
    try {
      if (window.__threadChannel && !channelReused) {
        void window.__threadChannel.unsubscribe(); window.__threadChannel = null; window.__threadChannelMealId = null;
      }
    } catch { /* none yet */ }

    let rtLive = channelReused ? _threadRtLive : false; // realtime confirmed subscribed — lets the poll relax
    let burstUntil = 0;         // fast-poll window after the athlete sends
    const BASE_MS = 15000, SLOW_MS = 45000, BURST_MS = 2500, FOCUS_MS = 6000;
    const tickDelay = () => {
      if (Date.now() < burstUntil) return BURST_MS;
      // Looked up per call, not closed over: `input` is declared further down this mount, so
      // closing over it would put the first synchronous tickDelay() inside its temporal dead zone.
      const composerEl = root.querySelector('#meal-msg');
      if (composerEl && typeof document !== 'undefined' && document.activeElement === composerEl) return FOCUS_MS;
      return rtLive ? SLOW_MS : BASE_MS;
    };
    // A self-rescheduling timeout rather than setInterval: the delay has to be re-decided every
    // tick, and setInterval fixes it at creation.
    const scheduleTick = () => {
      try { clearTimeout(window.__threadTick); } catch { /* first */ }
      window.__threadTick = setTimeout(async () => {
        if (typeof document === 'undefined' || !document.hidden) {
          if (!threadBusy) {
            // Skip the probe during the post-send burst window: a reply IS expected there, so
            // a cheap "anything new?" check first would only add a round trip before the full
            // fetch that's about to happen anyway.
            const probing = Date.now() >= burstUntil;
            await refresh({ probe: probing }).catch(() => {});
          }
        }
        if (root.isConnected) scheduleTick();   // stop rescheduling once the screen is gone
      }, tickDelay());
    };
    scheduleTick();
    // Exposed so submit() can pull the thread into its fast window the moment a message lands.
    const startBurst = (ms = 20000) => { burstUntil = Date.now() + ms; scheduleTick(); };

    // Hand the persistent channel this mount's live handles. The channel outlives the mount, so
    // its callbacks must never close over this mount's DOM directly — they call through these,
    // which always belong to the NEWEST mount. If the screen is gone and no newer mount replaced
    // us, the athlete left the thread: close the socket, exactly as the old self-cleanup did.
    _liveThreadRefresh = (opts) => {
      if (!root.isConnected) {
        try {
          if (window.__threadChannel) { void window.__threadChannel.unsubscribe(); window.__threadChannel = null; window.__threadChannelMealId = null; }
        } catch { /* already gone */ }
        return;
      }
      if (!threadBusy) void refresh(opts).catch(() => {});
    };
    _liveThreadRtStatus = (live) => {
      if (!root.isConnected) return;
      rtLive = live;
      // Re-decide the cadence immediately: going live should relax the poll now, and losing
      // the socket should tighten it back up without waiting a full slow cycle.
      scheduleTick();
    };

    // Realtime subscription. Wrapped end-to-end: the vendored supabase-js already contains the
    // realtime client, but the `meal_comments` table still has to be added to the
    // supabase_realtime publication (see the migration alongside this change). Until that lands,
    // subscribe() simply never reaches 'SUBSCRIBED', rtLive stays false, and the poll keeps
    // running at its normal rate — the feature degrades to exactly today's behaviour.
    void (async () => {
      if (!M.mealId || channelReused) return; // the live socket for this meal already exists
      try {
        // `window.sb` is the live client handle the whole proto shares (supabase.js assigns it;
        // roles.js reads it the same way). NOT `import { sb }` — that export is the client
        // INSTANCE, not a getter, and calling it would throw.
        const c = typeof window !== 'undefined' ? window.sb : null;
        if (!c || typeof c.channel !== 'function') return;
        const ch = c.channel(`meal_thread:${M.mealId}`)
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'meal_comments', filter: `meal_id=eq.${M.mealId}` },
            // The channel persists across remounts, so this must not close over THIS mount's
            // refresh/root — _liveThreadRefresh always belongs to the newest mount, and it owns
            // the "screen is gone → close the socket" cleanup.
            () => { if (_liveThreadRefresh) _liveThreadRefresh(); })
          .subscribe((status) => {
            _threadRtLive = status === 'SUBSCRIBED';
            if (_liveThreadRtStatus) _liveThreadRtStatus(_threadRtLive);
          });
        window.__threadChannel = ch;
        window.__threadChannelMealId = M.mealId;
      } catch { /* no realtime — the poll above is the whole mechanism, exactly as before */ }
    })();


    // Composer: post athlete message → invoke meal-chat with client-composed context.
    // On success the AI reply row is already persisted server-side, so a REFETCH shows
    // it — never append data.reply manually AND refetch.
    const input = root.querySelector('#meal-msg');
    const send = root.querySelector('#meal-send');
    const note = root.querySelector('#chat-note');
    // Quick actions + the breakdown's "flag it" link both prefill the composer — the thread
    // is the correction channel (post-log meal data stays immutable; coach sees the flag).
    const prefill = (text) => {
      if (!input) return;
      if (text) input.value = text;
      // focusComposer, not focus() + scrollIntoView({block:'center'}): centring a 48px box in the
      // room the keyboard leaves puts the composer in the middle of nowhere with the conversation
      // it belongs to off-screen above it. The keyboard layer brings the thread down onto the keys
      // and the bar arrives with it.
      focusComposer(input);
    };
    root.querySelectorAll('.qa').forEach((b) => b.addEventListener('click', () => prefill(b.getAttribute('data-qa') || '')));

    // Pending-read controls. Delegated on the root because openingBlockHtml re-renders these rows
    // on every repaint — a direct listener would be lost the first time the thread refreshed.
    root.addEventListener('click', (ev) => {
      // A suggested usual meal: stage it through the same confirm gate Plan's one-tap re-log
      // uses (plan.js data-fm-log), so it is reviewed before it counts.
      const fm = ev.target && ev.target.closest ? ev.target.closest('[data-fm-log]') : null;
      if (fm) {
        if (act.stageSavedMeal(fm.getAttribute('data-fm-log'))) location.hash = '#meal-analysis';
        return;
      }
      // Memory confirmation: the athlete's tap is the ONLY thing that lets an inferred fact bind.
      const fx = ev.target && ev.target.closest ? ev.target.closest('[data-fact]') : null;
      if (fx) {
        const id = fx.getAttribute('data-fact');
        ANSWERED_FACTS.add(String(id));
        PENDING_FACTS = { uid: PENDING_FACTS.uid, rows: (PENDING_FACTS.rows || []).filter((f) => f.id !== id), at: Date.now() };
        void act.confirmMemoryFact(id, fx.getAttribute('data-keep') === '1');
        return;
      }
      const t = ev.target && ev.target.closest ? ev.target.closest('#mq-thread-go, #mq-thread-skip, #mq-open-breakdown, #mt-retry-analysis, #mt-ai-on, #mt-reread, #open-full-chat, #thread-more') : null;
      if (!t) return;
      if (t.id === 'mt-ai-on') {
        // The consent sheet, asked on purpose. A yes re-queues this plate's read.
        void ensureAiConsent(RT.userId, { role: 'athlete', ask: true }).then((yes) => { if (yes) void act.retryAnalysis(M.slot); });
        return;
      }
      if (t.id === 'mt-retry-analysis') {
        // Always answer the tap: in-flight label now, and retryAnalysis itself re-renders with
        // either the pending state or an honest failure line. The old handler called a function
        // that could return without doing anything, and the button just sat there.
        t.disabled = true;
        t.textContent = 'Nia is reading the plate…';
        void act.retryAnalysis(M.slot);
        return;
      }
      // The same conversation, unbounded by this one plate.
      // Route through the router, NOT a raw hash write. backHead's `to` is only a FALLBACK — back
      // actually pops the per-tab origin stack, and only navigateTo() pushes onto it. Assigning
      // location.hash directly skipped that push, so nutrition-chat had no recorded origin and its
      // back button fell through to its 'home' fallback instead of returning to the meal the
      // athlete opened it from.
      if (t.id === 'open-full-chat' || t.id === 'thread-more') {
        // Aimed at THIS plate: the full chat opens with this meal's card selected and in view,
        // so "the rest of this conversation" is where the athlete lands, not the bottom of a
        // season (nutrition-chat.js reads the sub-route).
        const dest = M.mealId ? `nutrition-chat/${M.mealId}` : 'nutrition-chat';
        if (window.__navigate) window.__navigate(dest); else location.hash = `#${dest}`;
        return;
      }
      // A meal that settled at zero: put it back in the queue for another read.
      if (t.id === 'mt-reread') { t.textContent = 'Nia is reading the plate…'; void act.rereadMeal(M.slot); return; }
      if (t.id === 'mq-thread-skip') { act.skipPendingQuestions(M.slot); return; }
      // Both remaining ids (the bubble's chip and the breakdown's button) open the same sheet.
      askPendingQuestions(M);
    });
    // (the old "flag it for Coach" free-text path is replaced by the structured correction panel)
    const writeNote = (t, retry) => { if (note) note.innerHTML = t ? `<div class="mt-retry" ${retry ? 'id="chat-retry"' : ''}>${esc(t)}</div>` : ''; };
    const setNote = (t, retry) => {
      CHAT_NOTE = t ? { key: corrKey, text: t, retry: !!retry, at: Date.now() } : null;
      writeNote(t, retry);
    };
    // Repaint restore: the note outlives the render that would otherwise erase it.
    if (CHAT_NOTE && CHAT_NOTE.key === corrKey && (Date.now() - CHAT_NOTE.at) < CHAT_NOTE_TTL_MS) {
      writeNote(CHAT_NOTE.text, CHAT_NOTE.retry);
    } else if (CHAT_NOTE && CHAT_NOTE.key === corrKey) { CHAT_NOTE = null; }
    let busy = false;
    // Reaches the AI for an ALREADY-POSTED question. Retry re-runs only this — the athlete's
    // comment lands in meal_comments exactly once per question, never duplicated by a retry.
    // `photoPath` is a storage KEY, never image bytes: meal-chat re-reads the object server-side
    // with the service role, so the client cannot make the model look at anything the athlete did
    // not actually attach to this thread.
    const askAI = async (text, photoPath = null, turn = null) => {
      // AI CONSENT (0243): the first time the AI would answer, ask; after a Not now, say plainly
      // that it stays quiet. The message itself is already posted either way.
      if (!(await ensureAiConsent(RT.userId, { role: 'athlete' }))) { setNote(aiOffReply()); return; }
      // THE AI IS WORKING, visibly, from the moment it is asked (2026-09-22). This used to wait on
      // two fetches first, so the athlete stared at a quiet thread for a beat and could not tell
      // a turn was coming at all.
      setTyping(true, photoPath ? 'Reading the photo' : '');
      try {
        const recent = await roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(7)).catch(() => []);
        // Saved usual meals, so the AI can name what THEY eat and the suggest_meal bubble has
        // something to fill from. Cached a minute; a cold miss just means an empty list.
        await warmFoodMemory(roles, RT.userId).catch(() => null);
        const ex = S.exec;
        // roles.fetchRecentMeals returns newest-first (day_date descending); contextForChat's
        // 8KB clamp drops from the FRONT of recentMeals, so the caller must hand it oldest→newest
        // or the clamp discards the newest meals instead of the oldest. Reverse to ascending here.
        const recentAscending = (recent || []).slice().reverse();
        const context = contextForChat({
          meal: {
            name: M.name, slot: M.slot, macros: M.macros, fiber: M.fiber, quality: M.score, late: M.late, note: M.note,
            // Per-item provenance, not just names: the AI needs to see WHICH item carries WHICH
            // logged value (and whether it was read off a label, resolved from the product
            // cache, or estimated) to discuss the plate honestly and to apply a correction to
            // the right item instead of arguing about the totals.
            foods: (M.detectedRich || []).map((d) => d && ({
              name: d.name, per: d.per, basis: d.basis, product: d.product, brand: d.brand, quantity: d.quantity,
            })).filter(Boolean),
          },
          plan: { goal: RT.profile && RT.profile.baseGoal, targets: S.planTargets, allergies: RT.allergies },
          exec: { met: ex.met, total: ex.total, score: ex.score, possible: ex.possible, next: ex.now && ex.now.title },
          // Today's macro position — exec only counts requirements; this is where the day's fuel
          // actually stands, so the AI can coach off it (founder 2026-08-10). Same source as the
          // day bars on this screen.
          day: (() => { const dp = S.mealDayProgress || {}; return { proteinSoFar: dp.proteinSoFar, proteinTarget: dp.proteinTarget, mealsRemaining: dp.mealsRemaining }; })(),
          recentMeals: recentAscending.map((m) => ({ type: m.type, protein: m.protein, kcal: m.kcal, quality: m.quality, date: m.day_date })),
          // WHO SAID WHAT. This was `{role, text}` — two coaches, a trainer and a parent all
          // arrived as 'coach', and a reply to the AI was indistinguishable from a reply to a
          // person. buildAiThread keeps senderId/senderName/senderRole and the reply target,
          // which is what lets the model (and the server-side gate) tell the room apart.
          thread: turn ? turn.thread : threadMessages(comments).slice(-20).map((c) => ({ role: c.role, senderId: c.author_id || null, text: String(c.text).slice(0, 300) })),
          usualMeals: suggestItems(),
        });
        const { data, error } = await window.sb.functions.invoke('meal-chat', {
          body: {
            mealId: M.mealId,
            // A wordless photo still needs a question for the model to answer. Sent explicitly
            // rather than left empty so the prompt reads as a real ask, not a blank turn.
            question: text || 'I sent a photo. What do you make of it?',
            context,
            // WHO IS EATING (founder 2026-09-13): sport, position, level, bodyweight, training or
            // rest day. The read has carried this since 2026-09-02 and the thread carried none of
            // it, so a linebacker asking a follow-up got answered as a generic athlete. Same
            // builder as the read, so the two can never describe different people.
            ...athleteContextForAnalysis(),
            // "I can apply a structured correction": unlocks the apply_correction tool
            // server-side. Only sent because the handler below actually applies it.
            canApplyCorrection: true,
            // "I apply first and report back": Nia's ack is filed only once the plate has changed.
            canConfirmCorrection: true,
            // The addressing decision, so meal-chat can reach the SAME verdict rather than
            // trusting this client's word for it (see ai-addressing.js).
            ...(turn ? { speaker: turn.outgoing, addressing: turn.decision, participants: turn.participants } : {}),
            // "I render the remember-this chips": unlocks the remember tool. Same contract.
            canRemember: true,
            // "I fill a suggest_meal bubble from Food Memory and stage a tapped meal": unlocks
            // the suggest_meal tool. Same contract; bubbleText + the data-fm-log tap close it.
            canSuggestMeal: true,
            ...(photoPath ? { photoPath } : {}),
          },
        });
        setTyping(false);
        // A fresh offer is pending by definition. Re-read the pending list past its cache so the
        // chips under the new bubble are drawn from what the server holds, not from a minute-old
        // snapshot that predates the fact.
        if (data && data.memory && data.memory.id) void warmPendingFacts(RT.userId, { force: true });
        // The server reached the same addressing verdict and declined the turn. Not an
        // error and not a failure to reach anyone: the message is in the thread, and the AI
        // simply had nothing it was asked for. Say nothing, show nothing.
        if (data && data.silent) { setTyping(false); return; }
        if (isConsentSkip(data)) { noteAiConsentRequired(RT.userId); setNote(aiOffReply()); return; }
        if (error || !data || data.error) {
          // The vendored supabase-js (js/vendor/supabase.js) throws FunctionsHttpError on any
          // non-2xx response, so `data` is always null and the function's JSON error body never
          // reaches it — `data.error === 'limit'` above can never fire. FunctionsHttpError
          // extends FunctionsError, which stores the raw Response as `.context`; parse the
          // structured error off that instead. `data.error` is kept as a fallback in case a
          // future vendor version ever returns a 2xx with an inline error field.
          let parsed = data && data.error ? data : null;
          if (!parsed && error && error.context && typeof error.context.json === 'function') {
            parsed = await error.context.json().catch(() => null);
          }
          if (parsed && parsed.error === 'limit') setNote("Nia is out of replies for today. Back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach Nia. Tap to try again.", true);
        } else {
          // THE CORRECTION LOOP CLOSES HERE (founder escalation 2026-08-06; truth rule 2026-09-24).
          // The athlete stated a fact about their own food and Nia called apply_correction. The app
          // applies it DETERMINISTICALLY (per-item macros, totals, score, rubric, coach focus, day
          // targets, the meals row mirror), and only then does Nia say anything about it:
          // correction-turn.js reports the outcome and meal-chat files her ack and the receipt when
          // the numbers moved, or her one precise question when they did not ("Which one should I
          // double: the grilled chicken or the chicken salad?"). The typing row stays up until
          // then, so the athlete watches Nia work instead of reading a promise and an amber line
          // that contradicts it.
          // `pending`: the server is waiting to hear how it went, so Nia answers even a correction
          // that carries only `more` (no top-level item) or that turns out to have nothing to apply.
          if (data.correction && (data.pending || data.correction.item || ['missed', 'more'].some((k) => Array.isArray(data.correction[k]) && data.correction[k].length))) {
            setTyping(true);
            const { runChatCorrection } = await import('../correction-turn.js');
            const res = await runChatCorrection({
              act, sb: window.sb, uid: RT.userId, slot: M.slot, mealId: M.mealId, meta: DAY.slotMacros[M.slot] || M,
              data, said: text, minutesLate: M.minutesLate,
            });
            setTyping(false);
            if (res.note) setNote(res.note);
            await refresh();
            if (window.__render) window.__render();
            return;
          }
          await refresh();
        }
      } catch { setTyping(false); setNote("Couldn't reach Nia. Tap to try again.", true); }
      // The question is already in the thread — retry only re-reaches the AI (no input refill).
      const retry = root.querySelector('#chat-retry');
      if (retry) retry.addEventListener('click', async () => {
        if (busy) return;
        busy = true; setNote('');
        // Same turn, same verdict: retry re-sends a request that was already judged worth
        // making, never a fresh one the gate has not seen.
        await askAI(text, null, turn);
        busy = false;
      });
    };
    /* ---- photo attachment ---- */
    // All the DOM plumbing lives in chat-attach.js so the coach thread shares it verbatim rather
    // than growing a second copy that drifts. Nothing uploads on pick.
    const attach = wireComposerAttach({
      root, attachId: 'meal-attach', pendingId: 'meal-attach-pending', safeImg, onNote: (m) => setNote(m),
    });

    /* ONE SEND IS ONE INTENT (2026-09-22). The lock, the outbox bubble and the duplicate window
       live in chat-live.js, keyed to the meal, because this mount is re-run on every render and
       a `busy` flag in it was forgotten by the next one. The bubble shows the moment Send is
       tapped ("Sending…"), the box clears, and a send that never lands stays on screen as "Not
       delivered" with a retry instead of vanishing. */
    const deliver = async (item) => {
      const typed = item.text;
      const pendingPhoto = item.photo;
      // Upload happens BEFORE the row is written: a comment whose meta points at an object that
      // failed to upload would render a permanently broken image. On upload failure nothing is
      // posted at all, and the bubble stays with its picture for the retry.
      const res = await postChatMessage(roles, {
        mealId: M.mealId, athleteId: RT.userId, authorId: RT.userId, role: 'athlete',
        text: typed, photo: pendingPhoto, replyTo: item.replyTo || null,
      });
      endSend(M.mealId, item.lid, { ok: res.ok });
      const photoPath = res.photoPath;
      if (!res.ok) {
        if (res.error === 'filtered') {
          // A retry would be refused the same way: take the bubble back and hand the words back.
          takeFailed(M.mealId, item.lid);
          const box = root.querySelector('#meal-msg');
          if (box && !box.value) box.value = typed;
          setNote(FILTERED_NOTE);
        } else if (res.error === 'upload') setNote("Couldn't upload that photo. Tap the message to try again.");
        return;
      }
      setNote('');
      // The seconds right after sending are when the athlete is actually watching for a reply.
      startBurst();
      // The athlete asked a question in the shared conversation — action-class for the coach
      // (spec: a direct athlete question is "action needed"). Best-effort, after the post landed.
      if (S.coach.hasCoach) {
        void roles.notifyMyCoach({
          // Suffix = deep link for the coach's bell row (notif-feed KIND_ROUTE), matching the
          // push payload's route below. 'athlete_message', not 'meal_action' (2026-09-15): a
          // question is a message, tagged as one in the bell, governed by the coach's
          // onMessage switch, and never mistaken for a flagged plate.
          kind: M.mealId ? `athlete_message:${M.mealId}` : 'athlete_message', urgent: true,
          title: `${S.athlete.first || 'Your athlete'} ${photoPath && !typed ? 'sent a photo about' : 'asked about'} ${M.name}`,
          // A wordless photo has no text to preview, so say what it IS rather than sending a
          // notification whose body is an empty string.
          body: `${(typed || 'Sent a photo').slice(0, 140)} · Tap to open the conversation.`,
          route: `coach-meal/${M.mealId}`,
        });
      }
      await refresh();
      // Forced: the athlete just sent this and is watching for it to land. Every other repaint
      // leaves a reader where they are; this one always shows them their own message.
      scrollThreadToEnd(root, { force: true });
      /* IS ANYONE TALKING TO THE AI? (founder 2026-09-18). This used to be an unconditional
         askAI(typed) — the model answered "Thank you Coach" because answering was the only
         thing it could do. Now the room decides first, through the same gate the other two
         composers and the server use. A wordless photo is still a real question, so it keeps
         its turn; anything the athlete said to a PERSON is left between them.
         The message itself already posted either way — silence is the AI not speaking, never
         the athlete not being heard. */
      const turn = decideAiTurn({
        text: typed,
        comments,
        participants: PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [],
        self: { id: RT.userId, name: S.athlete.first || 'Athlete', role: 'athlete' },
        athleteName: S.athlete.first || 'Athlete',
        fallbackNoun: S.coach.noun,
        // THE 12:44 INCIDENT (2026-09-22): a photo WITH a caption ("I'm also drinking this") was
        // judged on its words alone and stayed silent. The photo is part of the message.
        photo: !!photoPath,
      });
      const wordlessPhoto = !typed && !!photoPath;
      if (wordlessPhoto || turn.decision.shouldRespond) {
        busy = true;
        await askAI(typed, photoPath, turn);
        busy = false;
      }
    };
    const submit = async () => {
      const box = root.querySelector('#meal-msg') || input;
      const typed = ((box && box.value) || '').trim();
      const pendingPhoto = attach.get();
      // A photo alone is a complete message — post-0173 it sends with genuinely empty text, and
      // postChatMessage falls back to the legacy stand-in if this database still carries 0046's
      // original length floor.
      if (!typed && !pendingPhoto) return;
      const claim = beginSend(M.mealId, { text: typed, photo: pendingPhoto, replyTo: replyOf(M.mealId) });
      if (!claim.ok) {
        // In flight: the tap is the same intent as the one already on its way. A duplicate: the
        // same words landed a moment ago; say so and leave them in the box to edit or keep.
        if (claim.reason === 'duplicate') setNote('You just sent that.');
        return;
      }
      setNote('');
      if (box) box.value = '';
      attach.clear();
      clearReply(M.mealId);
      paintReplyChip(root.querySelector('#meal-disc .chat-dock'), M.mealId, esc);
      await deliver(claim.item);
    };
    // Retry a bubble that did not land: the same words, photo and reply, as a fresh send.
    const retryItem = async (item) => {
      const claim = beginSend(M.mealId, { text: item.text, photo: item.photo, replyTo: item.replyTo });
      if (claim.ok) await deliver(claim.item);
    };
    bindLive(M.mealId, { sync: placeLive, onRetry: retryItem });
    placeLive();
    const startReply = (row) => {
      const id = row && row.getAttribute('data-cid');
      const c = threadMessages(comments).find((x) => x && String(x.id) === id);
      if (!c) return;
      const mineRow = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
      const who = mineRow ? 'You' : authorName(c, participants, RT.userId, S.coach.noun);
      setReply(M.mealId, replyTargetMeta(c, who));
      paintReplyChip(root.querySelector('#meal-disc .chat-dock'), M.mealId, esc);
      focusComposer(root.querySelector('#meal-msg'));
    };
    paintReplyChip(root.querySelector('#meal-disc .chat-dock'), M.mealId, esc);
    wireThreadTaps({ root, scope: '#meal-thread', key: () => M.mealId });
    if (send) send.addEventListener('click', submit);
    // !isComposing: Enter inside an IME composition is choosing a character, not sending —
    // same guard nutrition-chat has; without it a CJK keyboard ships half a word.
    if (input) input.addEventListener('keydown', (e2) => { if (e2.key === 'Enter' && !e2.isComposing) submit(); });

    /* ---- reactions: press and hold a message ---- */
    // The permanent four-emoji row above the composer is gone (founder, 2026-08-02). Same posting
    // logic, same toggle, reached the way every messaging app on this phone reaches it. Wired on
    // `root` — the node the router never replaces — because #view and everything in it is rebuilt
    // on each render; wireTapback is re-entrant, so this re-mount swaps the callbacks rather than
    // stacking listeners. The picker itself lives on <body>, out of the render's way.
    // Drag the conversation left to see when each message was sent.
    // Drag it right, on one message, to reply to that message.
    wireChatTimes({ root, scope: '#meal-thread', onReply: startReply });
    if (M.mealId) wireTapback({
      root,
      scope: '#meal-thread',
      onReply: startReply,
      emoji: REACTION_EMOJI,
      mine: () => new Set((Array.isArray(comments) ? comments : [])
        .filter((c) => c && c.kind === 'reaction' && c.author_id === RT.userId)
        .map((c) => String(c.text))),
      onReact: async (emoji) => {
        if (!emoji || rxBusy) return;
        rxBusy = true;
        // TOGGLE, not append. There is no uniqueness constraint on reaction rows and 0157's message
        // cap deliberately exempts them, so an un-toggled control would let one athlete write
        // unbounded rows. Mirrors the coach side's own toggle.
        const existing = (Array.isArray(comments) ? comments : [])
          .find((c) => c && c.kind === 'reaction' && c.author_id === RT.userId && String(c.text) === emoji);
        let ok = false;
        if (existing) {
          ok = await roles.deleteMealComment(existing.id);
        } else {
          // role MUST be 'athlete' with athlete_id = self: 0046's insert policy routes a 'coach' row
          // through an `athlete_id <> auth.uid()` arm that an athlete can never satisfy.
          ok = await roles.postMealComment(M.mealId, RT.userId, RT.userId, 'athlete', emoji, 'reaction');
        }
        if (ok) await refresh(); else setNote("Couldn't save that reaction. Try again.");
        rxBusy = false;
      },
    });

    // Tap an attached photo to open it full-screen, the same viewer the meal's own hero photo uses.
    // Delegated on the thread because every repaint replaces these <img> elements.
    const threadRoot = root.querySelector('#meal-thread');
    if (threadRoot) threadRoot.addEventListener('click', (ev) => {
      const im = ev.target && ev.target.closest ? ev.target.closest('img.bimg') : null;
      if (!im || !im.src) return;
      openImageViewer(im.src, 'Photo attached to this message', im);
    });
  },
};

// Legacy routes/imports (#meal-confirm, #meal-detail) render the same unified page.
export const confirm = thread;
export const detail = thread;
