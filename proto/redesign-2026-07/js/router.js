/* Hash router + chrome (status bar, tab bar). Screens register in js/screens/index.js */
import { S, act } from './state.js';
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
  return `<div class="statusbar">
    <span>${S.now}</span>
    <span class="sb-right">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="4.5" y="5" width="3" height="7" rx="1"/><rect x="9" y="2.5" width="3" height="9.5" rx="1"/><rect x="13.5" y="0" width="3" height="12" rx="1" opacity=".4"/></svg>
      <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 2.5c2.3 0 4.4.9 6 2.4l-1.4 1.5A6.6 6.6 0 0 0 8.5 4.6 6.6 6.6 0 0 0 3.9 6.4L2.5 4.9A8.6 8.6 0 0 1 8.5 2.5z"/><path d="M8.5 6.3c1.2 0 2.4.5 3.2 1.4L8.5 11 5.3 7.7A4.6 4.6 0 0 1 8.5 6.3z"/></svg>
      <svg width="26" height="13" viewBox="0 0 26 13" fill="none"><rect x="1" y="1" width="21" height="11" rx="3" stroke="currentColor" stroke-opacity=".5"/><rect x="3" y="3" width="16" height="7" rx="1.4" fill="currentColor"/><rect x="23" y="4.5" width="2" height="4" rx="1" fill="currentColor" fill-opacity=".5"/></svg>
    </span>
  </div>`;
}

function tabbar(activeTab, nav = 'athlete') {
  const tabs = NAVS[nav] || NAVS.athlete;
  return `<nav class="tabbar" style="grid-template-columns: repeat(${tabs.length}, 1fr)">${tabs.map(t => {
    if (t.fab) return `<div class="tab"><div class="fab" data-go="${t.route}">${icon(t.icon, 26)}</div></div>`;
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
    el.addEventListener('click', (e) => { e.stopPropagation(); buzz(6); go(el.getAttribute('data-go')); });
  });
  // wire actions: data-act="name" or data-act="name:arg"; data-then="route" navigates after
  device.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      buzz(14);
      const [name, arg] = el.getAttribute('data-act').split(':');
      if (act[name]) act[name](arg !== undefined ? +arg || arg : undefined);
      const then = el.getAttribute('data-then');
      if (then) { if (('#' + then) === location.hash) render(); else go(then); }
      else render();
    });
  });
  document.getElementById('viewport').scrollTop = 0;
  if (mod.mount) mod.mount(device, { sub, S });
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
if (document.readyState !== 'loading') render();
