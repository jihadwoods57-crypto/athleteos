/* ===== Soft-keyboard mechanics — one place, every composer (2026-08-11) =====

   This replaces nothing, because there was nothing: the proto had no keyboard handling at all and
   inherited the platform default, which is the wrong behaviour for an app.

   In WKWebView the LAYOUT viewport does not shrink when the keyboard comes up. iOS draws the keys
   over the bottom of it and then scrolls the whole DOCUMENT to drag the focused field out from
   under them. The shell is exactly one viewport tall, so that scroll has nothing spare to give:
   reaching a 48px composer costs the header, the back button and the top of the meal. That is the
   "tapping Ask about this meal pushes the app up" report.

   The model here is the one every native app uses: while the keyboard is up, the app is a SHORTER
   app. The keyboard's height is measured off visualViewport, published as `--kb`, and the shell is
   laid out inside what is left (see .device in app.css). Nothing moves that the athlete did not
   ask to move — the header stays put, the tab bar steps aside because it has no business sitting
   between a composer and the keys, and the end of the conversation comes to rest on top of them.

   Android needs no measuring: `softwareKeyboardLayoutMode: resize` (Expo's default) plus
   `interactive-widget=resizes-content` in index.html's viewport meta shrink the layout viewport
   itself, so `--kb` stays 0 there and the shell is already the right size. The FOCUS half of this
   file — deciding where the scroller should rest — runs on both platforms, and the "is it open"
   test below reads BOTH signals so neither platform needs its own branch anywhere else.

   Desktop (the 402px frame at :8124) has no keyboard: overlap is 0, nothing shrinks, `kb-open`
   never sets, and every rule below stays inert.

   ===== ONE MOTION (2026-09-23) =====
   Founder: "when i press 'ask about this meal' to pull up the keyboard, that transition isn't
   smooth. It's glitchy." Three separate things moved, at three different moments:
     1. WKWebView's own reveal scrolled the whole WebView up the instant the keys started to
        rise (its UIScrollView, which no amount of `overflow: hidden` stops), and pinShell() could
        only undo it a frame later: the page jumped up and snapped back.
     2. The shell only learned the keyboard's height from a visualViewport `resize`, which WebKit
        delivers once the keys have ARRIVED. So the keys slid up over the composer first, and the
        app shrank afterwards, over its own 220ms: the composer's move came second.
     3. reveal() scrolled the conversation to the end twice, once against the still-tall box and
        again 260ms later once it had shrunk. That second scroll was a third, visible move.
   Plus, on the meal page, the dock's padding, its sticky offset and the "Back to Home" foot all
   switched in one frame on `kb-open`.
   Now: the native shell (src/proto/ProtoApp.tsx) forwards iOS's keyboardWillShow/WillHide, which
   carry the final height and the animation's duration, BEFORE the keys move, through
   window.__nativeKeyboard. The shell starts shrinking on the same frame the keys start rising,
   over the same duration, on the keyboard's own curve (--kb-ms / --kb-ease). The WebView's own
   scroll is disabled natively (scrollEnabled={false} on iOS), so there is no shove to undo. And
   a conversation that was resting on its newest message is held there EVERY FRAME of that
   motion (followKeyboard) instead of being scrolled once before and once after. The
   visualViewport path below still runs; with the native numbers in, it agrees and moves nothing. */

let started = false;
let restH = 0;      // window.innerHeight with no keyboard — the app's full height
let kb = 0;         // px of the layout viewport the keyboard is covering (0 on Android)
let openNow = false;
let frame = 0;
/* The native shell's word on the keyboard, when there is one: px covered, or null before the first
   event (web, desktop, or an Android shell, which resizes the WebView instead). Authoritative over
   visualViewport while set, because it arrives at the START of the keys' animation. */
let nativeKb = null;
let kbMs = 250;     // the current keyboard animation's duration (iOS reports it; 250 is its usual)
let dropTimer = 0;

/* Fields that raise a keyboard. Buttons, checkboxes and the composer's own hidden file input are
   <input> too, and focusing them must not resize the app. */
const TEXTY = /^(|text|search|email|url|tel|number|password)$/i;
/* Controls that open a NATIVE PICKER instead of a keyboard: a wheel or a calendar that covers the
   bottom of the screen exactly like the keys do, and that the shell therefore has to resize for in
   exactly the same way. `time` was the miss that mattered: "Schedule a commitment" is built from
   three of them plus a <select>, so on that screen focusin bailed out for every control on the
   form and the only thing left updating --kb was a visualViewport event. --kb drives
   `.device { height: calc(100dvh - var(--kb)) }`, so a --kb that sticks collapses the shell, and a
   collapsed shell cannot be scrolled or tapped. */
const PICKER = /^(time|date|datetime-local|month|week)$/i;

function isField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'textarea') return !el.disabled && !el.readOnly;
  // A <select> raises a native picker over the page and owes the shell the same resize a keyboard
  // does. It has no readOnly, only disabled.
  if (tag === 'select') return !el.disabled;
  if (tag !== 'input') return false;
  const type = el.getAttribute('type') || '';
  return !el.disabled && !el.readOnly && (TEXTY.test(type) || PICKER.test(type));
}

/* How much of the layout viewport the keyboard is covering. Positive only where the keys are drawn
   OVER the page (iOS); Android resizes the WebView instead, so this is 0 there and the shrink test
   in sync() is what fires. The 60px floor throws away the hardware-keyboard accessory bar and
   sub-pixel rounding, neither of which is a keyboard the app should resize for. */
function overlap() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const px = Math.round(window.innerHeight - vv.height - vv.offsetTop);
  return px > 60 ? px : 0;
}

/* The browser's own "reveal the focused field" does not stop at the document: it walks EVERY
   scrollable ancestor, and `overflow: hidden` still counts as one. Measured headless, focusing the
   composer scrolled `.screen` itself by 98px — the status bar and the meal's own header went off
   the top of the app. Same shove as the document one, one box further in, and invisible to any
   amount of reading the CSS.

   .viewport is the app's ONLY legitimate scroller. Everything from it up to <body> is chrome and
   has no business moving, ever, for any reason. */
function pinShell() {
  if (window.scrollY || window.pageYOffset) window.scrollTo(0, 0);
  const vp = document.querySelector('.viewport');
  for (let n = vp && vp.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollTop) n.scrollTop = 0;
    if (n.scrollLeft) n.scrollLeft = 0;
  }
}

/* Where the scroller should come to rest. Called when the keyboard opens, and again whenever its
   height changes under an open keyboard (the predictive-text bar appearing is a real resize). */
function revealAt() {
  pinShell();
  const el = document.activeElement;
  const vp = el && el.closest ? el.closest('.viewport') : null;
  if (!vp) return;
  // A composer that ENDS a conversation wants the end of the conversation, not its own 48px box
  // centred in whatever room is left. Bring the newest message down onto the keyboard and the bar
  // arrives with it. (scrollTo clamps itself, so scrollHeight is safe to ask for.) `instant`,
  // because .viewport has `scroll-behavior: smooth` and a smooth reveal on top of the shell's own
  // 220ms height transition reads as two motions; router.js does the same.
  if (el.closest('.composer.at-end')) { vp.scrollTo({ top: vp.scrollHeight, behavior: 'instant' }); return; }
  // Anything else — the food search box, a profile field — only ever gets LIFTED out from under
  // the keys. Never scrolled down: a search bar living at the top of its screen must stay there.
  const bar = el.closest('.composer') || el;
  const under = Math.round(bar.getBoundingClientRect().bottom + 10 - vp.getBoundingClientRect().bottom);
  if (under > 2) vp.scrollTo({ top: vp.scrollTop + under, behavior: 'instant' });
}

/* Twice, and the second one is the one that lands. The shell TRANSITIONS to its shorter height
   (220ms, so the app and the keyboard read as one motion), which means the scroller measured on
   this tick is still the tall one and any scrollTop we ask for is clamped against a maximum that
   is about to grow. Measured headless: the composer came to rest 128px above the keys. So: move
   now, so the motion starts with the keyboard, and settle once the box has stopped changing.
   Both passes are idempotent — the second is a no-op whenever the first already landed. */
let settle = 0;
function reveal() {
  revealAt();
  clearTimeout(settle);
  settle = setTimeout(revealAt, kbMs + 20);
}

/** Should the conversation stay resting on its newest message while the app changes height?
 *  Yes when the box being typed in ENDS a conversation, or when the reader was already at the end
 *  (within 120px, the same slack scrollThreadToEnd gives the thread poll). A reader scrolled up
 *  into an older message is left exactly where they are: only the bar moves for them. Pure, and
 *  exported for keyboard-motion.test.mjs. */
export function shouldHoldEnd({ atEndComposer = false, scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  if (atEndComposer) return true;
  return scrollHeight - clientHeight - scrollTop <= 120;
}

/* The follow: for the length of the keyboard's own animation, every frame, a conversation that was
   resting on its newest message is put back on it. The shell is shrinking (or growing) under it on
   a CSS transition, so its scroll range changes every frame; pinning each frame is what makes the
   newest message ride the top of the keys in the SAME motion as the bar, instead of the old
   scroll-now-and-again-in-260ms, which was the third move in the founder's report. */
let followUntil = 0;
let followRaf = 0;
function followKeyboard() {
  pinShell();
  const el = document.activeElement;
  const vp = (el && el.closest && el.closest('.viewport')) || document.querySelector('.viewport');
  if (!vp) return;
  const atEndComposer = !!(el && el.closest && el.closest('.composer.at-end'));
  // Any OTHER field (the food search at the top of its screen, a profile form) is only ever lifted
  // clear of the keys once they land, never carried to the end: that is revealAt()'s rule.
  if (isField(el) && !atEndComposer) { if (openNow) reveal(); return; }
  const hold = shouldHoldEnd({
    atEndComposer, scrollTop: vp.scrollTop, scrollHeight: vp.scrollHeight, clientHeight: vp.clientHeight,
  });
  if (!hold) return;
  followUntil = performance.now() + kbMs + 80;
  cancelAnimationFrame(followRaf);
  const step = () => {
    if (!vp.isConnected) return;
    pinShell();
    vp.scrollTo({ top: vp.scrollHeight, behavior: 'instant' });
    if (performance.now() < followUntil) followRaf = requestAnimationFrame(step);
  };
  step();
}

function publishKb(px) {
  kb = px;
  document.documentElement.style.setProperty('--kb', `${kb}px`);
}

function sync() {
  frame = 0;
  const focused = isField(document.activeElement);
  // Re-baseline only upward and only while nothing is typing: focusout fires BEFORE the keyboard
  // finishes leaving, so a plain assignment here would record the shrunken height as "full" and
  // Android would never detect a keyboard again.
  if (!focused) restH = Math.max(restH, window.innerHeight);

  // A keyboard with nothing focused cannot exist for long. If the native "will hide" were ever
  // lost, the shell would stay short (see native-pickers-collapse-the-shell); give focus a moment
  // to move to the next field, then let the shell have its height back.
  clearTimeout(dropTimer);
  if (nativeKb && !focused) {
    dropTimer = setTimeout(() => { if (!isField(document.activeElement)) { nativeKb = 0; schedule(); } }, 800);
  }

  const over = nativeKb != null ? nativeKb : overlap();
  // Either signal counts. iOS keeps `over` positive for the whole close animation, which is what
  // keeps the tab bar from stepping back in over a keyboard that is still on screen.
  const open = over > 0 || (focused && restH - window.innerHeight > 60);

  const moved = over !== kb;
  if (moved) publishKb(over);
  const flipped = open !== openNow;
  if (flipped) { openNow = open; document.body.classList.toggle('kb-open', open); }
  if (flipped || moved) followKeyboard();
  if (open || focused) pinShell();
}

/* The native shell's keyboard channel (ProtoApp.tsx injects the call). `px` is how much of the
   WebView the keys will cover once they land, `ms` how long iOS will take to get them there.
   Handled NOW, not on the next frame: this call is the head start the whole motion depends on. */
function nativeKeyboard(px, ms) {
  const h = Math.max(0, Math.round(Number(px) || 0));
  const d = Math.round(Number(ms));
  if (d > 0 && d < 1000) {
    kbMs = d;
    document.documentElement.style.setProperty('--kb-ms', `${d}ms`);
  }
  nativeKb = h > 60 ? h : 0;
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  sync();
}

function schedule() { if (!frame) frame = requestAnimationFrame(sync); }

/** Bring a conversation's newest message into view above the composer.
 *
 *  `.thread` is a plain flex column, NOT a scroller — the screen's only scroller is #viewport.
 *  Which is why `threadEl.scrollTop = threadEl.scrollHeight`, written in two thread screens, has
 *  always been a no-op: sending a message never actually moved the conversation.
 *
 *  Unforced, this only re-pins a reader who was already at the end, so the 15s thread poll can
 *  never yank someone out of a paragraph they are halfway through. `force` is for the one moment
 *  it should always happen: the athlete just sent something and wants to see it land. */
export function scrollThreadToEnd(anchor, { force = false } = {}) {
  if (!anchor) return;
  // Callers hand this whatever they have to hand: a node inside the screen (the thread) or the
  // screen's own root, which in a mount() is #device and therefore CONTAINS the viewport rather
  // than sitting inside it. Both resolve to the same one scroller.
  const vp = (anchor.closest && anchor.closest('.viewport'))
    || (anchor.querySelector && anchor.querySelector('.viewport'))
    || null;
  if (!vp) return;
  const end = vp.scrollHeight - vp.clientHeight;
  if (!force && end - vp.scrollTop > 120) return;
  vp.scrollTo({ top: end, behavior: 'instant' });
}

/** Focus a composer and bring the conversation to it. Used by the quick actions and the
 *  breakdown's "flag it" link, which prefill the box the athlete is about to type in. */
export function focusComposer(input) {
  if (!input) return;
  input.focus();
  // The keyboard has not opened yet on this tick; sync() reveals once it has. This handles the
  // already-open case (moving between fields) and the no-keyboard case (desktop) on its own.
  requestAnimationFrame(() => { if (input.isConnected) reveal(); });
}

/* ===== The message box grows (2026-09-03) =====

   A conversation-ending composer is a one-row <textarea> (components.js). The phone's own
   Messages box wraps what you type and grows a line at a time, up to a ceiling, then scrolls
   inside itself; this is that, for every composer at once, from one delegated listener.

   Height comes off scrollHeight rather than a line count, so a wrapped long word and a real
   newline both measure right. The ceiling is the stylesheet's max-height (screens.css), read back
   rather than duplicated here, once per focus: getComputedStyle on every keystroke forces a
   style flush, and the ceiling does not change while a box has focus. `.has-text` is what dims
   the send button while the box is empty, and `.overflow` is the textarea being told it may
   scroll now. */
const MAX_H = new WeakMap();
function maxHeightOf(ta) {
  let max = MAX_H.get(ta);
  if (max == null) { max = parseInt(getComputedStyle(ta).maxHeight, 10) || 130; MAX_H.set(ta, max); }
  return max;
}
function fitComposer(ta) {
  if (!ta || ta.tagName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  const max = maxHeightOf(ta);
  const want = ta.scrollHeight;
  ta.style.height = `${Math.min(want, max)}px`;
  ta.classList.toggle('overflow', want > max);
  const bar = ta.closest('.composer');
  if (bar) bar.classList.toggle('has-text', ta.value.trim().length > 0);
  // A box that just grew by a line pushes the end of the conversation down; keep it resting on
  // the keys. Unforced, so a reader who scrolled up to quote something is not yanked back.
  if (openNow && bar && bar.classList.contains('at-end')) scrollThreadToEnd(bar);
}

/* Typing fires `input`, but clearing the box after a send (`input.value = ''`, in seven screens)
   fires nothing — and a four-line box that stayed four lines tall after sending is exactly the
   kind of thing the founder notices. Rather than teach seven screens a reset call, the box is
   watched while it has focus: one cheap frame callback comparing the value it last fitted. It
   stops itself on blur, after one last fit. */
let fitFrame = 0;
function watchComposer(ta) {
  cancelAnimationFrame(fitFrame);
  MAX_H.delete(ta); // a fresh focus re-reads the ceiling (the stylesheet may have changed with the screen)
  let last = ta.value;
  fitComposer(ta);
  const tick = () => {
    if (!ta.isConnected) return;
    if (document.activeElement !== ta) { fitComposer(ta); return; }
    if (ta.value !== last) { last = ta.value; fitComposer(ta); }
    fitFrame = requestAnimationFrame(tick);
  };
  fitFrame = requestAnimationFrame(tick);
}

const isComposerBox = (el) => !!(el && el.matches && el.matches('.composer textarea'));

export function initKeyboard() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  restH = window.innerHeight;
  // The native shell calls this from keyboardWillShow / keyboardWillHide (ProtoApp.tsx). On the
  // web, and on a shell that predates it, nothing ever calls it and visualViewport carries on.
  window.__nativeKeyboard = nativeKeyboard;

  document.addEventListener('input', (e) => { if (isComposerBox(e.target)) fitComposer(e.target); });
  // Enter SENDS in a conversation (the return key reads Send, enterkeyhint), which is what every
  // per-screen handler already does on keydown; in a textarea that same keystroke would also
  // insert a newline first, so it is suppressed here. Shift+Enter is the newline, and it is
  // stopped before it reaches the screen's handler so it never doubles as a send. An IME
  // composition's Enter is choosing a character and is left alone on both counts.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !isComposerBox(e.target)) return;
    if (!e.target.closest('.composer.at-end')) return;
    if (e.shiftKey) { e.stopPropagation(); return; }
    e.preventDefault();
  }, true);

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  }
  window.addEventListener('resize', schedule);
  // Rotation changes the app's real height, so the baseline has to be thrown away rather than
  // maxed against a taller portrait value that no longer exists.
  window.addEventListener('orientationchange', () => { restH = 0; schedule(); });
  window.addEventListener('focusin', (e) => {
    if (isComposerBox(e.target)) watchComposer(e.target);
    if (!isField(e.target)) return;
    // Synchronously, before this frame paints: the browser's reveal runs on focus, which is BEFORE
    // the visualViewport resize that tells us a keyboard exists. Waiting for that would let the
    // shove render for a frame or two.
    pinShell();
    schedule();
    requestAnimationFrame(() => { pinShell(); if (openNow) reveal(); });
  });
  window.addEventListener('focusout', schedule);
  /* The recovery path, and the reason it exists: --kb is only ever recomputed inside sync(), which
     runs off visualViewport and focus events. If any one of those fails to arrive — a native picker
     dismissed in a way that reports no resize, an interrupted animation — --kb keeps its last value
     and the shell stays short with no way back. Returning to the app re-measures unconditionally,
     so a stuck shell can always be recovered by leaving and coming back. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    restH = 0;
    // Coming back with nothing focused means no keyboard, whatever the last native word was.
    if (nativeKb && !isField(document.activeElement)) nativeKb = 0;
    schedule();
  });
  window.addEventListener('pageshow', schedule);
  // Capture, because `scroll` does not bubble and the box being shoved is `.screen`, not the
  // window. Cheap: pinShell only writes to elements that have actually been moved.
  document.addEventListener('scroll', () => {
    if (openNow || isField(document.activeElement)) pinShell();
  }, { capture: true, passive: true });

  // The whole pill is the message box, exactly as it is in Messages: a tap on the pill's own
  // ground — the padding left of send, the empty run right of a short sentence, the search
  // bar's decorative magnifier — focuses the field inside it. Without this those are dead
  // zones INSIDE the thing that looks like a text box, and the field itself (30px tall in a
  // 40px pill) is the only way in. Buttons inside the pill (send, the AI sparkle) keep their
  // own taps.
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    const field = t.closest('.composer .field');
    if (!field) return;
    const box = field.querySelector('textarea, input');
    if (box && !box.disabled) focusComposer(box);
  });

  // Touching empty ground puts the keyboard away — the gap between two bubbles, or the scroller
  // itself. Deliberately only those two: a tap on a control is not a request to stop typing, and
  // matching on the container's own class (rather than "anything that isn't a button") means a
  // long-press tapback, a chip and a photo all keep the keyboard exactly where it was.
  document.addEventListener('pointerdown', (e) => {
    if (!openNow) return;
    const t = e.target;
    if (!t || !t.classList) return;
    if (!t.classList.contains('viewport') && !t.classList.contains('thread')) return;
    const a = document.activeElement;
    if (a && typeof a.blur === 'function') a.blur();
  }, true);

  sync();
}
