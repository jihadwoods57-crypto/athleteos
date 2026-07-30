/* Hash router + chrome (status bar, tab bar). Screens register in js/screens/index.js */
import { S, act, RT, routeForRole } from './state.js';
import { icon } from './icons.js';
import { screens } from './screens/index.js';
import { initAnalytics, track, EVENTS } from './analytics.js';
import { emptyNav, pushOrigin, popOrigin, peekOrigin, resetTab } from './nav-stack.js';

/* Each role gets its own dashboard shell — not a modal off someone else's app. */
const NAVS = {
  athlete: [
    { id: 'home',     route: 'home',     label: 'Home',     icon: 'home' },
    { id: 'plan',     route: 'plan',     label: 'Plan',     icon: 'clipboard' },
    { id: 'camera',   route: 'log',      label: '',         icon: 'camera', fab: true },
    { id: 'progress', route: 'progress', label: 'Progress', icon: 'bars' },
    { id: 'profile',  route: 'profile',  label: 'Profile',  icon: 'user' },
  ],
  coach: [
    { id: 'home',     route: 'coach-home',     label: 'Home',     icon: 'home' },
    { id: 'roster',   route: 'coach-roster',   label: 'Roster',   icon: 'users' },
    { id: 'create',   route: 'coach-create',   label: '',         icon: 'plus', fab: true },
    { id: 'inbox',    route: 'coach-inbox',    label: 'Inbox',    icon: 'message' },
    { id: 'insights', route: 'coach-insights', label: 'Insights', icon: 'bars' },
  ],
  // Same five tab IDS as coach, so ROOT_TAB below extends rather than forks and every
  // operator-shared screen lights the right tab for either role. Only the routes and the
  // fifth tab differ: a trainer's business surface (Grow) sits where a coach has Insights.
  trainer: [
    { id: 'home',     route: 'trainer',        label: 'Home',    icon: 'home' },
    { id: 'roster',   route: 'trainer-roster', label: 'Clients', icon: 'heart' },
    { id: 'create',   route: 'trainer-create', label: '',        icon: 'plus', fab: true },
    { id: 'inbox',    route: 'trainer-inbox',  label: 'Inbox',   icon: 'message' },
    { id: 'insights', route: 'trainer-grow',   label: 'Grow',    icon: 'bars' },
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
      // data-tour marks the first-run tour's anchor (tour-plan.js). Only the athlete FAB is a
      // tour target — the operator FAB is "Create", which no step explains.
      const fabTour = nav === 'athlete' ? ' data-tour="log"' : '';
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
    const tabTour = t.route === 'plan' ? ' data-tour="plan"' : '';
    return `<div class="tab ${on}" ${on ? 'aria-current="page"' : ''} data-go="${t.route}"${tabTour} style="position:relative">${badge}${icon(t.icon, 23)}<span>${t.label}</span></div>`;
  }).join('')}</nav>`;
}

function parse() {
  const raw = (location.hash || '#home').slice(1);
  const [route, ...rest] = raw.split('/');
  return { route: route || 'home', sub: rest.join('/') };
}

export function go(route) { location.hash = '#' + route; }
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
  'coach-inbox': 'inbox', 'coach-insights': 'insights', 'coach-profile': 'profile',
  'coach-plan': 'roster',
  trainer: 'home', 'trainer-roster': 'roster', 'trainer-create': 'create',
  'trainer-inbox': 'inbox', 'trainer-grow': 'insights', 'trainer-profile': 'profile',
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
let RESTORE = null;       // {r, s} — scroll position to restore once that route paints
let LAST_FULL = null;     // the route (route/sub) the previous render painted — lets a same-route
                          // re-render (window.__render) PRESERVE scroll instead of snapping to top (T-08)

function currentFull() { const { route, sub } = parse(); return sub ? `${route}/${sub}` : route; }
function currentScroll() { const vp = document.getElementById('viewport'); return vp ? vp.scrollTop : 0; }

/** Forward navigation with origin tracking. Tab roots reset their stack; detail screens push
 *  the departing screen (unless it's a transient flow interstitial). Transient screens are
 *  REPLACED in browser history so a hardware/edge swipe-back skips the flow, matching the
 *  header back button. */
function navigateTo(target) {
  NAV_INTENT = true;
  const { route: cur } = parse();
  const curMod = screens[cur];
  const transient = !!(curMod && curMod.transient);
  const targetRoot = ROOT_TAB[target.split('/')[0]];
  if (targetRoot && !target.includes('/')) {
    resetTab(NAV, targetRoot); navSave();
  } else if (curMod && !transient && !AUTH_ROUTES.includes(cur)) {
    pushOrigin(NAV, currentFull(), currentScroll()); navSave();
  }
  if (transient) { try { location.replace('#' + target); return; } catch { /* fall through */ } }
  go(target);
}

/** Back: pop the active tab's stack and return there (with scroll), else land on `fallback`.
 *  Uses location.replace so browser history never grows from unwinding. */
function goBack(fallback) {
  NAV_INTENT = true;
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

function render() {
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
    if (top && top.r === full) { popOrigin(NAV); RESTORE = top; navSave(); }
  }
  NAV_INTENT = false;
  // Auth gate on EVERY render, not just boot: a signed-out runtime (expired/cleared session)
  // must never keep rendering app screens on a hash change.
  if (!RT.userId && !AUTH_ROUTES.includes(route)) { location.hash = '#welcome'; return; }
  // Landing on Welcome (sign-out, fresh boot) drops every stack — the next account starts clean.
  if (route === 'welcome' && (NAV.tab !== 'home' || Object.keys(NAV.stacks).length)) { NAV = emptyNav(); navSave(); }
  const mod = screens[route] || screens.home;
  // Role-route guard: a screen declaring an operator nav belongs to an operator's dashboard.
  // A signed-in user of another role must not render its chrome (RLS still scopes the data, but
  // the shell is wrong — a role-integrity leak). Redirect to their own home. Only fires when the
  // role is KNOWN (authRole set) so a pre-hydrate session is never bounced off its own dashboard;
  // shared/auth/athlete screens are unaffected. `nav:'operator'` admits BOTH coach and trainer —
  // that is the one screen module, two role shells seam.
  if (RT.userId && RT.authRole && (mod.nav === 'coach' || mod.nav === 'trainer' || mod.nav === 'operator')
    && !navAdmits(mod, RT.authRole)) {
    location.hash = '#' + routeForRole(RT.authRole);
    return;
  }
  // The mirror guard (role walkthrough 2026-07-15): a KNOWN coach/trainer must not render
  // ATHLETE-nav screens either — e.g. a stale #home hash surviving a reload used to leave a
  // coach on the athlete dashboard. Shared utility screens (settings/privacy/billing/terms)
  // resolve their nav per role via roleNav(), so they pass through untouched.
  if (RT.userId && (RT.authRole === 'coach' || RT.authRole === 'trainer')
    && (mod.nav || 'athlete') === 'athlete' && !AUTH_ROUTES.includes(route)) {
    location.hash = '#' + routeForRole(RT.authRole);
    return;
  }
  // A tab ROOT stamps the active tab (covers boot deep-links and role switches); every other
  // screen inherits the ORIGIN tab from the stack, so a detail opened from Profile keeps
  // Profile lit (spec §10.4). mod.tab remains the fallback for direct/deep links.
  if (ROOT_TAB[route] && !sub) NAV.tab = ROOT_TAB[route];
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
  const body = mod.render({ sub, S });
  device.innerHTML = `
    <div class="island"></div>
    <div class="screen">
      ${statusbar()}
      <div class="viewport ${mod.bleed ? 'bleed' : ''}${mod.hideTabs ? ' notabs' : ''}" id="viewport">
        <div class="view${enter}" id="view">${body}</div>
      </div>
      ${mod.hideTabs ? '' : tabbar(activeTab, navRole)}
    </div>`;

  // haptic feedback where the platform supports it (Android web; no-op elsewhere);
  // honors the athlete's real haptics preference (notification settings).
  const buzz = (ms) => { try { if (RT.haptics !== false && navigator.vibrate) navigator.vibrate(ms); } catch { /* no-op */ } };
  // wire navigation
  device.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation(); buzz(6);
      const target = el.getAttribute('data-go');
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
  // Keyboard activation for the non-native controls. role="button" + tabindex gives a div FOCUS
  // but not activation — only <button>/<a> get Enter/Space for free. Everything above wires
  // click and nothing wired keys, so every role="button" div in the app (.xhero, .iconbtn,
  // .hd-avatar, .roster-row, the stat tiles…) could be tabbed to and then not used. One
  // delegation covers all of them; native elements are skipped so Space can't double-fire.
  device.querySelectorAll('[data-go],[data-act],[data-back]').forEach(el => {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT') return;
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
}
// Re-render the current route in place — used by async (data-driven) screens to repaint once a
// best-effort fetch resolves. Guarded so a screen's own mount doesn't loop (fetch once, then paint).
window.__render = render;

// Boot gate: restore a Keychain session and gate app screens behind auth. Auth screens are
// always reachable; fresh (signed-out) users land on Welcome. Runs once on load.
const AUTH_ROUTES = ['welcome', 'role', 'signin', 'reset', 'onboarding', 'coach-ob', 'trainer-ob', 'client-ob', 'terms', 'privacy',
  'oba', 'obf', 'obk', 'obt', 'obp', 'obn']; // OB2 adaptive onboarding flows (2026-07 redesign)
async function boot() {
  initAnalytics(); // wire crash capture + visibility-flush (inert until a sink is configured)
  track(EVENTS.APP_OPEN, { role: RT.authRole || 'anon' });
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
