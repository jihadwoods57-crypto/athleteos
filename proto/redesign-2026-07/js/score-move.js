/* The score move — "what did that just do to my number?", answered as motion instead of numerals.
 *
 * Two screens answer that question, and until now each answered it differently and neither used the
 * app's own vocabulary for it. The meal thread and the recovery confirm both printed `82 → 88` as
 * static text and then ran the SAME nine lines of hand-rolled 900ms cubic count-up, copied between
 * two files. Meanwhile motion.js — the module that exists so every moment the app hands a number
 * back plays as one choreography — was not involved in either of them.
 *
 * What this module draws instead: the score's own dial, with the points just earned sweeping in
 * from where the old score ended. Three things move together off one clock, because they are one
 * event and not three:
 *
 *   1. the delta arc sweeps `from` → `to`,
 *   2. the numeral counts through the same values,
 *   3. the tier chip flips AT the frame the arc crosses the threshold, not after.
 *
 * The dial carries the ladder itself — faint ticks at 60 / 80 / 90 — so the athlete can see which
 * line they just crossed rather than being told. That is the whole design: the standard is a place
 * on the dial, and the sweep either reaches it or it doesn't.
 *
 * THE HAPTIC FIRES AT THE CROSSING, NOT AT THE END
 *
 * If a tier boundary is crossed, that frame is the emotional peak of the move and the buzz belongs
 * there. If none is crossed the buzz lands with the number. Exactly one either way: motion.js
 * documents why two non-'light' haptics inside one animation arrive as a single mushier one.
 *
 * WHY THE ARC IS DRIVEN IN rAF AND NOT BY A CSS TRANSITION
 *
 * animateRing uses a CSS transition because nothing has to stay in step with it. Here the arc, the
 * numeral and the chip all read the same eased progress, and a CSS-timed arc beside a JS-timed
 * counter drift apart within a few frames — the number reaches 88 while the arc is still short of
 * it, which reads as the app disagreeing with itself. One clock, three consumers.
 * `stroke-dashoffset` is not a layout property, so per-frame writes cost no reflow.
 *
 * THE MOVE IS KEYED, AND A REPAINT MID-SWEEP RESUMES INSTEAD OF RESTARTING
 *
 * The meal thread repaints while this is playing (participants and comments land about a second
 * in), which destroys the node being animated. motion.js solved the same problem for reveals with a
 * DONE set; a sweep needs one more state than a reveal does, because it can be interrupted PART WAY
 * rather than only before or after. So a key is in one of three states: unseen (play from the
 * start), in flight (adopt the new node and carry on from the elapsed time — never rewind), or done
 * (paint the outcome with no motion at all). Restarting on a repaint would replay the ceremony; the
 * old code's `_played` flag instead let the repaint delete the score line mid-count.
 *
 * Nothing here computes a score. `from` and `to` arrive from RT.lastMove, which the engine wrote.
 */
import { tierFor, TIERS } from './score-band.js';
import { DIAL_A0, DIAL_SWEEP, dialPath, dialPoint } from './components.js';
import { buzz } from './motion.js';

/* The thresholds drawn on the dial, low to high. Read off the ONE ladder rather than written out:
   a tick at a number the tier engine does not actually use would be the label lying about the
   score, which is the single thing PRODUCT.md says can never happen. 0 is not a threshold, it is
   the start of the dial. */
export const TICKS = TIERS.map((t) => t.min).filter((m) => m > 0).sort((a, b) => a - b);

/* One clock for the whole move. Longer than the 900ms the two copies used, because the sweep has
   further to travel than a numeral does, and shorter than --dur-ring (1400ms): a full ring draw is
   0 → score, this is only the delta. */
export const MOVE_DUR = 1150;

/** The JS twin of --ease-out-quart. Ease out only — no bounce, no elastic (DESIGN.md). */
const ease = (p) => 1 - Math.pow(1 - p, 4);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* Moves already spent, and moves currently travelling. See the header: a sweep needs both, because
   a repaint can land in the middle of one. FLIGHT holds the start timestamp only — the node is
   whatever the latest mount handed us, which is the point. */
const DONE = new Set();
const FLIGHT = new Map();

/** Test seam — drop all move state so a suite can assert the guard from every direction. */
export function resetScoreMoves() { DONE.clear(); FLIGHT.clear(); }
/** True when `key`'s move has already finished playing this session. */
export function scoreMovePlayed(key) { return DONE.has(key); }
/** True when `key` is mid-sweep right now. */
export function scoreMoveInFlight(key) { return FLIGHT.has(key); }

/* ---------------------------------------------------------------- markup */

/* The gradient the delta arc wears. Three stops from --ring-a/b/c, the signature sweep, which
   DESIGN.md reserves for surfaces that display or produce an OnStandard score. This is one: it is
   the score, moving. The glow underneath is what carries TIER, so the band never has to. */
function sweepDefs(uid, { x1, y1, x2, y2 }) {
  return `<linearGradient id="smg${uid}" gradientUnits="userSpaceOnUse"
      x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}">
      <stop offset="0%" stop-color="var(--ring-a)"/>
      <stop offset="50%" stop-color="var(--ring-b)"/>
      <stop offset="100%" stop-color="var(--ring-c)"/>
    </linearGradient>`;
}

/* The dial's axis: LOGO.md's own (26,82)→(58,18), scaled to this radius, so the sweep runs the same
   way across the confirm dial as it does across the mark. */
const dialAxis = (cx, cy, r) => ({ x1: cx - 0.71 * r, y1: cy + 0.88 * r, x2: cx + 0.24 * r, y2: cy - r });

/* The two stacked glows that carry the tier through the move.
 *
 * The from-tier layer sits at full opacity for the whole sweep and the to-tier layer fades in over
 * it, rather than the two cross-fading against each other: complementary fades under `normal`
 * blending dip in the middle, and a light source that dims halfway through a celebration reads as
 * a fault. Fading one layer IN over a layer that never leaves cannot dip. */
function glows(from, to) {
  // Carried as the ladder's own letter rather than an inline colour, so the light is looked up in
  // CSS from the same four classes the chips use and both themes resolve it themselves.
  return `<span class="sm-glow ${tierFor(from).cls}"></span>
    <span class="sm-glow sm-glow-to ${tierFor(to).cls}"></span>`;
}

/* A dash pair that shows exactly the run from `a` to `b` on a pathLength=100 geometry, seated where
 * it belongs. Shared by both geometries so the driver never has to know which one it is looking at:
 * the dial rotates its whole path so the run's start lands on `a`, the bar shifts its dash pattern
 * by the same amount, and both come out as one dasharray and one offset.
 *
 * THE RUN IS REVEALED BY GROWING ITS LENGTH, NOT BY SLIDING ITS OFFSET. Sliding is the obvious move
 * and it is wrong: a dash pattern is PERIODIC with period pathLength, so parking the run "behind the
 * start" by offsetting it its own length wraps it around to the far END of the path, where it is
 * perfectly visible. On the confirm dial that put the twelve points about to be earned at the top of
 * the ring before the sweep began — the answer, drawn in full, above the number still counting up to
 * it. Growing 0 → len from a fixed offset has no wrap to have a bug in. */
function span(a, b, { rotates }) {
  return { len: Math.max(0, b - a), dasharray: dashAt(Math.max(0, b - a)), off: (rotates ? 0 : -a).toFixed(2) };
}

/* The dash pair for `len` points of a pathLength=100 run.
 *
 * The gap is the WHOLE path, not `100 - len`. A dash pattern repeats with period dash+gap, so
 * `len` + `100 - len` comes to exactly 100 and the second period therefore begins on the path's
 * final point — where a round linecap draws it as a dot. Both arcs were leaving one: a bead at the
 * bottom-right end of the dial from the settled score, and a second one part-way round from the
 * delta, sitting nowhere near the points it belonged to and looking for all the world like a marker
 * for something. A gap of 100 puts the next period past the end of the path, where there is nothing
 * to draw it on. (scoreRing's ceiling arc has the same arithmetic and is saved by its butt cap: a
 * zero-length dash with a flat cap renders nothing at all.) */
const dashAt = (len) => `${len.toFixed(2)} 100`;

/**
 * The hero form: the score's own dial, with the delta sweeping in.
 *
 * @param {object} o
 * @param {number} o.from  the score before the thing that just happened
 * @param {number} o.to    the score after it
 * @param {number} [o.size]   px; 168 suits a confirm interstitial
 * @param {number} [o.stroke] band width
 * @param {string} [o.uid] unique per instance — two on one screen would share gradient ids
 * @returns {string} markup carrying every hook playScoreMove() drives
 */
export function scoreMoveDial({ from, to, size = 168, stroke = 12, uid = 'sm' } = {}) {
  const f = clamp(Number(from) || 0, 0, 100);
  const t = clamp(Number(to) || 0, 0, 100);
  const cx = size / 2, cy = size / 2;
  const r = (size - stroke) / 2 - 6;
  const d = dialPath(cx, cy, r);
  const base = span(0, f, { rotates: true });
  const delta = span(f, t, { rotates: true });
  const tierT = tierFor(t);
  // Ticks are drawn as short radial stubs straddling the band, in the dial's own coordinate space.
  const tick = (v) => {
    const deg = DIAL_A0 + (v / 100) * DIAL_SWEEP;
    const inner = r - stroke / 2 - 1, outer = r + stroke / 2 + 1;
    return `<line class="sm-tick${f >= v ? ' lit' : ''}" data-sm-tick="${v}"
      x1="${dialPoint(cx, cy, inner, deg).split(' ')[0]}" y1="${dialPoint(cx, cy, inner, deg).split(' ')[1]}"
      x2="${dialPoint(cx, cy, outer, deg).split(' ')[0]}" y2="${dialPoint(cx, cy, outer, deg).split(' ')[1]}"/>`;
  };
  return `
  ${/* No inline width/height: the svg below carries real width/height ATTRIBUTES, so the wrapper
        already sizes itself to the dial and a second copy of the number could only disagree. */''}
  <div class="smove smove-dial" data-sm data-sm-from="${f}" data-sm-to="${t}">
    ${glows(f, t)}
    <svg class="sm-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs>${sweepDefs(uid, dialAxis(cx, cy, r))}</defs>
      <path d="${d}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}" stroke-linecap="round"/>
      ${/* The score they already had. It does not animate: it did not just change, and winding it
            back would claim the whole number was earned in this one moment. */''}
      ${base.len > 0 ? `<path class="sm-base" d="${d}" fill="none" stroke="url(#smg${uid})"
        stroke-width="${stroke}" stroke-linecap="round" opacity="0.45"
        pathLength="100" stroke-dasharray="${base.dasharray}" stroke-dashoffset="${base.off}"/>` : ''}
      ${/* The points just earned. Rotated so the run begins exactly where the old score ended. */''}
      ${delta.len > 0 ? `<path class="sm-delta" data-sm-arc d="${d}" fill="none" stroke="url(#smg${uid})"
        stroke-width="${stroke}" stroke-linecap="round"
        pathLength="100" stroke-dasharray="${delta.dasharray}"
        stroke-dashoffset="${delta.off}" data-sm-len="${delta.len.toFixed(2)}"
        transform="rotate(${((f / 100) * DIAL_SWEEP).toFixed(2)} ${cx} ${cy})"/>` : ''}
      <g class="sm-ticks">${TICKS.map(tick).join('')}</g>
    </svg>
    <div class="sm-center">
      <span class="sm-num" data-sm-count="${t}">${t}</span>
      <span class="sm-of">/100</span>
      ${/* Inside the centre, exactly where scoreRing puts it. The dial's 60° gap at 6 o'clock is
            what leaves room for it, so it never has to be positioned outside the box and can never
            collide with whatever the screen puts underneath. */''}
      <span class="tier-chip sm-tier ${tierT.cls}" data-sm-tier data-sm-base="tier-chip sm-tier">${tierT.name}</span>
    </div>
  </div>`;
}

/**
 * The compact form: the same move as a thin strip, for a row inside a card where a dial would be
 * a second competing hero. Same hooks, same driver, same ticks.
 *
 * `head` is the caller's own line of numerals, rendered INSIDE the move element so that whatever
 * it carries — a counting numeral, a tier chip — is found by the same `el.querySelector` the dial's
 * centre is. The strip stays generic: it does not know what a meal confirmation wants to say, only
 * that the hooks have to live under one root.
 *
 * @param {object} o  as scoreMoveDial, minus size/stroke, plus `head`
 * @returns {string}
 */
export function scoreMoveBar({ from, to, uid = 'smb', head = '' } = {}) {
  const f = clamp(Number(from) || 0, 0, 100);
  const t = clamp(Number(to) || 0, 0, 100);
  const base = span(0, f, { rotates: false });
  const delta = span(f, t, { rotates: false });
  // viewBox units are score points across, so x === score. preserveAspectRatio=none stretches that
  // to whatever width the row is; non-scaling-stroke is what keeps the band 4px and the ticks 1.4px
  // instead of being smeared by the same transform.
  return `
  ${/* No tier glow on the strip. This sits inside a card that already carries its own tinted
        gradient, and a second wash on top of it fought the card rather than reading as light.
        The tier is carried here by the numeral, the chip and which ticks are lit. */''}
  <div class="smove smove-bar" data-sm data-sm-from="${f}" data-sm-to="${t}">
    ${head ? `<div class="sm-head">${head}</div>` : ''}
    ${/* viewBox units are score points across, stretched to whatever width the row is.
          `vector-effect="non-scaling-stroke"` is deliberately NOT on the three band lines: it makes
          the dash pattern resolve in RENDERED pixels, which ignores pathLength normalisation
          entirely — a 70/30 dash meant to run once tiled into five repeats across the row and the
          strip read as a dotted line. The ticks keep it (no dash pattern to break) so they stay
          hairlines instead of being smeared to ~9px by the horizontal stretch. The band's own
          thickness is safe: for a horizontal line it is governed by the Y scale, and CSS pins the
          svg to the viewBox's own 6 units tall. Butt caps, because a round cap would be stretched
          into an ellipse by the same transform. */''}
    <svg class="sm-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
      <defs>${sweepDefs(uid, { x1: 0, y1: 3, x2: 100, y2: 3 })}</defs>
      <line x1="0" y1="3" x2="100" y2="3" stroke="var(--ring-track)" stroke-width="4" stroke-linecap="butt"/>
      ${base.len > 0 ? `<line class="sm-base" x1="0" y1="3" x2="100" y2="3" stroke="url(#smg${uid})"
        stroke-width="4" stroke-linecap="butt" opacity="0.45"
        pathLength="100" stroke-dasharray="${base.dasharray}" stroke-dashoffset="${base.off}"/>` : ''}
      ${delta.len > 0 ? `<line class="sm-delta" data-sm-arc x1="0" y1="3" x2="100" y2="3" stroke="url(#smg${uid})"
        stroke-width="4" stroke-linecap="butt"
        pathLength="100" stroke-dasharray="${delta.dasharray}"
        stroke-dashoffset="${delta.off}" data-sm-len="${delta.len.toFixed(2)}"/>` : ''}
      <g class="sm-ticks">${TICKS.map((v) => `<line class="sm-tick${f >= v ? ' lit' : ''}" data-sm-tick="${v}"
        x1="${v}" y1="0" x2="${v}" y2="6" vector-effect="non-scaling-stroke"/>`).join('')}</g>
    </svg>
  </div>`;
}

/* ---------------------------------------------------------------- driver */

/* How far through the move the tier light is, 0..1 — a PROGRESS value, never an opacity, and
 * written on the CONTAINER so both glow layers can read the same number.
 *
 * Writing opacity here is what blew the halo out: an inline opacity beats every stylesheet rule, so
 * the ceiling the CSS had set was simply discarded and the light landed at full strength. It also
 * has to differ by theme — the light tokens are far more saturated against a near-white ground —
 * and the outgoing layer has to fade as the incoming one arrives or the two hues average to grey.
 * None of those three are the driver's business. It reports progress; screens.css decides what that
 * looks like. */
function setGlow(node, p) {
  if (node.style.setProperty) node.style.setProperty('--sm-p', String(p));
  else node.style['--sm-p'] = String(p);   // the node suites' minimal style objects
}

/* Paint the move's outcome with no motion at all: the arc seated, the number final, every tick the
   score has passed lit, the incoming tier's glow at full. Used for the three cases that must never
   animate — reduced motion, a repaint after the move already played, and a move of zero points. */
function settle(el, to) {
  el.querySelectorAll('[data-sm-arc]').forEach((arc) => {
    arc.style.transition = 'none';
    arc.style.strokeDasharray = dashAt(parseFloat(arc.getAttribute('data-sm-len')) || 0);
    arc.style.opacity = '';
  });
  const num = el.querySelector('[data-sm-count]');
  if (num) num.textContent = String(Math.round(to));
  el.querySelectorAll('[data-sm-tick]').forEach((tk) => {
    if (to >= +tk.getAttribute('data-sm-tick')) tk.classList.add('lit');
  });
  setGlow(el, 1);
  const chip = el.querySelector('[data-sm-tier]');
  if (chip) paintTier(chip, tierFor(to));
}

/* The tier chip, rewritten in place.
 *
 * Two attributes keep the driver out of the caller's design decisions: `data-sm-tier` holds a
 * prefix the screen wants in front of the name (the meal thread's "▲ "), and `data-sm-base` holds
 * the classes that are NOT the ladder letter. Without those, flipping the chip mid-sweep silently
 * ate whichever of the two the caller happened to be using. Idempotent, so the frames between two
 * crossings cost nothing. */
function paintTier(chip, t) {
  const label = (chip.getAttribute('data-sm-tier') || '') + t.name;
  if (chip.textContent === label) return;
  chip.textContent = label;
  chip.className = `${chip.getAttribute('data-sm-base') || 'tier-chip'} ${t.cls}`;
}

/**
 * Play the move on `root`'s `[data-sm]` element — at most once per `key`, resumable mid-flight.
 *
 * @param {Element|null} root  the screen root, or the move element itself
 * @param {object} o
 * @param {string} o.key   identity of THIS move ('move:lunch:82-88'). Required: without one, a
 *                         repaint replays the ceremony, which is the bug this module exists to fix.
 * @param {number} o.from
 * @param {number} o.to
 * @param {string|null} [o.haptic] vocabulary key fired once, at the crossing. null for silence.
 * @param {Function} [o.onDone] called when the move finishes OR is found already finished, so a
 *                         caller can retire whatever gate keeps the move on screen.
 * @returns {boolean} whether this call played (or resumed) real motion.
 */
export function playScoreMove(root, { key, from, to, haptic = 'reveal', onDone } = {}) {
  const el = !root ? null : (root.matches && root.matches('[data-sm]') ? root : root.querySelector('[data-sm]'));
  if (!el) return false;
  const f = clamp(Number(from) || 0, 0, 100);
  const t = clamp(Number(to) || 0, 0, 100);
  const fin = () => { if (typeof onDone === 'function') { try { onDone(); } catch { /* never break the moment */ } } };

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spent = key ? DONE.has(key) : false;
  // A reduced-motion athlete still gets the haptic on a first play: it is feedback about a real
  // event, not decoration (the same call motion.js makes). A repaint after the fact gets neither.
  if (spent || t <= f || reduced) {
    settle(el, t);
    if (key) { DONE.add(key); FLIGHT.delete(key); }
    if (!spent && reduced && haptic) buzz(haptic);
    fin();
    return false;
  }

  /* Adopt the elapsed time of a sweep a repaint interrupted, or start a new one. Never rewind: the
     athlete has already watched part of this.
   *
   * `gen` is what retires the loop the interrupted sweep left behind. Elapsed time is deliberately
   * carried over, so the two loops cannot be told apart by their clock, and both stay live in the
   * frame queue: whichever one reached the end first finalized the key, and the other then found
   * the key already retired and bailed BEFORE writing the final value. Half the time that loser was
   * the one holding the node still on screen, which left the athlete looking at a number frozen
   * part-way to the truth. Only the newest generation ever writes. */
  const now = typeof performance === 'object' && performance.now ? performance.now() : 0;
  const held = key ? FLIGHT.get(key) : null;
  const t0 = held ? held.t0 : now;
  const gen = (held ? held.gen : 0) + 1;
  const rec0 = { t0, buzzed: held ? held.buzzed : false, gen };
  if (key) FLIGHT.set(key, rec0);

  const arcs = Array.from(el.querySelectorAll('[data-sm-arc]')).map((arc) => ({
    node: arc,
    len: parseFloat(arc.getAttribute('data-sm-len')) || 0,
  }));
  const num = el.querySelector('[data-sm-count]');
  const chip = el.querySelector('[data-sm-tier]');
  const ticks = Array.from(el.querySelectorAll('[data-sm-tick]'));
  const fromTier = tierFor(f);
  const crosses = tierFor(t).name !== fromTier.name;

  // The incoming tier's light rides the same clock as everything else. The markup rests at 1 (the
  // move has landed), so this is the wind-back for the light.
  setGlow(el, 0);

  const frame = (nowT) => {
    const rec = key ? FLIGHT.get(key) : rec0;
    // A later mount adopted this move and is driving it now; this loop is the stale one.
    if (!rec || rec.gen !== gen) return;
    if (!el.isConnected) return;             // the node went with a repaint; the resume will re-drive it
    const p = clamp((nowT - t0) / MOVE_DUR, 0, 1);
    const e = ease(p);
    const cur = f + (t - f) * e;
    arcs.forEach((a) => {
      const len = a.len * e;
      a.node.style.strokeDasharray = dashAt(len);
      // A round linecap renders a zero-length dash as a DOT, so the first frames of a sweep would
      // otherwise print a bead where the old score ended before anything had been earned.
      a.node.style.opacity = len > 0.2 ? '' : '0';
    });
    if (num) num.textContent = String(Math.round(cur));
    setGlow(el, e);
    ticks.forEach((tk) => { if (cur >= +tk.getAttribute('data-sm-tick')) tk.classList.add('lit'); });
    const curTier = tierFor(Math.round(cur));
    if (chip) paintTier(chip, curTier);
    /* The one buzz. At the crossing when there is one — that frame is what the move was about —
       and otherwise with the number as it lands. */
    if (haptic && rec && !rec.buzzed && (crosses ? curTier.name !== fromTier.name : p >= 1)) {
      rec.buzzed = true;
      buzz(haptic);
    }
    if (p < 1) { requestAnimationFrame(frame); return; }
    if (key) { DONE.add(key); FLIGHT.delete(key); }
    settle(el, t);
    fin();
  };

  /* Driven synchronously first, THEN scheduled.
   *
   * The markup rests at its true value — the arc seated, the numeral already reading `to` — because
   * a paint that never animates has to be honest (the same rule scoreRing follows). So the first
   * write has to happen in the paint that created the node, not a frame later: waiting for rAF
   * shows the finished number for one frame and then yanks it back to `from`, and on a repaint
   * landing mid-sweep that flash is the answer appearing before the sweep that earns it.
   *
   * Without rAF at all (the node suites) this settles the move in one call rather than leaving it
   * parked at its start. */
  if (typeof requestAnimationFrame === 'function') frame(now);
  else { settle(el, t); if (key) { DONE.add(key); FLIGHT.delete(key); } fin(); }
  return true;
}
