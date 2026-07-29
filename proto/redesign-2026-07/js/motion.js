/* The reveal — one choreography for every moment the app hands a number back.
 *
 * meal.js already had this and it was the best moment in the product: wind the arc back, draw it,
 * count the number up, fire the one non-'light' haptic in the app. But it lived there as a local
 * IntersectionObserver plus a module-level REVEALED string, so the daily score, the breakdown ring
 * and the week header each either did nothing or reimplemented a piece of it. The same moment got
 * four different amounts of ceremony, which is the opposite of a signature.
 *
 * Two rules this module exists to enforce, both learned the hard way:
 *
 *   1. Every reveal is KEYED and plays ONCE. window.__render() re-runs mount(), and screens repaint
 *      for reasons that have nothing to do with the number — a thread loading, participant names
 *      landing, a receipt arriving. An unguarded reveal replays on every one of those paints.
 *   2. A below-the-fold reveal waits to be SEEN. The meal chip sits ~1100px down a 390x844 screen;
 *      revealing it in mount() spends the moment off-screen.
 *
 * prefers-reduced-motion is handled inside animateRing (it snaps every arc and number to its final
 * value). The haptic still fires: it is feedback about a real event, not decoration.
 *
 * Deliberately NOT exported as a re-render trigger of any kind. Nothing here calls __render().
 */
import { RT } from './state.js';
import { animateRing } from './components.js';

/* The app's haptic vocabulary, in one place.
 *
 * 'tap' is listed for completeness but must NOT be fired from screen code: the native shim already
 * puts a light impact on every [data-go]/[data-act] tap in capture phase, and a second one lands as
 * a single mushier buzz rather than as emphasis (see the note on navigator.vibrate in bridge.ts).
 * Fire these only for things the app did, not for things the finger did. */
export const HAPTIC = {
  tap: 'light',           // (global, already wired — do not call)
  reveal: 'success',      // a score just landed
  lock: 'heavy',          // a day sealed; irreversible, so it gets weight
  milestone: 'success',   // a streak crossed a threshold worth naming
  warn: 'warning',        // a window is closing / something needs attention
  error: 'error',         // an action failed
};

/** Fire one semantic haptic. Honors the athlete's preference and no-ops without the native shim. */
export function buzz(kind) {
  const style = HAPTIC[kind] || kind;
  if (!style || style === 'light') return false;   // 'tap' is the shim's job, not ours
  try {
    if (RT.haptics === false) return false;
    if (!window.OnStandardNative || !window.OnStandardNative.haptic) return false;
    window.OnStandardNative.haptic(style);
    return true;
  } catch {
    return false;   // web, QC harness, or a shim that predates this call
  }
}

/* Reveals that have already played, and reveals waiting on a node to become visible.
 *
 * PENDING maps key -> the element being observed, rather than being a plain Set, because a repaint
 * REPLACES the node: the observer attached to the old one can never fire (a detached element is
 * never intersecting), so a key claimed against a dead node has to be re-claimable or the reveal is
 * lost forever. Checking isConnected is what distinguishes "already waiting" from "waiting on a
 * corpse". */
const DONE = new Set();
const PENDING = new Map();

/** Test seam — drop all reveal state so a suite can assert the once-only guard both ways. */
export function resetReveals() { DONE.clear(); PENDING.clear(); }

/** True when `key` has already been revealed this session. */
export function revealed(key) { return DONE.has(key); }

/* Put every arc and number in `root` back at the start of the draw.
 *
 * The offset to wind back TO is read off each arc's own stroke-dasharray rather than assumed,
 * because the layers differ: the main band, under-glow and echo each carry their full circumference
 * (different radii), while the ceiling arc carries a SPAN and starts at that span. animateRing then
 * transitions each one to its own data-off, so every layer stays correct for every ring size. */
function windBack(root) {
  root.querySelectorAll('.ring-arc, .sc-arc').forEach((arc) => {
    const dash = parseFloat(String(arc.getAttribute('stroke-dasharray') || '').split(/[\s,]+/)[0]);
    if (!Number.isFinite(dash)) return;
    arc.style.transition = 'none';
    arc.style.strokeDashoffset = String(dash);
  });
  root.querySelectorAll('[data-count]').forEach((n) => { n.textContent = '0'; });
  // The comet tip rests VISIBLE (it marks where the arc ends, which is true whether or not anything
  // animated). Hide it for the draw so animateRing can fade it in as the band arrives.
  root.querySelectorAll('.ring-tip').forEach((tip) => { tip.style.transition = 'none'; tip.style.opacity = '0'; });
}

/**
 * Play the signature reveal on `el` — at most once per `key`.
 *
 * @param {Element|null} el    the ring container (anything animateRing understands)
 * @param {object}  opts
 * @param {string}  opts.key     identity of THIS number ('day:2026-07-29', 'meal:lunch:<id>'). Omit
 *                               only for a reveal that genuinely should replay on every paint.
 * @param {string}  opts.haptic  vocabulary key, or null for a silent reveal. Default 'reveal'.
 * @param {boolean} opts.whenSeen  wait until the element is on screen before playing. Observes the
 *                               element you PASS, so pass the small thing that should be seen (the
 *                               score chip), never a screen root — see the ratio note below.
 *                               Default false: most rings are above the fold on arrival.
 * @returns {boolean} whether this call took ownership of the reveal.
 */
export function reveal(el, { key, haptic = 'reveal', whenSeen = false, threshold = 0.6 } = {}) {
  if (!el) return false;
  if (key) {
    if (DONE.has(key)) return false;
    const waiting = PENDING.get(key);
    if (waiting && waiting.isConnected) return false;
    PENDING.set(key, el);
  }
  const play = () => {
    if (key) { PENDING.delete(key); DONE.add(key); }
    windBack(el);
    void el.offsetWidth;            // commit the wound-back state before animateRing re-adds the transition
    const draw = () => animateRing(el);
    // A frame's gap is what makes the wound-back state a starting point rather than a value the
    // browser coalesces away. Called directly where there are no frames to wait for (node suites).
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(draw); else draw();
    if (haptic) buzz(haptic);
  };
  if (!whenSeen || typeof IntersectionObserver !== 'function') { play(); return true; }
  /* An element TALLER than the viewport can never reach a high intersection ratio — its maximum is
     viewportHeight/elementHeight — so a fixed 0.6 silently means "never" and the reveal is lost,
     leaving the markup's placeholder 0 and an undrawn ring on screen. (Exactly what happened when
     a screen root was passed here.) Ask for what is actually reachable instead of assuming. */
  const h = el.getBoundingClientRect ? (el.getBoundingClientRect().height || 0) : 0;
  const vh = typeof innerHeight === 'number' ? innerHeight : 0;
  const reachable = (h > 0 && vh > 0) ? Math.min(1, vh / h) : 1;
  const t = reachable < threshold ? Math.max(0.01, reachable * 0.75) : threshold;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.intersectionRatio >= t)) return;
    io.disconnect();
    play();
  }, { threshold: [0, t] });
  io.observe(el);
  return true;
}
