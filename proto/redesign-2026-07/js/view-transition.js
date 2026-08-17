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
 * Only a move the router can NAME: push, pop, tab, and `restate` (see DIRS, and the block above
 * ROW_ATTR for what restate is and why it is not the same thing as a repaint). Everything else falls
 * through to the synchronous path unchanged:
 *
 *   - a same-route repaint from window.__render() — Home repaints constantly for commitments,
 *     activity standards, the coach receipt, participant names. Transitioning those is the
 *     settled-list-sliding-around bug with a bigger budget. window.__restate() is the separate door
 *     for the repaints a USER asked for.
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
const DIRS = new Set(['push', 'pop', 'tab', 'restate', 'overlay']);

/* 'restate' is the odd one, and the distinction it draws is the whole point of it.
 *
 * The app repaints the current screen constantly through window.__render(), and every one of those
 * is excluded above — Home alone repaints for commitments, activity standards, the coach receipt and
 * participant names, and animating those is the settled-list-sliding-around bug.
 *
 * But two very different events were sharing that one door. "The data arrived" is content resolving
 * in place, and it should not move. "The user changed what they are looking at" — a sort, a filter
 * chip, a search, a group expanding — is a different thing entirely: the athlete or coach asked for
 * the change, and in a re-ordered list the MOVEMENT IS THE INFORMATION. A roster of fourteen rows
 * re-sorting by score is telling you something, and snapping to the new order throws that away.
 * window.__restate() is that second door.
 *
 * A restate names no sheet, because no sheet is travelling. It names ROWS (`data-vt-row`), which the
 * browser then tweens from their old positions to their new ones — the default group animation is
 * exactly a position-and-size tween, so the glide costs no CSS at all. Everything unnamed stays in
 * the root capture and cross-fades in place, which for a header that did not change is invisible. */
/* 'overlay' is the third shape: something opens ON TOP of the screen it belongs to, rather than
 * replacing it. The full-screen photo viewer is the case it exists for — a thumbnail in a meal
 * thread grows into the whole screen and later shrinks back into the exact thumbnail it came from.
 *
 * Nothing structural is named for it. The screen underneath is not going anywhere, so naming the
 * sheet would capture it as a travelling image for no reason; the only thing moving is the photo.
 * The overlay's own backdrop is left to the root capture's cross-fade, which is exactly the fade it
 * would have done for itself.
 *
 * Both ends come in as NODES (`node` and `nodeAfter`), because the caller built the incoming element
 * and no search could find it — and because the thumbnail it came from is still sitting in the DOM
 * underneath, so a key shared by both would match twice and refuse to pair. */
const ROW_ATTR = 'data-vt-row';
const ROW_CLASS = 'vtrow';

/* A ceiling on how many rows may be promoted in one restate.
 *
 * Each named element becomes four pseudo-elements and its own compositor layer, so a 400-row list
 * would spend more time building the transition than the transition lasts. Forty is well past any
 * list a phone shows at once (a 14-person roster, a week of days) and far short of anything that
 * costs a frame. Over the cap, nothing is named and the restate degrades to the cross-fade — the
 * list still updates, it just does not glide. */
const ROW_CAP = 40;

/** Sanitise an author-supplied row id into a valid custom-ident. */
function rowName(id) {
  return 'vtr-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48);
}

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
/* Three shapes of transition, and each names a different set of things:
 *   'sheet'   a navigation. .screen travels, chrome is promoted out, one optional shared element.
 *   'rows'    a restate. Nothing travels but the rows, which rearrange inside a still frame.
 *   'shared'  an overlay opening or closing over the screen it belongs to. NOTHING structural is
 *             named — not the sheet, not the chrome — because none of it is going anywhere; only
 *             the one element that grows out of the page and later shrinks back into it. */
function stamp(scope, { key = null, allowShared = true, node = null, id = null, mode = 'sheet' } = {}) {
  const named = [];
  if (mode === 'rows') {
    /* A restate: no sheet, only rows. Naming `.screen` here would make the whole screen a single
       travelling image, which is the opposite of what is wanted — the point is that the frame stands
       still while its contents rearrange inside it. */
    named.push(...stampRows(scope));
    return { named, paired: false };
  }
  if (mode === 'sheet') {
    const view = scope.querySelector('.screen');
    if (view && view.style) { view.style.viewTransitionName = VIEW_NAME; named.push(view); }
    for (const [sel, name] of HELD) {
      const el = scope.querySelector(sel);
      if (el && el.style) { el.style.viewTransitionName = name; named.push(el); }
    }
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
      : (key && SAFE_KEY.test(key) ? onlyMatch(scope, key, id) : null);
    if (hit && hit.style) {
      hit.style.viewTransitionName = SHARED_NAME;
      named.push(hit);
      paired = true;
    }
  }
  return { named, paired };
}

/** Name every `[data-vt-row]` in `scope` so the browser tweens it from where it was to where it is.
 *
 *  A duplicate id would abort the whole transition, so ids are deduplicated here rather than trusted:
 *  a row list is generated in a loop, and a loop that repeats a key is a normal mistake to make.
 *  The first claimant wins and the rest go unnamed, which costs those rows their glide and nothing
 *  else. Over ROW_CAP, nobody is named. */
function stampRows(scope) {
  const rows = scope.querySelectorAll(`[${ROW_ATTR}]`);
  if (!rows.length || rows.length > ROW_CAP) return [];
  const named = [];
  const seen = new Set();
  for (const row of rows) {
    const id = row.getAttribute(ROW_ATTR);
    if (!id) continue;
    const name = rowName(id);
    if (seen.has(name)) continue;
    seen.add(name);
    if (!row.style) continue;
    row.style.viewTransitionName = name;
    /* Every row needs the same timing, and each one has a DIFFERENT name, so there is no selector
       that reaches them all by name. `view-transition-class` is what the group selector in
       css/view-transition.css matches on. Where it is unsupported the assignment is a silent no-op
       and the rows keep the UA's own 250ms — near enough to --dur-2 that nobody could pick it out,
       which is exactly the fallback you want for a property this new. */
    row.style.viewTransitionClass = ROW_CLASS;
    named.push(row);
  }
  return named;
}

/** The one element in `scope` that this key (and optional instance id) resolves to, or null.
 *
 * The id is tried FIRST and the plain key is the fallback, which is what makes one function correct
 * for both sides of a back-pop without either side needing to know which it is. Returning from a
 * meal detail: the detail's hero has no id, so the id-qualified selector finds nothing and the plain
 * key resolves it; the Home being returned to has three cards WITH ids, where the plain key would
 * find three and refuse, and the id picks out the one that was tapped on the way in.
 */
function onlyMatch(scope, key, id = null) {
  if (id && SAFE_KEY.test(id)) {
    const exact = scope.querySelectorAll(`[data-vt="${key}"][data-vt-id="${id}"]`);
    if (exact.length === 1) return exact[0];
  }
  const hits = scope.querySelectorAll(`[data-vt="${key}"]`);
  return hits.length === 1 ? hits[0] : null;
}

function unstamp(named) {
  for (const el of named) {
    try {
      el.style.viewTransitionName = '';
      el.style.viewTransitionClass = '';
    } catch { /* detached by a later render */ }
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
 * @param {string?}  opts.id   instance id (`data-vt-id`) to prefer when a key matches several.
 *                             Comes off the back stack on a pop, where there is no tap to read.
 * @param {Element?} opts.node the element the user actually TAPPED, when there was a tap. Used
 *                             for the outgoing side only; the incoming side always resolves by
 *                             key. Lets one screen hold several elements under one key.
 * @param {Function} commit    the synchronous DOM update (innerHTML + wiring + scroll + mount)
 * @returns {boolean} whether the update ran inside a transition (i.e. asynchronously)
 */
export function withTransition({ dir, key, node = null, id = null, nodeAfter = null } = {}, commit) {
  if (!DIRS.has(dir) || !supported() || reducedMotion()) { commit(); return false; }
  const device = document.getElementById('device');
  if (!device) { commit(); return false; }

  setRadius();
  const mode = dir === 'restate' ? 'rows' : dir === 'overlay' ? 'shared' : 'sheet';
  const before = stamp(device, { key, node, id, mode });
  const root = document.documentElement;
  root.setAttribute('data-vt-dir', dir);

  const mine = ++token;
  CURRENT = dir;
  pauseReveals();

  let after = { named: [], paired: false };
  let t;
  try {
    t = document.startViewTransition(() => {
      /* An overlay's outgoing element SURVIVES, and that is what makes this line necessary.
       *
       * For a navigation the commit replaces #device.innerHTML, so the nodes named a moment ago are
       * gone and their names go with them. An overlay is added on TOP of the screen it belongs to:
       * the thumbnail is still sitting there holding `vt-shared` when the full-size image claims the
       * same name, which is a duplicate — and a duplicate aborts the ENTIRE transition and then
       * leaks the name onto the surviving element afterwards. Both were observed.
       *
       * Releasing it here is safe: the browser took the outgoing snapshot BEFORE this callback ran,
       * so the capture it needs is already made. */
      if (mode === 'shared') unstamp(before.named);
      commit();
      /* `nodeAfter` is for a caller that BUILT the incoming element and therefore knows it exactly —
         an overlay, where the thing that grows out of the page did not exist a moment ago and has no
         `data-vt` to be found by. It also avoids a trap the search would walk into: the thumbnail
         that opened the viewer is still in the DOM underneath it, so a key present on both would
         match twice and refuse. */
      const incoming = typeof nodeAfter === 'function' ? nodeAfter() : null;
      after = stamp(device, { key, allowShared: before.paired, node: incoming, id, mode });
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
