/* Drag the thread left to see when each message was sent — the phone's own gesture.
 *
 * WHY. A thread shows the clock only where time actually passed (chat-view.js GROUP_GAP_MS),
 * which is right for reading and wrong for the one moment someone wants to know EXACTLY when a
 * message landed. Messages keeps a per-message time parked off the right edge and slides the
 * whole conversation left to reveal it. So does this.
 *
 * MECHANICS. Every row carries a `.mt` (chat-view.js msgTimeHtml) positioned just past the
 * thread's right edge, where the viewport clips it. A leftward horizontal drag on the thread sets
 * `--rv` (the thread's translateX) and `--rv-a` (the clocks' opacity) on the thread element; on
 * release both spring back. The axis is decided on the first few pixels and stays decided, so a
 * vertical scroll never becomes a reveal halfway down and a reveal never turns into a scroll.
 *
 * WHAT IT STAYS OUT OF. The left EDGE zone belongs to gestures.js (swipe back); a press on a
 * bubble that holds still belongs to tapback.js (it cancels itself once the finger moves past
 * its own slop). Controls inside the thread (chips, buttons, the meal cards) are left alone.
 *
 * Attached to the persistent screen root for the same reason tapback.js is: `#view` is rebuilt
 * on every render, and the gesture must survive a repaint mid-drag. The thread is re-found by
 * `scope` at press time.
 */

/** The left-edge width gestures.js reserves for swipe-back (its EDGE constant, restated here so
 *  this module has no import from a DOM-driving module). */
const EDGE = 28;
/** Pixels of travel before the axis is decided. */
const AXIS_PX = 8;
/** How far the thread may slide. Wide enough for "12:34 PM" plus breathing room. */
const MAX_PX = 68;

const WIRED = new WeakMap();

/**
 * @param {object}  o
 * @param {Element} o.root   the persistent screen root
 * @param {string}  o.scope  selector for the thread element (unique to the screen)
 * @returns {Function} detach
 */
export function wireChatTimes({ root, scope = '.thread' } = {}) {
  if (!root || typeof document === 'undefined') return () => {};
  const prior = WIRED.get(root);
  if (prior) { prior.scope = scope; return prior.detach; }
  const live = { scope, detach: () => {} };
  WIRED.set(root, live);

  let g = null;   // { thread, x0, y0, axis, dx }

  const settle = (thread) => {
    if (!thread) return;
    thread.classList.add('rv-settle');
    thread.style.setProperty('--rv', '0px');
    thread.style.setProperty('--rv-a', '0');
    const done = () => { thread.classList.remove('rv-settle'); thread.removeEventListener('transitionend', done); };
    thread.addEventListener('transitionend', done);
    // A reduced-motion viewer has no transition to end; clear the class on the next frame.
    setTimeout(done, 320);
  };

  const onDown = (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.pointerType === 'mouse' && ev.buttons !== 1) return;
    const t = ev.target;
    const thread = t && t.closest ? t.closest(live.scope) : null;
    if (!thread || !root.contains(thread)) return;
    // Controls own their own taps and drags.
    if (t.closest('button, a, input, textarea, select, [role="button"], .nc-div')) return;
    // The edge belongs to swipe-back.
    const vp = thread.closest('.viewport');
    const left = vp ? vp.getBoundingClientRect().left : 0;
    if (ev.clientX - left <= EDGE) return;
    g = { thread, x0: ev.clientX, y0: ev.clientY, axis: null, dx: 0 };
  };

  const onMove = (ev) => {
    if (!g) return;
    const dx = ev.clientX - g.x0;
    const dy = ev.clientY - g.y0;
    if (!g.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
      // Decided once. A rightward start is not a reveal (there is nothing on the left).
      g.axis = Math.abs(dx) > Math.abs(dy) && dx < 0 ? 'x' : 'y';
      if (g.axis === 'y') { g = null; return; }
      g.thread.classList.remove('rv-settle');
    }
    // Rubber-band past the stop rather than hard-stopping at it.
    const raw = Math.min(0, dx);
    const over = Math.max(0, -raw - MAX_PX);
    const shown = Math.min(MAX_PX, -raw) + over * 0.18;
    g.dx = -shown;
    g.thread.style.setProperty('--rv', `${Math.round(g.dx)}px`);
    g.thread.style.setProperty('--rv-a', String(Math.min(1, shown / (MAX_PX * 0.6))));
    if (ev.cancelable) ev.preventDefault();
  };

  const onUp = () => {
    if (!g) return;
    const thread = g.thread;
    const was = g.axis === 'x';
    g = null;
    if (was) settle(thread);
  };

  // Passive:false on move so a decided horizontal drag can stop the page from also scrolling.
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive: false });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  // touch-action is set here rather than in CSS so a thread that is never wired (the coach's
  // read-only views) keeps the browser's default horizontal behaviour.
  const mark = () => { const th = root.querySelector(live.scope); if (th) th.style.touchAction = 'pan-y'; };
  mark();
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(mark) : null;
  if (mo) mo.observe(root, { childList: true, subtree: true });

  live.detach = () => {
    WIRED.delete(root);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    if (mo) mo.disconnect();
    g = null;
  };
  return live.detach;
}
