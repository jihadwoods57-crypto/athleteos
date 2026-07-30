/* Press-tilt — the score surface answers the finger with depth.
 *
 * While a press is down, the surface tilts toward the touch point around a 700px perspective
 * (max ~4.5deg) and its layers separate slightly (the ring sits proud of the body via translateZ
 * in CSS, so the tilt reads as a real object, not a rotated screenshot). On release it springs
 * flat with the app's own ease-out. Nothing here animates layout: transform only, tracked at one
 * write per frame, with passive listeners so scrolling never waits on us.
 *
 * A scroll that takes over the touch fires pointercancel — the surface just settles. Reduced
 * motion opts the whole thing out at wire time (there is no press feedback to preserve: the
 * :active scale in CSS still applies because the inline transform is never set).
 *
 * Wired from mount(). Safe against the __render()-re-runs-mount() pattern: listeners live on the
 * node this render created and die with the next innerHTML swap, and this module keeps no state.
 */

export function pressTilt(el, { max = 4.5, scale = 0.985, perspective = 700 } = {}) {
  if (!el || typeof el.addEventListener !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let rect = null, raf = 0, nx = 0, ny = 0, down = false;
  const apply = () => {
    raf = 0;
    if (!down) return;
    el.style.transform =
      `perspective(${perspective}px) rotateX(${(-ny * max).toFixed(2)}deg) rotateY(${(nx * max).toFixed(2)}deg) scale(${scale})`;
  };
  const track = (e) => {
    if (!down || !rect || !rect.width || !rect.height) return;
    nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const release = () => {
    if (!down) return;
    down = false; rect = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    el.style.transition = 'transform 460ms var(--ease-out)';
    el.style.transform = '';
    el.style.willChange = '';
  };
  el.addEventListener('pointerdown', (e) => {
    down = true;
    rect = el.getBoundingClientRect();
    el.style.willChange = 'transform';
    el.style.transition = 'transform 120ms var(--ease-out-quart)';
    track(e);
  }, { passive: true });
  el.addEventListener('pointermove', track, { passive: true });
  el.addEventListener('pointerup', release, { passive: true });
  el.addEventListener('pointercancel', release, { passive: true });
  el.addEventListener('pointerleave', release, { passive: true });
}
