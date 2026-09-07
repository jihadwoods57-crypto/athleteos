/* The clarifying question, as a sheet that comes to the athlete.
 *
 * WHY THIS IS AN OVERLAY, when DESIGN.md says a modal is never the first idea. Because the ask is
 * genuinely blocking and the app is the one that is stuck. The read came back without numbers: the
 * model was unsure about something that moves the macros, so the breakdown holds five dashes until
 * a human answers. Until 2026-09-07 that ask lived only as a bubble inside the meal thread, below
 * the fold and below a "Back to Home" button, wearing the same weight as a chat message. An
 * athlete opened Lunch, saw five dashes with no reason given, and left. The question that would
 * have finished their meal was three scrolls down.
 *
 * Nothing here asks for anything new. It is the same one to three questions the full-screen
 * Clarifying Moment (#meal-questions) asks in the capture flow, in the same words, with the same
 * two ways out. This is the surface for the meal you come BACK to, where a route change would
 * lose your place in the conversation.
 *
 * Same idiom as members-sheet.js and image-viewer.js: a body-level element, no route change, so
 * closing lands exactly where the athlete opened it. It records the opener, moves focus in, traps
 * Tab, honours Escape, registers its marker with overlay-guard, and sits above the keyboard by
 * riding --kb (keyboard.js), because unlike every other overlay in this app it holds text inputs.
 */

import { esc, safeImg } from './components.js';
import { icon } from './icons.js';
import { overlayOpen } from './overlay-guard.js';

let overlay = null;
let opener = null;   // the element that opened the sheet; focus returns to it on close
let busy = false;

/* Meals whose sheet has already come up on its own this session. The ask is unmissable the first
   time a meal is opened and never nags after that: a second automatic appearance would be the
   app arguing with someone who has already decided to read their thread first. Deliberate opens
   (the Answer chip, the breakdown's own button) ignore this entirely. */
const AUTO_SHOWN = new Set();

/** True when this meal's sheet has not opened itself yet. */
export function autoShownFor(key) { return AUTO_SHOWN.has(String(key)); }
/** Mark a meal as auto-shown (the caller does this when it opens the sheet automatically). */
export function markAutoShown(key) { AUTO_SHOWN.add(String(key)); }
/** Forget the session's auto-open record. Exported for tests. */
export function resetAutoShown() { AUTO_SHOWN.clear(); }

export function closeMealQuestions() {
  if (!overlay) return;
  const o = overlay;
  overlay = null;
  busy = false;
  o.classList.remove('on');
  setTimeout(() => { try { o.remove(); } catch { /* already gone */ } }, 200);
  try { document.removeEventListener('keydown', onKey); } catch { /* not attached */ }
  const back = opener;
  opener = null;
  if (back && typeof back.focus === 'function') { try { back.focus(); } catch { /* opener left the DOM */ } }
}

function onKey(e) {
  // Escape leaves the question unanswered on purpose. It is not the same as Skip: skipping tells
  // the server to finalize on estimates, and that is a decision the athlete makes with a button.
  if (e.key === 'Escape') { closeMealQuestions(); return; }
  if (e.key === 'Tab' && overlay) {
    const f = overlay.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/**
 * Open the sheet.
 * @param {object} o
 * @param {string[]} o.questions  one to three questions, in the model's words
 * @param {string=}  o.photo      the meal photo, shown small so the question has its subject
 * @param {string=}  o.slot       the meal slot, for the copy
 * @param {(answers: string[]) => any} o.onAnswer  called with one answer per question
 * @param {() => any} o.onSkip    called when the athlete chooses estimates instead
 */
export function openMealQuestions({ questions, photo, slot, onAnswer, onSkip } = {}) {
  const qs = (Array.isArray(questions) ? questions : []).filter(Boolean).slice(0, 3);
  // One overlay at a time (DESIGN.md). Excluding only its own marker, so it never vetoes itself.
  if (!qs.length || overlay || overlayOpen('.mqsheet')) return false;
  opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

  const head = qs.length === 1 ? 'One quick thing' : qs.length === 2 ? 'Two quick things' : `${qs.length} quick things`;
  const img = photo ? safeImg(photo) : '';
  const el = document.createElement('div');
  el.className = 'mqsheet';
  el.innerHTML = `
    <div class="mqs-card" role="dialog" aria-modal="true" aria-labelledby="mqs-title">
      <div class="mqs-grab" aria-hidden="true"></div>
      <div class="mqs-head">
        ${img ? '<div class="mqs-thumb" aria-hidden="true"></div>' : `<div class="mqs-thumb ph" aria-hidden="true">${icon('sparkle', 18)}</div>`}
        <div class="mqs-htxt">
          <h2 class="mqs-title" id="mqs-title">${esc(head)} and your ${esc(slot || 'meal')} numbers are exact</h2>
          <div class="mqs-sub">A photo can't show what's under or off the plate. The camera got the rest.</div>
        </div>
        <button class="mqs-x" type="button" aria-label="Close, answer later">×</button>
      </div>
      <div class="mqs-body">
        <div class="mq-list">
          ${qs.map((q, i) => `
          <label class="mq-item">
            <div class="mq-q"><span class="mq-n">${i + 1}</span><span>${esc(q)}</span></div>
            <input class="mq-input" data-qi="${i}" type="text" autocomplete="off" enterkeyhint="${i === qs.length - 1 ? 'done' : 'next'}"
              placeholder="Your answer" aria-label="${esc(q)}" />
          </label>`).join('')}
        </div>
      </div>
      <div class="mqs-foot">
        <button class="btn primary" id="mqs-go" type="button">${icon('check', 18)} Get my result</button>
        <button class="mqs-skip" id="mqs-skip" type="button">Skip, just estimate</button>
      </div>
    </div>`;

  document.body.appendChild(el);
  overlay = el;
  // The photo is set as a property rather than an attribute: the URL never becomes markup, and a
  // new module has no inline-style budget to spend on it (tools/inline-style-ratchet.mjs).
  if (img) { const th = el.querySelector('.mqs-thumb'); if (th) th.style.backgroundImage = `url("${img}")`; }
  requestAnimationFrame(() => el.classList.add('on'));
  document.addEventListener('keydown', onKey);

  const card = el.querySelector('.mqs-card');
  const inputs = () => Array.from(el.querySelectorAll('.mq-input'));
  const answers = () => { const a = []; inputs().forEach((x) => { a[+x.dataset.qi] = x.value.trim(); }); return a; };

  const fail = (msg) => {
    let err = el.querySelector('#mqs-err');
    if (!err) {
      el.querySelector('.mqs-foot').insertAdjacentHTML('beforebegin', `<div id="mqs-err" class="mq-err" role="alert">${icon('x', 14)} <span></span></div>`);
      err = el.querySelector('#mqs-err');
    }
    err.querySelector('span').textContent = msg;
  };

  const finish = async (ans, handler) => {
    if (busy) return;
    busy = true;
    const go = el.querySelector('#mqs-go');
    const skip = el.querySelector('#mqs-skip');
    if (go) { go.disabled = true; go.innerHTML = `${icon('sparkle', 18)} Reading your meal...`; }
    if (skip) skip.disabled = true;
    try {
      const r = await handler(ans);
      // The actions resolve to nothing on success; only an explicit {ok:false} is a failure.
      if (r && r.ok === false) {
        busy = false;
        if (go) { go.disabled = false; go.innerHTML = `${icon('check', 18)} Get my result`; }
        if (skip) skip.disabled = false;
        fail(r.error || "Couldn't send that. Check your connection and try again.");
        return;
      }
      closeMealQuestions();
    } catch {
      busy = false;
      if (go) { go.disabled = false; go.innerHTML = `${icon('check', 18)} Get my result`; }
      if (skip) skip.disabled = false;
      fail("Couldn't send that. Check your connection and try again.");
    }
  };

  el.querySelector('.mqs-x').addEventListener('click', closeMealQuestions);
  // Tapping the scrim closes; tapping the card must not.
  el.addEventListener('click', (ev) => { if (ev.target === el) closeMealQuestions(); });
  el.querySelector('#mqs-go').addEventListener('click', () => finish(answers(), (a) => (onAnswer ? onAnswer(a) : null)));
  el.querySelector('#mqs-skip').addEventListener('click', () => finish([], () => (onSkip ? onSkip() : null)));
  // Enter on the last field submits; Enter on an earlier one moves along, which is what the
  // enterkeyhint above already promised the keyboard.
  inputs().forEach((inp, i) => inp.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const next = inputs()[i + 1];
    if (next) next.focus(); else el.querySelector('#mqs-go').click();
  }));

  /* Focus the CARD, not the first field. This sheet can arrive on its own when a meal is opened,
     and an overlay that raises the keyboard uninvited is a jump-scare, not an affordance. The
     athlete taps the field when they are ready; a screen reader still lands inside the dialog and
     reads its title. */
  try { card.focus(); } catch { /* focus is a nicety */ }
  return true;
}
