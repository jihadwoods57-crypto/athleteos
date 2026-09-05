/* ===== Navigation gestures — the finger moves the screen (2026-09-03) =====

   Two gestures, and only two, because a swipe has to MEAN the same thing every time it works and
   never work where it would mean nothing:

     BACK   A drag that begins at the left edge of a pushed screen. The screen follows the finger
            off to the right and the screen it was pushed from sits underneath, brightening as it
            is uncovered — the exact picture js/view-transition.js paints for a pop, with the
            timeline handed to the thumb. This is the one gesture every iPhone has taught since
            2013 and the one a user tries first.

     PAGE   A drag anywhere on a screen that declares a sibling strip (`subs` on the module; Plan's
            Overview / Nutrition / Requirements / Food Memory). The content under the strip moves
            with the finger and the neighbouring tab's content comes in beside it. The strip
            itself stands still, for the reason view-transition.css already gives: the frame is
            not moving, only what is in it. The bottom tab bar deliberately does NOT page — iOS
            never has, and a horizontal drag on Home is a real scroll through the meal rail.

   Everything that is NOT a gesture is decided before a pixel moves: a drag that begins inside a
   horizontal scroller, over a text field, under an open keyboard, on a flow interstitial or the
   camera, or while a view transition is still travelling. Once the axis is decided (AXIS_LOCK),
   a vertical drag is released to the browser untouched; only a horizontal one is claimed.

   The router owns what the gestures cannot know — what "back" is, what a route renders, how a
   navigation commits — and hands it in through initGestures(api). This file never imports it.
   The commit itself is a normal navigation with the direction 'swipe', which the router reads as
   "already animated, arrive with no second entrance".

   The pure decisions (axisOf, shouldCommit, lateralTarget, eligibility) are exported so
   gestures.test.mjs can hold them still. */

/** Width of the left-edge zone a back drag may begin in. */
export const EDGE = 28;
/** Movement before the drag's axis is decided. */
export const AXIS_LOCK = 8;

/** 'x', 'y', or null while the finger has not moved enough to tell. A diagonal is a scroll —
 *  losing a scroll to a gesture is the worse failure, so horizontal has to win clearly. */
export function axisOf(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < AXIS_LOCK && ay < AXIS_LOCK) return null;
  return ax > ay * 1.3 ? 'x' : 'y';
}

/** Whether a released drag is a navigation. Distance past a third of the width, or a flick —
 *  velocity in px/ms, with a floor so a twitch is never a flick. `dir` is the direction that
 *  counts as forward for this gesture: +1 for back (rightward), −1 for the next page. */
export function shouldCommit({ dx, dt, width, dir = 1 }) {
  const d = dx * dir;
  if (d <= 0) return false;
  const v = d / Math.max(dt, 1);
  return d > width * 0.34 || (v > 0.55 && d > 30);
}

/** The sibling a drag of `dx` reaches from `cur`, or null past either end. Leftward (negative)
 *  goes to the NEXT tab, which is the way every pager on the phone reads it. No sub is the first
 *  tab, exactly as the router's lateralStep reads a bare route. */
export function lateralTarget(subs, cur, dx) {
  const i = subs.includes(cur) ? subs.indexOf(cur) : 0;
  const n = dx < 0 ? i + 1 : i - 1;
  return n >= 0 && n < subs.length ? subs[n] : null;
}

/** A screen you may swipe away: not a flow interstitial, not the full-bleed camera. */
export function eligibleBack(mod) {
  return !!mod && !mod.transient && !mod.bleed;
}

/** A screen that pages sideways: one with at least two siblings on its strip. */
export function eligibleLateral(mod) {
  return !!mod && Array.isArray(mod.subs) && mod.subs.length > 1;
}

/* The nearest ancestor that scrolls horizontally on its own and has somewhere to scroll to. A
   drag that starts inside one belongs to it. */
function horizontalScroller(el, stop) {
  for (let n = el; n && n !== stop && n.nodeType === 1; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      let ox = '';
      try { ox = getComputedStyle(n).overflowX; } catch { /* detached */ }
      if (ox === 'auto' || ox === 'scroll') return n;
    }
  }
  return null;
}

const SETTLE_MS = 260;
const DIM = 0.45;      // how dark the uncovered screen starts (matches --vt-dim's read of "behind")
const RECEDE = 32;     // % the uncovered screen sits back, matching vtRecedeIn

function reducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/* Run `fn` once the settle transition has landed, whether or not transitionend fires (it does
   not under reduced motion, or when the element is torn down mid-flight). Exactly once. */
function afterSettle(el, fn) {
  let done = false;
  const once = () => { if (done) return; done = true; fn(); };
  if (reducedMotion()) { once(); return; }
  el.addEventListener('transitionend', once, { once: true });
  setTimeout(once, SETTLE_MS + 40);
}

let started = false;

/* A drag or its settle in flight. The router needs this for two things the api can't tell it:
   hold same-route repaints while a finger owns the screen (a thread poll that repaints mid-drag
   detaches the layers under the finger), and refuse a new gesture during the 260ms commit settle
   (the pop happens in afterSettle, so a second flick in that window re-armed against the same
   not-yet-popped target and popped the stack twice). */
let ACTIVE = false;
let AFTER = [];
function setActive(v) {
  if (ACTIVE === v) return;
  ACTIVE = v;
  if (!v) { const q = AFTER; AFTER = []; for (const f of q) { try { f(); } catch { /* resume is best-effort */ } } }
}
export function gestureActive() { return ACTIVE; }
/** Run once, the next time no gesture is active (immediately if none is). */
export function afterGesture(fn) { if (!ACTIVE) { fn(); return; } AFTER.push(fn); }

/**
 * Wire the two gestures onto #device. `api` is the router's view of the world:
 *   device()            the #device element
 *   busy()              true while a view transition is travelling
 *   current()           { route, sub, mod } for the screen on show
 *   backTarget()        { route, scroll, fallback? } for what Back would show, or null
 *   shell(route)        the inner markup of a .screen for that route (statusbar+viewport+tabbar),
 *                       or null when it cannot be rendered
 *   back(fallback)      commit a back navigation as a swipe
 *   lateral(target)     commit a sideways navigation as a swipe
 *   renderSub(sub)      the current module's markup for one of its siblings
 */
export function initGestures(api) {
  if (started || typeof document === 'undefined' || typeof window === 'undefined') return;
  started = true;
  const device = api.device();
  if (!device) return;

  let g = null;   // the drag in progress, or null

  const blocked = () => {
    if (ACTIVE) return true;   // a drag or its commit settle owns the screen; no re-arm mid-flight
    if (document.body.classList.contains('kb-open')) return true;
    if (document.querySelector('.tour, .imgview, .memsheet, .tapback, .lockstamp, .sheet-scrim')) return true;
    return !!api.busy();
  };

  device.addEventListener('touchstart', (e) => {
    // A live drag interrupted by ANY new touch (a second finger, a palm) is settled back to
    // rest, not orphaned: `g = null` alone left the held screen translated and the under-layer
    // in the DOM with pointer-events off — a dead strip until the next full repaint.
    if (g) { const s = g; g = null; if (s.live) (s.kind === 'back' ? finishBack : finishPage)(s, 1e9, true); }
    if (e.touches.length !== 1 || blocked()) return;
    const t = e.touches[0];
    const target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const rect = device.getBoundingClientRect();
    const x = t.clientX - rect.left;
    const cur = api.current();
    const hs = horizontalScroller(target, device);
    let kind = null;
    // The edge wins over a rail sitting at its own left edge, as it does on the phone; a rail that
    // has already been scrolled is the thing the finger is on.
    if (x <= EDGE && eligibleBack(cur.mod) && api.backTarget() && !(hs && hs.scrollLeft > 0)) kind = 'back';
    // .viewport, not #view: the header note above promises "a drag anywhere on a screen with a
    // sibling strip", but on a short tab (Food Memory with two rows) most of the screen is
    // viewport padding below #view, where the pager silently refused to arm.
    else if (!hs && eligibleLateral(cur.mod) && target.closest('.viewport')) kind = 'page';
    if (!kind) return;
    g = { kind, x0: t.clientX, y0: t.clientY, t0: e.timeStamp || Date.now(), axis: null, width: rect.width, cur, dx: 0, live: false };
  }, { passive: true });

  device.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.axis) {
      g.axis = axisOf(dx, dy);
      if (!g.axis) return;
      // Vertical: the browser's scroll, untouched. Nothing was prevented before this point.
      if (g.axis === 'y') { g = null; return; }
      if (g.kind === 'back' && dx < 0) { g = null; return; }
      const armed = g.kind === 'back' ? armBack(g) : armPage(g, dx);
      if (!armed) { g = null; return; }
    }
    e.preventDefault();
    g.dx = dx;
    if (g.kind === 'back') moveBack(g, dx); else movePage(g, dx);
  }, { passive: false });

  const release = (e, cancelled) => {
    if (!g) return;
    const s = g; g = null;
    if (!s.live) return;
    const dt = (e.timeStamp || Date.now()) - s.t0;
    if (s.kind === 'back') finishBack(s, dt, cancelled); else finishPage(s, dt, cancelled);
  };
  device.addEventListener('touchend', (e) => release(e, false));
  device.addEventListener('touchcancel', (e) => release(e, true));

  /* ---- BACK: the screen you came from is rendered underneath, and the finger uncovers it ---- */
  function armBack(s) {
    const screen = device.querySelector('.screen:not(.under)');
    const target = api.backTarget();
    if (!screen || !target) return false;
    let html = null;
    try { html = api.shell(target.route); } catch { html = null; }
    const under = document.createElement('div');
    under.className = 'screen under';
    under.setAttribute('aria-hidden', 'true');
    // Rendered from the same modules the router uses, straight from state: it is a picture of
    // where Back goes, and the real render replaces it the moment the navigation commits. A
    // module that cannot render from cold state leaves the canvas showing, which is still honest.
    under.innerHTML = html || '';
    const dim = document.createElement('div');
    dim.className = 'gesture-dim';
    under.appendChild(dim);
    device.insertBefore(under, screen);
    const uvp = under.querySelector('.viewport');
    if (uvp) uvp.scrollTop = target.scroll || 0;
    screen.classList.add('gesturing');
    Object.assign(s, { screen, under, dim, target, live: true });
    setActive(true);
    return true;
  }
  function paintBack(s, dx) {
    const x = Math.max(0, dx);
    const p = Math.min(1, x / s.width);
    s.screen.style.transform = `translate3d(${x}px, 0, 0)`;
    s.under.style.transform = `translate3d(${-RECEDE * (1 - p)}%, 0, 0)`;
    s.dim.style.opacity = String(DIM * (1 - p));
  }
  function moveBack(s, dx) { paintBack(s, dx); }
  function finishBack(s, dt, cancelled) {
    const commit = !cancelled && shouldCommit({ dx: s.dx, dt, width: s.width, dir: 1 });
    s.screen.classList.add('settling');
    s.under.classList.add('settling');
    paintBack(s, commit ? s.width : 0);
    afterSettle(s.screen, () => {
      if (commit) {
        // The router's render replaces #device's children, which takes the under-layer with it.
        try { api.back(s.target.fallback); } finally { setActive(false); }
        return;
      }
      s.under.remove();
      s.screen.classList.remove('gesturing', 'settling');
      s.screen.style.transform = '';
      setActive(false);
    });
  }

  /* ---- PAGE: the strip's content drags, and the neighbour's content comes in beside it ---- */
  function armPage(s, dx) {
    const view = device.querySelector('#view');
    const pane = view && view.querySelector('.pane');
    if (!pane) return false;
    const target = lateralTarget(s.cur.mod.subs, s.cur.sub, dx);
    if (!target) return false;
    let html = '';
    try { html = api.renderSub(target) || ''; } catch { html = ''; }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const peek = tmp.querySelector('.pane');
    if (!peek) return false;
    const dir = dx < 0 ? -1 : 1;   // −1: the next tab arrives from the right
    view.classList.add('paging');
    peek.classList.add('peek');
    peek.setAttribute('aria-hidden', 'true');
    peek.style.top = `${pane.offsetTop}px`;
    view.appendChild(peek);
    const w = pane.offsetWidth || s.width;
    Object.assign(s, { view, pane, peek, target, dir, w, live: true });
    setActive(true);
    paintPage(s, 0);
    return true;
  }
  function paintPage(s, dx) {
    const x = s.dir < 0 ? Math.min(0, dx) : Math.max(0, dx);
    s.pane.style.transform = `translate3d(${x}px, 0, 0)`;
    s.peek.style.transform = `translate3d(${-s.dir * s.w + x}px, 0, 0)`;
  }
  function movePage(s, dx) { paintPage(s, dx); }
  function finishPage(s, dt, cancelled) {
    const commit = !cancelled && shouldCommit({ dx: s.dx, dt, width: s.w, dir: s.dir });
    s.pane.classList.add('settling');
    s.peek.classList.add('settling');
    paintPage(s, commit ? s.dir * s.w : 0);
    afterSettle(s.pane, () => {
      if (commit) {
        try { api.lateral(`${s.cur.route}/${s.target}`); } finally { setActive(false); }
        return;
      }
      s.peek.remove();
      s.view.classList.remove('paging');
      s.pane.classList.remove('settling');
      s.pane.style.transform = '';
      setActive(false);
    });
  }

  /* ---- The scroll edge: a header turns to glass once content is passing under it ---- */
  // `scroll` does not bubble; capture on the document reaches every #viewport the router paints.
  document.addEventListener('scroll', (e) => {
    const vp = e.target;
    if (!vp || vp.id !== 'viewport') return;
    const head = vp.querySelector('.back-head');
    // Hysteresis: the collapse changes the header's in-flow height, which moves scrollTop, which
    // can re-cross a single threshold and flicker. Collapse late (24), expand early (4) — the
    // 20px dead band is bigger than any height change the collapse itself causes.
    if (head) head.classList.toggle('stuck', vp.scrollTop > (head.classList.contains('stuck') ? 4 : 24));
  }, { capture: true, passive: true });
}
