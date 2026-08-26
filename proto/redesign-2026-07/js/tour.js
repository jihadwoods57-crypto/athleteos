/* The first-run tour, on screen.
 *
 * tour-plan.js decides WHAT to say. This file only says it: dim the app, cut a hole around one
 * real element, put a card next to it, advance. It makes no inclusion decisions of its own — the
 * single judgement it holds is "that element isn't on screen", which drops a step.
 *
 * Three things shaped the implementation:
 *
 *   1. `window.__render()` re-runs mount(), and Home repaints for commitments, standards, receipts
 *      and a 30-second tick. So mount() is NOT "first time". Three bugs in this codebase came from
 *      forgetting that. Guards here: a module singleton, a `pending` flag across the settle delay,
 *      and a seen flag written at first paint — after which planTour returns nothing at all.
 *
 *   2. The overlay lives on document.body, outside #device, so a repaint underneath it doesn't
 *      destroy it. It re-queries its anchor by selector every time it positions, so the element
 *      being swapped out from under it is a non-event.
 *
 *   3. The hole is four scrim panels, not a mask or a giant box-shadow. Four rectangles around a
 *      rect is arithmetic that can't be subtly wrong at an edge, needs no clip-path support
 *      question, and leaves the highlighted element genuinely untouched.
 */

import { RT, S, act, routeForRole } from './state.js';
import { planTour, filterSteps, placeCard, TOUR_IDS, isNewAccount } from './tour-plan.js';
import { buzz } from './motion.js';
import { overlayOpen } from './overlay-guard.js';

/** Let the entrance stagger, the score ring, AND Home's early re-render churn finish before we dim
    everything. The number the tour points at should already be at rest, and the element it rings
    should not be about to be replaced. */
const SETTLE_MS = 600;
/** Matches the CSS transition on .tour, the way image-viewer.js matches its own. */
const FADE_MS = 180;
/** Breathing room between the highlighted rect and the cutout edge. */
const HALO = 8;

let active = null;      // { el, steps, i, ... } while an overlay is up
let pending = false;    // a settle timer is armed; a second mount must not arm another
let replayArmed = false; // Settings asked for a replay: bypass the seen flag exactly once

/* Reduced motion is handled entirely in CSS (flows.css kills the transitions) — the tour itself
   runs identically either way, including the settle above. */

const routeNow = () => ((location.hash || '#home').slice(1).split('/')[0] || 'home');

const anchorEl = (name) => {
  try { return document.querySelector(`[data-tour="${name}"]`); }
  catch { return null; }
};

/* ---------------- the overlay ---------------- */

/* FLIP: the ring and card land at their NEW geometry instantly, then travel there visually as a
   transform easing back to identity — never as animated top/left/width/height (DESIGN.md: never
   animate a layout property; these two were the last violators). Mid-flight advances are fine:
   getBoundingClientRect reads the transformed position, so the next hop starts from wherever the
   element visually is. Reduced motion skips the travel entirely, matching the old CSS block. */
const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
function flipFrom(node, before, withScale) {
  if (!before || !before.width || reducedMotion()) return;
  const after = node.getBoundingClientRect();
  if (!after.width) return;
  const dx = before.left - after.left, dy = before.top - after.top;
  const sx = withScale ? before.width / after.width : 1;
  const sy = withScale ? before.height / after.height : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  node.style.transition = 'none';
  node.style.transformOrigin = '0 0';
  node.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  requestAnimationFrame(() => {
    node.style.transition = 'transform var(--dur-2) var(--ease-out)';
    node.style.transform = '';
  });
}

function paintStep() {
  if (!active) return;
  const step = active.steps[active.i];
  const el = anchorEl(step.anchor);
  if (!el) { advance(); return; } // vanished mid-tour (async slot emptied) — skip, don't stall

  const ringPrev = active.painted ? active.ring.getBoundingClientRect() : null;
  const cardPrev = active.painted ? active.card.getBoundingClientRect() : null;

  const r = el.getBoundingClientRect();
  const vp = { width: window.innerWidth, height: window.innerHeight };
  const hole = {
    top: Math.max(0, r.top - HALO),
    left: Math.max(0, r.left - HALO),
    width: Math.min(vp.width, r.width + HALO * 2),
    height: r.height + HALO * 2,
  };

  const [pT, pB, pL, pR] = active.panels;
  const px = (n) => `${Math.round(n)}px`;
  pT.style.cssText = `top:0;left:0;width:100%;height:${px(hole.top)}`;
  pB.style.cssText = `top:${px(hole.top + hole.height)};left:0;width:100%;bottom:0`;
  pL.style.cssText = `top:${px(hole.top)};left:0;width:${px(hole.left)};height:${px(hole.height)}`;
  pR.style.cssText = `top:${px(hole.top)};left:${px(hole.left + hole.width)};right:0;height:${px(hole.height)}`;

  // Match the ring to the shape it surrounds: a squircle drawn around the circular log FAB is the
  // one thing here that reads as a generic tour library rather than this app.
  let radius = 'var(--r-card)';
  try {
    const cr = getComputedStyle(el).borderTopLeftRadius || '';
    const n = parseFloat(cr) || 0;
    if (cr.includes('%') || n >= Math.min(r.width, r.height) / 2 - 0.5) radius = '999px';
  } catch { /* keep the card radius */ }
  active.ring.style.cssText = `top:${px(hole.top)};left:${px(hole.left)};width:${px(hole.width)};height:${px(hole.height)};border-radius:${radius}`;

  const last = active.i === active.steps.length - 1;
  active.title.textContent = step.title;
  active.body.textContent = step.body;
  active.count.textContent = active.steps.length > 1 ? `${active.i + 1} of ${active.steps.length}` : '';
  active.next.textContent = last ? 'Done' : 'Next';
  active.skip.style.visibility = last ? 'hidden' : 'visible';
  active.back.style.visibility = active.i > 0 ? 'visible' : 'hidden';

  // Measure after the text lands, or the card is placed against the previous step's height.
  const c = active.card.getBoundingClientRect();
  const pos = placeCard(r, { width: c.width || 280, height: c.height || 120 }, vp);
  active.card.style.top = `${Math.round(pos.top)}px`;
  active.card.style.left = `${Math.round(pos.left)}px`;
  active.card.setAttribute('data-placement', pos.placement);

  // The card travels position-only (its height changes with the copy and should snap); the ring
  // travels and rescales, since its whole identity is "the same ring moved to the next thing".
  flipFrom(active.ring, ringPrev, true);
  flipFrom(active.card, cardPrev, false);
  active.painted = true;

  try { active.next.focus({ preventScroll: true }); } catch { /* older WebView */ }
}

function advance() {
  if (!active) return;
  if (active.i >= active.steps.length - 1) { close(); return; }
  active.i += 1;
  paintStep();
}

/* Step back one. Never an exit: on step 1 it is hidden (paintStep), and Skip/Done own leaving. */
function retreat() {
  if (!active || active.i === 0) return;
  active.i -= 1;
  paintStep();
}

function close() {
  if (!active) return;
  const a = active;
  active = null;
  try { document.removeEventListener('keydown', a.onKey); } catch { /* not attached */ }
  try { window.removeEventListener('resize', a.onResize); } catch { /* not attached */ }
  try { window.removeEventListener('hashchange', a.onHash); } catch { /* not attached */ }
  if (a.lock) { try { a.lock.el.style.overflow = a.lock.prev; } catch { /* gone with a repaint */ } }
  try { if (a.restore && document.contains(a.restore)) a.restore.focus({ preventScroll: true }); }
  catch { /* the element it came from is gone — leave focus where the browser put it */ }
  a.el.classList.remove('on');
  setTimeout(() => { try { a.el.remove(); } catch { /* already gone */ } }, FADE_MS);
}

/**
 * Open the overlay on a finished plan. Assumes the caller has already resolved anchors.
 * Marks the tour seen at first paint — see act.markTourSeen for why show, not finish.
 */
function open(id, steps) {
  if (active || !steps.length) return false;

  const el = document.createElement('div');
  el.className = 'tour';
  el.innerHTML = `
    <div class="tour-panel" data-p="t"></div>
    <div class="tour-panel" data-p="b"></div>
    <div class="tour-panel" data-p="l"></div>
    <div class="tour-panel" data-p="r"></div>
    <div class="tour-ring" aria-hidden="true"></div>
    ${/* No aria-modal: the cutout deliberately leaves the highlighted element interactive, and
          aria-modal would tell AT the page behind this card does not exist while the tour is
          actively pointing at it. */''}
    <div class="tour-card" role="dialog" aria-labelledby="tour-t">
      <div class="tour-count" aria-hidden="true"></div>
      <div class="tour-t" id="tour-t"></div>
      <div class="tour-b"></div>
      <div class="tour-actions">
        <button class="tour-back" type="button">Back</button>
        <button class="tour-skip" type="button">Skip</button>
        <button class="tour-next btn primary sm" type="button">Next</button>
      </div>
    </div>`;

  document.body.appendChild(el);

  const restore = document.activeElement;
  // Lock the scrolling container, not the body: this overlay points AT a screen, and letting that
  // screen scroll away underneath the cutout is the one failure a static highlight can't survive.
  let lock = null;
  const vpEl = document.getElementById('viewport');
  if (vpEl) { lock = { el: vpEl, prev: vpEl.style.overflow }; vpEl.style.overflow = 'hidden'; }

  active = {
    el, steps, i: 0, restore, lock,
    panels: ['t', 'b', 'l', 'r'].map((p) => el.querySelector(`[data-p="${p}"]`)),
    ring: el.querySelector('.tour-ring'),
    card: el.querySelector('.tour-card'),
    title: el.querySelector('.tour-t'),
    body: el.querySelector('.tour-b'),
    count: el.querySelector('.tour-count'),
    next: el.querySelector('.tour-next'),
    skip: el.querySelector('.tour-skip'),
    back: el.querySelector('.tour-back'),
    onKey: (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowRight') advance();
      if (e.key === 'ArrowLeft') retreat();
    },
    onResize: () => paintStep(),
    // Leaving the screen ends the tour — every anchor it knows about lives here. But only a real
    // route CHANGE counts: boot writes location.hash back to the route it is already on, and
    // treating that as navigation closed the tour ~12ms after it opened.
    route: routeNow(),
    onHash: () => { if (active && routeNow() !== active.route) close(); },
  };

  active.next.addEventListener('click', advance);
  active.skip.addEventListener('click', close);
  active.back.addEventListener('click', retreat);
  // A tap on the dimmed area is deliberately a NO-OP: it used to advance, so a stray tap while
  // reading skipped a step with no way back. Next/Back move; Skip and Done are the exits.
  document.addEventListener('keydown', active.onKey);
  window.addEventListener('resize', active.onResize);
  window.addEventListener('hashchange', active.onHash);

  requestAnimationFrame(() => {
    el.classList.add('on');
    paintStep();
  });

  if (id) act.markTourSeen(id);
  buzz('reveal');
  return true;
}

/* ---------------- entry points ---------------- */

function context(replay) {
  return {
    role: RT.authRole,
    audience: (() => { try { return S.audience; } catch { return null; } })(),
    goal: (RT.profile && RT.profile.baseGoal) || (RT.ob && RT.ob.goal) || null,
    hasCoach: !!(RT.myCoach || RT.myTrainer),
    hasStandards: Array.isArray(RT.csRows) && RT.csRows.length > 0,
    seenAt: (RT.tourSeen || {})[TOUR_IDS[RT.authRole]] || null,
    // The server birthday (profiles.created_at, hydrated by _loadProfileIntoRt). Missing until
    // that fetch lands, which planTour treats as "not now" — the seen flag stays unwritten, so a
    // later boot with a hydrated profile self-heals. Only a brand-new account auto-tours.
    createdAt: (RT.profile && RT.profile.createdAt) || null,
    now: Date.now(),
    route: routeNow(),
    replay,
  };
}

/**
 * Called at the end of a landing screen's mount(). Safe to call on every repaint — the work is
 * guarded three ways and the common case (already seen) costs one object and a map lookup.
 */
export function maybeStartTour() {
  if (active || pending) return;
  const replay = replayArmed;
  const plan = planTour(context(replay));
  if (!plan.steps.length) return;

  pending = true;
  const go = () => {
    pending = false;
    if (active) return;
    // Nothing else may be on screen: a tour landing on top of the day-locked stamp is two modals.
    if (overlayOpen('.tour')) return;
    // Re-plan at fire time — 600ms is long enough for another device to have marked it, for the
    // athlete to have navigated away, or for the async slots to have filled in more anchors.
    const fresh = planTour(context(replay));
    if (!fresh.steps.length) return;
    const steps = filterSteps(fresh.steps, (a) => {
      const el = anchorEl(a);
      return el ? el.getBoundingClientRect() : null;
    });
    if (!steps.length) return;
    replayArmed = false;
    open(fresh.id, steps);
  };
  // The wait is NOT only about animation, which is why reduced-motion gets it too: Home renders
  // several times during early load (standards, commitments, receipts all repaint on arrival),
  // and a tour that opens into that churn is pointing at elements about to be replaced.
  setTimeout(go, SETTLE_MS);
}

/** Settings' "Replay app tour": arm the bypass, then navigate. The landing screen's mount picks
    it up — navigation re-renders asynchronously, so we can't just call open() here. */
export function armReplay() {
  replayArmed = true;
  const route = routeForRole(RT.authRole);
  if (routeNow() === route) maybeStartTour();
  else location.hash = `#${route}`;
}

/**
 * A one-step spotlight for a screen the main tour never covered.
 *
 * For a brand-new account, suppressed until the role's main tour has been seen, so nobody is
 * spotlighted twice in one session. An account too old for the main tour (the first-signup gate)
 * would satisfy that condition never — so age itself unlocks tips there: no main tour is coming,
 * hence no double-spotlight risk. Device-local only — no server column, by design.
 */
export function maybeShowTip(id, tip) {
  if (active || pending || !id || !tip) return;
  const seen = RT.tourSeen || {};
  if (seen[id]) return;
  const mainId = TOUR_IDS[RT.authRole];
  if (!mainId) return;
  if (!seen[mainId] && isNewAccount((RT.profile && RT.profile.createdAt) || null, Date.now())) return;

  pending = true;
  setTimeout(() => {
    pending = false;
    if (active || (RT.tourSeen || {})[id]) return;
    if (overlayOpen('.tour')) return;
    const steps = filterSteps([tip], (a) => {
      const el = anchorEl(a);
      return el ? el.getBoundingClientRect() : null;
    }, { min: 1 });
    if (!steps.length) return;
    open(id, steps);
  }, SETTLE_MS);
}

/** Test/QC seam: forget that anything has been shown in THIS page session. Never called by app code. */
export function resetTourRuntime() {
  if (active) close();
  pending = false;
  replayArmed = false;
}
