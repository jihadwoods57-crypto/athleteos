import { S, RT, tier, act, MEAL, mealDetail, fmtClock, liveWeightPct } from '../state.js';
import { DAY, slotDeadline } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, nonLiveBadge, composer, segBar, skeletonRows } from '../components.js';
import { reveal } from '../motion.js';
import { scoreMoveBar, playScoreMove } from '../score-move.js';
import {
  openingMessage, openingSummary, qualityBand, scoreReasons, coachFocus, reactionGroups, threadMessages,
  contextForChat, applyFoodEdit, hasUserEdits, restrictionConflicts,
  estimateConfidence, estRange, mealPatterns, scoreRubric, coachThreadStatus,
  correctionAxes, REACTION_EMOJI,
} from '../meal-intel.js';
import {
  attachedPhoto, isPhotoOnly, wireComposerAttach, postChatMessage,
  bubblePhotoHtml, hydrateThreadPhotos,
} from '../chat-attach.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { hydrateAvatars } from '../avatar.js';
import { wireTapback } from '../tapback.js';
import { scrollThreadToEnd, focusComposer } from '../keyboard.js';
import { recentRows, warmRecent as warmRecentShared } from '../recent-meals.js';
import {
  layoutThread, authorName, initialsFor, participantList, participantSummary, participantMeta,
  isAnalysisOpener, isAnalysisUpdate, isEscalated, quotedFor,
  dayLabelOf,
} from '../chat-view.js';

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
/* "Read more" expansions the athlete has opened this session — keyed on each bubble's own text
   head so they survive every thread repaint (and a navigate-away-and-back). */
const expandedBubbles = new Set();

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
async function warmPendingFacts(uid) {
  if (!uid) return;
  if (PENDING_FACTS.uid === uid && Date.now() - PENDING_FACTS.at < 60000) return;
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

function macroRow(m) {
  return `<div class="macro-row">
    <div class="macro"><div class="mv">${m.protein}g</div><div class="mk">Protein</div></div>
    <div class="macro"><div class="mv">${m.carbs}g</div><div class="mk">Carbs</div></div>
    <div class="macro"><div class="mv">${m.fat}g</div><div class="mk">Fat</div></div>
    <div class="macro"><div class="mv">${m.cals}</div><div class="mk">Calories</div></div>
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
      <div class="phase" id="an-phase" role="status">Analyzing meal<span class="dots"></span></div>
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
        if (phase) phase.textContent = 'Read complete';
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
         <button class="btn green sm" id="an-retry" style="width:100%">${icon('camera', 18)} Retake photo</button>
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
    ${img ? `<div class="mq-photo" style="background-image:url('${img}')"><div class="mq-grad"></div>
      <div class="mq-badge">${icon('sparkle', 13)} The camera can't see everything</div></div>` : ''}
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
      <button class="btn green" id="mq-go">${icon('check', 18)} Get my result</button>
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
      if (go) { go.disabled = true; go.innerHTML = `${icon('sparkle', 18)} Reading your meal...`; }
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
      if (e.key !== 'Enter') return;
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
    quality: M.score, macros: M.macros, fiber: M.fiber, highlights: M.highlights, late: M.late, goal,
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
  const styleSafeProse = S.planStyle.showMacros || M.styleApplied === S.planStyle.key;
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
     form. The capability is not lost — the exact same cooking/sauce/portion corrections live in
     "Correct the analysis", where the athlete goes when they actually want to fix a number.
     `fq` stays in the returned shape (null) so openingBlockHtml's signature is untouched. */
  return { sum, fullText, fq: null };
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
export function openingBlockHtml(M, { sum, fullText, fq, hasPersistedRead = false, part = 'all' } = {}) {
  /* `part` exists because these rows live at two different points in time. The lead (the read
     itself, or its pending/failed/questions state) is the OLDEST thing in the thread and paints
     above the messages; the tail (the follow-up question, the memory confirmation) is the AI
     speaking NOW and belongs after the newest message — rendering it above older bubbles read
     as the thread being out of order. paint() asks for each half where it belongs; 'all' keeps
     the render()-time call (no messages yet) working unchanged. */
  const wrap = (lead, tail) => (part === 'lead' ? lead : part === 'tail' ? tail : lead + tail);
  const aiRow = (inner, id) => `
      <div class="msg ai"${id ? ` id="${id}"` : ''}>
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">${inner}</div></div>
      </div>`;

  if (M && M.analysisFailed) {
    const capacity = M.analysisFailed === 'capacity';
    // photo_lost: the device's photo budget dropped the bytes before they uploaded. There is
    // nothing left to read, so no retry chip — offering one would be a dead button.
    const lost = M.analysisFailed === 'photo_lost';
    return wrap(aiRow(`
          <div style="font-weight:700">${capacity ? "I couldn't get to this one today." : lost ? "I couldn't read this one." : "I couldn't read this plate."}</div>
          <div style="margin-top:4px;color:var(--text-2)">${lost
            ? "The photo couldn't be kept on this device, so there's nothing left to read. The log still counts for timing."
            : `It's logged and counts for timing either way. Your photo is the proof.${capacity ? '' : ' Worth another try?'}`}</div>
          ${M.rereadError ? `<div class="mt-warnline">Couldn't fetch the photo just now. Try again in a moment.</div>` : ''}
          ${capacity || lost ? '' : `<div class="fq-chips"><button class="fx-chip" id="mt-retry-analysis">${icon('sparkle', 13)} Read it again</button></div>`}`, 'analysis-failed'), '');
  }

  if (M && Array.isArray(M.pendingQuestions) && M.pendingQuestions.length) {
    const qs = M.pendingQuestions.slice(0, 3);
    // Count its own questions: this bubble promised "Two" over one question as easily as three.
    const qHead = qs.length === 1 ? 'One quick thing' : qs.length === 2 ? 'Two quick things' : `${qs.length} quick things`;
    return wrap(aiRow(`
          <div style="font-weight:700">${qHead} and your numbers are exact.</div>
          <div style="margin-top:3px;color:var(--text-2)">A photo can't show what's under or off the plate.</div>
          <div class="mq-list" style="margin-top:10px">
            ${qs.map((q, i) => `
            <label class="mq-item">
              <div class="mq-q"><span class="mq-n">${i + 1}</span><span>${esc(q)}</span></div>
              <input class="mq-input" data-qi="${i}" type="text" autocomplete="off"
                enterkeyhint="${i === qs.length - 1 ? 'done' : 'next'}" placeholder="Your answer" aria-label="${esc(q)}" />
            </label>`).join('')}
          </div>
          <div class="fq-chips">
            <button class="fx-chip" id="mq-thread-go">${icon('check', 13)} Get my result</button>
            <button class="fx-chip" id="mq-thread-skip">Skip, just estimate</button>
          </div>`, 'mq-bubble'), '');
  }

  if (M && M.pending) {
    return wrap(aiRow(`
          <div style="font-weight:700">Reading your plate<span class="dots"></span></div>
          <div style="margin-top:4px;color:var(--text-2)">Logged and counting. The breakdown lands here in a few seconds. You don't have to wait on this screen.</div>`, 'analysis-pending'), '');
  }

  // ONE pending-fact confirmation, and only when it is about a food on THIS plate — an inferred
  // dislike is weak evidence, so it is worth a single tap in context, never a queue of prompts.
  const plate = new Set((M && Array.isArray(M.detectedRich) ? M.detectedRich : [])
    .map((d) => String((d && d.name) || '').toLowerCase()).filter(Boolean));
  const askFact = (PENDING_FACTS.rows || []).find((f) => f && f.kind === 'dislike' && plate.has(String(f.value).toLowerCase()))
    || (PENDING_FACTS.rows || [])[0] || null;
  const confirmRow = askFact ? `
      <div class="msg ai" id="fact-confirm">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">
          ${esc(askFact.kind === 'dislike'
            ? `Noted. You took ${askFact.value} off a plate. Skip it in future reads?`
            : `Should I remember: ${askFact.kind.replace(/_/g, ' ')} (${askFact.value})?`)}
          <div class="fq-chips">
            <button class="fx-chip" data-fact="${esc(askFact.id)}" data-keep="1">Yes, remember</button>
            <button class="fx-chip" data-fact="${esc(askFact.id)}" data-keep="0">No, one-off</button>
          </div>
        </div></div>
      </div>` : '';

  // The one follow-up question, offered as chips. Derived (it depends on what the read found,
  // not on what was said), so it renders alongside the persisted read as well as instead of it.
  const fqRow = (f) => `
      <div class="msg ai" id="fq-bubble">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">
          ${esc(f.q)}
          <div class="fq-chips">${f.chips.map(c => `<button class="fx-chip" data-fq="${esc(f.kind)}" data-val="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>
        </div></div>
      </div>`;

  // THE READ ITSELF IS NOW A REAL MESSAGE (2026-07-28). analyze-meal composes it and persists it
  // as an `ai` row, so it lives in the thread the athlete can reply to, reference tomorrow, and
  // scroll back through with their coach. This derived block only fills in when that row is not
  // there: meals logged before the change, and the rare case where the thread write did not land.
  // Without the fallback those meals would show a breakdown with nothing said about it.
  if (hasPersistedRead) return wrap('', (fq ? fqRow(fq) : '') + confirmRow);

  // ONE VOICE (founder, 2026-08-02). This is the bubble the athlete sees the instant the read
  // lands locally, before the persisted `ai` row comes back from the server a beat later. It used
  // to be a REPORT CARD — "What went well / Biggest opportunity / Next time" over a "View full
  // analysis" expander — while the persisted message that replaced it seconds later was a plain
  // conversational paragraph. Same read, two different voices, arriving one after the other: that
  // is most of why the AI felt like a second process running behind the breakdown instead of one
  // nutritionist talking. Both ends now say the same thing the same way, so the swap is invisible.
  // `sum` stays as the floor for the rare read with no prose in it at all.
  const body = fullText
    ? esc(fullText)
    : [sum && sum.wentWell, sum && sum.opportunity, sum && sum.next].filter(Boolean).map(esc).join(' ');
  if (!body) return wrap('', (fq ? fqRow(fq) : '') + confirmRow);

  return wrap(`
      <div class="msg ai">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">${body}</div></div>
      </div>`, (fq ? fqRow(fq) : '') + confirmRow);
}

/* ---------- Meal Analysis (AI, pre-log) ----------
   Founder structure (2026-07-15), each fact exactly once:
     photo (with timing vs the slot deadline) → editable breakdown (what + how much) →
     estimated macros → ONE detailed AI analysis → log.
   The old page rendered the AI note three times (planMatch + AI Feedback + thread opener) and
   macros/foods twice (componentsRead + chips/macroRow) — all of that is consolidated here. */

/** "Captured 1:42 PM · 18 min before the 2:00 PM deadline" — real clock math, never canned. */
function captureTimingLine(capturedAtMin, slot) {
  if (capturedAtMin == null) return null;
  const dl = slotDeadline(slot);
  const when = fmtClock(capturedAtMin);
  if (capturedAtMin > dl) return `Captured ${when} · ${capturedAtMin - dl} min past the ${fmtClock(dl)} deadline`;
  return `Captured ${when} · ${dl - capturedAtMin} min before the ${fmtClock(dl)} deadline`;
}

export const analysis = {
  tab: 'camera',
  hideTabs: true,
  transient: true,
  render() {
    const L = S.logging;
    const slot = MEAL.key || 'dinner';
    const already = !!DAY.meals[slot];
    const nonLive = MEAL.live === false;
    const timingLine = captureTimingLine(L.capturedAtMin, slot);
    const rich = (MEAL.result && Array.isArray(MEAL.result.detectedRich) && MEAL.result.detectedRich.length)
      ? MEAL.result.detectedRich
      : L.foods.map((f) => ({ name: f, confidence: 'high' }));
    const edited = hasUserEdits(MEAL.result);
    // Source-honest labels (WS7): a typed nutrition label is EXACT, never "estimated from photo".
    const src = MEAL.source;
    const srcLabel = edited ? 'edited by you'
      : src === 'label' ? 'exact, from the nutrition label'
      : src === 'manual' ? 'entered by you'
      : 'estimated from photo';
    return `
    ${backHead(`${L.name} Analysis`, already ? 'Already logged' : 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="${safeImg(L.img) ? `background-image:url('${safeImg(L.img)}')` : 'background:linear-gradient(150deg, rgba(var(--green-rgb),0.14), rgba(var(--blue-deep-rgb),0.06))'}">
      <div class="ph-grad"></div>
      <div class="ph-meta">
        <div><div class="ph-t">${esc(L.name)}</div><div class="ph-s">${esc(timingLine || (nonLive ? 'From your gallery' : 'Captured just now'))}</div>${nonLive ? `<div style="margin-top:6px">${nonLiveBadge()}</div>` : ''}</div>
        ${L.score != null ? `<div class="scorechip ${(qualityBand(L.score) || {}).cls || ''}"><span class="v">${L.score}</span><span class="k">Meal</span></div>` : ''}
      </div>
    </div>

    <div class="eyebrow" style="flex-wrap:wrap;row-gap:2px;column-gap:8px"><span style="white-space:nowrap">Breakdown</span><span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0;white-space:nowrap">· ${srcLabel}</span> <span class="link" id="edit-foods" style="margin-left:auto">${'Edit'}</span></div>
    <section class="card" style="padding:4px 16px" id="foods">
      ${rich.map((d) => `
        <div class="food-row" data-name="${esc(d.name)}">
          <span class="conf-dot ${esc(d.confidence)}"></span>
          <span class="fr-name">${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI is unsure. Confirm or remove">?</span>' : ''}</span>
          <span class="fr-qty">${d.quantity ? esc(d.quantity) : ''}</span>
        </div>`).join('')}
      <div class="food-row fr-add" id="food-add" style="display:none">
        <span class="conf-dot high"></span>
        <input class="fr-in name" id="add-name" maxlength="60" placeholder="Add item (e.g. 2 eggs off-frame)" aria-label="Food name" />
        <input class="fr-in qty" id="add-qty" maxlength="12" placeholder="Qty" aria-label="Quantity" />
        <button class="fr-ok" id="add-ok" aria-label="Add">${icon('check', 15)}</button>
      </div>
      ${edited ? `<div style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);padding:4px 0 8px">${MEAL.result && MEAL.result.recomputed ? 'Edited by you. Macros and score recalculated from the foods listed.' : 'Edited by you. Macros stay the AI’s estimate.'}</div>` : ''}
    </section>

    <div class="eyebrow">${src === 'label' ? 'From the label' : src === 'manual' ? 'As entered' : 'Estimated'}</div>
    ${macroRow(L.macros)}

    <div style="height:14px"></div>
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
      <div style="display:flex;gap:10px;padding:13px 14px;border-radius:var(--r-tile);background:var(--red-surface);border:1.5px solid var(--red-border)">
        ${icon('bell', 17, 'style="color:var(--red);flex:none;margin-top:1px"')}
        <div><div style="font-size:var(--t-sm);font-weight:800;color:var(--red-bright)">Possible severe allergen: ${esc(severeHits.join(', '))}</div>
        <div style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:3px;line-height:1.45">A detected food may contain it. The read can't see every ingredient or cross-contact. Check the label or ask staff before you eat or log this.</div></div>
      </div>`;
      if (cf.moderate.length || cf.noted.length) return `
      <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--amber-surface);border:1px solid var(--amber-border)">
        ${icon('bell', 15)} <span style="font-size:var(--t-sm);font-weight:700;color:var(--amber-bright)">Heads up: this may contain ${esc([...cf.moderate, ...cf.noted].join(', '))} from your restrictions.</span>
      </div>`;
      return `
      <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--surface-2);border:1px solid var(--hairline)">
        ${icon('shield', 15)} <span style="font-size:var(--t-sm);font-weight:600;color:var(--text-2)">Compared with your saved restrictions. No matches detected. Detection can miss ingredients or cross-contact; always verify severe allergens yourself.</span>
      </div>`;
    })()}

    <div style="height:12px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Analysis</div><p>${esc(L.analysis || L.ai)}</p></div>
    </div>

    ${already ? '' : `<div class="score-change">${icon('arrowUp', 16)} Logging this counts toward Nutrition (${liveWeightPct('nutrition')}%) and closes 1 of ${S.remainingCount} remaining tonight.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      ${src === 'manual' ? `<button class="btn ghost sm" style="flex:1" data-go="food-search">${icon('search', 17)} Edit plate</button>`
        : src === 'label' ? `<button class="btn ghost sm" style="flex:1" data-go="label-scan">${icon('barcode', 17)} Edit label</button>`
        : `<button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>`}
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-back="home">Back to Home</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-thread/${slot}">${icon('check', 18)} Log ${esc(L.name)}</button>`}
    </div>
    <div style="height:10px"></div>
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
      if (addRow) addRow.style.display = 'flex';
      // Per-row edit affordances: name/qty become inputs, ✕ removes.
      box.querySelectorAll('.food-row:not(.fr-add)').forEach((row) => {
        const name = row.getAttribute('data-name');
        const nameEl = row.querySelector('.fr-name');
        const qtyEl = row.querySelector('.fr-qty');
        const item = MEAL.result && (MEAL.result.detectedRich || []).find((d) => d && d.name === name);
        row.insertAdjacentHTML('beforeend', `<span class="rm" role="button" tabindex="0" aria-label="Remove ${esc(name)}" style="margin-left:8px;color:var(--red);font-weight:800;cursor:pointer;display:inline-flex;vertical-align:middle">${icon('x', 14)}</span>`);
        row.querySelector('.rm').addEventListener('click', (e) => {
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
export const thread = {
  tab: 'home',
  // Founder feedback 2026-07-16: the tab bar + camera FAB covered the composer, and "take
  // another photo" is the wrong primary action on a meal that's already logged. Nav hides
  // here; the back head and Back Home carry the exits.
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

    // ---- 1. LOGGED CONFIRMATION — compact (founder feedback 2026-07-16: the old celebration
    // ate half the screen and mixed compliance with meal quality). Three facts only: logged
    // (green = accountability), the score move, progress on the day. Timing appears here ONCE.
    /* `_played` is now retired by the MOVE ITSELF, when the sweep finishes (see the mount below),
       rather than the instant mount ran. It used to be set on the first mount, which meant the very
       next repaint — participants and comments land about a second into a thread — dropped this
       whole line while its count-up was still running. The app's payoff was racing a network
       response for the right to finish, and on a fast connection it lost. */
    const move = RT.lastMove && (RT.lastMove.what || '').toLowerCase() === M.slot ? RT.lastMove : null;
    const justLogged = !!move && !move._played;
    const dupFlagged = M.flagged === 'dup';
    const timing = M.loggedAt
      ? `Logged ${M.loggedAt} · ${M.minutesLate > 0 ? `${M.minutesLate} min late` : 'on time'}`
      : (M.late ? 'Logged late · still counts' : 'Logged on time');
    const toTier = justLogged ? tier(move.to) : null;
    // The athlete's very first log ever: no day before today has ever been scored. Derived, so
    // there is no flag that can drift out of step with what actually happened.
    const firstEver = justLogged && !(DAY.scoreHistory || []).some((h) => h && h.date && h.date < String(DAY.date));
    // Coach attention, from REAL signals only (comments load async; the mount updates this
    // line in place once they land): Sent to Coach → Reviewed by Coach → Coach replied.
    const cStatus = coachThreadStatus({
      mealId: M.mealId, hasCoach: S.coach.hasCoach, comments: [], noun: S.coach.noun,
      dayReviewed: RECEIPT.uid === RT.userId && RECEIPT.date === String(DAY.date) && RECEIPT.reviewed,
    });
    const execTop = `
    <section class="mt-confirm">
      <div class="row1">
        <div class="ck${justLogged ? ' pop' : ''}">${icon('check', 20)}</div>
        <div><div class="t">${esc(M.name)} logged</div>
        <div class="s">${timing}${cStatus.label ? ` · <span id="coach-status">${esc(cStatus.label)}</span>` : ''}</div></div>
      </div>
      ${dupFlagged ? `<div class="dup-note">Duplicate photo · recorded, but it doesn't count. Coach can see the flag.</div>` : ''}
      ${/* The same move the recovery confirm draws as a dial, as a strip — this sits inside a card
            under a green confirmation, and a second hero here would be two celebrations arguing.
            What the strip adds over the old bare numerals is the LADDER: ticks at 60 / 80 / 90, so
            "+6" is read as a distance to the next line rather than as six of nothing. */''}
      ${justLogged && !dupFlagged ? scoreMoveBar({
        from: move.from, to: move.to, uid: 'mt',
        head: `<div class="score-line">
        <span class="k">Daily Score</span>
        <span class="from">${move.from}</span>
        <span class="arr">${icon('arrowRight', 14)}</span>
        <span class="to ${toTier.cls}" data-sm-count="${move.to}">${move.to}</span>
        <span class="gain ${toTier.cls}">+${move.gain}</span>
        ${toTier.name !== tier(move.from).name ? `<span class="tier-chip ${toTier.cls}" data-sm-tier="▲ " data-sm-base="tier-chip">▲ ${esc(toTier.name)}</span>` : ''}
      </div>`,
      }) + (firstEver ? '<div class="sm-first">First one in. From here the number is live: every meal, every check-in, every day.</div>' : '') : ''}
      ${/* The credit is a fact about the day, not a one-time animation — it used to render only
            on the justLogged paint, so the first background repaint (participants landing ~1s in)
            erased the most rewarding line on the page, and a revisit never showed it at all.
            The engine's own number (mealScoreImpact), so it can never disagree with the score. */''}
      ${(() => {
        if (justLogged || dupFlagged) return '';
        const gain = S.mealScoreImpact(M.slot) || 0;
        // Tinted by where the day actually stands, like the move above it. Untinted, the pill fell
        // through to the old flat green and told a 62 it was on standard.
        return gain > 0 ? `
      <div class="score-line">
        <span class="k">Daily Score</span>
        <span class="gain ${tier(S.score).cls}">+${gain} from this meal</span>
      </div>` : '';
      })()}
      <div class="prog-line">
        ${segBar(e.met, e.total, `${e.met} of ${e.total} completed today`)}
        <span class="pk">${e.met} of ${e.total} in today${S.streakDays > 0 ? ` · ${S.streakDays} day streak` : ''}</span>
      </div>
    </section>`;

    // ---- 2. PHOTO + MEAL QUALITY (feedback 2026-07-16: quality is a separate concept from
    // compliance — banded color, its own label, and a one-line WHY so 58 never reads as green
    // success or an arbitrary number). Provenance badges live here; name/timing not repeated.
    const band = qualityBand(M.score);
    // The top 2-3 reasons the score is what it is (founder 2026-08-04: the score must be
    // immediately explainable) — same componentStates arithmetic as the number itself.
    const reasons = scoreReasons({ macros: M.macros, fiber: M.fiber, detected: M.detectedRich, minutesLate: M.minutesLate });
    // Coach's Focus (founder 2026-08-05): the one line to remember, from the same judgments.
    const dayProgCF = S.mealDayProgress || {};
    const nextMealCF = e.now && e.now.proof === 'photo' ? e.now.title : null;
    const focus = coachFocus({
      macros: M.macros, fiber: M.fiber, detected: M.detectedRich, minutesLate: M.minutesLate,
      nextMealName: nextMealCF,
      dayGap: (Number(dayProgCF.proteinTarget) || 0) - (Number(dayProgCF.proteinSoFar) || 0),
      mealsRemaining: Number(dayProgCF.mealsRemaining) || 0,
      numbers: S.planStyle.showMacros,
    });
    // Expandable score rubric (upgrade 2026-07-16): the observable components behind the
    // number, each marked exact or estimated — same math as the feedback, so they agree.
    const rub = scoreRubric({
      quality: M.score, minutesLate: M.minutesLate, macros: M.macros, fiber: M.fiber,
      detected: M.detectedRich, source: M.source, userNote: M.userNote, photoQ: M.photoQ,
    });
    const RUB_DOT = { met: 'g', partial: 'a', miss: 'r' };
    // ---- Nutrition facts, computed BEFORE the photo block because they now render inside the
    // read card (founder 2026-08-10: the read and the numbers were two boxes saying almost the
    // same thing — they are one card now, so the screen stacks confirm / photo / read, done).
    // A read still in flight (or one that failed) has no numbers to correct — the correction
    // affordances only appear once the analysis has settled.
    const settled = !M.pending && !M.analysisFailed && !(Array.isArray(M.pendingQuestions) && M.pendingQuestions.length);
    const T = S.planTargets || {};
    const fromPhoto = M.source !== 'label' && M.source !== 'manual';
    const conf = estimateConfidence(M.source, M.detectedRich);
    /* The heading this feeds used to read "Estimated Nutrition · estimated from photo · high
       confidence" — the word twice, over two lines, on the app's most-read card. Worse on the
       other two branches: it announced an EXACT typed nutrition label as "Estimated Nutrition",
       which is the one thing line 544 above exists to prevent. The heading is now just
       "Nutrition" and the provenance is stated once, here, where it can be true for all three. */
    const srcLabel = M.source === 'label' ? 'exact, from the nutrition label'
      : M.source === 'manual' ? 'entered by you'
      : `estimated from photo · ${conf} confidence`;
    // Photo estimates present as estimates (~ prefix on tiles; the full range lives in the
    // rubric). Label/manual values stay exact — no false hedging on real numbers.
    const tilde = fromPhoto ? '~' : '';
    // THE PROJECTION. A bar that only shows what is banked answers "how much of the day is done",
    // but the athlete reads it as a verdict — 81 of 180g at dinner looks like failing when it is
    // squarely on pace. So each bar also carries what is still COMING: the meals left today at
    // the share this athlete's plan expects. Real engine numbers or nothing; never a flattering
    // guess. `dayProg` is the same source the AI's day sentence uses, so the two always agree.
    const dayProg = S.mealDayProgress || {};
    const mealsLeft = Math.max(0, Number(dayProg.mealsRemaining) || 0);
    const project = (target, soFar) => {
      if (!target || !mealsLeft) return null;
      const gap = Math.max(0, target - (Number(soFar) || 0));
      return gap ? Math.round(gap / Math.max(1, mealsLeft)) * mealsLeft : 0;
    };
    const targetBars = [
      ['Protein', M.macros.protein, T.protein, 'g', project(T.protein, dayProg.proteinSoFar)],
      ['Calories', M.macros.cals, T.calories, '', null],
    ].filter(([, , target]) => target);
    const projectedTotal = T.protein ? (Number(dayProg.proteinSoFar) || 0) + (project(T.protein, dayProg.proteinSoFar) || 0) : null;
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
    const rereadNote = `<div class="est-note" style="margin-top:8px">These numbers didn't land. The read came back empty, so nothing was measured.${M.mealId ? ` <span class="link" id="mt-reread" role="button" tabindex="0">Re-read this meal</span>` : ''}${M.rereadError ? ` <b style="color:var(--text-2)">Couldn't fetch the photo just now. Try again in a moment.</b>` : ''}</div>`;
    // INTUITIVE (0142): no macro or calorie figure reaches the athlete. The plate itself, what
    // was on it, and how it landed still do — the composition IS the feedback. Every number is
    // still computed and still stored (the professional needs them, and under-fueling is a
    // safety signal); this gate is presentation only. `showMacros` is the athlete's own
    // opt-in-able switch, so someone who WANTS their numbers back can have them.
    const showNums = S.planStyle.showMacros;
    // The value strip + day bars, as one chrome-less block the read card hosts. Same numbers,
    // same honesty markers (~ for photo estimates); provenance rides a quiet in-card line.
    const nutInCard = settled && showNums ? `
    <div class="nut-src">Nutrition · ${esc(srcLabel)}</div>
    ${emptyRead ? `<div style="padding:0 16px 13px">${rereadNote}</div>` : `
    <div class="nut-values">
      <div class="nv lead"><div class="mv">${tilde}${M.macros.protein}<i>g</i></div><div class="mk">Protein</div></div>
      <div class="nv"><div class="mv">${tilde}${M.macros.carbs}<i>g</i></div><div class="mk">Carbs</div></div>
      <div class="nv"><div class="mv">${tilde}${M.macros.fat}<i>g</i></div><div class="mk">Fat</div></div>
      <div class="nv"><div class="mv">${tilde}${M.macros.cals}</div><div class="mk">Calories</div></div>
    </div>
    ${targetBars.length ? `<div class="day-bars">
        ${targetBars.map(([k, v, target, u, projected]) => {
          const now = Math.min(100, Math.round((v / target) * 100));
          const ahead = projected != null ? Math.max(0, Math.min(100 - now, Math.round((projected / target) * 100))) : 0;
          return `
          <div class="cons-row">
            <span class="k" style="width:64px">${k}</span>
            ${/* There is no --teal token — only --teal-rgb and --teal-deep — so this fill's old
                  `var(--teal, #39c6d6)` ALWAYS fell through to a hardcoded hue, in both themes,
                  which is the one thing tokens exist to prevent. It also wore the green→teal
                  sweep, and that is reserved for surfaces that display a score; a macro-against-
                  target bar is progress geometry, and progress geometry wears blue. Same
                  deep→base ramp `.cat-trend .fillb.b` already uses. */''}
            <div class="track"><div class="fillb" style="width:${now}%;background:linear-gradient(90deg,var(--blue-deep),var(--blue))"></div>${ahead ? `<div class="ghostb" style="left:${now}%;width:${ahead}%"></div>` : ''}</div>
            <span class="v" style="width:110px;white-space:nowrap">${tilde}${v}${u} <small style="color:var(--text-3)">of ${esc(String(target))}${u}</small></span>
          </div>`;
        }).join('')}
        ${paceNote ? `<div class="pace">${esc(paceNote)}</div>` : ''}
    </div>` : ''}
    ${/* No correction chips on the read card (founder, 2026-08-17). "Correct this read" and
          "Add a detail" sat directly under the numbers and made every settled meal look like it
          was asking to be argued with. The correction panel is unchanged and still one tap away
          from where the foods actually are — the two links inside "View detected foods". */''}`}` : '';
    const photoBlock = `
    <!-- The plate, blurred, as the screen's own backdrop. The meal thread is the one screen with a
         real photograph on it, and it sat on the same flat canvas as everything else; letting the
         food tint the room is what makes the screen feel like it is ABOUT that meal. Same <img>
         src as the hero below (assigned once in mount), so this costs no second fetch. Decorative
         and behind everything: aria-hidden, no pointer events. -->
    <div class="meal-backdrop" aria-hidden="true"><img id="meal-backdrop-img" alt="" decoding="async"/></div>
    <div class="photo-hero" id="meal-hero" data-vt="plate" style="margin-top:14px;background:linear-gradient(150deg, rgba(var(--green-rgb),0.14), rgba(var(--blue-deep-rgb),0.06))">
      <img id="meal-photo" alt="Photo of this meal" decoding="async" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta"><div>${M.live === false ? `<div>${nonLiveBadge()}</div>` : '<div></div>'}</div>
      ${M.score != null ? `<div class="scorechip ${band ? band.cls : ''}" id="meal-scorechip">
        ${miniDial(M.score)}
        <span class="v" data-count="${M.score}">${M.score}</span><span class="k">Meal</span>
      </div>` : ''}</div>
    </div>
    ${/* ONE score presentation (founder spec 2026-08-06): the ring chip on the photo IS the
          number — repeating "71/100" in a second big panel directly beneath it made the score
          read as two systems. The band verdict + the ✓/✕ reasons stay: they are the
          explanation, not a restatement. */''}
    ${/* ONE read, one card (2026-08-06): the verdict, the ✓/✕ reasons, the coach's one line, and
          the rubric expander used to be four separately-chromed boxes in a row — four answers to
          the same question ("how good was this meal?") each wearing its own border. They are one
          unit now: verdict+reasons up top, the focus line as its footer, the rubric as the quiet
          seam at the bottom. Inner class names stay so reveal()/tests keep working. */''}
    ${band ? `<section class="meal-read">
    <div class="score-read">
      <div class="sr-head">
        <span class="sr-band ${band.cls}">${band.label}</span>
      </div>
      ${reasons.length ? `<div class="sr-rows">
        ${[...reasons].sort((a, b) => (a.state === 'met' ? -1 : 1) - (b.state === 'met' ? -1 : 1)).map((r) => `
        <div class="sr-row ${r.state}"><span class="sr-ic">${icon(r.state === 'met' ? 'check' : 'x', 12)}</span>${esc(r.label)}</div>`).join('')}
      </div>` : ''}
    </div>
    ${/* "Coach's Focus" removed (founder, 2026-08-06). The ✓/✕ reasons above already say what
          landed and what didn't, and the AI's own message in the thread says what to do next —
          a third restatement of the same judgment, in a box wearing the coach's name for a line
          the coach never wrote, was the most redundant thing on the screen. */''}
    ${/* The nutrition strip lives INSIDE this card now (founder 2026-08-10: the read card and
          the Estimated Nutrition panel were two boxes making one point — the verdict and the
          numbers behind it). Hairline seams, not borders, do the separating. */''}
    ${nutInCard}
    <details class="rub">
      <summary>${esc(rub.headline)} ${icon('chevron', 13)}</summary>
      <div class="rub-body">
        ${rub.rows.map(r => `
        <div class="rub-row">
          <span class="bd-req-dot ${RUB_DOT[r.state] || 'muted'}"></span>
          <span class="rk">${esc(r.k)}</span>
          <span class="rn">${esc(r.note)}</span>
          <span class="rx-tag">${r.exact ? 'exact' : 'estimated'}</span>
        </div>`).join('')}
        <div class="rub-fine">Exact items are facts (timing, what you submitted). Estimated items come from the photo read and move if you correct the analysis.</div>
      </div>
    </details>
    </section>` : nutInCard ? `<section class="meal-read">${nutInCard}</section>` : ''}`;

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
    const breakdown = !settled ? `
    <div class="eyebrow" style="margin-top:16px">Meal Breakdown</div>
    <section class="card pad" style="margin-top:8px">
      <div class="macro-row five">
        ${['Protein', 'Carbs', 'Fat', 'Calories', 'Fiber'].map((k) => `
        <div class="macro"><div class="mv${M.analysisFailed ? '' : ' mv-wait'}" style="color:var(--text-3)">&mdash;</div><div class="mk">${k}</div></div>`).join('')}
      </div>
      ${M.analysisFailed ? `<div class="est-note" style="margin-top:10px">No numbers for this one. The photo is still your proof that the meal happened.</div>` : ''}
    </section>` : !showNums ? `
    <div class="eyebrow" style="margin-top:16px;flex-wrap:wrap;row-gap:2px;column-gap:8px"><span style="white-space:nowrap">What was on the plate</span><span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0;white-space:nowrap">· ${srcLabel}</span></div>
    ${foodRows ? `<section class="card" style="margin-top:8px;padding:4px 16px">${foodRows}</section>` : ''}
    ${M.userNote ? `<div class="est-note" style="margin-top:8px"><b style="color:var(--text-2)">Your note:</b> ${esc(M.userNote)}</div>` : ''}
    <div class="est-note" style="margin-top:8px">Your plan tracks how food leaves you feeling rather than calorie and macro counts. Your ${esc(S.coach.noun)} can still see the full numbers.</div>
    ${emptyRead ? rereadNote : ''}` : `
    ${/* The Estimated Nutrition panel that opened this section lives inside the read card now
          (founder 2026-08-10) — what remains here is the detail drawer: foods, notes,
          corrections, and the correction panel itself. */''}
    <details class="bd-wrap"${thread._bdOpen || thread._fixOpen ? ' open' : ''}>
      <summary>View detected foods ${icon('chevron', 13)}</summary>
      <div class="bd-body">
      ${foodRows ? `<section class="card" style="margin-top:8px;padding:4px 16px">${foodRows}</section>` : ''}
      ${targetBars.length ? '' : `<div class="est-note">No coach targets set yet, so there's nothing to measure against. These are this meal's totals.</div>`}
      <div class="est-note" style="margin-top:8px">~${M.fiber}g fiber estimated. The full component read lives under "Why this meal reads ${M.score != null ? M.score : 'what it reads'}".</div>
      ${M.userNote ? `<div class="est-note" style="margin-top:8px"><b style="color:var(--text-2)">Your note:</b> ${esc(M.userNote)}</div>` : ''}
      ${corrLog ? `<div class="est-note" style="margin-top:8px;color:var(--blue-bright)"><b style="color:var(--blue-bright)">Corrected by you</b>: ${corrLog} correction${corrLog === 1 ? '' : 's'} applied. The AI's original estimate is kept for reference${M.orig ? ` (was ~${M.orig.protein}g protein · ~${M.orig.kcal} cal)` : ''}.</div>` : ''}
      ${/* The two entry points into the correction panel live HERE, with the numbers they correct
            (founder, 2026-08-02). Both render for a manually logged meal too. */''}
      ${emptyRead ? '' : M.mealId ? `<div class="est-note">${fromPhoto ? 'Estimated from the photo · cooking oil or sauce may change these numbers. ' : ''}<span class="link" id="open-correct" role="button" tabindex="0">${fromPhoto ? 'Something off? Correct the analysis' : 'Correct the analysis'}</span> · <span class="link" id="qa-details" role="button" tabindex="0">Add meal details</span></div>` : ''}

      <!-- Correct analysis (upgrade 2026-07-16): fix what the photo can't show; every chip is a
           deterministic, estimated adjustment with an audit trail — hidden until opened. -->
      ${/* ONE DECISION AT A TIME (2026-08-14). This panel used to render all five dimensions
            expanded at once: nineteen chips plus a free-text field, on the app's most-used
            flow, for an athlete who arrived with exactly one thing to fix. Now the first
            decision is "which dimension", and only that dimension's answers are on screen.
            Every panel is in the DOM (so the chips keep their delegated handler and nothing
            re-renders on a tab switch) but the inactive ones are `hidden`, which also takes
            them out of the tab order. Order comes from correctionAxes(): real signals only. */''}
      ${(() => {
        const axes = correctionAxes(M);
        const valid = new Set(axes.map((a) => a.kind).concat('other'));
        const active = valid.has(thread._fixAxis) ? thread._fixAxis : axes[0].kind;
        const tab = (kind, label, answered) => `<button class="fx-axis${kind === active ? ' on' : ''}" data-axis="${kind}" role="tab" aria-selected="${kind === active}">${label}${answered ? icon('check', 12) : ''}</button>`;
        return `
      <div id="fix-panel" hidden>
        <div class="eyebrow" style="margin-top:14px">Correct the analysis</div>
        <section class="card pad" style="padding-top:12px">
          <div class="fx-axes" role="tablist" aria-label="What to correct">
            ${axes.map((a) => tab(a.kind, a.label, a.answered)).join('')}
            ${tab('other', 'Something else', false)}
          </div>
          ${axes.map((a) => `
          <div class="fx-vals" data-axis-panel="${a.kind}"${a.kind === active ? '' : ' hidden'}>
            <div class="fx-chips">${a.opts.map(([l, v]) => `<button class="fx-chip" data-fix="${a.kind}" data-val="${esc(v)}">${l}</button>`).join('')}</div>
          </div>`).join('')}
          <div class="fx-vals" data-axis-panel="other"${active === 'other' ? '' : ' hidden'}>
            <div class="fx-other"><input class="input" id="fx-other" maxlength="160" placeholder="Anything else the photo can't show…" style="height:40px"/><button class="btn ghost sm" id="fx-other-add" style="width:auto;flex:none;padding:0 14px;height:40px">Add</button></div>
          </div>
          <div id="fx-note" style="font-size:var(--t-sm);font-weight:700;color:var(--green-bright);min-height:16px;margin-top:6px"></div>
          <div class="rub-fine">Corrections update the estimate with rule-based kitchen math, keep the AI's original for the record, and ${S.coach.hasCoach ? `your ${esc(S.coach.noun)} sees the corrected numbers` : 'the corrected numbers are what your log keeps'}.</div>
        </section>
      </div>`;
      })()}
      </div>
    </details>`;

    // ---- 4. GROUPCHAT — the SINGLE AI-insight surface. Feedback 2026-07-16: the opening
    // used to be a wall of text nobody reads. Now it's the 5-second structured summary
    // (derived, never stored) with the full openingMessage paragraph behind an expander.
    // Quick actions make it feel like a chat, not a report. ----
    const { sum, fullText, fq } = openingInputs(M);

    // WHO IS IN THE ROOM. A messaging surface that hides its own audience is a privacy problem
    // wearing a UI problem's clothes — an athlete typing "I skipped breakfast" deserves to know
    // their coach and their mother can both read it before they hit send. Overlapping faces
    // rather than emoji, because these are people.
    const people = participantList(PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [], RT.userId);
    const facepile = !M.mealId ? '' : `
    <button class="facepile" id="meal-members" aria-label="Who can see this conversation">
      <span class="fp">${people.slice(0, 4).map((p) => `<span class="fpav ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}"${p.kind !== 'ai' && p.id ? ` data-avatar-uid="${esc(p.id)}"` : ''}>${p.kind === 'ai' ? icon('sparkle', 13) : `<span data-avatar-fallback>${esc(initialsFor(p.name))}</span>`}</span>`).join('')}</span>
      <span class="names">${esc(participantSummary(people))}<small>${people.length} in this conversation</small></span>
      <span class="chev">${icon('chevron', 15)}</span>
    </button>`;

    const discussion = `
    <div class="eyebrow" style="margin-top:18px;display:flex;align-items:baseline;gap:8px">
      <span>Team Discussion</span>
      ${M.mealId ? `<span class="link" id="open-full-chat" role="button" tabindex="0" style="margin-left:auto;text-transform:none;letter-spacing:0;font-size:12px">View full chat &rarr;</span>` : ''}
    </div>
    ${facepile}
    ${/* The `#rx-strip` that used to sit here is gone: paint() has cleared it on every repaint
          since reactions moved onto the bubble they belong to, so it was an element whose only
          job was to be emptied. */''}
    ${/* The "Earlier · <last message>" teaser row is GONE (founder, 2026-08-11): it opened the
          exact same full chat as "View full chat" two lines above it — two controls, one
          destination, and the teaser's preview text doubled as a third voice above the thread.
          The in-thread "View N earlier messages" seam (#thread-more) stays: that one carries
          information this screen truncated. */''}
    <div class="thread" id="meal-thread" role="log" aria-label="Meal conversation">
      ${openingBlockHtml(M, { sum, fullText, fq })}
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
    ${composer({ inputId: 'meal-msg', sendId: 'meal-send', placeholder: 'Ask about this meal…', sendLabel: 'Send', attachId: 'meal-attach', atEnd: true })}
    <div class="composer-attach-pending" id="meal-attach-pending" hidden></div>
    <div id="chat-note" style="min-height:18px"></div>` : ''}`;

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
    return `<div class="meal-screen">${backHead(M.dish || M.name, dupFlagged ? 'Duplicate photo' : '', 'home')}${execTop}${next}${photoBlock}${breakdown}${discussion}
    <div style="height:18px"></div>
    ${/* A quiet exit, not a second green CTA (2026-08-06): the meal is already logged — the only
          green verdict on this screen is the confirm card at the top. A full-width "Done" in the
          log-action color, sitting directly under a send composer, was two primary buttons
          competing for the same thumb. */''}
    <button class="btn ghost" style="width:100%" data-go="home" aria-label="Back to home">Back to Home</button>
    <div style="height:16px"></div></div>`;
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

    // The score arrives. This chip is the moment the product is built around, and it sat there as
    // static text. The choreography (wait until it is actually looked at, wind the arc back, draw,
    // count up, one 'success' haptic) now lives in motion.js so the daily score and the breakdown
    // ring play the SAME moment instead of three different amounts of it. The slot prefix keeps the
    // key stable while mealId is still null on a locally-logged, not-yet-synced meal.
    // whenSeen: the chip sits ~1100px down a 390x844 thread, so playing it on mount would spend the
    // moment off-screen. It observes the CHIP, which is small enough for the ratio to be reachable.
    reveal(root.querySelector('#meal-scorechip'), { key: `meal:${M.slot}:${M.mealId || ''}`, whenSeen: true });

    const roles = await import('../roles.js');
    // Delegation target for render-injected content (the fq bubble, the tapback picker):
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

    // ---- Correct analysis panel (upgrade 2026-07-16) ----
    if (thread._fixSlot !== M.slot) { thread._fixOpen = false; thread._fixAxis = null; thread._fixSlot = M.slot; }
    // Breakdown expander state survives the exec-tick re-render; `toggle` fires only on user
    // changes, never on the initial `open` attribute.
    const bdWrap = root.querySelector('.bd-wrap');
    if (bdWrap) bdWrap.addEventListener('toggle', () => { thread._bdOpen = bdWrap.open; });
    const fixPanel = root.querySelector('#fix-panel');
    // Switching dimension only flips `hidden` on panels that are already in the DOM: no
    // re-render, no lost scroll position, and the delegated chip handler below stays valid.
    const showAxis = (kind) => {
      if (!fixPanel) return;
      thread._fixAxis = kind;
      fixPanel.querySelectorAll('[data-axis-panel]').forEach((p) => {
        p.hidden = p.getAttribute('data-axis-panel') !== kind;
      });
      fixPanel.querySelectorAll('[data-axis]').forEach((b) => {
        const on = b.getAttribute('data-axis') === kind;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
    };
    const openFix = (focusOther) => {
      if (!fixPanel) return;
      thread._fixOpen = true;
      if (bdWrap) bdWrap.open = true; // the panel lives inside the breakdown expander
      fixPanel.hidden = false;
      if (focusOther) showAxis('other');
      fixPanel.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (focusOther) { const o = root.querySelector('#fx-other'); if (o) o.focus(); }
    };
    if (fixPanel && thread._fixOpen) fixPanel.hidden = false;
    const openBtns = [['#open-correct', false], ['#qa-details', true]];
    openBtns.forEach(([sel, focusOther]) => {
      const b = root.querySelector(sel);
      if (b) b.addEventListener('click', () => openFix(focusOther));
    });
    let fixBusy = false;
    const runCorrection = async (correction) => {
      if (fixBusy) return;
      fixBusy = true;
      const r = await act.correctMeal(M.slot, correction);
      if (r) {
        const note = root.querySelector('#fx-note');
        if (note) note.textContent = r.summary;
        // Repaint so macros, rubric, score chip, and daily progress all update together —
        // the SAME estimate updated in place, never a second disconnected result.
        setTimeout(() => window.__render && window.__render(), 450);
      }
      fixBusy = false;
    };
    // Delegated on the panel, not bound per chip: the dimension tabs show and hide chip groups,
    // and a per-element listener would be the kind of thing that quietly stops working later.
    if (fixPanel) fixPanel.addEventListener('click', (ev) => {
      const axisBtn = ev.target.closest('[data-axis]');
      if (axisBtn) { showAxis(axisBtn.getAttribute('data-axis')); return; }
      const b = ev.target.closest('[data-fix]');
      if (b) runCorrection({ kind: b.getAttribute('data-fix'), value: b.getAttribute('data-val') });
    });
    const otherAdd = root.querySelector('#fx-other-add');
    if (otherAdd) otherAdd.addEventListener('click', () => {
      const o = root.querySelector('#fx-other');
      const detail = (o && o.value || '').trim();
      if (detail) runCorrection({ kind: 'other', detail });
    });
    // Follow-up quick answers: 'other' opens the panel; a concrete answer applies in place.
    // DELEGATED on the screen root (like the analysis expander): paint() re-injects the
    // bubble as HTML on every comments refresh, which would drop per-element listeners.
    viewEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-fq]');
      if (!b) return;
      const v = b.getAttribute('data-val');
      if (v === 'other') { openFix(true); return; }
      runCorrection({ kind: b.getAttribute('data-fq'), value: v });
    });
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

    // The AI is composing something — the plate is being read, or a question is being answered.
    // A live indicator instead of a static "thinking" card, because that is what every other
    // conversation this athlete has ever had looks like while someone types.
    let aiTyping = false;
    const typingRow = () => `
        <div class="msg ai typing" id="ai-typing">
          <div class="av">${icon('sparkle', 15)}</div>
          <div><div class="who">AI Nutritionist is typing<span class="sr-only">, a reply is on its way</span></div>
          <div class="bubble tdots"><span></span><span></span><span></span></div></div>
        </div>`;

    const paint = () => {
      if (!threadEl) return;
      const msgs = threadMessages(comments);
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
      if (!msgs.length && !aiTyping) tail.push('No replies yet. Ask below and the AI Nutritionist answers from your plan.');
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
      const shown = msgs.slice(-PREVIEW_MSGS);
      const hiddenCount = msgs.length - shown.length;
      const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
      const rows = layoutThread(shown, { fmtTime: fmtMsgTime, fmtDay: dayKey, fmtDayLabel: dayLabelOf }).map((item) => {
        if (item.type === 'time') return `<div class="tsep">${esc(item.label)}</div>`;
        const c = item.comment;
        const mine = c.role === 'athlete' && (!c.author_id || c.author_id === RT.userId);
        const who = authorName(c, participants, RT.userId, S.coach.noun);
        const update = isAnalysisUpdate(c);
        const escalated = isEscalated(c);
        const quoted = update ? quotedFor(c, msgs) : null;
        // Reactions belong to the whole thread (0049 keys them to the meal, not to a message), so
        // they sit on the LAST bubble in it — the one the eye lands on. Putting them on the last
        // message of every run repeated the same pill down the page as if four people had each
        // reacted separately.
        const rx = c === lastMsg ? reactionGroups(comments) : [];
        // An attached photo renders ABOVE the text, and the text is suppressed when it is only the
        // NOT-NULL stand-in — a bubble reading "Sent a photo" under the photo it is describing is
        // noise. The src is filled in after paint (signed URLs are async); until then the element
        // is a sized placeholder, so the thread does not reflow when images land.
        const photo = attachedPhoto(c);
        const photoOnly = isPhotoOnly(c);
        return `
        <div class="msg ${mine ? 'athlete' : c.role === 'ai' ? 'ai' : 'coach'}${item.firstOfRun ? '' : ' cont'}${rx.length ? ' has-rx' : ''}">
          ${!mine && item.firstOfRun ? `<div class="av"${c.role !== 'ai' && c.author_id ? ` data-avatar-uid="${esc(c.author_id)}"` : ''}>${c.role === 'ai' ? icon('sparkle', 15) : `<span data-avatar-fallback>${esc(initialsFor(who))}</span>`}</div>` : '<div class="av-sp"></div>'}
          <div class="stack">
            ${item.firstOfRun && !mine ? `<div class="who">${esc(who)}</div>` : ''}
            ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : ''}
            ${/* The "Updated analysis" badge is gone (founder 2026-08-05: robotic) — a correction
                  reply is just the AI's next message, like a person texting back. The quote stem
                  above already shows WHAT it answers. The escalation badge stays: "this reached
                  your coach" is a fact worth labeling. */''}
            <div class="bubble">${escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : esc(c.text)}</div>
            ${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}
          </div>
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
      const lastMsgAt = msgs.length
        ? Math.max(...msgs.map((c) => { const t = Date.parse(c && c.created_at); return isNaN(t) ? 0 : t; }))
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
      const lastCoach = [...msgs].reverse().find((c) => c && c.role === 'coach' && !isPhotoOnly(c) && String(c.text || '').trim());
      // The pin exists to SURFACE a coach word that scrolled out of the preview. When that same
      // message is one of the four bubbles right below it, the pin is a duplicate two inches
      // above its original — so it only renders when its message is not already on screen.
      const coachPin = lastCoach && !shown.includes(lastCoach) ? (() => {
        const who = authorName(lastCoach, participants, RT.userId, S.coach.noun);
        return `<div class="coach-pin">
          <div class="cp-head"><span class="cp-av">${esc(initialsFor(who))}</span><span class="cp-who">${esc(who)}</span><span class="cp-tag">${icon('pin', 11)} Pinned</span></div>
          <div class="cp-text">${esc(String(lastCoach.text || ''))}</div>
        </div>`;
      })() : '';
      const earlierBtn = hiddenCount > 0
        ? `<button class="cont-earlier" id="thread-more">View ${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'} &rarr;</button>`
        : '';
      threadEl.innerHTML = coachPin + openingLead + earlierBtn + rows + openingTail + (aiTyping ? typingRow() : '')
        + (seen ? `<div class="seen">${seen}</div>` : '')
        + (tail.length ? `<div class="msg-status">${tail.join(' ')}</div>` : '');
      hydrateAvatars(threadEl);   // 0206: message monograms upgrade to real faces
      // READ MORE (founder 2026-08-05): a long AI message clamps to its first four lines with a
      // quiet expander — the core coaching stands alone; history/hedges are there for whoever
      // wants them. Keyed on the text's own head so an expansion survives every repaint; photo
      // bubbles and chip bubbles are never clamped (clipping a control would break it).
      threadEl.querySelectorAll('.msg.ai .bubble').forEach((b) => {
        if (b.closest('#ai-typing') || b.querySelector('.fq-chips, img, .chat-photo')) return;
        const t = b.textContent || '';
        if (t.length < 320) return;
        const key = t.slice(0, 64);
        // Clamp an inner wrapper, not the padded bubble itself — -webkit-line-clamp on a padded
        // box lets a partial fifth line bleed into the padding.
        const inner = document.createElement('div');
        inner.className = 'bt-clamp';
        while (b.firstChild) inner.appendChild(b.firstChild);
        b.appendChild(inner);
        const more = document.createElement('button');
        more.className = 'read-more';
        b.after(more);
        // A TOGGLE, not a one-way door (founder, 2026-08-06). Expanding used to delete the control,
        // so a five-paragraph read stayed open forever and pushed the rest of the conversation off
        // the screen with no way back. The expanded/collapsed state still keys on the text's own
        // head so it survives every repaint — it is now just a two-way flag rather than a
        // write-once one.
        const sync = () => {
          const open = expandedBubbles.has(key);
          inner.classList.toggle('bt-clamp', !open);
          more.textContent = open ? 'Read less' : 'Read more';
          more.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        more.addEventListener('click', () => {
          if (expandedBubbles.has(key)) expandedBubbles.delete(key); else expandedBubbles.add(key);
          sync();
        });
        sync();
      });
      // `.thread` is a flex column, not a scroller — this line used to set scrollTop on an element
      // that has never had any, so a repaint moved nothing. The screen's scroller is #viewport.
      // Unforced, so the 15s poll can only re-pin a reader who was already at the end of the
      // conversation; someone scrolled up reading the breakdown stays where they put themselves.
      scrollThreadToEnd(threadEl);
      void hydrateThreadPhotos(threadEl, roles);
    };

    const setTyping = (on) => { aiTyping = !!on; paint(); };
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
        if (c && c.meta && c.meta.t === 'pro_correction') {
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
      // Memory confirmation: the athlete's tap is the ONLY thing that lets an inferred fact bind.
      const fx = ev.target && ev.target.closest ? ev.target.closest('[data-fact]') : null;
      if (fx) {
        const id = fx.getAttribute('data-fact');
        PENDING_FACTS = { uid: PENDING_FACTS.uid, rows: (PENDING_FACTS.rows || []).filter((f) => f.id !== id), at: Date.now() };
        void act.confirmMemoryFact(id, fx.getAttribute('data-keep') === '1');
        return;
      }
      const t = ev.target && ev.target.closest ? ev.target.closest('#mq-thread-go, #mq-thread-skip, #mt-retry-analysis, #mt-reread, #open-full-chat, #thread-more') : null;
      if (!t) return;
      if (t.id === 'mt-retry-analysis') {
        // Always answer the tap: in-flight label now, and retryAnalysis itself re-renders with
        // either the pending state or an honest failure line. The old handler called a function
        // that could return without doing anything, and the button just sat there.
        t.disabled = true;
        t.textContent = 'Reading the plate…';
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
        if (window.__navigate) window.__navigate('nutrition-chat'); else location.hash = '#nutrition-chat';
        return;
      }
      // A meal that settled at zero: put it back in the queue for another read.
      if (t.id === 'mt-reread') { t.textContent = 'Reading the plate…'; void act.rereadMeal(M.slot); return; }
      if (t.id === 'mq-thread-skip') { act.skipPendingQuestions(M.slot); return; }
      const answers = [];
      root.querySelectorAll('#mq-bubble .mq-input').forEach((el) => { answers[+el.dataset.qi] = el.value; });
      act.answerPendingQuestions(M.slot, answers);
    });
    // (the old "flag it for Coach" free-text path is replaced by the structured correction panel)
    const setNote = (t, retry) => { if (note) note.innerHTML = t ? `<div class="mt-retry" ${retry ? 'id="chat-retry"' : ''}>${esc(t)}</div>` : ''; };
    let busy = false;
    // Reaches the AI for an ALREADY-POSTED question. Retry re-runs only this — the athlete's
    // comment lands in meal_comments exactly once per question, never duplicated by a retry.
    // `photoPath` is a storage KEY, never image bytes: meal-chat re-reads the object server-side
    // with the service role, so the client cannot make the model look at anything the athlete did
    // not actually attach to this thread.
    const askAI = async (text, photoPath = null) => {
      try {
        const recent = await roles.fetchRecentMeals(RT.userId, roles.daysAgoISO(7)).catch(() => []);
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
          thread: threadMessages(comments).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
        });
        setTyping(true);
        const { data, error } = await window.sb.functions.invoke('meal-chat', {
          body: {
            mealId: M.mealId,
            // A wordless photo still needs a question for the model to answer. Sent explicitly
            // rather than left empty so the prompt reads as a real ask, not a blank turn.
            question: text || 'I sent a photo. What do you make of it?',
            context,
            // "I can apply a structured correction": unlocks the apply_correction tool
            // server-side. Only sent because the handler below actually applies it.
            canApplyCorrection: true,
            ...(photoPath ? { photoPath } : {}),
          },
        });
        setTyping(false);
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
          if (parsed && parsed.error === 'limit') setNote("You've hit today's AI coaching limit. Back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach your AI coach. Tap to try again.", true);
        } else {
          // THE CORRECTION LOOP CLOSES HERE (founder escalation 2026-08-06). The athlete stated
          // a fact about their own food ("the shake is the 42g bottle") and the AI called
          // apply_correction instead of arguing. The app now applies it DETERMINISTICALLY —
          // per-item macros, meal totals, score, rubric, coach focus, and day targets all
          // recompute from the one canonical record, and the meals row mirror keeps coach view,
          // daily score, and group chat reading the same finalized data. The AI's acknowledgment
          // row is already persisted server-side; refresh() below shows it.
          if (data.correction && data.correction.item) {
            const c = data.correction;
            const applied = await act.correctMeal(M.slot, {
              kind: 'item', item: c.item, newName: c.newName || undefined,
              per: c.per || {}, add: c.add || undefined, minutesLate: M.minutesLate,
            }, { skipAiUpdate: true });
            // A CORRECTION THAT DID NOT LAND MUST SAY SO (2026-08-09). correctMeal returns null
            // whenever it cannot act — the named item matches nothing in the read, the meal has no
            // per-item detail, the day slot is gone. That null used to be discarded on the way
            // past, and because the AI's "updating your numbers now" was already sitting in the
            // thread, the athlete was left reading a promise the app had quietly failed. Now the
            // thread admits it in the same breath and hands them the panel that always works.
            if (!applied) {
              setNote("That didn't line up with anything in this meal's read, so your numbers haven't changed. Fix it here and it will stick.");
              openFix(true);
              if (window.__render) window.__render();
              return;
            }
            // An ingredient we have no reference for is named out loud rather than rounded away:
            // the athlete is told exactly what is still missing and what would let us count it.
            if (applied.unpriced && applied.unpriced.length) {
              setNote(`Added what I could price. There are no numbers on file for ${applied.unpriced.join(' or ')}, so it isn't counted yet. Add it here and it will be.`);
              openFix(true);
            } else setNote('');
            // Full repaint: score ring, breakdown tiles, rubric, coach focus, day progress —
            // every surface on this screen re-derives from the corrected record.
            if (window.__render) window.__render();
            return;
          }
          await refresh();
        }
      } catch { setTyping(false); setNote("Couldn't reach your AI coach. Tap to try again.", true); }
      // The question is already in the thread — retry only re-reaches the AI (no input refill).
      const retry = root.querySelector('#chat-retry');
      if (retry) retry.addEventListener('click', async () => {
        if (busy) return;
        busy = true; setNote('');
        await askAI(text);
        busy = false;
      });
    };
    /* ---- photo attachment ---- */
    // All the DOM plumbing lives in chat-attach.js so the coach thread shares it verbatim rather
    // than growing a second copy that drifts. Nothing uploads on pick.
    const attach = wireComposerAttach({
      root, attachId: 'meal-attach', pendingId: 'meal-attach-pending', safeImg, onNote: (m) => setNote(m),
    });

    const submit = async () => {
      const typed = (input.value || '').trim();
      const pendingPhoto = attach.get();
      // A photo alone is a complete message — post-0173 it sends with genuinely empty text, and
      // postChatMessage falls back to the legacy stand-in if this database still carries 0046's
      // original length floor.
      if ((!typed && !pendingPhoto) || busy) return;
      // The 3-message wall is gone (0157): this is a conversation now, and the database backstop
      // sits far past anything a person would type. Nothing to warn about up front.
      busy = true; setNote('');
      input.value = '';
      if (pendingPhoto) setNote('Uploading photo…');
      // Upload happens BEFORE the row is written: a comment whose meta points at an object that
      // failed to upload would render a permanently broken image. On upload failure nothing is
      // posted at all, rather than silently dropping the picture from a message about it.
      const res = await postChatMessage(roles, {
        mealId: M.mealId, athleteId: RT.userId, authorId: RT.userId, role: 'athlete',
        text: typed, photo: pendingPhoto,
      });
      const photoPath = res.photoPath;
      if (res.ok) {
        attach.clear();
        setNote('');
        // The seconds right after sending are when the athlete is actually watching for a reply.
        startBurst();
      } else {
        // Give the text back — re-submitting IS the retry — and don't reach the AI for a question
        // that never landed. The photo stays held so it is not lost with it.
        input.value = typed;
        setNote(res.error === 'upload'
          ? "Couldn't upload that photo. Try again, or remove it and send."
          : "Couldn't send. Try again.");
        busy = false;
        return;
      }
      // The athlete asked a question in the shared conversation — action-class for the coach
      // (spec: a direct athlete question is "action needed"). Best-effort, after the post landed.
      if (S.coach.hasCoach) {
        void roles.notifyMyCoach({
          // Suffix = deep link for the coach's bell row (notif-feed KIND_ROUTE), matching the
          // push payload's route below.
          kind: M.mealId ? `meal_action:${M.mealId}` : 'meal_action', urgent: true,
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
      // The AI now SEES an attachment: meal-chat fetches it from storage server-side and passes it
      // to the model as a real image block, so a wordless photo is a legitimate question ("what do
      // you make of this?") rather than something only the coach can act on.
      await askAI(typed, photoPath);
      busy = false;
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') submit(); });

    /* ---- reactions: press and hold a message ---- */
    // The permanent four-emoji row above the composer is gone (founder, 2026-08-02). Same posting
    // logic, same toggle, reached the way every messaging app on this phone reaches it. Wired on
    // `root` — the node the router never replaces — because #view and everything in it is rebuilt
    // on each render; wireTapback is re-entrant, so this re-mount swaps the callbacks rather than
    // stacking listeners. The picker itself lives on <body>, out of the render's way.
    if (M.mealId) wireTapback({
      root,
      scope: '#meal-thread',
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
