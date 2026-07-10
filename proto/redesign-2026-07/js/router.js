/* Hash router + chrome (status bar, tab bar). Screens register in js/screens/index.js */
import { S, act, RT, routeForRole } from './state.js';
import { icon } from './icons.js';
import { screens } from './screens/index.js';

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
    { id: 'team',    route: 'coach',        label: 'Team',    icon: 'users' },
    { id: 'plan',    route: 'coach-plan',   label: 'Plan',    icon: 'clipboard' },
    { id: 'assign',  route: 'coach-assign', label: '',        icon: 'plus', fab: true },
    { id: 'copilot', route: 'copilot',      label: 'Copilot', icon: 'sparkle' },
    { id: 'profile', route: 'coach-profile',label: 'Profile', icon: 'user' },
  ],
  trainer: [
    { id: 'clients', route: 'trainer',         label: 'Clients', icon: 'heart' },
    { id: 'note',    route: 'trainer-client',  label: '',        icon: 'message', fab: true },
    { id: 'profile', route: 'trainer-profile', label: 'Profile', icon: 'user' },
  ],
};

function statusbar() {
  // The phone's own status bar (real clock, real battery) renders above the WebView —
  // drawing a second one reads as fake. This strip only reserves the safe-area height.
  return `<div class="statusbar" aria-hidden="true"></div>`;
}

function tabbar(activeTab, nav = 'athlete') {
  const tabs = NAVS[nav] || NAVS.athlete;
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
      return `<div class="tab"><div class="fab" data-go="${t.route}" style="position:relative">${icon(t.icon, 26)}${dot}</div></div>`;
    }
    const on = t.id === activeTab ? `active ${t.id === 'home' || t.id === 'team' || t.id === 'clients' ? 'home' : ''}` : '';
    return `<div class="tab ${on}" data-go="${t.route}">${icon(t.icon, 23)}<span>${t.label}</span></div>`;
  }).join('')}</nav>`;
}

function parse() {
  const raw = (location.hash || '#home').slice(1);
  const [route, ...rest] = raw.split('/');
  return { route: route || 'home', sub: rest.join('/') };
}

export function go(route) { location.hash = '#' + route; }
window.__go = go;

function render() {
  // Screens with live countdowns register a tick; every route change clears it.
  if (window.__execTick) { clearInterval(window.__execTick); window.__execTick = null; }
  const { route, sub } = parse();
  const mod = screens[route] || screens.home;
  const activeTab = mod.tab || route;
  const device = document.getElementById('device');

  const body = mod.render({ sub, S });
  device.innerHTML = `
    <div class="island"></div>
    <div class="screen">
      ${statusbar()}
      <div class="viewport ${mod.bleed ? 'bleed' : ''}" id="viewport">
        <div class="view" id="view">${body}</div>
      </div>
      ${mod.hideTabs ? '' : tabbar(activeTab, mod.nav || 'athlete')}
    </div>`;

  // haptic feedback where the platform supports it (Android web; no-op elsewhere)
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* no-op */ } };
  // wire navigation
  device.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation(); buzz(6);
      const target = el.getAttribute('data-go');
      // Any path back to Welcome from inside the app is a sign-out (no-op if not signed in).
      if (target === 'welcome') { try { await act.signOut(); } catch { /* ignore */ } }
      go(target);
    });
  });
  // wire actions: data-act="name" or data-act="name:arg"; data-then="route" navigates after
  device.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      buzz(14);
      const [name, arg] = el.getAttribute('data-act').split(':');
      if (act[name]) await act[name](arg !== undefined ? +arg || arg : undefined);
      const then = el.getAttribute('data-then');
      if (then) { if (('#' + then) === location.hash) render(); else go(then); }
      else render();
    });
  });
  document.getElementById('viewport').scrollTop = 0;
  if (mod.mount) mod.mount(device, { sub, S });
}
// Re-render the current route in place — used by async (data-driven) screens to repaint once a
// best-effort fetch resolves. Guarded so a screen's own mount doesn't loop (fetch once, then paint).
window.__render = render;

// Boot gate: restore a Keychain session and gate app screens behind auth. Auth screens are
// always reachable; fresh (signed-out) users land on Welcome. Runs once on load.
const AUTH_ROUTES = ['welcome', 'role', 'signin', 'reset', 'onboarding', 'coach-ob', 'trainer-ob', 'client-ob', 'terms', 'privacy'];
async function boot() {
  let authed = false;
  try {
    const sb = window.sb;
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data && data.session) { authed = true; act._syncSession(data.session.user); await act.hydrateDay(); }
    }
  } catch { /* offline / no client → treat as signed out */ }
  const { route } = parse();
  if (!authed && !AUTH_ROUTES.includes(route)) { location.hash = '#welcome'; return; } // hashchange → render
  if (authed && (route === 'welcome' || !location.hash)) { location.hash = '#' + routeForRole(RT.authRole || 'athlete'); return; }
  render();
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
