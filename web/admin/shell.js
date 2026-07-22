// OnStandard — Command Center shell. Builds the left-nav from the registered sections, wires hash
// routing (#/<section>/<arg>), the top-bar global search (admin_global_search), the environment badge,
// identity, and a visibility-gated 5-min poll of the active section. Sections are self-contained
// modules ({ id, title, rail, render(view, arg), poll? }); the shell owns navigation + chrome only.
import { rpc } from './api.js';
import { h, $ } from './ui.js';

const RAIL_ORDER = ['Overview', 'People', 'Product', 'Money & AI', 'Growth', 'Ops', 'Trust'];
// map a global-search result kind → the section id + whether the id is an arg for a drill-down
const KIND_TO_SECTION = { user: 'users', audit: 'audit', org: 'orgs', ticket: 'support', payment: 'payments' };

let SECTIONS = [], CTX = {}, current = null, pollTimer = null;

export function mountShell(sections, ctx) {
  SECTIONS = sections; CTX = ctx || {};
  buildNav();
  buildTopbar();
  window.addEventListener('hashchange', route);
  route();
  if (!pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 5 * 60 * 1000);
}

export function refreshActive() {
  if (!current) return;
  const view = $('view'); view.textContent = '';
  current.render(view);
}

function poll() { if (current && typeof current.poll === 'function') current.poll(); else refreshActive(); }

function buildNav() {
  const rail = $('rail'); if (!rail) return;
  rail.textContent = '';
  const byRail = {};
  for (const s of SECTIONS) (byRail[s.rail] = byRail[s.rail] || []).push(s);
  const rails = [...RAIL_ORDER, ...Object.keys(byRail).filter((r) => !RAIL_ORDER.includes(r))];
  for (const railName of rails) {
    if (!byRail[railName]) continue;
    rail.appendChild(h('div', { class: 'railgroup', text: railName }));
    for (const s of byRail[railName]) {
      rail.appendChild(h('a', { class: 'railitem', href: `#/${s.id}`, 'data-id': s.id, text: s.title }));
    }
  }
}

function buildTopbar() {
  const badge = $('envbadge');
  if (badge) {
    const env = CTX.environment || 'production';
    badge.textContent = env;
    badge.classList.toggle('nonprod', env !== 'production');
  }
  const ident = $('identity'); if (ident) ident.textContent = CTX.email || '';
  const inp = $('search'), drop = $('searchdrop');
  if (inp && drop) {
    let t;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => doSearch(inp.value, drop), 200); });
    inp.addEventListener('blur', () => setTimeout(() => { drop.textContent = ''; }, 180));
  }
}

async function doSearch(q, drop) {
  drop.textContent = '';
  if (!q || q.trim().length < 2) return;
  try {
    const rows = await rpc('admin_global_search', { p_q: q.trim(), p_limit: 8 });
    if (!(rows || []).length) { drop.appendChild(h('div', { class: 'searchrow', text: 'no matches' })); return; }
    for (const r of rows) {
      const sec = KIND_TO_SECTION[r.kind] || r.kind;
      drop.appendChild(h('a', { class: 'searchrow', href: `#/${sec}/${r.id}`, onmousedown: () => { drop.textContent = ''; } }, [
        h('span', { class: 'skind', text: r.kind }),
        h('span', { text: r.label || r.id }),
        h('span', { class: 'ssub', text: r.sub || '' }),
      ]));
    }
  } catch (e) { drop.appendChild(h('div', { class: 'searchrow', text: 'search unavailable' })); }
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [id, arg] = hash.split('/');
  const sec = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  for (const a of document.querySelectorAll('.railitem')) a.classList.toggle('active', a.getAttribute('data-id') === sec.id);
  const view = $('view'); view.textContent = '';
  current = sec;
  sec.render(view, arg);
}
