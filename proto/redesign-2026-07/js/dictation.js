/* ===== Dictation in every conversation box (composer upgrade, 2026-09-23) =====

   Founder: "I need the microphone button in order to talk out a message."

   components.js puts a .cmp-mic in send's slot on every conversation composer; this file owns what it
   does, from ONE set of document listeners, so no screen wires anything and all four threads (and
   Ask OnStandard on Plan) behave the same:
     - tap the mic: native speech recognition starts (src/lib/voice/nativeSpeech.ts, through the
       bridge's DICTATION_*), the mic becomes a blue stop control, and the words stream into the box
       at the caret as they are heard;
     - tap stop: listening ends, the last words land, and the text sits in the box to be read and
       edited. Nothing is ever sent by dictation. Send is the athlete's tap.
     - typing, sending, leaving the screen or leaving the app ends listening at once.

   The mic only SHOWS under html.can-dictate, which is set here only after the native shell says
   recognition can actually run (DICTATION_AVAILABLE). The web preview, and any installed binary
   built before the speech module, never see a mic that cannot work: an OTA reaching such a build
   finds window.OnStandardNative.dictation answering { available: false } and leaves it hidden. */
import { splitAtCaret, mergeDictation, dictationMessage, createSessions } from './dictation-state.js';

let started = false;
let backend = null;   // harness seam; otherwise window.OnStandardNative.dictation
let active = null;    // { sid, boxId, box, bar, base, placeholder, stopping, timer }
const sessions = createSessions();
let applying = false; // true while WE write into the box, so our own input event is not "typing"

const nativeBackend = () => {
  const n = typeof window !== 'undefined' ? window.OnStandardNative : null;
  return n && n.dictation ? n.dictation : null;
};
const api = () => backend || nativeBackend();

async function probe() {
  const b = api();
  if (!b || typeof b.available !== 'function') return;
  try {
    const st = await b.available();
    document.documentElement.classList.toggle('can-dictate', !!(st && st.available));
  } catch {
    document.documentElement.classList.remove('can-dictate');
  }
}

/* The box and bar being dictated into. Screens repaint (the thread polls, a reply lands), and a
   repaint replaces the composer with a new one carrying the same id: follow it. */
function current() {
  if (!active) return null;
  let box = active.box;
  if (!box || !box.isConnected) {
    box = active.boxId ? document.getElementById(active.boxId) : null;
    if (!box) return null;
    active.box = box;
  }
  const bar = box.closest('.composer');
  if (bar !== active.bar) {
    active.bar = bar;
    if (bar && !active.stopping) paintListening(bar, box, true);
  }
  return { box, bar };
}

function paintListening(bar, box, on) {
  if (!bar) return;
  bar.classList.toggle('cmp-listening', on);
  const mic = bar.querySelector('.cmp-mic');
  if (mic) {
    mic.setAttribute('aria-pressed', on ? 'true' : 'false');
    mic.setAttribute('aria-label', on ? 'Stop dictation' : 'Dictate a message');
  }
  if (box && active) box.setAttribute('placeholder', on ? 'Listening…' : active.placeholder);
  if (!on) bar.style.removeProperty('--cmp-mic-level');
}

/* One line under the box, owned by dictation (the screens' own notes stay theirs). It says why the
   mic did not work, then clears itself. */
function say(bar, text) {
  if (!bar) return;
  const host = bar.parentElement;
  if (!host) return;
  let note = host.querySelector(':scope > .cmp-dict-note');
  if (!note) {
    note = document.createElement('div');
    note.className = 'cmp-note cmp-dict-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    bar.insertAdjacentElement('afterend', note);
  }
  note.textContent = text;
  clearTimeout(note._t);
  note._t = setTimeout(() => { if (note.isConnected) note.remove(); }, 6000);
}

function write(text) {
  const cur = current();
  if (!cur) return;
  const { value, caret } = mergeDictation(active.base, text);
  if (cur.box.value === value) return;
  applying = true;
  cur.box.value = value;
  if (document.activeElement === cur.box) { try { cur.box.setSelectionRange(caret, caret); } catch { /* not a text box */ } }
  // The box grows (keyboard.js), .has-text updates and every screen's own input handler runs, as
  // if the athlete had typed it.
  cur.box.dispatchEvent(new Event('input', { bubbles: true }));
  applying = false;
}

function finish() {
  if (!active) return;
  const cur = current();
  clearTimeout(active.timer);
  if (cur) paintListening(cur.bar, cur.box, false);
  sessions.end(active.sid);
  active = null;
}

/* The device's language for the recognizer (the native side checks it and falls back to en-US). */
const deviceLang = () => {
  try { return (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US'; } catch { return 'en-US'; }
};

/** Stop listening; the recognizer's last words may still arrive, for a moment. */
function stop() {
  if (!active || active.stopping) return;
  active.stopping = true;
  sessions.stopping(active.sid);
  const cur = current();
  if (cur) paintListening(cur.bar, cur.box, false);
  // Always reaches the recognizer: the native side stops this session, or, if it has lost it,
  // aborts whatever is listening.
  try { api() && api().stop(active.sid); } catch { /* the native side is gone: nothing to stop */ }
  // If the end never comes (a dropped bridge message), do not leave a session open.
  active.timer = setTimeout(finish, 1500);
}

/** Stop at once and keep nothing more: the athlete typed, sent, or left. */
function abort() {
  const sid = sessions.leave();
  if (!active) return;
  try { api() && api().abort(sid || active.sid); } catch { /* nothing to abort */ }
  finish();
}

async function start(bar) {
  const b = api();
  const box = bar && bar.querySelector('textarea');
  if (!b || !box || box.disabled) return;
  // The session this tap replaces (a stop still finishing, or another box's mic) is left now; the
  // native side waits for its recognizer to end before it starts the new one.
  if (active) abort();
  const { sid } = sessions.begin(box.id || '');
  const base = splitAtCaret(box.value, box.selectionStart, box.selectionEnd);
  const me = { sid, boxId: box.id || '', box, bar, base, placeholder: box.getAttribute('placeholder') || '', stopping: false, timer: 0 };
  active = me;
  const old = bar.parentElement && bar.parentElement.querySelector(':scope > .cmp-dict-note');
  if (old) old.remove();
  paintListening(bar, box, true);
  let res = null;
  try { res = await b.start(deviceLang(), sid); } catch { res = { ok: false, code: 'failed' }; }
  if (active !== me) { if (res && res.ok) { try { b.abort(sid); } catch { /* gone */ } } return; }
  // 'busy' is a later tap overtaking this one on the native side; that tap owns the next session.
  if (res && !res.ok && res.code === 'busy') { if (active === me) finish(); return; }
  if (!res || !res.ok) {
    const cur = current();
    finish();
    say(cur ? cur.bar : bar, dictationMessage(res && res.code));
    // Refused for good (denied) keeps the mic: tapping it is how the athlete finds out why. A phone
    // that cannot recognise at all loses it.
    if (res && res.code === 'unavailable') document.documentElement.classList.remove('can-dictate');
  }
}

/* The native side's voice. Events for a session that has already ended are dropped. */
function onDictation(ev) {
  if (!ev || !active || !sessions.accepts(ev) || ev.sid !== active.sid) return;
  if (ev.type === 'text') { write(ev.text); return; }
  if (ev.type === 'level') {
    const cur = current();
    if (cur && cur.bar && !active.stopping) cur.bar.style.setProperty('--cmp-mic-level', String(Math.max(0, Math.min(1, Number(ev.value) || 0))));
    return;
  }
  if (ev.type === 'error') {
    const cur = current();
    if (!(active.stopping && ev.code === 'no-speech')) say(cur ? cur.bar : null, dictationMessage(ev.code));
    return;
  }
  if (ev.type === 'end') finish();
}

/** Harness seam: the id of the session the page is listening in, or null. */
export function currentDictationSid() { return active ? active.sid : null; }

/** Harness and test seam: stand in for the native side ({ available, start, stop, abort }). */
export function setDictationBackendForHarness(b) {
  backend = b || null;
  return probe();
}

export function initDictation() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  window.__onDictation = onDictation;

  // Keep the keyboard where it is: a mic tap must not take focus from the box being typed in.
  document.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.composer .cmp-mic')) e.preventDefault();
  }, true);

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const mic = t.closest('.composer .cmp-mic');
    if (mic) {
      e.preventDefault();
      const bar = mic.closest('.composer');
      if (active && active.bar === bar && !active.stopping) stop();
      else void start(bar);
      return;
    }
    // Sending (or asking the AI) while the last words are still arriving: what is on screen is
    // what goes, and nothing lands in the box after it has been cleared.
    if (active && t.closest('.send, .ai-ask') && t.closest('.composer') === active.bar) abort();
  }, true);

  // Typing takes over from dictation, as it does on the phone's own keyboard.
  document.addEventListener('input', (e) => {
    if (!applying && active && e.target === active.box) abort();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Enter' && !e.isComposing && e.target === active.box) abort();
  }, true);

  // Leaving the screen or the app ends listening. Even with no session on the page, a phone that
  // can dictate tells the native side to abort: whatever the page may have lost track of, no
  // microphone outlives the screen it was opened on.
  const leaveAll = () => {
    if (active) { abort(); return; }
    if (!document.documentElement.classList.contains('can-dictate')) return;
    try { api() && api().abort(); } catch { /* nothing to abort */ }
  };
  window.addEventListener('hashchange', leaveAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) leaveAll(); });

  void probe();
}
