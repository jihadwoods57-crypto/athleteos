/* Hash router + chrome (status bar, tab bar). Screens register in js/screens/index.js */
import { S, act, RT, routeForRole } from './state.js';
import { icon } from './icons.js';
import { skeletonRows } from './components.js';
import { screens } from './screens/index.js';
import { initAnalytics, track, EVENTS } from './analytics.js';
import { emptyNav, pushOrigin, popOrigin, peekOrigin, resetTab } from './nav-stack.js';
import { initKeyboard } from './keyboard.js';
import { withTransition, canTransition, transitioning, afterTransition } from './view-transition.js';

// Shell-level and route-independent: the keyboard has to behave the same on the composer, the food
// search box and a profile field, and #device outlives every render() so this is wired once here
// rather than in seven mounts. Inert until something focusable is actually focused.
initKeyboard();

/* Each role gets its own dashboard shell — not a modal off someone else's app. */
const NAVS = {
  athlete: [
    { id: 'home',     route: 'home',     label: 'Home',     icon: 'home' },
    { id: 'plan',     route: 'plan',     label: 'Plan',     icon: 'clipboard' },
    { id: 'camera',   route: 'log',      label: '',         icon: 'camera', fab: true },
    { id: 'progress', route: 'progress', label: 'Progress', icon: 'bars' },
    { id: 'profile',  route: 'profile',  label: 'Profile',  icon: 'user' },
  ],
  // The fifth tab is You (account + settings + SIGN OUT), matching the athlete shell.
  // It used to be Insights/Grow, and profile had no tab at all — its only door was a 40px
  // circle of initials in the header, which the founder could not find. Account settings and
  // sign-out are not a power feature to hunt for; every other role's shell puts them in the bar.
  // Insights and Grow keep their routes and are one tap deeper, under You.
  coach: [
    { id: 'home',    route: 'coach-home',    label: 'Home',   icon: 'home' },
    { id: 'roster',  route: 'coach-roster',  label: 'Roster', icon: 'users' },
    { id: 'create',  route: 'coach-create',  label: '',       icon: 'plus', fab: true },
    { id: 'inbox',   route: 'coach-inbox',   label: 'Inbox',  icon: 'message' },
    { id: 'profile', route: 'coach-profile', label: 'You',    icon: 'user' },
  ],
  // Same five tab IDS as coach, so ROOT_TAB below extends rather than forks and every
  // operator-shared screen lights the right tab for either role. Only the routes differ.
  trainer: [
    { id: 'home',    route: 'trainer',          label: 'Home',    icon: 'home' },
    { id: 'roster',  route: 'trainer-roster',   label: 'Clients', icon: 'heart' },
    { id: 'create',  route: 'trainer-create',   label: '',        icon: 'plus', fab: true },
    { id: 'inbox',   route: 'trainer-inbox',    label: 'Inbox',   icon: 'message' },
    { id: 'profile', route: 'trainer-profile',  label: 'You',     icon: 'user' },
  ],
};

/** Which tab bar a screen renders. `nav: 'operator'` means "whichever operator is signed in" —
 *  one screen module, two role shells. Anything else is a literal nav name.
 *  Exported for the router matrix test: both guards below `return` after setting location.hash,
 *  so a wrong answer here is a silent redirect loop with nothing in the console. */
export function navFor(mod, role) {
  if (!mod) return 'athlete';
  if (mod.nav === 'operator') return role === 'trainer' ? 'trainer' : 'coach';
  if (mod.nav) return mod.nav;
  // No declared nav = a shared/utility screen. Render it in the SIGNED-IN role's chrome instead
  // of defaulting to athlete: a parent opening "Fund a plan" or "Funded plans" was handed the
  // ATHLETE tab bar (Home/Plan/Camera/Progress/Profile) under a parent screen — five tabs to
  // places a parent has no account for. Parents have no tab bar of their own, and tabbar()
  // now renders nothing for a nav it has no tabs for.
  return role === 'parent' ? 'parent' : 'athlete';
}
/** Roles allowed to render this screen. An operator screen admits both; anything else admits
 *  exactly the role it names. */
export function navAdmits(mod, role) {
  if (mod.nav === 'operator') return role === 'coach' || role === 'trainer';
  return (mod.nav || 'athlete') === role;
}

function statusbar() {
  // The phone's own status bar (real clock, real battery) renders above the WebView —
  // drawing a second one reads as fake. This strip only reserves the safe-area height.
  return `<div class="statusbar" aria-hidden="true"></div>`;
}

function tabbar(activeTab, nav = 'athlete') {
  // A nav with no tab set renders NO tab bar. Falling back to NAVS.athlete meant an unknown or
  // tab-less role (parent) silently inherited someone else's navigation — failing to nothing is
  // correct here, failing to another role's chrome is not.
  const tabs = NAVS[nav];
  if (!tabs) return '';
  return `<nav class="tabbar" style="grid-template-columns: repeat(${tabs.length}, 1fr)">${tabs.map(t => {
    if (t.fab) {
      // Athlete camera FAB carries the exec status dot (gold = actionable, red = overdue,
      // none = day complete). Other roles' FABs are plain. Glyph never changes.
      let dot = '';
      if (nav === 'athlete') {
        try {
          const e = S.exec;
          dot = e.celebration ? '' : `<span class="fab-dot ${e.overdue.length ? 'red' : 'gold'}"></span>`;
        } catch { /* pre-auth render — no dot */ }
      }
      const fabLabel = nav === 'athlete' ? 'Log a meal' : 'Create';
      // .fabslot carries the scrim that keeps scrolling content from colliding with the FAB's
      // hard edge — see .tabbar .fabslot::before in app.css.
      // data-tour marks the first-run tour's anchor (tour-plan.js). The athlete FAB is the "log"
      // step; the operator FAB got its own "create" step in the v2 tour (2026-08-05).
      const fabTour = nav === 'athlete' ? ' data-tour="log"'
        : (nav === 'coach' || nav === 'trainer') ? ' data-tour="create"' : '';
      return `<div class="tab fabslot"><div class="fab" role="button" tabindex="0" aria-label="${fabLabel}" data-go="${t.route}"${fabTour} style="position:relative">${icon(t.icon, 26)}${dot}</div></div>`;
    }
    const on = t.id === activeTab ? `active ${t.id === 'home' ? 'home' : ''}` : '';
    // Tab badge: any screen exposing badge() → live count, hidden at zero (Coach Inbox pending
    // joins/unopened logs; Trainer Grow new applications). Route-driven so it works for every role.
    let badge = '';
    try {
      const scr = screens[t.route];
      const n = scr && scr.badge ? scr.badge() : 0;
      if (n) badge = `<span style="position:absolute;top:-3px;right:50%;margin-right:-16px;min-width:15px;height:15px;border-radius:999px;background:var(--red);color:#fff;font-size:9px;font-weight:800;display:grid;place-items:center;padding:0 3px;border:2px solid var(--bg)">${n > 9 ? '9+' : n}</span>`;
    } catch { /* pre-auth render */ }
    // First-run tour anchors on the tabs themselves (tour-plan.js). Operator tab anchors are
    // prefixed tab- so they never collide with the board's own `roster` anchor on coach-home.
    const TAB_TOUR = {
      plan: 'plan', progress: 'progress', profile: 'profile',
      'coach-roster': 'tab-roster', 'trainer-roster': 'tab-roster',
      'coach-inbox': 'tab-inbox', 'trainer-inbox': 'tab-inbox',
      'coach-profile': 'tab-you', 'trainer-profile': 'tab-you',
    };
    const tabTour = TAB_TOUR[t.route] ? ` data-tour="${TAB_TOUR[t.route]}"` : '';
    return `<div class="tab ${on}" ${on ? 'aria-current="page"' : ''} data-go="${t.route}"${tabTour} style="position:relative">${badge}${icon(t.icon, 23)}<span>${t.label}</span></div>`;
  }).join('')}</nav>`;
}

function parse() {
  const raw = (location.hash || '#home').slice(1);
  const [route, ...rest] = raw.split('/');
  return { route: route || 'home', sub: rest.join('/') };
}

/**
 * Change the route.
 *
 * `opts` exists for the navigations the router cannot read intent from. A `[data-go]` tap tells it
 * everything: which gesture (navigateTo works it out) and what the finger was on (the `data-vt`
 * mark). A screen that navigates from its OWN code — the shutter firing, an analysis finishing —
 * tells it nothing, so those moves arrived with no direction at all and got the plain fade-up
 * meant for a deep link. The whole meal capture flow was four such moves in a row.
 *
 * @param {string}  route
 * @param {object?} opts
 * @param {string?} opts.dir  the gesture this move should read as ('push' | 'pop' | 'tab')
 * @param {string?} opts.vt   `data-vt` key to carry across it (see js/view-transition.js)
 */
export function go(route, opts) {
  if (opts && opts.dir) { NAV_INTENT = true; NAV_DIR = opts.dir; }
  if (opts && opts.vt) VT_KEY = opts.vt;
  location.hash = '#' + route;
}
window.__go = go;

/* ---------------- Navigation stacks (spec §1.5/§10) ----------------
   Each main tab keeps its own back-stack of {route, scroll} origins. Back (header chevron,
   data-back buttons, swipe-back) returns to the EXACT screen + scroll position the user came
   from; the highlighted bottom tab is the ORIGIN tab, not a per-screen guess. Persisted in
   sessionStorage so an in-session WebView reload keeps its place; a fresh launch starts clean. */
const NAV_KEY = 'onstd-nav-v1';
// Every role's tab-root routes → their tab id (role guards elsewhere keep roles apart).
const ROOT_TAB = {
  home: 'home', plan: 'plan', progress: 'progress', profile: 'profile',
  coach: 'home', 'coach-home': 'home', 'coach-roster': 'roster',
  // coach-insights / trainer-grow are deliberately ABSENT: they stopped being tab roots when You
  // took the fifth slot. Listing them here would reset the profile stack on entry, so their back
  // chevron would have no origin to return to; omitted, they push like any other detail screen
  // and inherit the origin tab (mod.tab = 'profile' remains the deep-link fallback).
  'coach-inbox': 'inbox', 'coach-profile': 'profile',
  'coach-plan': 'roster',
  // trainer-create is deliberately ABSENT, exactly like coach-create above: both routes render
  // the same transient coachCreate module, whose back button pops the pushed origin. Listing it
  // here made the trainer's FAB reset an otherwise-unused 'create' stack instead of pushing the
  // departing screen, so Back from the Create menu dumped the trainer on Home and NAV.tab stayed
  // 'create' (no lit tab) for every detail screen opened from that menu.
  trainer: 'home', 'trainer-roster': 'roster',
  'trainer-inbox': 'inbox', 'trainer-profile': 'profile',
};
let NAV = (() => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const j = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null');
      if (j && j.stacks && j.tab) return j;
    }
  } catch { /* corrupt/blocked store — start clean */ }
  return emptyNav();
})();
function navSave() {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(NAV_KEY, JSON.stringify(NAV)); }
  catch { /* quota — nav still works in-memory this session */ }
}
let NAV_INTENT = false;   // this hash change came from our own handlers (vs browser/swipe back)
let NAV_DIR = null;       // 'push' | 'pop' | 'tab' | 'lat-next' | 'lat-prev' — how the user got
                          // here, so the entrance can match the gesture (detail slides in from the
                          // right, back from the left, a sibling tab slides the way you reached
                          // for, tab roots keep the fade-up). Consumed once per render.
let VT_NODE = null;       // the tapped [data-vt] element itself. The OUTGOING side names this
                          // rather than searching, so one screen may hold several elements under
                          // one key — Home shows three meal photographs at once, all wanting
                          // `plate` on the far side. See stamp() in js/view-transition.js.
let VT_ID = null;         // its `data-vt-id`, when it has one. Stored on the back stack so a pop can
                          // morph back to the SAME element out of a rail of peers.
let VT_KEY = null;        // `data-vt` key of the element the user tapped, so the same thing on the
                          // next screen can be carried across the navigation instead of destroyed
                          // and rebuilt somewhere else. Consumed once per render, exactly like
                          // NAV_DIR — a stale key would pair a screen with whatever the athlete
                          // last touched two navigations ago. See js/view-transition.js.
let RESTORE = null;       // {r, s} — scroll position to restore once that route paints
let LAST_FULL = null;     // the route (route/sub) the previous render painted — lets a same-route
                          // re-render (window.__render) PRESERVE scroll instead of snapping to top (T-08)

function currentFull() { const { route, sub } = parse(); return sub ? `${route}/${sub}` : route; }
function currentScroll() { const vp = document.getElementById('viewport'); return vp ? vp.scrollTop : 0; }

/* A move ACROSS a screen's own sibling tabs, not deeper into it.
 *
 * A screen declares `subs: [...]` when its sub-routes are a tab strip rather than detail pages
 * (Plan's Today / Nutrition / Requirements / Food Memory). Without this, `plan/nutrition` looked
 * exactly like `connected-standard/csr-steps` to the router: a forward push. So tapping across
 * the strip slid the whole screen in from the right — the "you went deeper" grammar for a move
 * that goes sideways — AND pushed each tab onto the back stack, so leaving Plan from the fourth
 * tab took four backs. Both were one missing distinction.
 *
 * Returns the signed distance travelled (target index − current index), or 0 when this is not a
 * lateral move at all. The sign is the direction the content should arrive from.
 *
 * Exported for the router test, for the same reason navFor is: a wrong answer here is silent.
 * Return 0 where it should have returned ±1 and the strip quietly goes back to piling up back
 * targets; return ±1 where it should have returned 0 and a real detail screen stops being
 * reachable by Back at all. Neither throws, and neither shows up in a screenshot. */
export function lateralStep(curRoute, curSub, target) {
  const [root, sub] = target.split('/');
  if (root !== curRoute || !sub) return 0;
  const mod = screens[curRoute];
  const subs = mod && Array.isArray(mod.subs) ? mod.subs : null;
  if (!subs || !subs.includes(sub)) return 0;
  // No declared sub = resting on the first tab, which is what a bare `#plan` renders.
  const from = curSub && subs.includes(curSub) ? subs.indexOf(curSub) : 0;
  return subs.indexOf(sub) - from;
}

/** Forward navigation with origin tracking. Tab roots reset their stack; detail screens push
 *  the departing screen (unless it's a transient flow interstitial); a sibling tab REPLACES,
 *  so the strip never becomes a pile of back-targets. Transient screens are REPLACED in browser
 *  history so a hardware/edge swipe-back skips the flow, matching the header back button. */
function navigateTo(target) {
  NAV_INTENT = true;
  const { route: cur, sub: curSub } = parse();
  const curMod = screens[cur];
  const transient = !!(curMod && curMod.transient);
  const targetRoot = ROOT_TAB[target.split('/')[0]];
  const lateral = lateralStep(cur, curSub, target);
  if (lateral !== 0) {
    // Sideways: no stack entry, no history entry. Back from any tab of the strip leaves the
    // screen, which is the only reading of "back" that survives a four-tab strip.
    NAV_DIR = lateral > 0 ? 'lat-next' : 'lat-prev';
    try { location.replace('#' + target); return; } catch { /* fall through to go() */ }
  } else if (targetRoot && !target.includes('/')) {
    NAV_DIR = 'tab';
    resetTab(NAV, targetRoot); navSave();
  } else if (curMod && !transient && !AUTH_ROUTES.includes(cur)) {
    NAV_DIR = 'push';
    /* The anchor rides the back stack so Back can morph to the SAME element. Only worth storing
       when there is an instance id to disambiguate with: without one the pop's key search is
       already as good as it gets. */
    pushOrigin(NAV, currentFull(), currentScroll(), (VT_KEY && VT_ID) ? { k: VT_KEY, i: VT_ID } : null);
    navSave();
  } else {
    NAV_DIR = 'push';   // flow interstitials still ARRIVE forward even though they don't stack
  }
  if (transient) { try { location.replace('#' + target); return; } catch { /* fall through */ } }
  go(target);
}

/** Back: pop the active tab's stack and return there (with scroll), else land on `fallback`.
 *  Uses location.replace so browser history never grows from unwinding. */
function goBack(fallback) {
  NAV_INTENT = true;
  NAV_DIR = 'pop';
  const entry = popOrigin(NAV); navSave();
  if (entry) {
    RESTORE = entry;
    try { location.replace('#' + entry.r); } catch { go(entry.r); }
    return;
  }
  const fb = fallback || (RT.userId ? routeForRole(RT.authRole || 'athlete') : 'welcome');
  const fbRoot = ROOT_TAB[fb.split('/')[0]];
  if (fbRoot) { resetTab(NAV, fbRoot); navSave(); }
  try { location.replace('#' + fb); } catch { go(fb); }
}
window.__back = goBack;
window.__navigate = navigateTo; // Screens that patch subtrees (roster search) re-wire taps through the SAME origin-tracking path.

let REPAINT_HELD = false;   // a same-route repaint is waiting out a transition (see below)

function render() {
  /* A repaint that lands mid-transition would replace the element the browser is animating, and
     the browser answers that by cutting the transition short — the screen stops travelling and
     simply appears. Screens fetch in mount() and repaint the moment the data arrives, so this is
     not a rare race: it is the normal shape of every async screen in the app, and on a fast
     connection it fires inside the first frames of the arrival.
     Held, not dropped, and collapsed to one: whatever the latest state is gets painted the instant
     the screen is standing still. Only a SAME-ROUTE repaint waits. A real navigation is the
     athlete asking for something and goes through immediately, interrupting whatever is in
     flight — which is what a second tap should do. */
  if (transitioning() && LAST_FULL !== null && LAST_FULL === currentFull()) {
    if (!REPAINT_HELD) {
      REPAINT_HELD = true;
      afterTransition(() => { REPAINT_HELD = false; render(); });
    }
    return;
  }
  // Screens with live countdowns register a tick; every route change clears it.
  if (window.__execTick) { clearInterval(window.__execTick); window.__execTick = null; }
  // The meal thread polls for replies while it is open (there is no realtime in this app). It
  // must stop when the screen does, or every visited thread keeps fetching for the whole session.
  if (window.__threadTick) { clearInterval(window.__threadTick); window.__threadTick = null; }
  // Screens holding live resources (the camera's MediaStream) register a cleanup; every
  // route change / re-render runs it exactly once so a stream never survives its screen.
  if (window.__screenCleanup) { try { window.__screenCleanup(); } catch { /* best-effort */ } window.__screenCleanup = null; }
  const { route, sub } = parse();
  const full = sub ? `${route}/${sub}` : route;
  // Browser/swipe back (no intent flag): if the new location matches the top of the active
  // stack, consume it as a pop so header-back and edge-swipe stay perfectly consistent.
  if (!NAV_INTENT) {
    const top = peekOrigin(NAV);
    if (top && top.r === full) { popOrigin(NAV); RESTORE = top; NAV_DIR = 'pop'; navSave(); }
  }
  NAV_INTENT = false;
  // Auth gate on EVERY render, not just boot: a signed-out runtime (expired/cleared session)
  // must never keep rendering app screens on a hash change.
  if (!RT.userId && !AUTH_ROUTES.includes(route)) { location.hash = '#welcome'; return; }
  // Landing on Welcome (sign-out, fresh boot) drops every stack — the next account starts clean.
  if (route === 'welcome' && (NAV.tab !== 'home' || Object.keys(NAV.stacks).length)) { NAV = emptyNav(); navSave(); }
  // An unknown route resolves to a REAL not-found screen, never to Home. Falling back to Home
  // painted a correct-looking dashboard under a bogus hash, so stale deep links and renamed
  // screens failed invisibly and were never reported. See screens/notfound.js.
  let mod = screens[route] || screens.notfound;
  // Role-route guard: a screen declaring an operator nav belongs to an operator's dashboard.
  // A signed-in user of another role must not render its chrome (RLS still scopes the data, but
  // the shell is wrong — a role-integrity leak). Only fires when the role is KNOWN (authRole
  // set) so a pre-hydrate session is never bounced off its own dashboard; shared/auth/athlete
  // screens are unaffected. `nav:'operator'` admits BOTH coach and trainer — that is the one
  // screen module, two role shells seam.
  //
  // This used to rewrite location.hash to the user's own home. Role integrity was kept and the
  // user was told nothing: a tap that silently lands somewhere else is indistinguishable from a
  // broken tap, and it hides the bug in whatever produced the link — exactly how the avatarHead
  // trainer lockout stayed invisible. Render the denial instead, in the denied user's OWN
  // chrome (notpermitted declares no nav, so navFor resolves to their shell) with a real door
  // home. The refused screen module is never rendered, so nothing leaks.
  let denied = false;
  if (RT.userId && RT.authRole && (mod.nav === 'coach' || mod.nav === 'trainer' || mod.nav === 'operator')
    && !navAdmits(mod, RT.authRole)) {
    mod = screens.notpermitted;
    denied = true;
  }
  // The mirror guard (role walkthrough 2026-07-15): a KNOWN coach/trainer must not render
  // ATHLETE-nav screens either — e.g. a stale #home hash surviving a reload used to leave a
  // coach on the athlete dashboard. Shared utility screens (settings/privacy/billing/terms)
  // resolve their nav per role via roleNav(), so they pass through untouched.
  if (RT.userId && (RT.authRole === 'coach' || RT.authRole === 'trainer')
    && (mod.nav || 'athlete') === 'athlete' && !mod.anyRole && !AUTH_ROUTES.includes(route)) {
    location.hash = '#' + routeForRole(RT.authRole);
    return;
  }
  // A tab ROOT stamps the active tab (covers boot deep-links and role switches); every other
  // screen inherits the ORIGIN tab from the stack, so a detail opened from Profile keeps
  // Profile lit (spec §10.4). mod.tab remains the fallback for direct/deep links.
  // A denied route never stamps a tab: it is not being rendered, and lighting the tab of a
  // dashboard the user was just refused would be the shell claiming they are somewhere they are not.
  if (ROOT_TAB[route] && !sub && !denied) NAV.tab = ROOT_TAB[route];
  const navRole = navFor(mod, RT.authRole);
  const roleTabs = (NAVS[navRole] || NAVS.athlete).map((t) => t.id);
  const activeTab = roleTabs.includes(NAV.tab) ? NAV.tab : (mod.tab || route);
  const device = document.getElementById('device');

  // Capture the outgoing viewport's scroll BEFORE innerHTML replaces it, so a same-route re-render
  // can restore it — the fix for controls that call window.__render() (Team Standard editor knobs,
  // athlete profile chips) snapping the page to the top (T-08).
  const prevVp = document.getElementById('viewport');
  const prevScroll = prevVp ? prevVp.scrollTop : 0;
  // The entrance animation belongs to ARRIVING somewhere, not to repainting where you already are.
  // .view carried it unconditionally, and #view is rebuilt on every render() — including the
  // same-route repaints async screens do constantly (Home alone repaints for commitments, activity
  // standards, the coach receipt and participant names). Each one re-ran the fade-and-rise on the
  // whole screen plus the staggered row entrances, so content that should have felt settled kept
  // sliding around under the reader. LAST_FULL is still the PREVIOUS route here (it is assigned
  // further down, with the scroll restore that uses the same signal), so this is the same
  // definition of "same-route re-render" the scroll logic already trusts.
  const enter = LAST_FULL === full ? '' : ' enter';
  // Direction modifier: the entrance matches the gesture that caused it. Consumed here whether or
  // not it renders (a same-route repaint must not inherit a stale direction from an old tap).
  const dir = NAV_DIR; NAV_DIR = null;
  const DIR_CLS = { push: ' dir-push', pop: ' dir-pop', 'lat-next': ' dir-lat-next', 'lat-prev': ' dir-lat-prev' };
  const dirCls = enter ? (DIR_CLS[dir] || '') : '';
  const body = mod.render({ sub, S });
  /* The one state change the app makes constantly and never showed: a skeleton being replaced by
     the real thing. Async screens repaint via __render() on the SAME route, which `enter` above
     deliberately excludes — correct for the entrance choreography, but it left the most common
     "your data landed" moment as a hard cut. `.settle` is a short opacity-only fade with no
     travel, because the content is arriving in place rather than sliding in from somewhere, and
     it is stamped only when the outgoing DOM held a SKELETON and the incoming one does not — a
     transition that can only happen once per load, so there is no repaint to guard against.
     Keyed on .sk-card, the skeleton primitive's own class, and deliberately NOT on aria-busy:
     that attribute does double duty in this app, marking both a skeleton region and a button
     mid-request (Pay, Redeem, Connect), and fading a whole screen because a button finished
     would be exactly the decorative motion the product register bans. */
  const settle = !enter && prevVp
    && prevVp.querySelector('.sk-card')
    && !/\bsk-card\b/.test(body) ? ' settle' : '';
  /* The shared-element key, consumed on the same terms as `dir`: only a real navigation may carry
     one, so a repaint can never inherit the last tap's morph target. */
  const vtKey = enter ? VT_KEY : null; VT_KEY = null;
  /* The node the finger was on, when there was a finger. Consumed on the same terms as the key:
     a stale node would name an element from two navigations ago. */
  const vtNode = enter ? VT_NODE : null; VT_NODE = null;
  /* On a pop the anchor comes off the stack entry we are returning to — there was no tap on the
     thing that should travel, so the id is the only way to pick it out of a rail of peers. */
  const popAnchor = (RESTORE && RESTORE.r === full && RESTORE.v) ? RESTORE.v : null;
  const vtKey2 = vtKey || (popAnchor ? popAnchor.k : null);
  const vtId = enter ? (VT_ID || (popAnchor ? popAnchor.i : null)) : null; VT_ID = null;
  /* A view transition is offered only for a navigation the router can NAME. A same-route repaint
     (Home repaints constantly) and a boot deep-link both arrive with no direction, and both must
     keep the synchronous path they have always had. */
  /* A restate is a same-route repaint on purpose, so `enter` is empty for it and the usual
     "only a real arrival transitions" test would refuse. It is the one repaint that has earned a
     transition, so it is admitted explicitly. */
  const restate = dir === 'restate';
  const vtDir = (enter || restate) ? dir : null;
  /* Asked BEFORE the markup is built, because the answer changes it: under a transition the
     transition IS the entrance, and leaving `.enter` on would run the screen's own fade-and-rise
     underneath a slide already moving it — two choreographies for one arrival, at different
     durations and curves. `.settle` is untouched; it belongs to a repaint, which never
     transitions. */
  const morph = canTransition(vtDir);
  const enterCls = morph ? '' : enter;
  const dirClsUsed = morph ? '' : dirCls;
  /* A restate must never carry `.settle` either: that fade belongs to a skeleton handing over to
     real content, and a user-driven re-order is not that. Both would run at once otherwise. */
  const settleCls = restate ? '' : settle;

  /* Everything below mutates the DOM, and under a transition all of it runs inside the update
     callback so the "after" snapshot is the finished screen — markup, wiring, scroll AND mount.
     Splitting mount out would snapshot a screen its own code had not finished arranging yet. */
  const commit = () => {
  device.innerHTML = `
    <div class="island"></div>
    <div class="screen">
      ${statusbar()}
      <div class="viewport ${mod.bleed ? 'bleed' : ''}${mod.hideTabs ? ' notabs' : ''}${mod.fill ? ' fill' : ''}" id="viewport">
        <div class="view${enterCls}${dirClsUsed}${settleCls}" id="view">${body}</div>
      </div>
      ${mod.hideTabs ? '' : tabbar(activeTab, navRole)}
    </div>`;
  // A genuine tab switch pops the newly-active tab icon (CSS keys off .tabbar.switch). Gated so a
  // push/pop/repaint never replays it — the bar should only move when the BAR is what changed.
  if (enter && dir === 'tab') { const bar = device.querySelector('.tabbar'); if (bar) bar.classList.add('switch'); }

  // haptic feedback where the platform supports it (Android web; no-op elsewhere);
  // honors the athlete's real haptics preference (notification settings).
  const buzz = (ms) => { try { if (RT.haptics !== false && navigator.vibrate) navigator.vibrate(ms); } catch { /* no-op */ } };
  // wire navigation
  device.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation(); buzz(6);
      const target = el.getAttribute('data-go');
      // What, if anything, should survive this navigation. The tapped element may BE the thing
      // (a roster row) or merely contain it (Home's hero contains the ring, and it is the ring
      // that has a counterpart on the breakdown — morphing the whole hero into a small card
      // would smear two unrelated compositions into each other). `closest` first so a control
      // nested inside a marked row still carries its row's key.
      const mark = el.closest('[data-vt]') || el.querySelector('[data-vt]');
      VT_KEY = mark ? mark.getAttribute('data-vt') : null;
      VT_ID = mark ? mark.getAttribute('data-vt-id') : null;
      VT_NODE = mark;
      // Any path back to Welcome from inside the app is a sign-out (no-op if not signed in).
      if (target === 'welcome') { try { await act.signOut(); } catch { /* ignore */ } }
      navigateTo(target);
    });
  });
  // wire back: data-back="fallback" pops the origin stack (exact screen + scroll), landing on
  // the fallback only when there is no recorded origin (deep link, fresh boot).
  device.querySelectorAll('[data-back]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation(); buzz(6);
      goBack(el.getAttribute('data-back') || undefined);
    });
  });
  // wire actions: data-act="name" or data-act="name:arg"; data-then="route" navigates after;
  // data-then="__back" (or data-then="__back:fallback") returns to the recorded origin.
  device.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      buzz(14);
      const [name, arg] = el.getAttribute('data-act').split(':');
      if (act[name]) await act[name](arg !== undefined ? +arg || arg : undefined);
      const then = el.getAttribute('data-then');
      if (then && then.startsWith('__back')) { goBack(then.split(':')[1] || undefined); }
      else if (then) { if (('#' + then) === location.hash) render(); else navigateTo(then); }
      else render();
    });
  });
  // Keyboard reachability AND activation for the non-native controls.
  //
  // This used to wire Enter/Space only, which fixed activation for the handful of divs that
  // already carried role="button" + tabindex and did nothing at all for the rest — because a div
  // with no tabindex cannot be focused, so the keydown listener could never fire. Tabbing through
  // Home reached exactly two elements out of sixteen, and the entire tab bar was unreachable:
  // .tab is a plain div, so css/focus.css's carefully-written `.tab:focus-visible` rule had no
  // element to ever match. Invisible to a pointer-only QA pass, and a hard stop for an external
  // keyboard, iOS Switch Control, or full keyboard access.
  //
  // Doing it HERE rather than at each of the ~80 call sites is the point: every data-go the app
  // will ever add is covered the moment it is written, and it can't be forgotten in review.
  // Native controls are skipped so Space can't double-fire, and an author-supplied tabindex or
  // role always wins.
  device.querySelectorAll('[data-go],[data-act],[data-back]').forEach(el => {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT') return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      el.click();
    });
  });
  // Scroll: restore the exact origin position on a back-pop; fresh forward views start at top.
  // scrollTo with behavior:'instant' overrides the viewport's smooth scroll-behavior — a
  // restore must snap, never animate.
  const vp = document.getElementById('viewport');
  // Back-pop → the recorded origin scroll; a same-route re-render (LAST_FULL === full, e.g. an
  // editor knob calling window.__render) → keep where the user was; a real forward view → top.
  const targetScroll = (RESTORE && RESTORE.r === full) ? (RESTORE.s || 0)
    : (LAST_FULL === full ? prevScroll : 0);
  RESTORE = null;
  LAST_FULL = full;
  try { vp.scrollTo({ top: targetScroll, behavior: 'instant' }); } catch { vp.scrollTop = targetScroll; }
  if (mod.mount) mod.mount(device, { sub, S });
  };
  // Runs `commit` immediately when there is no transition to run, and inside one when there is.
  // Either way it runs exactly once: a navigation is never the thing that gets dropped.
  withTransition({ dir: vtDir, key: vtKey2, node: vtNode, id: vtId }, commit);
}
// Re-render the current route in place — used by async (data-driven) screens to repaint once a
// best-effort fetch resolves. Guarded so a screen's own mount doesn't loop (fetch once, then paint).
window.__render = render;

/* The SAME repaint, declared as something the user asked for.
 *
 * Two different events were sharing window.__render(). "Data arrived" is content resolving in place
 * and must not move — that is what the entrance gate and the repaint deferral both exist to protect.
 * "The user changed what they are looking at" is not that: a sort, a filter chip, a search, a group
 * opening. In a re-ordered list the MOVEMENT IS THE INFORMATION, and snapping to the new order
 * throws away the only thing that explains it. The router could not tell them apart, so every one of
 * ~350 call sites got the no-motion treatment the first kind needs.
 *
 * Screens call this instead when a repaint is the direct result of a tap. Rows carrying
 * `data-vt-row` then glide from their old positions to their new ones. Everything else about the
 * repaint is unchanged, including the scroll preservation, so a screen can switch one handler at a
 * time. Falls back to a plain render wherever transitions are unavailable. */
window.__restate = function () {
  NAV_INTENT = true;
  NAV_DIR = 'restate';
  render();
};

// Boot gate: restore a Keychain session and gate app screens behind auth. Auth screens are
// always reachable; fresh (signed-out) users land on Welcome. Runs once on load.
const AUTH_ROUTES = ['welcome', 'role', 'signin', 'reset', 'onboarding', 'coach-ob', 'trainer-ob', 'client-ob', 'terms', 'privacy',
  'oba', 'obf', 'obk', 'obt', 'obp', 'obn', 'obd']; // OB2 adaptive onboarding flows (2026-07 redesign)
/* First paint, before the network. boot() awaits getSession() AND hydrateDay() — a real round
   trip — before render() runs, so a returning athlete on school wifi used to stare at an empty
   #device for seconds with no branding and nothing to read. Everything the shell needs is
   knowable with ZERO network: the role is persisted, and the chrome never depends on today's
   data. Paint it synchronously here, then let render() replace the whole subtree once the day
   lands. Only for a persisted session — a signed-out boot goes to Welcome, which has no data to
   wait on. The tab bar is inert (aria-hidden + pointer-events:none via .booting): showing the
   real chrome keeps the layout from jumping, but it must not pretend to be live before it is. */
function bootShell() {
  const device = document.getElementById('device');
  if (!device) return;
  const navRole = RT.authRole === 'coach' || RT.authRole === 'trainer' ? RT.authRole : 'athlete';
  device.innerHTML = `
    <div class="island"></div>
    <div class="screen booting">
      ${statusbar()}
      <div class="viewport" id="viewport">
        <div class="view" id="view" aria-busy="true" aria-label="Loading your day">
          <div class="sk-hero"><div class="sk-ring"></div><div class="sk-line sk-hero-l"></div></div>
          ${skeletonRows(3, 'Loading your day')}
          ${skeletonRows(2, '')}
        </div>
      </div>
      ${tabbar('home', navRole)}
    </div>`;
  // pointer-events:none alone would still leave the inert tabs in the tab order, which is a
  // keyboard trap that looks like a working control. Take them out of both trees.
  const bar = device.querySelector('.tabbar');
  if (bar) {
    bar.setAttribute('aria-hidden', 'true');
    bar.querySelectorAll('[data-go],[tabindex],button,a').forEach((el) => el.setAttribute('tabindex', '-1'));
  }
}

async function boot() {
  initAnalytics(); // wire crash capture + visibility-flush (inert until a sink is configured)
  track(EVENTS.APP_OPEN, { role: RT.authRole || 'anon' });
  if (RT.userId && !AUTH_ROUTES.includes(parse().route)) bootShell();
  let authed = false;
  try {
    const sb = window.sb;
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data && data.session) { authed = true; await act._syncSession(data.session.user); await act.hydrateDay(); }
    }
  } catch { /* offline / no client → treat as signed out */ }
  // No live session on boot → drop any stale user-scoped state. A persisted RT.userId would
  // otherwise let the render gate paint an authed shell against cached data until the next data
  // call. Same cleanup SIGNED_OUT uses; keeps pending-onboarding scratch. (stress-test R1)
  if (!authed && RT.userId) { try { act._wipeUserScopedState({ keepPendingOb: true }); } catch { /* never block boot */ } }
  const { route } = parse();
  if (!authed && !AUTH_ROUTES.includes(route)) { location.hash = '#welcome'; return; } // hashchange → render
  if (authed && (route === 'welcome' || !location.hash)) { location.hash = '#' + routeForRole(RT.authRole || 'athlete'); return; }
  render();
}

/* Escape closes the frontmost dismissible thing, once, app-wide.
   The tour, the image viewer, the members sheet and tapback each wired their own Escape handler,
   but a `transient: true` ROUTE — the log sheet, the quick-log sheet, any screen whose scrim is
   a data-back — had none: on a keyboard the only exit was to find and click the scrim. Screens
   own their own handlers first (this runs at the document level, and theirs stopPropagation or
   fire on their own nodes), so this is a floor, not an override. */
/* Enter/Space activation floor for every role-annotated non-native control, app-wide.
   The per-render net above only reaches [data-go]/[data-act]/[data-back]; the switches, audience
   chips, plan cards, steppers and photo openers carry their own data hooks, and several are
   recreated by innerHTML patches AFTER render() has wired things (the food-search plate, the
   meal food-edit rows), so per-element wiring can never be complete. One delegated listener
   covers anything a builder marks with a role plus tabindex, whenever it is created.
   Guards: native controls activate themselves (skipped by tag), and any handler that already
   claimed the key with preventDefault wins (the per-render net, coach-connected's switches,
   settings' wireToggles all do), so nothing double-fires. preventDefault stops Space from
   scrolling the page under the activation. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.defaultPrevented) return;
  const el = e.target;
  if (!el || !el.getAttribute) return;
  const role = el.getAttribute('role');
  if (role !== 'button' && role !== 'switch' && role !== 'radio' && role !== 'tab') return;
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  el.click();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  // Never steal Escape from a field the user is mid-edit in, or from an overlay that owns it.
  const t = document.activeElement;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (document.querySelector('.tour, .imgview, .memsheet, .tapback, .lockstamp')) return;
  const scrim = document.querySelector('.sheet-scrim[data-back]');
  if (!scrim) return;
  e.preventDefault();
  goBack(scrim.getAttribute('data-back') || undefined);
});

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();

// Keyboard avoidance: a WebView doesn't auto-scroll a focused input above the soft keyboard, so
// bottom-anchored fields (chat composer, weight/code entry, onboarding) can sit hidden under it.
// On focus — and when visualViewport shrinks (keyboard opens) — scroll the active field into the
// centre of the visible area. Cheap, self-contained, no layout impact when there's no keyboard.
(function keyboardAvoidance() {
  const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
  const reveal = () => {
    const el = document.activeElement;
    if (isField(el)) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* older WebView */ } }
  };
  document.addEventListener('focusin', (e) => { if (isField(e.target)) setTimeout(reveal, 250); }); // wait for the keyboard to animate up
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { setTimeout(reveal, 60); });
})();
