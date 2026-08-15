/* Hold-to-commit — the signing-the-contract moment. 1200ms press-and-hold with a fill
   sweep and haptic; reduced-motion users get a plain tap (same meaning, no theater). */
import { icon } from './icons.js';

export function commitButton(committed) {
  if (committed) return `<button class="btn green" id="ob-commit" disabled>${icon('check', 18)}&nbsp; Standard committed</button>`;
  return `<button class="btn primary hold-btn" id="ob-commit"><span class="hold-fill"></span><span class="hold-label">Hold to commit</span></button>`;
}

export function wireCommit(root, onDone) {
  const btn = root.querySelector('#ob-commit');
  if (!btn || btn.disabled) return;
  const fill = btn.querySelector('.hold-fill');
  const HOLD_MS = 1200;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  const done = () => {
    timer = null;
    try { navigator.vibrate && navigator.vibrate(30); } catch { /* no-op */ }
    onDone();
  };
  if (reduced) {
    btn.querySelector('.hold-label').textContent = 'Tap to commit';
    btn.addEventListener('click', done);
    return;
  }
  const start = (e) => {
    e.preventDefault();
    // scaleX, never width: the fill is full-size and clipped by the button (overflow hidden),
    // so the 1200ms sweep composites instead of running layout every frame of the press.
    fill.style.transition = `transform ${HOLD_MS}ms linear`;
    fill.style.transform = 'scaleX(1)';
    try { navigator.vibrate && navigator.vibrate(10); } catch { /* no-op */ }
    timer = setTimeout(done, HOLD_MS);
  };
  const cancel = () => {
    if (timer == null) return;
    clearTimeout(timer); timer = null;
    fill.style.transition = 'transform 160ms ease-out';
    fill.style.transform = 'scaleX(0)';
  };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
}
