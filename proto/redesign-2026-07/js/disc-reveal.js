/* The Team discussion's one entrance (2026-09-15).
 *
 * The raised discussion card tilts up out of the page as it arrives (screens.css .disc-raised.in).
 * Adding the class at paint would replay it on every repaint, and the meal screens repaint on
 * every poll tick, every participant landing, every correction. So the class is added ONCE per
 * plate, when the section actually scrolls into view, and never again for that plate this
 * session. Screens that never scroll to it never pay for it. */
const SEEN = new Set();

/**
 * @param {Element} root   the screen root
 * @param {string}  key    a stable key for this plate (meal id or route), so a repaint of the same
 *                         plate does not replay and a different plate does
 */
export function revealDisc(root, key) {
  if (!root || typeof document === 'undefined') return;
  const el = root.querySelector('.disc.disc-raised');
  if (!el) return;
  const k = String(key || 'disc');
  if (SEEN.has(k)) { el.classList.add('in'); el.style.animation = 'none'; return; }
  if (typeof IntersectionObserver !== 'function') { SEEN.add(k); el.classList.add('in'); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      SEEN.add(k);
      el.classList.add('in');
      io.disconnect();
    }
  }, { threshold: 0.12 });
  io.observe(el);
}
