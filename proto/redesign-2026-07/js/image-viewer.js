/* Full-screen photo viewer (spec §6.1): pinch-to-zoom, double-tap zoom, pan while zoomed,
   swipe-down to dismiss, X to dismiss. A pure DOM overlay — no route change, so closing
   always lands on the exact scroll position the viewer opened from. Original image bytes,
   original orientation, no editing controls. */

import { withTransition, canTransition } from './view-transition.js';

let overlay = null;
let opener = null;   // the element that opened the viewer; focus returns to it on close
/* The thumbnail this viewer grew out of, kept separately from `opener`.
 *
 * They are usually the same element and must not be assumed to be: `opener` is whatever had focus,
 * which on a pointer tap can be <body> or an ancestor, and it exists to hand focus back. This one
 * exists to be MORPHED back into, so it has to be the picture itself or the photo appears to shrink
 * into the wrong place. Cleared on close; checked for isConnected before use, because a repaint may
 * have replaced the thumbnail while the viewer was open. */
let cameFrom = null;

function close() {
  if (!overlay) return;
  const o = overlay;
  overlay = null;
  const img = o.querySelector('.iv-img');
  /* `shrinkTo`, not `back` — this function already has a `back` for the focus round-trip below, and
     the two are different things on purpose (see the note on `cameFrom`). */
  const shrinkTo = cameFrom && cameFrom.isConnected ? cameFrom : null;
  cameFrom = null;
  /* Closing is the open played backwards: the full-screen photo shrinks into the thumbnail it came
     from. Under a transition the overlay is torn down SYNCHRONOUSLY inside the update — the fade is
     the transition's job now, and leaving the old 180ms timeout in would remove the element twice. */
  const teardown = () => { o.classList.remove('on'); try { o.remove(); } catch { /* already gone */ } };
  if (shrinkTo && canTransition('overlay')) {
    withTransition({ dir: 'overlay', node: img, nodeAfter: () => shrinkTo }, teardown);
  } else {
    o.classList.remove('on');
    setTimeout(() => { try { o.remove(); } catch { /* already gone */ } }, 180);
  }
  try { document.removeEventListener('keydown', onKey); } catch { /* not attached */ }
  // Round-trip focus: open() moves focus to the close button, so closing must hand it back or
  // a keyboard/reader user is dumped to <body> and loses their place mid-thread.
  const back = opener;
  opener = null;
  if (back && typeof back.focus === 'function') { try { back.focus(); } catch { /* opener left the DOM */ } }
}
function onKey(e) {
  if (e.key === 'Escape') { close(); return; }
  // aria-modal promised AT the background doesn't exist; Tab has to keep that promise too.
  if (e.key === 'Tab' && overlay) {
    const f = overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/** Open the viewer on an image URL (data: or https). Safe to call from any screen. */
export function openImageViewer(src, alt = 'Meal photo', from = null) {
  // One overlay at a time (DESIGN.md): the tour cutout leaves its highlighted element live, so a
  // ringed meal photo could open the viewer under a running tour without this.
  if (!src || overlay || document.querySelector('.tour, .lockstamp, .memsheet')) return;
  cameFrom = from && from.isConnected ? from : null;
  // Record who opened it BEFORE anything moves; close() hands focus back there.
  opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const el = document.createElement('div');
  el.className = 'imgview';
  // Dialog semantics: without these the overlay is announced as plain page content and the
  // screen behind stays in the reading order as far as AT is concerned.
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', alt || 'Photo viewer');
  el.innerHTML = `
    <button class="iv-x" aria-label="Close">×</button>
    <div class="iv-stage"><img class="iv-img" alt="Full-size photo" draggable="false"/></div>`;
  const img = el.querySelector('.iv-img');
  img.src = src; img.alt = alt;
  /* The photo grows out of the thumbnail that was tapped, instead of a black screen fading in over
     it. Two things about that are load-bearing and neither is obvious.
   *
   * `overlay` is claimed HERE, not in mount(). It is what the re-entrancy guard at the top of this
   * function tests, and moving the insertion into a transition callback made that callback
   * ASYNCHRONOUS — so a second click in the same tick still saw `overlay === null` and opened a
   * second viewer. Not hypothetical: the meal thread's hero carries two click listeners, harmless
   * for as long as the guard worked, and it opened the viewer twice the moment the guard stopped.
   * Both copies then claimed `vt-shared`, and a duplicate name aborts the transition entirely. The
   * element already exists; only its insertion is deferred, so the slot can be claimed now.
   *
   * `.on` goes on SYNCHRONOUSLY on the transition path. The browser snapshots the new state at the
   * end of the callback, and the rAF the non-transition path needs (to give the CSS transition a
   * frame to start from) lands after that snapshot — so the overlay would be captured invisible and
   * then fade in twice. */
  overlay = el;
  const mount = (sync) => {
    document.body.appendChild(el);
    if (sync) el.classList.add('on');
    else requestAnimationFrame(() => el.classList.add('on'));
  };
  if (cameFrom && canTransition('overlay')) {
    withTransition({ dir: 'overlay', node: cameFrom, nodeAfter: () => img }, () => mount(true));
  } else {
    mount(false);
  }
  document.addEventListener('keydown', onKey);
  el.querySelector('.iv-x').addEventListener('click', close);
  // Move focus INTO the dialog (the close button is its one real control), mirroring members-sheet.
  try { el.querySelector('.iv-x').focus(); } catch { /* focus is a nicety */ }

  /* ---- gesture state ---- */
  let scale = 1, tx = 0, ty = 0;           // current transform
  let startDist = 0, startScale = 1;       // pinch
  let panX = 0, panY = 0, startTx = 0, startTy = 0; // pan / swipe origin
  let swipeY = 0;                          // swipe-down-to-dismiss accumulator (only at scale 1)
  let lastTap = 0;
  const MAXS = 5;

  const apply = () => {
    // Keep the image from being panned fully off-screen: clamp translation to the scaled overflow.
    const r = el.getBoundingClientRect();
    const boundX = Math.max(0, (scale - 1) * r.width / 2);
    const boundY = Math.max(0, (scale - 1) * r.height / 2);
    tx = Math.min(boundX, Math.max(-boundX, tx));
    ty = Math.min(boundY, Math.max(-boundY, ty));
    img.style.transform = `translate(${tx}px, ${ty + swipeY}px) scale(${scale})`;
  };
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  el.addEventListener('touchstart', (e) => {
    const t = e.touches;
    if (t.length === 2) { startDist = dist(t); startScale = scale; }
    else if (t.length === 1) {
      panX = t[0].clientX; panY = t[0].clientY; startTx = tx; startTy = ty;
      const now = Date.now();
      if (now - lastTap < 300) { // double-tap: toggle 1x ↔ 2.5x centered on the tap
        if (scale > 1) { scale = 1; tx = 0; ty = 0; }
        else {
          scale = 2.5;
          const r = el.getBoundingClientRect();
          tx = (r.width / 2 - t[0].clientX) * (scale - 1) / scale * 1.2;
          ty = (r.height / 2 - t[0].clientY) * (scale - 1) / scale * 1.2;
        }
        // Tokens, not hand-picked numbers: DESIGN.md's Motion section is ease-out only, and 220ms
        // is not one of the three durations. Custom properties resolve in inline styles.
        img.style.transition = 'transform var(--dur-2) var(--ease-out)';
        setTimeout(() => { img.style.transition = ''; }, 300);
        apply();
        lastTap = 0;
        return;
      }
      lastTap = now;
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    const t = e.touches;
    if (t.length === 2) {
      scale = Math.min(MAXS, Math.max(1, startScale * (dist(t) / startDist)));
      if (scale === 1) { tx = 0; ty = 0; }
      apply();
    } else if (t.length === 1) {
      const dx = t[0].clientX - panX, dy = t[0].clientY - panY;
      if (scale > 1) { tx = startTx + dx; ty = startTy + dy; apply(); }
      else if (dy > 0) { // swipe-down at rest → dismiss gesture with follow + fade
        swipeY = dy;
        el.style.opacity = String(Math.max(0.35, 1 - dy / 480));
        apply();
      }
    }
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    if (scale === 1 && swipeY > 110) { close(); return; }
    if (swipeY) { swipeY = 0; el.style.opacity = '1'; img.style.transition = 'transform var(--dur-1) var(--ease-out)'; apply(); setTimeout(() => { img.style.transition = ''; }, 200); }
  });

  // Desktop conveniences (dev / web preview): wheel zoom, double-click zoom, click-outside close.
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(MAXS, Math.max(1, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  el.addEventListener('dblclick', (e) => {
    scale = scale > 1 ? 1 : 2.5;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
    e.preventDefault();
  });
  el.addEventListener('click', (e) => { if (e.target === el || e.target.classList.contains('iv-stage')) close(); });
}

/** Wire every `[data-viewer]` element in a rendered screen: tap opens the viewer on the
 *  element's data-viewer URL (or, for <img>, its current src). Screens call this in mount(). */
export function wireImageViewers(root) {
  root.querySelectorAll('[data-viewer]').forEach((n) => {
    n.style.cursor = 'zoom-in';
    // Keyboard path: these thumbnails are plain elements, so without a tabindex they are
    // pointer-only. Activation rides the router's document-level Enter/Space net (role="button").
    if (!n.hasAttribute('tabindex')) n.setAttribute('tabindex', '0');
    if (!n.hasAttribute('role')) n.setAttribute('role', 'button');
    if (!n.hasAttribute('aria-label') && !(n.tagName === 'IMG' && n.getAttribute('alt'))) n.setAttribute('aria-label', 'View photo full screen');
    n.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = n.getAttribute('data-viewer') || (n.tagName === 'IMG' ? n.src : '');
      // `n` is the thumbnail: the element the photo should grow out of, and shrink back into.
      if (src) openImageViewer(src, 'Meal photo', n);
    });
  });
}
