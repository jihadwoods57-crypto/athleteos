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
   never sets, and every rule below stays inert. */

let started = false;
let restH = 0;      // window.innerHeight with no keyboard — the app's full height
let kb = 0;         // px of the layout viewport the keyboard is covering (0 on Android)
let openNow = false;
let frame = 0;

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
  // arrives with it. (scrollTop clamps itself, so scrollHeight is safe to assign.)
  if (el.closest('.composer.at-end')) { vp.scrollTop = vp.scrollHeight; return; }
  // Anything else — the food search box, a profile field — only ever gets LIFTED out from under
  // the keys. Never scrolled down: a search bar living at the top of its screen must stay there.
  const bar = el.closest('.composer') || el;
  const under = Math.round(bar.getBoundingClientRect().bottom + 10 - vp.getBoundingClientRect().bottom);
  if (under > 2) vp.scrollTop += under;
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
  settle = setTimeout(revealAt, 260);
}

function sync() {
  frame = 0;
  const focused = isField(document.activeElement);
  // Re-baseline only upward and only while nothing is typing: focusout fires BEFORE the keyboard
  // finishes leaving, so a plain assignment here would record the shrunken height as "full" and
  // Android would never detect a keyboard again.
  if (!focused) restH = Math.max(restH, window.innerHeight);

  const over = overlap();
  // Either signal counts. iOS keeps `over` positive for the whole close animation, which is what
  // keeps the tab bar from stepping back in over a keyboard that is still on screen.
  const open = over > 0 || (focused && restH - window.innerHeight > 60);

  const moved = over !== kb;
  if (moved) { kb = over; document.documentElement.style.setProperty('--kb', `${kb}px`); }
  const flipped = open !== openNow;
  if (flipped) { openNow = open; document.body.classList.toggle('kb-open', open); }
  if (open && (flipped || moved)) reveal();
  if (open || focused) pinShell();
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
  vp.scrollTop = end;
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

export function initKeyboard() {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  restH = window.innerHeight;

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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { restH = 0; schedule(); } });
  window.addEventListener('pageshow', schedule);
  // Capture, because `scroll` does not bubble and the box being shoved is `.screen`, not the
  // window. Cheap: pinShell only writes to elements that have actually been moved.
  document.addEventListener('scroll', () => {
    if (openNow || isField(document.activeElement)) pinShell();
  }, { capture: true, passive: true });

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
