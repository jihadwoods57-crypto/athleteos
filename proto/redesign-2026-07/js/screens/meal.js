import { S, RT, tier, act, MEAL, mealDetail, fmtClock } from '../state.js';
import { DAY, slotDeadline } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, nonLiveBadge, composer } from '../components.js';
import { reveal } from '../motion.js';
import {
  openingMessage, openingSummary, qualityBand, scoreReasons, reactionGroups, threadMessages,
  contextForChat, applyFoodEdit, hasUserEdits, restrictionConflicts,
  estimateConfidence, estRange, mealPatterns, scoreRubric, followUpQuestion, coachThreadStatus,
  REACTION_EMOJI,
} from '../meal-intel.js';
import {
  attachedPhoto, isPhotoOnly, wireComposerAttach, postChatMessage,
  bubblePhotoHtml, hydrateThreadPhotos,
} from '../chat-attach.js';
import { openImageViewer } from '../image-viewer.js';
import { openMembersSheet } from '../members-sheet.js';
import { wireTapback } from '../tapback.js';
import { recentRows, warmRecent as warmRecentShared } from '../recent-meals.js';
import {
  layoutThread, authorName, initialsFor, participantList, participantSummary, participantMeta,
  isAnalysisOpener, isAnalysisUpdate, isEscalated, quotedFor,
} from '../chat-view.js';

/* The meal score chip's ring, drawn as the brand dial (docs/brand/LOGO.md): a 300° gauge with
   a 60° gap at 6 o'clock and the signature --ring-a/b/c sweep — the same silhouette as the day
   score ring and the mark itself. Status color (good/mid/low) lives on the chip's NUMBER, never
   the arc: score surfaces wear the sweep, green stays status-only. Keeps .sc-arc/.ring-arc +
   data-off so reveal()/windBack drive it unchanged. */
function miniDial(score) {
  const c = 31, r = 26, A0 = 120, SWEEP = 300;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + Math.cos(a) * r).toFixed(2)} ${(c + Math.sin(a) * r).toFixed(2)}`;
  };
  const d = `M ${pt(A0)} A ${r} ${r} 0 1 1 ${pt(60)}`;
  const off = (100 - score).toFixed(1);
  return `<svg class="sc-ring" width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
    <defs>
      <linearGradient id="scg" gradientUnits="userSpaceOnUse" x1="12.5" y1="53.9" x2="37.2" y2="5">
        <stop offset="0%" stop-color="var(--ring-a)"/>
        <stop offset="50%" stop-color="var(--ring-b)"/>
        <stop offset="100%" stop-color="var(--ring-c)"/>
      </linearGradient>
    </defs>
    <path d="${d}" fill="none" stroke="var(--hairline)" stroke-width="3.5" stroke-linecap="round"/>
    <path class="ring-arc sc-arc" d="${d}" fill="none" stroke="url(#scg)" stroke-width="3.5" stroke-linecap="round"
      pathLength="100" stroke-dasharray="100" stroke-dashoffset="${off}" data-off="${off}"/>
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
      <div class="scanbox">
        <div class="img" style="background-image:url('${img}')"></div>
        <div class="scanline"></div>
      </div>
      ${nonLive ? `<div style="display:flex;justify-content:center;padding-top:10px">${nonLiveBadge()}</div>` : ''}
      <div class="phase" id="an-phase">Analyzing meal<span class="dots"></span></div>
      <div class="phase-sub" id="an-sub">Detecting foods and portions</div>
    </div>`;
  },
  async mount(root, { sub: slotArg } = {}) {
    analysis._editing = false; // a fresh analysis never opens in edit mode
    const phase = root.querySelector('#an-phase');
    const sub = root.querySelector('#an-sub');
    const onScreen = () => location.hash.startsWith('#analyzing');
    /* Three beats instead of two. The screen used to switch copy once at 1s and then hold, which
       was fine when it bailed after a second — now that it actually waits for the read (see the
       dwell note below), one static line for several seconds reads as a hang. */
    const PHASES = [
      [1400, 'Estimating macros', 'Matching to your plan'],
      [3800, 'Almost there', 'Building your breakdown'],
    ];
    const phaseTimers = PHASES.map(([at, head, tail]) => setTimeout(() => {
      if (!phase || !onScreen()) return;
      phase.innerHTML = `${head}<span class="dots"></span>`;
      if (sub) sub.textContent = tail;
    }, at));
    const clearPhases = () => phaseTimers.forEach(clearTimeout);

    /* ---- WATCH MODE: the meal is ALREADY logged and the outbox owns the read. ----
       This is the path the camera takes now. Two things it must never do: start its own analysis
       (the outbox job is already running one, and a second vision call is real money), or hold the
       athlete here (the meal is committed — nothing downstream is waiting on this screen).

       So it is a bounded moment, not a gate: MIN_MS guarantees the scan actually registers even
       when the read comes back in 300ms, MAX_MS guarantees it is never a wait. Either way the next
       screen is the thread, which already states the pending case honestly ("Logged and counting.
       The breakdown lands here in a few seconds"). */
    const slot = slotArg || (MEAL && MEAL.key) || null;
    if (slot && DAY.meals[slot]) {
      /* The dwell. MIN_MS is the floor so the scan always registers as work; MAX_MS is the
         ceiling so this is a moment, never a gate — the meal is already committed and nothing
         downstream waits on this screen.
         Both were far too tight (1150 / 3200). The ceiling in particular sat below a real vision
         call, so the athlete was handed off mid-read almost every time. Worse, `pending` was
         never persisted (day.js dropped it from dayLogMeal's meta whitelist), so `landed` was
         true on the very first tick and this always bailed at the 1150ms floor — which is what
         "way too fast" was. With pending fixed this genuinely waits for the read, and the
         ceiling now clears a typical call instead of cutting it off. */
      const MIN_MS = 2600, MAX_MS = 9000;
      const t0 = Date.now();
      const leave = () => { clearPhases(); if (onScreen()) window.__go('meal-thread/' + slot); };
      const tick = () => {
        if (!root.isConnected || !onScreen()) { clearPhases(); return; }
        const cur = DAY.slotMacros[slot] || {};
        const landed = !cur.pending;              // applyAnalysisResult clears it, success or not
        const waited = Date.now() - t0;
        if ((landed && waited >= MIN_MS) || waited >= MAX_MS) { leave(); return; }
        setTimeout(tick, 110);
      };
      setTimeout(tick, 110);
      return;
    }

    if (MEAL && MEAL.photoBase64 && !MEAL.result) {
      // REAL analysis via the analyze-meal edge function.
      const r = await act.runAnalysis();
      if (location.hash !== '#analyzing') return; // navigated away
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
      if (phase) phase.textContent = r.error || 'Analysis failed.';
      if (sub) { sub.textContent = 'Nothing was logged — your photo is still here.'; }
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
    if (location.hash === '#analyzing') location.hash = '#camera';
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
    ${backHead('Two quick things', "So your numbers are exact", 'camera')}
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
      err.querySelector('span').textContent = r.error || 'Analysis failed. Try again.';
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
  // ONE useful follow-up when uncertainty materially affects the analysis — the chips map
  // onto correction rules, so an answer UPDATES this estimate rather than forking a new one.
  const fq = followUpQuestion({
    source: M.source, userNote: M.userNote, note: M.note,
    detectedRich: M.detectedRich, corrections: M.corrections,
    });
  return { sum, fullText, fq };
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
export function openingBlockHtml(M, { sum, fullText, fq, hasPersistedRead = false } = {}) {
  const aiRow = (inner, id) => `
      <div class="msg ai"${id ? ` id="${id}"` : ''}>
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">${inner}</div></div>
      </div>`;

  if (M && M.analysisFailed) {
    const capacity = M.analysisFailed === 'capacity';
    return aiRow(`
          <div style="font-weight:700">${capacity ? "I couldn't get to this one today." : "I couldn't read this plate."}</div>
          <div style="margin-top:4px;color:var(--text-2)">It's logged and counts for timing either way — your photo is the proof.${capacity ? '' : ' Worth another try?'}</div>
          ${capacity ? '' : `<div class="fq-chips"><button class="fx-chip" id="mt-retry-analysis">${icon('sparkle', 13)} Read it again</button></div>`}`, 'analysis-failed');
  }

  if (M && Array.isArray(M.pendingQuestions) && M.pendingQuestions.length) {
    const qs = M.pendingQuestions.slice(0, 3);
    return aiRow(`
          <div style="font-weight:700">Two quick things and your numbers are exact.</div>
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
          </div>`, 'mq-bubble');
  }

  if (M && M.pending) {
    return aiRow(`
          <div style="font-weight:700">Reading your plate<span class="dots"></span></div>
          <div style="margin-top:4px;color:var(--text-2)">Logged and counting. The breakdown lands here in a few seconds — you don't have to wait on this screen.</div>`, 'analysis-pending');
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
            ? `Noted — you took ${askFact.value} off a plate. Skip it in future reads?`
            : `Should I remember: ${askFact.kind.replace(/_/g, ' ')} — ${askFact.value}?`)}
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
  if (hasPersistedRead) return fq ? fqRow(fq) + confirmRow : confirmRow;

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
  if (!body) return fq ? fqRow(fq) + confirmRow : confirmRow;

  return `
      <div class="msg ai">
        <div class="av">${icon('sparkle', 15)}</div>
        <div><div class="who">AI Nutritionist</div>
        <div class="bubble">${body}</div></div>
      </div>
      ${fq ? fqRow(fq) : ''}
      ${confirmRow}`;
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
    ${backHead(`${L.name} Analysis`, 'Check it before it counts', 'camera')}

    <div class="photo-hero" style="${safeImg(L.img) ? `background-image:url('${safeImg(L.img)}')` : 'background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))'}">
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
          <span class="fr-name">${esc(d.name)}${d.confidence === 'low' ? '<span class="q" title="AI is unsure — confirm or remove">?</span>' : ''}</span>
          <span class="fr-qty">${d.quantity ? esc(d.quantity) : ''}</span>
        </div>`).join('')}
      <div class="food-row fr-add" id="food-add" style="display:none">
        <span class="conf-dot high"></span>
        <input class="fr-in name" id="add-name" placeholder="Add item (e.g. 2 eggs off-frame)" aria-label="Food name" />
        <input class="fr-in qty" id="add-qty" placeholder="Qty" aria-label="Quantity" />
        <button class="fr-ok" id="add-ok" aria-label="Add">${icon('check', 15)}</button>
      </div>
      ${edited ? `<div style="font-size:11px;font-weight:600;color:var(--text-3);padding:4px 0 8px">${MEAL.result && MEAL.result.recomputed ? 'Edited by you — macros and score recalculated from the foods listed.' : 'Edited by you — macros stay the AI’s estimate.'}</div>` : ''}
    </section>

    <div class="eyebrow">Estimated</div>
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
        <div><div style="font-size:13.5px;font-weight:800;color:var(--red-bright)">Possible severe allergen: ${esc(severeHits.join(', '))}</div>
        <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-top:3px;line-height:1.45">A detected food may contain it — the read can't see every ingredient or cross-contact. Check the label or ask staff before you eat or log this.</div></div>
      </div>`;
      if (cf.moderate.length || cf.noted.length) return `
      <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--amber-surface);border:1px solid var(--amber-border)">
        ${icon('bell', 15)} <span style="font-size:12.5px;font-weight:700;color:var(--amber-bright)">Heads up: this may contain ${esc([...cf.moderate, ...cf.noted].join(', '))} from your restrictions.</span>
      </div>`;
      return `
      <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:var(--r-tile);background:var(--surface-2);border:1px solid var(--hairline)">
        ${icon('shield', 15)} <span style="font-size:12px;font-weight:600;color:var(--text-2)">Compared with your saved restrictions — no matches detected. Detection can miss ingredients or cross-contact; always verify severe allergens yourself.</span>
      </div>`;
    })()}

    <div style="height:12px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">AI Analysis</div><p>${esc(L.analysis || L.ai)}</p></div>
    </div>

    ${already ? '' : `<div class="score-change">${icon('arrowUp', 16)} Logging this counts toward Nutrition (50%) and closes 1 of ${S.remainingCount} remaining tonight.</div>`}

    <div style="height:20px"></div>
    <div class="btn-row">
      ${src === 'manual' ? `<button class="btn ghost sm" style="flex:1" data-go="food-search">${icon('search', 17)} Edit plate</button>`
        : src === 'label' ? `<button class="btn ghost sm" style="flex:1" data-go="label-scan">${icon('barcode', 17)} Edit label</button>`
        : `<button class="btn ghost sm" style="flex:1" data-go="camera/${slot}">${icon('camera', 17)} Retake</button>`}
      ${already
        ? `<button class="btn ghost sm" style="flex:1.6" data-back="home">Already logged</button>`
        : `<button class="btn green sm" style="flex:1.6" data-act="logMeal:${slot}" data-then="meal-thread/${slot}">${icon('check', 18)} Log ${esc(L.name)}</button>`}
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Tapping the pre-log photo opens it full-screen too (§6.1) — same viewer as the thread.
    const hero = root.querySelector('.photo-hero');
    if (hero && MEAL.photoDataUrl) {
      hero.style.cursor = 'zoom-in';
      hero.addEventListener('click', () => openImageViewer(MEAL.photoDataUrl, 'Meal photo'));
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
        row.insertAdjacentHTML('beforeend', '<span class="rm" role="button" aria-label="Remove" style="margin-left:8px;color:var(--red);font-weight:800;cursor:pointer">✕</span>');
        row.querySelector('.rm').addEventListener('click', (e) => {
          e.stopPropagation();
          const op = { kind: 'remove', name };
          if (applyFoodEdit(MEAL.result, op)) { act.recomputeStagedMeal(op); analysis._editing = true; window.__render(); }
        });
        if (nameEl) {
          nameEl.innerHTML = `<input class="fr-in name" value="${esc(name)}" aria-label="Food name" />`;
          nameEl.querySelector('input').addEventListener('change', (e) => {
            const op = { kind: 'rename', name, newName: e.target.value };
            if (applyFoodEdit(MEAL.result, op)) act.recomputeStagedMeal(op);
            analysis._editing = true; window.__render();
          });
        }
        if (qtyEl) {
          qtyEl.innerHTML = `<input class="fr-in qty" value="${esc((item && item.quantity) || '')}" placeholder="Qty" aria-label="Quantity" />`;
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
    btn.addEventListener('click', () => { analysis._editing = !analysis._editing; window.__render(); });
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
        <div class="sd-s">Log it with a photo and its full breakdown — foods, macros, your team's take — lives here.</div>
      </div>
      <button class="btn green" data-go="camera/${M.slot}">${icon('camera', 18)} Log ${esc(M.name)}</button>
      <div style="height:10px"></div>`;
    }

    // ---- 1. LOGGED CONFIRMATION — compact (founder feedback 2026-07-16: the old celebration
    // ate half the screen and mixed compliance with meal quality). Three facts only: logged
    // (green = accountability), the score move, progress on the day. Timing appears here ONCE.
    const justLogged = RT.lastMove && !RT.lastMove._played && (RT.lastMove.what || '').toLowerCase() === M.slot;
    const dupFlagged = M.flagged === 'dup';
    const timing = M.loggedAt
      ? `Logged ${M.loggedAt} · ${M.minutesLate > 0 ? `${M.minutesLate} min late` : 'on time'}`
      : (M.late ? 'Logged late · still counts' : 'Logged on time');
    const toTier = justLogged ? tier(RT.lastMove.to) : null;
    // Coach attention, from REAL signals only (comments load async; the mount updates this
    // line in place once they land): Sent to Coach → Reviewed by Coach → Coach replied.
    const cStatus = coachThreadStatus({
      mealId: M.mealId, hasCoach: S.coach.hasCoach, comments: [],
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
      ${justLogged && !dupFlagged ? `
      <div class="score-line">
        <span class="k">Daily Score</span>
        <span class="from" data-anim-from>${RT.lastMove.from}</span>
        <span class="arr">${icon('arrowRight', 14)}</span>
        <span class="to" data-anim-to>${RT.lastMove.to}</span>
        <span class="gain">+${RT.lastMove.gain}</span>
        ${toTier.name !== tier(RT.lastMove.from).name ? `<span class="tier-chip ${toTier.cls}">▲ ${esc(toTier.name)}</span>` : ''}
      </div>` : ''}
      <div class="prog-line">
        <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
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
    // Expandable score rubric (upgrade 2026-07-16): the observable components behind the
    // number, each marked exact or estimated — same math as the feedback, so they agree.
    const rub = scoreRubric({
      quality: M.score, minutesLate: M.minutesLate, macros: M.macros, fiber: M.fiber,
      detected: M.detectedRich, source: M.source, userNote: M.userNote, photoQ: M.photoQ,
    });
    const RUB_DOT = { met: 'g', partial: 'a', miss: 'r' };
    const photoBlock = `
    <!-- The plate, blurred, as the screen's own backdrop. The meal thread is the one screen with a
         real photograph on it, and it sat on the same flat canvas as everything else; letting the
         food tint the room is what makes the screen feel like it is ABOUT that meal. Same <img>
         src as the hero below (assigned once in mount), so this costs no second fetch. Decorative
         and behind everything: aria-hidden, no pointer events. -->
    <div class="meal-backdrop" aria-hidden="true"><img id="meal-backdrop-img" alt=""/></div>
    <div class="photo-hero" id="meal-hero" style="margin-top:14px;background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))">
      <img id="meal-photo" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;display:none"/>
      <div class="ph-grad"></div>
      <div class="ph-meta"><div>${M.live === false ? `<div>${nonLiveBadge()}</div>` : '<div></div>'}</div>
      ${M.score != null ? `<div class="scorechip ${band ? band.cls : ''}" id="meal-scorechip">
        ${miniDial(M.score)}
        <span class="v" data-count="${M.score}">${M.score}</span><span class="k">Meal</span>
      </div>` : ''}</div>
    </div>
    ${band ? `<div class="score-reasons">
      <span class="sr-band ${band.cls}">${M.score}<small>/100</small> · ${band.label}</span>
      ${reasons.map((r) => `<span class="sr-chip ${r.state}">${esc(r.label)}</span>`).join('')}
    </div>
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
    </details>` : ''}`;

    // ---- 3. MEAL BREAKDOWN (feedback 2026-07-16: progress bars imply a goal — they only
    // render against REAL coach targets. No targets → plain nutrient tiles, no fake
    // denominators. Detected foods are rows with portions + an honest estimate note.) ----
    // A read still in flight (or one that failed) has no numbers to correct — the correction
    // affordances only appear once the analysis has settled.
    const settled = !M.pending && !M.analysisFailed && !(Array.isArray(M.pendingQuestions) && M.pendingQuestions.length);
    const T = S.planTargets || {};
    const fromPhoto = M.source !== 'label' && M.source !== 'manual';
    const conf = estimateConfidence(M.source, M.detectedRich);
    const srcLabel = M.source === 'label' ? 'exact, from the nutrition label'
      : M.source === 'manual' ? 'entered by you'
      : `estimated from photo · ${conf} confidence`;
    const foodRows = M.detectedRich.map((d) => `
      <div class="food-row">
        <span class="conf-dot ${esc(d.confidence || 'high')}"></span>
        <span class="fr-name">${esc(d.name)}</span>
        <span class="fr-qty">${d.quantity ? `${fromPhoto ? '~ ' : ''}${esc(d.quantity)}` : ''}</span>
      </div>`).join('');
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
    // What share of the day's protein this one plate carried. Protein leads the breakdown because
    // it is the number a coach actually sets — the others are context for it.
    const dayShare = T.protein && M.macros.protein
      ? Math.round((M.macros.protein / T.protein) * 100) : null;
    const projectedTotal = T.protein ? (Number(dayProg.proteinSoFar) || 0) + (project(T.protein, dayProg.proteinSoFar) || 0) : null;
    const paceNote = projectedTotal && mealsLeft
      ? `On pace for about ${projectedTotal}g if your ${mealsLeft === 1 ? 'last meal lands' : `last ${mealsLeft} meals land`} on plan`
      : '';
    const corrLog = (M.corrections || []).length;
    // THE EMPTY READ. A settled photo meal whose every macro is zero isn't a light meal — it's a
    // read that came back with nothing in it (the truncated-report bug, now fixed at the source,
    // but these meals are already in people's days). Correction chips are useless here, because
    // every rule scales or nudges the stored numbers and all of those are zero. The only honest
    // move is to offer the read again.
    const emptyRead = settled && fromPhoto
      && !M.macros.protein && !M.macros.carbs && !M.macros.fat && !M.macros.cals;
    const rereadNote = `<div class="est-note" style="margin-top:8px">These numbers didn't land — the read came back empty, so nothing was measured.${M.mealId ? ` <span class="link" id="mt-reread" role="button">Re-read this meal</span>` : ''}${M.rereadError ? ` <b style="color:var(--text-2)">Couldn't fetch the photo just now — try again in a moment.</b>` : ''}</div>`;

    // INTUITIVE (0142): no macro or calorie figure reaches the athlete. The plate itself, what
    // was on it, and how it landed still do — the composition IS the feedback. Every number is
    // still computed and still stored (the professional needs them, and under-fueling is a
    // safety signal); this gate is presentation only. `showMacros` is the athlete's own
    // opt-in-able switch, so someone who WANTS their numbers back can have them.
    const showNums = S.planStyle.showMacros;
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
      ${M.analysisFailed ? `<div class="est-note" style="margin-top:10px">No numbers for this one — the photo is still your proof that the meal happened.</div>` : ''}
    </section>` : !showNums ? `
    <div class="eyebrow" style="margin-top:16px;flex-wrap:wrap;row-gap:2px;column-gap:8px"><span style="white-space:nowrap">What was on the plate</span><span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0;white-space:nowrap">· ${srcLabel}</span></div>
    ${foodRows ? `<section class="card" style="margin-top:8px;padding:4px 16px">${foodRows}</section>` : ''}
    ${M.userNote ? `<div class="est-note" style="margin-top:8px"><b style="color:var(--text-2)">Your note:</b> ${esc(M.userNote)}</div>` : ''}
    <div class="est-note" style="margin-top:8px">Your plan tracks how food leaves you feeling rather than calorie and macro counts. Your ${esc(S.coach.noun)} can still see the full numbers.</div>
    ${emptyRead ? rereadNote : ''}` : `
    ${/* THE ONE BREAKDOWN (founder 2026-08-04): the always-visible part is a single slim strip —
          protein leading, since it's the number a coach actually sets — and everything supporting
          (foods, target bars, notes, corrections) folds into one expandable section. The strip is
          what keeps the Meal Breakdown the single source of truth on screen, so the AI never has
          to restate a number; the old protein hero + 4-tile macro row said the same thing twice. */''}
    <div class="eyebrow" style="margin-top:16px;flex-wrap:wrap;row-gap:2px;column-gap:8px"><span style="white-space:nowrap">Meal Breakdown</span><span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0;white-space:nowrap">· ${srcLabel}</span></div>
    ${emptyRead ? rereadNote : `
    <div class="bd-strip">
      <span class="bs-p">${tilde}${M.macros.protein}g protein${dayShare != null ? `<small> · ${dayShare}% of your day</small>` : ''}</span>
      <span class="bs-m">${tilde}${M.macros.carbs}g carbs</span>
      <span class="bs-m">${tilde}${M.macros.fat}g fat</span>
      <span class="bs-m">${tilde}${M.macros.cals} cal</span>
    </div>`}
    <details class="bd-wrap"${thread._bdOpen || thread._fixOpen ? ' open' : ''}>
      <summary>Full breakdown${targetBars.length ? ' &amp; targets' : ''} ${icon('chevron', 13)}</summary>
      <div class="bd-body">
      ${foodRows ? `<section class="card" style="margin-top:8px;padding:4px 16px">${foodRows}</section>` : ''}
      ${targetBars.length ? `<section class="card pad" style="margin-top:10px">
        ${targetBars.map(([k, v, target, u, projected]) => {
          const now = Math.min(100, Math.round((v / target) * 100));
          // The striped segment is what is still COMING: the meals left today at their planned
          // share. Without it, 81 of 180g at dinner reads as failing when it is on pace — the bar
          // was answering "how much of the day is done" and the athlete reads it as a verdict.
          const ahead = projected != null ? Math.max(0, Math.min(100 - now, Math.round((projected / target) * 100))) : 0;
          return `
          <div class="cons-row" style="margin-bottom:10px">
            <span class="k" style="width:64px">${k}</span>
            <div class="track"><div class="fillb" style="width:${now}%;background:linear-gradient(90deg,var(--blue),var(--teal, #39c6d6))"></div>${ahead ? `<div class="ghostb" style="left:${now}%;width:${ahead}%"></div>` : ''}</div>
            <span class="v" style="width:110px">${tilde}${v}${u} <small style="color:var(--text-3)">of ${esc(String(target))}${u}</small></span>
          </div>`;
        }).join('')}
        ${paceNote ? `<div class="pace">${esc(paceNote)}</div>` : ''}
      </section>` : `<div class="est-note">No coach targets set yet, so there's nothing to measure against. These are this meal's totals.</div>`}
      <div class="est-note" style="margin-top:8px">~${M.fiber}g fiber estimated — the full component read lives under "Why this meal reads ${M.score != null ? M.score : 'what it reads'}".</div>
      ${M.userNote ? `<div class="est-note" style="margin-top:8px"><b style="color:var(--text-2)">Your note:</b> ${esc(M.userNote)}</div>` : ''}
      ${corrLog ? `<div class="est-note" style="margin-top:8px;color:var(--blue-bright)"><b style="color:var(--blue-bright)">Corrected by you</b> — ${corrLog} correction${corrLog === 1 ? '' : 's'} applied. The AI's original estimate is kept for reference${M.orig ? ` (was ~${M.orig.protein}g protein · ~${M.orig.kcal} cal)` : ''}.</div>` : ''}
      ${/* The two entry points into the correction panel live HERE, with the numbers they correct
            (founder, 2026-08-02). Both render for a manually logged meal too. */''}
      ${emptyRead ? '' : M.mealId ? `<div class="est-note">${fromPhoto ? 'Estimated from the photo · cooking oil or sauce may change these numbers. ' : ''}<span class="link" id="open-correct" role="button">${fromPhoto ? 'Something off? Correct the analysis' : 'Correct the analysis'}</span> · <span class="link" id="qa-details" role="button">Add meal details</span></div>` : ''}

      <!-- Correct analysis (upgrade 2026-07-16): fix what the photo can't show; every chip is a
           deterministic, estimated adjustment with an audit trail — hidden until opened. -->
      <div id="fix-panel" hidden>
        <div class="eyebrow" style="margin-top:14px">Correct the analysis</div>
        <section class="card pad" style="padding-top:12px">
          ${[
            ['cooking', 'Cooking', [['Oil', 'oil'], ['Butter', 'butter'], ['Neither', 'neither']]],
            ['sauce', 'Sauce', [['Creamy', 'creamy'], ['Sweet / glaze', 'sweet'], ['None', 'none']]],
            ['drink', 'Drink', [['Water', 'water'], ['Milk', 'milk'], ['Juice', 'juice'], ['Soda', 'soda'], ['Sports drink', 'sports drink']]],
            ['side', 'I also had', [['Fruit', 'fruit'], ['Vegetables', 'vegetables'], ['Bread / roll', 'bread']]],
            ['portion', 'Portion was', [['About half', 'half'], ['A bit less', 'three-quarters'], ['Larger', 'larger'], ['Double', 'double']]],
          ].map(([kind, label, opts]) => `
          <div class="fx-row">
            <span class="fx-k">${label}</span>
            <div class="fx-chips">${opts.map(([l, v]) => `<button class="fx-chip" data-fix="${kind}" data-val="${esc(v)}">${l}</button>`).join('')}</div>
          </div>`).join('')}
          <div class="fx-row">
            <span class="fx-k">Other</span>
            <div class="fx-other"><input class="input" id="fx-other" maxlength="160" placeholder="Anything else the photo can't show…" style="height:40px"/><button class="btn ghost sm" id="fx-other-add" style="width:auto;flex:none;padding:0 14px;height:40px">Add</button></div>
          </div>
          <div id="fx-note" style="font-size:12px;font-weight:700;color:var(--green-bright);min-height:16px;margin-top:6px"></div>
          <div class="rub-fine">Corrections update the estimate with rule-based kitchen math, keep the AI's original for the record, and ${S.coach.hasCoach ? `your ${esc(S.coach.noun)} sees the corrected numbers` : 'the corrected numbers are what your log keeps'}.</div>
        </section>
      </div>
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
      <span class="fp">${people.slice(0, 4).map((p) => `<span class="fpav ${esc(p.kind === 'ai' ? 'ai' : p.self ? 'self' : 'other')}">${p.kind === 'ai' ? icon('sparkle', 13) : esc(initialsFor(p.name))}</span>`).join('')}</span>
      <span class="names">${esc(participantSummary(people))}<small>${people.length} in this conversation</small></span>
      <span class="chev">${icon('chevron', 15)}</span>
    </button>`;

    const discussion = `
    <div class="eyebrow" style="margin-top:18px;display:flex;align-items:baseline;gap:8px">
      <span>Team Discussion</span>
      ${M.mealId ? `<span class="link" id="open-full-chat" role="button" style="margin-left:auto;text-transform:none;letter-spacing:0;font-size:12px">View full chat &rarr;</span>` : ''}
    </div>
    ${facepile}
    ${/* The `#rx-strip` that used to sit here is gone: paint() has cleared it on every repaint
          since reactions moved onto the bubble they belong to, so it was an element whose only
          job was to be emptied. */''}
    ${M.mealId ? `<button class="cont-earlier" id="thread-earlier" hidden aria-label="Open the full conversation"></button>` : ''}
    <div class="thread" id="meal-thread">
      ${openingBlockHtml(M, { sum, fullText, fq })}
      <div class="msg-status" id="thread-status">${M.mealId ? 'Loading the thread…' : (S.coach.hasCoach ? `Syncs when connected — your ${esc(S.coach.noun)} sees this log either way.` : 'Syncs when connected — this log is saved either way.')}</div>
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
    ${composer({ inputId: 'meal-msg', sendId: 'meal-send', placeholder: 'Ask about this meal…', sendLabel: 'Send', attachId: 'meal-attach' })}
    <div class="composer-attach-pending" id="meal-attach-pending" hidden></div>
    <div id="chat-note" style="min-height:18px"></div>` : ''}`;

    // ---- 4. NEXT ACTION (the exec engine's NOW) — context-aware (upgrade 2026-07-16):
    // an overdue item says exactly what can still be earned; when everything actionable is
    // done but locked items remain, the row names what opens next instead of vanishing.
    const n = e.now;
    const nextLocked = !n && !e.celebration ? (e.later || []).find(i => i.state === 'locked' && i.required) : null;
    const next = e.celebration ? `
    <div class="day-done" style="margin-top:16px">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">That's everything. You're OnStandard at ${e.score}.</div>
      <div class="ts">All requirements in.${S.streakDays > 0 ? ` Day ${S.streakDays} locks at midnight.` : ' Your streak starts when today locks at midnight.'}</div></div>
    </div>` : n ? `
    <div class="eyebrow" style="margin-top:16px">Next Action</div>
    <div class="xrow-item next-hot" data-go="${n.route}">
      <div class="xico sm ${n.color}">${icon(n.icon, 17)}</div>
      <div class="xr"><div class="xa">${esc(n.title)}</div>
      <div class="xb">${n.state === 'overdue' ? 'Log now for partial credit — late still counts'
        : `${n.countdown ? `⏱ ${esc(n.countdown)} · ` : ''}${esc(n.dueLabel)}`} · ${e.score} → ${e.possible}</div></div>
      <span class="xpill ${n.color}">${n.pill}</span>
    </div>` : nextLocked ? `
    <div class="eyebrow" style="margin-top:16px">Next Action</div>
    <div class="xrow-item" data-go="${nextLocked.route}">
      <div class="xico sm gray">${icon(nextLocked.icon, 17)}</div>
      <div class="xr"><div class="xa">Next up: ${esc(nextLocked.title)}</div>
      <div class="xb">${esc(nextLocked.sub)} · nothing else is open right now</div></div>
      <span class="xpill gray">Upcoming</span>
    </div>` : '';

    // Wrapped so the blurred photo backdrop inside photoBlock has a containing block and a stacking
    // context of its OWN. The obvious shortcut — positioning #view — is shared by every screen and
    // breaks any absolutely-positioned overlay rendered inside one (it threw the quick-log sheet
    // off the top of the screen); see .meal-screen in screens.css.
    // The header used to repeat the timing verdict the confirm card states one line below it —
    // "Breakfast / On time" immediately above "Breakfast logged / Logged 8:24 AM · on time".
    // Three facts, each said twice. This file's own rule is each fact exactly once, so the verdict
    // now lives only in the card (which carries the real clock time with it). The header keeps the
    // meal's name, and keeps the duplicate-photo flag — a different fact nothing else states.
    // Next Action moved directly under the confirm strip (founder 2026-08-04): after logging,
    // the very next required thing is visible without scrolling — the clearest possible
    // "what now". The rest of the screen stays photo → score → conversation → details.
    return `<div class="meal-screen">${backHead(M.name, dupFlagged ? 'Duplicate photo' : '', 'home')}${execTop}${next}${photoBlock}${breakdown}${discussion}
    <div style="height:18px"></div>
    <button class="btn green" style="width:100%" data-go="home" aria-label="Done — back to home">${icon('check', 18)} Done</button>
    <div style="height:16px"></div></div>`;
  },

  async mount(root, { sub }) {
    const slot = sub || MEAL.key || 'dinner';
    const M = mealDetail(slot);
    // score count-up plays once per log
    const to = root.querySelector('[data-anim-to]');
    if (to) {
      const target = +to.textContent; const from = +root.querySelector('[data-anim-from]').textContent; const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 900); to.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      // in-memory played flag only; worst case the count-up replays once after a reload — acceptable
      if (RT.lastMove) RT.lastMove._played = true;
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
      if (el && el.textContent === 'Sent to Coach' && RECEIPT.reviewed) el.textContent = 'Reviewed by Coach';
    });

    // ---- Correct analysis panel (upgrade 2026-07-16) ----
    if (thread._fixSlot !== M.slot) { thread._fixOpen = false; thread._fixSlot = M.slot; }
    // Breakdown expander state survives the exec-tick re-render; `toggle` fires only on user
    // changes, never on the initial `open` attribute.
    const bdWrap = root.querySelector('.bd-wrap');
    if (bdWrap) bdWrap.addEventListener('toggle', () => { thread._bdOpen = bdWrap.open; });
    const fixPanel = root.querySelector('#fix-panel');
    const openFix = (focusOther) => {
      if (!fixPanel) return;
      thread._fixOpen = true;
      if (bdWrap) bdWrap.open = true; // the panel lives inside the breakdown expander
      fixPanel.hidden = false;
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
    root.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () =>
      runCorrection({ kind: b.getAttribute('data-fix'), value: b.getAttribute('data-val') })));
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
    // Photo: the in-session capture, else a signed Storage URL so it survives a reload. The URL
    // is set as an img.src property (not HTML), so no injection risk; best-effort.
    const photo = root.querySelector('#meal-photo');
    if (photo) {
      let url = M.img;
      if (!url && RT.userId) url = await roles.signedMealPhotoUrl(`${RT.userId}/${DAY.date}/${M.slot}.jpg`);
      if (url) {
        photo.src = url; photo.style.display = 'block';
        // Same URL into the blurred backdrop — one decode, two uses.
        const back = root.querySelector('#meal-backdrop-img');
        if (back) back.src = url;
        // Tapping the meal photo opens the original full-screen (§6.1) — a DOM overlay, so
        // closing returns to this exact scroll position with zero navigation.
        const hero = root.querySelector('#meal-hero');
        if (hero) {
          hero.style.cursor = 'zoom-in';
          hero.addEventListener('click', () => openImageViewer(url, `${M.name} photo`));
        }
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
      statusEl.innerHTML = `<div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.4">Couldn't load the discussion — your log is safe, coach can still see it.</div>
        <button class="btn ghost sm" id="thread-retry" style="margin-top:10px">${icon('wifiOff', 15)} Retry</button>`;
      const retryBtn = statusEl.querySelector('#thread-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => {
        if (threadBusy) return;
        threadBusy = true;
        refresh().finally(() => { threadBusy = false; });
      });
    };
    let gen = 0; // stale-response guard: only the newest refresh paints
    let comments = [];
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
          <div><div class="who">AI Nutritionist is typing<span class="sr-only"> — a reply is on its way</span></div>
          <div class="bubble tdots"><span></span><span></span><span></span></div></div>
        </div>`;

    const paint = () => {
      if (!threadEl) return;
      const msgs = threadMessages(comments);
      // Coach REVIEW status: any coach row (message or reaction) counts as reviewed.
      const coachSeen = (Array.isArray(comments) ? comments : []).some((c) => c && c.role === 'coach');
      // Upgrade the header status line from the real thread: a coach row = "Coach replied".
      const csEl = root.querySelector('#coach-status');
      if (csEl && coachSeen) csEl.textContent = 'Coach replied';
      const tail = [];
      if (!msgs.length && !aiTyping) tail.push('No replies yet. Ask below and the AI Nutritionist answers from your plan.');
      if (!coachSeen) tail.push("Coach hasn't reviewed this meal yet.");

      // The pending / clarifying / failed rows are DERIVED, because they describe a read that has
      // not landed and so has nothing persisted to show. The READ ITSELF is now a real message in
      // `msgs`, so the derived summary only fills in for meals logged before that change.
      const hasPersistedRead = msgs.some(isAnalysisOpener);
      // Recomputed from the LIVE meal, not captured from render: a read that lands while this
      // screen is open (or a correction the athlete just made) has to change what these rows say.
      const live = mealDetail(M.slot) || M;
      const openingHtml = openingBlockHtml(live, { ...openingInputs(live), hasPersistedRead });

      const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
      const rows = layoutThread(msgs, { fmtTime: fmtMsgTime, fmtDay: dayKey }).map((item) => {
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
          ${!mine && item.firstOfRun ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : esc(initialsFor(who))}</div>` : '<div class="av-sp"></div>'}
          <div class="stack">
            ${item.firstOfRun && !mine ? `<div class="who">${esc(who)}</div>` : ''}
            ${quoted ? `<div class="quote"><span class="stem"></span><span class="qtext">${esc(quoted.text)}</span></div>` : ''}
            <div class="bubble">${update ? '<span class="upd">Updated analysis</span>' : escalated ? '<span class="esc">Sent to your coach</span>' : ''}${bubblePhotoHtml(photo, esc)}${photoOnly ? '' : esc(c.text)}</div>
            ${rx.length ? `<span class="rxo">${rx.map((r) => `${esc(r.emoji)} ${r.count}`).join(' ')}</span>` : ''}
          </div>
        </div>`;
      }).join('');

      // The receipt, in the thread rather than buried in the header: "seen" is what tells an
      // athlete their coach is actually there. coach_views is a DAY receipt, so it is stated as
      // one — claiming a per-message read we do not have would be a lie.
      const seen = coachSeen || (RECEIPT.rows || []).length
        ? (RECEIPT.rows || []).map((r) => `Seen by ${esc(r.viewer_name || 'your coach')}`).slice(0, 1).join('')
        : '';

      // COACH LEADS, AI ASSISTS (founder 2026-08-04): when a coach has spoken on this meal,
      // their latest word is PINNED above the AI's opener so the human's voice frames the
      // machine's. A pin, not a move — the message stays in the chronological flow below
      // (deduping would break layoutThread runs, last-bubble reactions, and quoted replies).
      const lastCoach = [...msgs].reverse().find((c) => c && c.role === 'coach' && !isPhotoOnly(c) && String(c.text || '').trim());
      const coachPin = lastCoach ? (() => {
        const who = authorName(lastCoach, participants, RT.userId, S.coach.noun);
        return `<div class="coach-pin">
          <div class="cp-head"><span class="cp-av">${esc(initialsFor(who))}</span><span class="cp-who">${esc(who)}</span><span class="cp-tag">${icon('pin', 11)} Coach</span></div>
          <div class="cp-text">${esc(String(lastCoach.text || ''))}</div>
        </div>`;
      })() : '';
      threadEl.innerHTML = coachPin + openingHtml + rows + (aiTyping ? typingRow() : '')
        + (seen ? `<div class="seen">${seen}</div>` : '')
        + (tail.length ? `<div class="msg-status">${tail.join(' ')}</div>` : '');
      threadEl.scrollTop = threadEl.scrollHeight;
      void hydrateThreadPhotos(threadEl, roles);
    };

    const setTyping = (on) => { aiTyping = !!on; paint(); };
    const refresh = async () => {
      const myGen = ++gen;
      const fetched = await roles.fetchMealComments(M.mealId);
      if (myGen !== gen) return;
      if (fetched && fetched.error) { showThreadError(); return; }
      comments = fetched; if (statusEl) statusEl.remove(); paint();
    };
    await refresh();

    // CONTINUITY. This meal's messages paint first and stay the fast path — but a conversation
    // that starts over at every plate is the thing being fixed, so once the thread is up we go
    // and find what was said before it and offer it as one line. Two messages, not a season: the
    // meal screen is not the place to scroll a fortnight, which is what the full chat is for.
    void (async () => {
      const season = await roles.fetchMyMealThread(RT.userId, { limit: 60 }).catch(() => []);
      if (!Array.isArray(season) || !season.length) return;
      const before = season.filter((c) => c && c.meal_id !== M.mealId && (c.kind || 'message') === 'message');
      if (!before.length) return;
      const last = before[before.length - 1];
      const el = root.querySelector('#thread-earlier');
      if (!el) return;
      const who = authorName(last, PARTICIPANTS.uid === RT.userId ? PARTICIPANTS.rows : [], RT.userId);
      el.innerHTML = `<span class="ce-k">Earlier</span><span class="ce-t"><b>${esc(who)}:</b> ${esc(String(last.text || '').slice(0, 90))}</span><span class="ce-go">${icon('chevron', 13)}</span>`;
      el.hidden = false;
    })();

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
    try { if (window.__threadChannel) { void window.__threadChannel.unsubscribe(); window.__threadChannel = null; } } catch { /* none yet */ }

    let rtLive = false;         // realtime confirmed subscribed — lets the poll relax
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
          if (!threadBusy) await refresh().catch(() => {});
        }
        if (root.isConnected) scheduleTick();   // stop rescheduling once the screen is gone
      }, tickDelay());
    };
    scheduleTick();
    // Exposed so submit() can pull the thread into its fast window the moment a message lands.
    const startBurst = (ms = 20000) => { burstUntil = Date.now() + ms; scheduleTick(); };

    // Realtime subscription. Wrapped end-to-end: the vendored supabase-js already contains the
    // realtime client, but the `meal_comments` table still has to be added to the
    // supabase_realtime publication (see the migration alongside this change). Until that lands,
    // subscribe() simply never reaches 'SUBSCRIBED', rtLive stays false, and the poll keeps
    // running at its normal rate — the feature degrades to exactly today's behaviour.
    void (async () => {
      if (!M.mealId) return;
      try {
        // `window.sb` is the live client handle the whole proto shares (supabase.js assigns it;
        // roles.js reads it the same way). NOT `import { sb }` — that export is the client
        // INSTANCE, not a getter, and calling it would throw.
        const c = typeof window !== 'undefined' ? window.sb : null;
        if (!c || typeof c.channel !== 'function') return;
        const ch = c.channel(`meal_thread:${M.mealId}`)
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'meal_comments', filter: `meal_id=eq.${M.mealId}` },
            () => {
              // Leaving this screen does not tear the socket down (the next mount does), so a
              // stale channel would otherwise keep repainting a detached DOM and holding the
              // subscription open. Close it the first time we notice the screen is gone.
              if (!root.isConnected) {
                try { void ch.unsubscribe(); if (window.__threadChannel === ch) window.__threadChannel = null; } catch { /* already gone */ }
                return;
              }
              if (!threadBusy) void refresh().catch(() => {});
            })
          .subscribe((status) => {
            rtLive = status === 'SUBSCRIBED';
            // Re-decide the cadence immediately: going live should relax the poll now, and losing
            // the socket should tighten it back up without waiting a full slow cycle.
            scheduleTick();
          });
        window.__threadChannel = ch;
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
      input.focus();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
      const t = ev.target && ev.target.closest ? ev.target.closest('#mq-thread-go, #mq-thread-skip, #mt-retry-analysis, #mt-reread, #open-full-chat, #thread-earlier') : null;
      if (!t) return;
      if (t.id === 'mt-retry-analysis') { act.retryAnalysis(M.slot); return; }
      // The same conversation, unbounded by this one plate.
      // Route through the router, NOT a raw hash write. backHead's `to` is only a FALLBACK — back
      // actually pops the per-tab origin stack, and only navigateTo() pushes onto it. Assigning
      // location.hash directly skipped that push, so nutrition-chat had no recorded origin and its
      // back button fell through to its 'home' fallback instead of returning to the meal the
      // athlete opened it from.
      if (t.id === 'open-full-chat' || t.id === 'thread-earlier') {
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
          meal: { name: M.name, slot: M.slot, foods: M.detectedRich, macros: M.macros, fiber: M.fiber, quality: M.score, late: M.late, note: M.note },
          plan: { goal: RT.profile && RT.profile.baseGoal, targets: S.planTargets, allergies: RT.allergies },
          exec: { met: ex.met, total: ex.total, score: ex.score, possible: ex.possible, next: ex.now && ex.now.title },
          recentMeals: recentAscending.map((m) => ({ type: m.type, protein: m.protein, kcal: m.kcal, quality: m.quality, date: m.day_date })),
          thread: threadMessages(comments).slice(-20).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
        });
        setTyping(true);
        const { data, error } = await window.sb.functions.invoke('meal-chat', {
          body: {
            mealId: M.mealId,
            // A wordless photo still needs a question for the model to answer. Sent explicitly
            // rather than left empty so the prompt reads as a real ask, not a blank turn.
            question: text || 'I sent a photo — what do you make of it?',
            context,
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
          if (parsed && parsed.error === 'limit') setNote("You've hit today's AI coaching limit — back tomorrow. Your coach still sees this.");
          else setNote("Couldn't reach your AI coach — tap to try again.", true);
        } else {
          await refresh();
        }
      } catch { setTyping(false); setNote("Couldn't reach your AI coach — tap to try again.", true); }
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
          ? "Couldn't upload that photo — try again, or remove it and send."
          : "Couldn't send — try again.");
        busy = false;
        return;
      }
      // The athlete asked a question in the shared conversation — action-class for the coach
      // (spec: a direct athlete question is "action needed"). Best-effort, after the post landed.
      if (S.coach.hasCoach) {
        void roles.notifyMyCoach({
          kind: 'meal_action', urgent: true,
          title: `${S.athlete.first || 'Your athlete'} ${photoPath && !typed ? 'sent a photo about' : 'asked about'} ${M.name}`,
          // A wordless photo has no text to preview, so say what it IS rather than sending a
          // notification whose body is an empty string.
          body: `${(typed || 'Sent a photo').slice(0, 140)} · Tap to open the conversation.`,
          route: `coach-meal/${M.mealId}`,
        });
      }
      await refresh();
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
        if (ok) await refresh(); else setNote("Couldn't save that reaction — try again.");
        rxBusy = false;
      },
    });

    // Tap an attached photo to open it full-screen, the same viewer the meal's own hero photo uses.
    // Delegated on the thread because every repaint replaces these <img> elements.
    const threadRoot = root.querySelector('#meal-thread');
    if (threadRoot) threadRoot.addEventListener('click', (ev) => {
      const im = ev.target && ev.target.closest ? ev.target.closest('img.bimg') : null;
      if (!im || !im.src) return;
      openImageViewer(im.src, 'Photo attached to this message');
    });
  },
};

// Legacy routes/imports (#meal-confirm, #meal-detail) render the same unified page.
export const confirm = thread;
export const detail = thread;
