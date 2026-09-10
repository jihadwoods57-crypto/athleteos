/* The perfect plate, full screen.
 *
 * Founder 2026-09-10: "it needs to be a bigger deal when a user gets 100 meal score. I want a
 * 3 second full screen animation instead of the current one." The 2026-09-09 version bloomed on
 * the score chip itself, which put the app's rarest event inside a 62px circle most of the way
 * down a scrolling thread. This takes the screen for three seconds and then gives it back.
 *
 * Body-level, for the same reason the lock stamp is (lock-moment.js): the router rebuilds
 * device.innerHTML on every render, so an overlay parented to a screen is destroyed mid-animation
 * by any async repaint. Fixed to the window because it has no layout relationship to the screen
 * underneath it.
 *
 * Three rules it inherits rather than reinvents:
 *   1. The scrim is STATIC. Tweening the opacity of a full-screen blurred layer re-runs the blur
 *      over the whole document every frame, which is the most expensive thing a WebView can be
 *      asked to do at the exact moment it is also drawing a ring and twenty particles. The
 *      CONTENT carries the entrance (flows.css, same ruling as .lockstamp).
 *   2. The arc is the brand dial (docs/brand/LOGO.md): a 300 degree gauge with a 60 degree gap at
 *      six o'clock, wearing the --ring-a/b/c sweep. Green is status only and never paints the
 *      arc, so the numeral is plain ink and the sweep does the celebrating.
 *   3. The draw is the house choreography: markup rests wound back, animateRing() transitions
 *      each arc to its own data-off and counts [data-count] up. Under prefers-reduced-motion
 *      animateRing snaps both to their final values, and the CSS drops the particles and the
 *      spin, so the moment still HAPPENS: it just stops moving.
 *
 * One overlay at a time (overlay-guard.js). If something else owns the screen when the score
 * lands (the clarifying-question sheet opens ~420ms after mount) this waits once and then lets
 * the moment go rather than stacking: the chip still reads 100 and the band still says Perfect
 * plate, so nothing is lost except the ceremony.
 */
import { buzz } from './motion.js';
import { animateRing } from './components.js';
import { overlayOpen } from './overlay-guard.js';
import { esc } from './components.js';

/** Particles in the burst. Twenty reads as a burst and still composites in one frame on the
 *  oldest phone we support; sixty looked like a screensaver and dropped frames on an iPhone 11. */
export const PM_PARTICLES = 20;
/** How long the whole moment owns the screen, start to removed. The founder asked for three. */
export const PM_LIFE_MS = 3000;
/** When the exit fade starts. The 400ms remainder is the fade itself (flows.css .pmoment.out). */
export const PM_FADE_AT_MS = 2600;
/** One retry when another overlay owns the screen, then the moment is let go. */
export const PM_RETRY_MS = 1200;

const DIAL_START = 120;   // degrees; six o'clock gap runs 60..120
const DIAL_SWEEP = 300;

let showing = false;

/** The brand dial at any size. Same geometry as meal.js miniDial, which is 62px and fixed. */
function dialSvg(size, stroke, score) {
  const c = size / 2;
  const r = c - stroke;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + Math.cos(a) * r).toFixed(2)} ${(c + Math.sin(a) * r).toFixed(2)}`;
  };
  const d = `M ${pt(DIAL_START)} A ${r} ${r} 0 1 1 ${pt(DIAL_START + DIAL_SWEEP - 360)}`;
  const off = Math.max(0, 100 - Number(score)).toFixed(1);
  // Gradient coordinates scaled from the 62px mark so the sweep lands at the same angle it does
  // on every other ring in the app.
  const g = (n) => (size * n).toFixed(1);
  return `<svg class="pm-dial" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs>
      <linearGradient id="pmgrad" gradientUnits="userSpaceOnUse" x1="${g(0.2016)}" y1="${g(0.8694)}" x2="${g(0.6)}" y2="${g(0.0806)}">
        <stop offset="0%" stop-color="var(--ring-a)"/>
        <stop offset="50%" stop-color="var(--ring-b)"/>
        <stop offset="100%" stop-color="var(--ring-c)"/>
      </linearGradient>
    </defs>
    <path d="${d}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}" stroke-linecap="round"/>
    ${/* Rests WOUND BACK at the full dash: this node is built fresh for the draw, so there is no
          honest resting value to protect the way a rendered screen's ring has. animateRing
          transitions it to data-off. */''}
    <path class="ring-arc pm-arc" d="${d}" fill="none" stroke="url(#pmgrad)" stroke-width="${stroke}"
      stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-off="${off}"/>
  </svg>`;
}

function burstEl(doc) {
  const b = doc.createElement('div');
  b.className = 'pm-burst';
  b.setAttribute('aria-hidden', 'true');
  const cols = ['var(--ring-a)', 'var(--ring-b)', 'var(--ring-c)'];
  for (let i = 0; i < PM_PARTICLES; i++) {
    const p = doc.createElement('i');
    // Angles are jittered off the perfect spoke so the burst reads as thrown rather than plotted.
    p.style.setProperty('--a', `${Math.round((360 / PM_PARTICLES) * i + (i % 3 ? 11 : -8))}deg`);
    p.style.setProperty('--d', `${132 + (i % 4) * 34}px`);
    p.style.setProperty('--c', cols[i % 3]);
    p.style.setProperty('--z', `${0.7 + (i % 3) * 0.25}`);
    p.style.setProperty('animation-delay', `${880 + (i % 5) * 45}ms`);
    b.appendChild(p);
  }
  return b;
}

/**
 * Play the full-screen perfect-plate moment. Safe to call from a reveal's onPlay: it guards its
 * own re-entry, so a repaint that somehow reaches it twice still shows one.
 *
 * @param {object}  opts
 * @param {string}  opts.slotLabel  "Lunch" — what the athlete calls this meal
 * @param {number}  opts.score      the meal score; only ever 100 today, but drawn from the value
 * @param {number}  opts.attempt    internal: 1 on the single retry
 * @returns {boolean} whether the moment was shown or scheduled
 */
export function playPerfectMoment(opts = {}) {
  const { slotLabel = '', score = 100, attempt = 0 } = opts;
  if (typeof document === 'undefined' || !document.body) return false;
  if (showing) return false;
  if (overlayOpen('.pmoment')) {
    if (attempt === 0 && typeof setTimeout === 'function') {
      setTimeout(() => { playPerfectMoment({ ...opts, attempt: 1 }); }, PM_RETRY_MS);
      return true;
    }
    return false;
  }

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'pmoment';
  /* A three-second announcement that dismisses itself is not a dialog: role="dialog" would tell a
     screen reader something is waiting for an answer when nothing is. status + polite announces
     the words without stealing focus, so there is no focus to restore either. */
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  /* The slot, not the dish: the header already names the dish, and "Lunch · Chicken bowl ·
     every point on the plate" is three clauses where one lands harder. */
  const line = slotLabel ? `${esc(String(slotLabel))} · ` : '';
  el.innerHTML = `
    <div class="pm-glow" aria-hidden="true"></div>
    <div class="pm-stage">
      <div class="pm-core">
        ${dialSvg(248, 12, score)}
        ${/* No "/100". The word below already says perfect and the dial is visibly full, so the
              denominator was the one thing on screen doing no work, and at three digits it
              crowded the arc. */''}
        <div class="pm-read"><span class="pm-num" data-count="${Number(score) || 0}">0</span></div>
      </div>
      <div class="pm-word">Perfect plate</div>
      <div class="pm-sub">${line}every point on the plate</div>
    </div>`;
  if (!reduce) el.appendChild(burstEl(document));
  document.body.appendChild(el);
  showing = true;

  // The arc and the numeral, drawn the way every other number in this app is drawn.
  try { animateRing(el); } catch { /* a celebration never breaks on its own drawing */ }
  /* 'celebrate' is the heavy impact. The lock stamp owns the other one, and the two can never
     co-occur (overlay-guard), so heavy still means "the rarest thing that happens today". */
  buzz('celebrate');

  let done = false;
  const close = (fast) => {
    if (done) return;
    done = true;
    try { document.removeEventListener('keydown', onKey); } catch { /* never mounted */ }
    clearTimeout(fadeT); clearTimeout(endT);
    el.classList.add('out');
    if (fast) el.classList.add('fast');
    setTimeout(() => {
      try { el.remove(); } catch { /* already gone with the document */ }
      showing = false;
    }, fast ? 200 : 400);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
  /* The router's app-wide Escape floor stands down while .pmoment is in the DOM (router.js), the
     same arrangement the lock stamp has, so the moment owns its own key or there is no way out
     for a keyboard user. A tap anywhere closes it: three seconds is short, but nobody should be
     made to wait out an animation they have already read. */
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', () => close(true));

  const fadeT = setTimeout(() => { el.classList.add('out'); }, PM_FADE_AT_MS);
  const endT = setTimeout(() => {
    try { el.remove(); } catch { /* already gone */ }
    showing = false;
    try { document.removeEventListener('keydown', onKey); } catch { /* never mounted */ }
    done = true;
  }, PM_LIFE_MS);
  return true;
}

/** Test seam: forget that a moment is on screen. Never called by the app. */
export function _resetPerfectMoment() { showing = false; }
