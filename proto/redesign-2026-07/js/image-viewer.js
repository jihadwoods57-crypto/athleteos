/* Full-screen photo viewer (spec §6.1): pinch-to-zoom, double-tap zoom, pan while zoomed,
   swipe-down to dismiss, X to dismiss. A pure DOM overlay — no route change, so closing
   always lands on the exact scroll position the viewer opened from. Original image bytes,
   original orientation, no editing controls. */

let overlay = null;

function close() {
  if (!overlay) return;
  const o = overlay;
  overlay = null;
  o.classList.remove('on');
  setTimeout(() => { try { o.remove(); } catch { /* already gone */ } }, 180);
  try { document.removeEventListener('keydown', onKey); } catch { /* not attached */ }
}
function onKey(e) { if (e.key === 'Escape') close(); }

/** Open the viewer on an image URL (data: or https). Safe to call from any screen. */
export function openImageViewer(src, alt = 'Meal photo') {
  if (!src || overlay) return;
  const el = document.createElement('div');
  el.className = 'imgview';
  el.innerHTML = `
    <button class="iv-x" aria-label="Close">×</button>
    <div class="iv-stage"><img class="iv-img" alt="" draggable="false"/></div>`;
  const img = el.querySelector('.iv-img');
  img.src = src; img.alt = alt;
  document.body.appendChild(el);
  overlay = el;
  requestAnimationFrame(() => el.classList.add('on'));
  document.addEventListener('keydown', onKey);
  el.querySelector('.iv-x').addEventListener('click', close);

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
        img.style.transition = 'transform 220ms ease';
        setTimeout(() => { img.style.transition = ''; }, 240);
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
    if (swipeY) { swipeY = 0; el.style.opacity = '1'; img.style.transition = 'transform 200ms ease'; apply(); setTimeout(() => { img.style.transition = ''; }, 220); }
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
    n.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = n.getAttribute('data-viewer') || (n.tagName === 'IMG' ? n.src : '');
      if (src) openImageViewer(src);
    });
  });
}
