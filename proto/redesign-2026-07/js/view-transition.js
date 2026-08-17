/* Nothing ever cuts — the navigation spine, as one continuous surface.
 *
 * The router paints the whole app by replacing `#device.innerHTML` in a single statement. That is
 * the cheapest possible render and it has always had exactly one cost: the outgoing screen never
 * exists. `.view.enter` animates the ARRIVING content (and does it well, with real direction
 * grammar), but it animates it in over a screen that vanished a frame earlier. Every navigation in
 * the app is a hard cut with a fade-up glued to the back of it.
 *
 * The View Transitions API is the one thing that fixes that without restructuring the router: it
 * snapshots the old document, runs our DOM update, snapshots the new one, and animates between
 * them. One innerHTML swap is the ideal shape for it — there is a single, unambiguous moment to
 * wrap.
 *
 * WHAT GETS A TRANSITION, AND WHAT DOES NOT
 *
 * Only a navigation the router can NAME, and only three of the five names it uses: push, pop and
 * tab (see DIRS). Everything else falls through to the synchronous path unchanged:
 *
 *   - a same-route repaint (window.__render) — Home repaints constantly for commitments, activity
 *     standards, the coach receipt, participant names. Transitioning those is the settled-list-
 *     sliding-around bug with a bigger budget.
 *   - a move across a screen's own tab strip, which has a better animation already.
 *   - first paint and boot deep-links — there is nothing to transition FROM; that swap is what
 *     `.settle` already covers.
 *   - reduced motion, and any browser without the API.
 *
 * WHAT IS NAMED
 *
 * `.screen` travels; the status bar and tab bar are promoted out of it and hold still; the bezel
 * and island stay in the root capture, identical on both sides. See the block above VIEW_NAME for
 * why the sheet has to be `.screen` and not the viewport inside it.
 *
 * Plus, optionally, one shared element (`vt-shared`) so a thing can survive the navigation instead
 * of being destroyed and rebuilt somewhere else. See the pairing contract below.
 *
 * THE NAMES ARE STAMPED, NEVER DECLARED
 *
 * `view-transition-name` in a stylesheet would be live on every frame the app ever paints, and it
 * makes its element a containing block for fixed descendants. Nothing in this app needs to pay
 * that for the 99.9% of its life when no transition is running, so the names go on as inline
 * properties immediately before the capture and come off on `finished`. Two elements sharing a
 * name aborts the WHOLE transition, so the shared name is only ever stamped when the selector
 * matches exactly once — on both sides.
 *
 * THE PAIRING CONTRACT
 *
 * An element declares `data-vt="<key>"`. The router remembers the tapped element (or the single
 * `[data-vt]` inside it) and hands both the node and its key here.
 *
 * The two sides resolve DIFFERENTLY, and that asymmetry is the point. Outgoing: the tapped node is
 * named directly, never searched for, so a screen may hold many elements under one key — Home shows
 * today's lunch beside yesterday's lunch and the day before's dinner, every one of them a meal
 * photograph wanting the same `plate` key. Incoming: resolved by key and required to match exactly
 * once, because there is no tap to read and two elements sharing a name aborts the whole transition.
 *
 * If the incoming side has no match, nothing breaks: the sheet transition runs alone. That is the
 * whole failure mode, and it is why a screen can adopt `data-vt` without coordinating with anything.
 *
 * WHY REVEALS PAUSE
 *
 * `mod.mount()` runs inside the update callback, which is where score reveals fire. Two things
 * follow. A reveal that plays there draws its arc while the screen is still travelling, which is
 * the moment being spent off to the side of the user's attention. And a ring that just MORPHED
 * across the navigation has already had its moment: winding it back to zero to draw it again is
 * the same ceremony twice, with the second one contradicting the first. So reveals are paused for
 * the duration and then either played (no morph happened) or dropped (one did).
 */
import { pauseReveals, resumeReveals } from './motion.js';

/* What travels, and what is promoted out of it so it can hold still.
 *
 * `.screen` is the sheet, NOT `#viewport`. That distinction was the whole difference between a
 * transition that looked right and one that looked like a double exposure: the viewport is
 * transparent by design (the canvas gradient and its grain live on `.screen`), so an incoming
 * viewport snapshot cannot occlude the outgoing screen no matter what opacity it is given, and the
 * two screens read as printed on top of each other for the length of the travel. `.screen` carries
 * the background, so it arrives as an opaque sheet and covers what it is replacing, which is what
 * every native push has always done.
 *
 * The status bar and tab bar are named for the opposite reason. A named descendant is captured
 * separately and EXCLUDED from its ancestor's snapshot, so naming them lifts them out of the sheet
 * and leaves them standing still while it slides underneath. Chrome that slid with the content
 * would be the app itself appearing to move. */
const VIEW_NAME = 'vt-view';
const SHARED_NAME = 'vt-shared';
const HELD = [['.statusbar', 'vt-status'], ['.tabbar', 'vt-tabs']];

/* Which gestures a whole-sheet transition is the RIGHT answer for.
 *
 * 'lat-next' / 'lat-prev' are deliberately absent. A move across a screen's own tab strip changes
 * only the strip's contents, and `.view.enter.dir-lat-*` already animates exactly that: #view
 * alone, 10px, --dur-1, with the screen's header and the strip itself standing still. Sliding the
 * whole sheet for it would move the tab strip the athlete is tapping across, which is a worse
 * animation than the one this file would be replacing. Declining here is what keeps that path
 * live. */
const DIRS = new Set(['push', 'pop', 'tab']);

/* A key goes straight into an attribute selector, so it may only contain characters that cannot
   terminate one. Real keys are short identifiers ('score', 'meal:lunch'); anything else is a
   caller bug and is refused rather than escaped, because a silently-mangled key would pair with
   nothing and look exactly like a missing target. */
const SAFE_KEY = /^[A-Za-z0-9:_.-]{1,64}$/;

/* Which transition owns the cleanup. A second navigation started mid-flight causes the browser to
   skip the first, whose `finished` then rejects — and if that rejection stripped names, it would
   strip the ones the SECOND transition had just stamped, aborting it too. Only the current token
   is allowed to clean up. */
let token = 0;

/** True while a view transition is capturing or animating. */
export function transitioning() { return token > 0 && CURRENT !== null; }
let CURRENT = null;

/* Work that must not land in the middle of a transition.
 *
 * The one that matters is a same-route repaint. Screens fetch in mount() and call window.__render()
 * when the data arrives, which replaces #device.innerHTML — and doing that mid-flight destroys the
 * very element the browser is animating, so the browser cuts the transition short. Measured on a
 * tab switch into Plan against an instant (mocked) backend: a 280ms transition ended after 74ms,
 * as a cut, because Plan's targets landed before the screen had finished arriving.
 *
 * Deferring is also the better behaviour on its own terms. A skeleton turning into real content
 * underneath a sliding sheet is content changing in a place the reader is not yet looking, and it
 * is the same class of problem `.view.enter`'s repaint gate already exists to prevent. The cost is
 * that data can wait up to one transition (280ms) to appear, which is a fair price for never
 * showing it arriving sideways. */
const SETTLED = [];

/**
 * Run `fn` once the current transition has finished, or immediately if none is running.
 * Never queues past a single transition: whatever is waiting runs at the next settle.
 */
export function afterTransition(fn) {
  if (!transitioning()) { fn(); return; }
  SETTLED.push(fn);
}

function drain() {
  const held = SETTLED.splice(0, SETTLED.length);
  for (const fn of held) { try { fn(); } catch { /* a deferred repaint must not break cleanup */ } }
}

function supported() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

function reducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/* The sliding sheet is clipped to the frame by `clip-path: inset(0)` on its own group — see the
   long note in css/view-transition.css for why the group and why `inset(0)` rather than a measured
   rect. The one thing a self-referential clip cannot know is the frame's corner rounding, so that
   single value comes from here.
 *
 * Wholesale try/catch, and deliberately so: rounded corners are decoration, a navigation is not.
 * There is no version of "the corners squared off for 280ms" that justifies costing the athlete
 * their tap, and a missing custom property just falls back to square. */
function setRadius() {
  const root = document.documentElement;
  try {
    const scr = document.querySelector('.screen');
    const radius = scr ? (getComputedStyle(scr).borderTopLeftRadius || '') : '';
    if (radius) root.style.setProperty('--vt-radius', radius);
    else root.style.removeProperty('--vt-radius');
  } catch {
    try { root.style.removeProperty('--vt-radius'); } catch { /* nothing left to clean */ }
  }
}

/** Stamp the transition names on one side of the swap. Returns the elements stamped, and whether
 *  the shared element found exactly one home here.
 *
 *  `allowShared` is how the incoming side learns that the outgoing side failed to pair. A name
 *  present on only ONE side does not morph — the browser reads it as an element entering or
 *  leaving on its own, and animates it by itself, above the sheet. So the incoming side does not
 *  claim the name unless there is something for it to arrive from. (The reverse, an outgoing
 *  element with no counterpart, cannot be undone: its snapshot was taken before the update ran.
 *  That one is left to fade, which is at least honest about what is happening to it.) */
function stamp(scope, key, allowShared = true, node = null) {
  const named = [];
  const view = scope.querySelector('.screen');
  if (view && view.style) { view.style.viewTransitionName = VIEW_NAME; named.push(view); }
  for (const [sel, name] of HELD) {
    const el = scope.querySelector(sel);
    if (el && el.style) { el.style.viewTransitionName = name; named.push(el); }
  }
  let paired = false;
  if (allowShared) {
    /* The OUTGOING side knows exactly which element the finger was on, so it names THAT and never
       searches. This is what lets a screen hold several elements under one key: Home shows today's
       lunch beside yesterday's lunch and the day before's dinner, all of them a meal photograph,
       all of them wanting the same `plate` key on the far side. Searching by key there would find
       three, refuse to pair (correctly — it cannot know which), and quietly drop the morph on the
       most obvious surface in the app. Naming the tapped node makes the ambiguity disappear,
       because there was never any: the user resolved it by tapping.
       The INCOMING side still searches and still demands exactly one, because there is no tap to
       read there and two elements sharing a name aborts the whole transition. */
    const hit = (node && node.isConnected) ? node
      : (key && SAFE_KEY.test(key) ? onlyMatch(scope, key) : null);
    if (hit && hit.style) {
      hit.style.viewTransitionName = SHARED_NAME;
      named.push(hit);
      paired = true;
    }
  }
  return { named, paired };
}

/** The single `[data-vt="key"]` in `scope`, or null when there are none or more than one. */
function onlyMatch(scope, key) {
  const hits = scope.querySelectorAll(`[data-vt="${key}"]`);
  return hits.length === 1 ? hits[0] : null;
}

function unstamp(named) {
  for (const el of named) {
    try { el.style.viewTransitionName = ''; } catch { /* detached by a later render */ }
  }
}

/**
 * Whether `withTransition` would actually transition for this direction.
 *
 * Exists because the caller has to know BEFORE it builds its markup: a screen that is about to be
 * slid in by a transition must not also carry its own entrance class. Same conditions as
 * withTransition, minus the one thing that cannot be predicted (startViewTransition itself
 * throwing) — and a false positive there costs a single entrance animation, never a navigation.
 *
 * @param {string?} dir the gesture, or null/undefined for "no transition"
 */
export function canTransition(dir) {
  return DIRS.has(dir) && supported() && !reducedMotion() && !!document.getElementById('device');
}

/**
 * Run `commit` inside a view transition when the router knows what gesture caused it.
 *
 * ALWAYS calls `commit` exactly once, on every path including every failure path. A transition is
 * decoration; the navigation is not, and no browser quirk may cost the user their tap.
 *
 * @param {object}   opts
 * @param {string?}  opts.dir  'push' | 'pop' | 'tab' | 'lat-next' | 'lat-prev', or null to skip
 * @param {string?}  opts.key  `data-vt` key of the element to carry across, if any
 * @param {Element?} opts.node the element the user actually TAPPED, when there was a tap. Used
 *                             for the outgoing side only; the incoming side always resolves by
 *                             key. Lets one screen hold several elements under one key.
 * @param {Function} commit    the synchronous DOM update (innerHTML + wiring + scroll + mount)
 * @returns {boolean} whether the update ran inside a transition (i.e. asynchronously)
 */
export function withTransition({ dir, key, node = null } = {}, commit) {
  if (!DIRS.has(dir) || !supported() || reducedMotion()) { commit(); return false; }
  const device = document.getElementById('device');
  if (!device) { commit(); return false; }

  setRadius();
  const before = stamp(device, key, true, node);
  const root = document.documentElement;
  root.setAttribute('data-vt-dir', dir);

  const mine = ++token;
  CURRENT = dir;
  pauseReveals();

  let after = { named: [], paired: false };
  let t;
  try {
    t = document.startViewTransition(() => {
      commit();
      after = stamp(device, key, before.paired, null);
    });
  } catch {
    // The API exists but refused (a nested call, a detached document). The names are already on
    // the OLD nodes, which the commit is about to destroy, so there is nothing to unwind there.
    unstamp(before.named);
    if (mine === token) { CURRENT = null; root.removeAttribute('data-vt-dir'); }
    commit();
    resumeReveals({ drop: false });
    drain();
    return false;
  }

  const done = () => {
    if (mine !== token) return;   // a newer navigation owns the frame now; it will clean up
    CURRENT = null;
    unstamp(after.named);
    root.removeAttribute('data-vt-dir');
    root.style.removeProperty('--vt-radius');
    // A morph already showed the number. Anything else still owes the athlete its reveal.
    resumeReveals({ drop: before.paired && after.paired });
    // CURRENT is already null, so anything queued here that renders again is not re-deferred.
    drain();
  };
  t.finished.then(done, done);
  return true;
}
