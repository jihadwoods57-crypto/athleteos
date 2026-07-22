// OnStandard — Command Center · Organizations. Platform-wide org list + a per-org health rollup over the
// live link tables (teams / team_members / team_staff). Read-only, cross-org isolated. Org-level billing
// is user-owned (not modeled at the org level), so subscription/payment rollups are labeled deferred.
import { rpc } from '../api.js';
import { $, h, num, one, badge, tbl, row, openModal, emptyState } from '../ui.js';

const PAGE_SIZE = 25;
const ST = { page: 0, search: '', total: 0 };

async function load() {
  const body = $('orgs-body'); if (!body) return;
  body.textContent = ''; body.appendChild(emptyState('Loading…'));
  try {
    const rows = await rpc('admin_list_orgs', { p_search: ST.search || null, p_page: ST.page, p_page_size: PAGE_SIZE });
    ST.total = (rows && rows.length) ? num(rows[0].total_count) : 0;
    renderTable(rows || []);
  } catch (e) { body.textContent = ''; body.appendChild(emptyState('Error: ' + e.message)); }
}

function renderTable(rows) {
  const body = $('orgs-body'); body.textContent = '';
  if (!rows.length) { body.appendChild(emptyState('No organizations match.')); updatePager(); return; }
  const t = tbl(
    ['name', 'type', 'verification', { t: 'teams', num: 1 }, { t: 'members', num: 1 }, { t: 'staff', num: 1 }],
    rows.map((r) => ['', r.type || '—', '', num(r.teams), num(r.members), num(r.staff)]),
  );
  const trs = t.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i];
    tr.children[0].textContent = r.name || String(r.org_id).slice(0, 8) + '…';
    const vcell = tr.children[2]; vcell.textContent = '';
    vcell.appendChild(badge(r.verification_status || 'unverified', r.verification_status === 'verified' ? 'ok' : ''));
    tr.className = 'click';
    tr.addEventListener('click', () => openHealth(r.org_id));
  });
  body.appendChild(t);
  updatePager();
}

function updatePager() {
  const p = $('orgs-pager'); if (!p) return; p.textContent = '';
  const pages = Math.max(1, Math.ceil(ST.total / PAGE_SIZE));
  p.appendChild(h('span', { class: 'cap', text: `${ST.total} orgs · page ${ST.page + 1}/${pages}` }));
  const prev = h('button', { class: 'btn sm ghost', text: 'Prev', onclick: () => { if (ST.page > 0) { ST.page--; load(); } } });
  const next = h('button', { class: 'btn sm ghost', text: 'Next', onclick: () => { if (ST.page + 1 < pages) { ST.page++; load(); } } });
  prev.disabled = ST.page <= 0; next.disabled = ST.page + 1 >= pages;
  p.appendChild(prev); p.appendChild(next);
}

async function openHealth(orgId) {
  openModal('Organization', [emptyState('Loading…')]);
  try {
    const o = one(await rpc('admin_org_health', { p_org: orgId }));
    openModal('Organization · health', [
      h('div', { style: 'margin-bottom:10px' }, [badge(o.verification_status || 'unverified', o.verification_status === 'verified' ? 'ok' : '')]),
      row('Name', o.name || '—'), row('Type', o.type || '—'),
      row('Teams', num(o.teams)), row('Members', num(o.members)), row('Staff', num(o.staff)),
      row('Active · 7d', num(o.active_7d)),
      h('p', { class: 'cap', style: 'margin-top:14px', text: 'Org-level billing, outstanding payments, and support tickets are deferred to Phase 1B/2 (subscriptions are user-owned, not modeled at the org level).' }),
    ]);
  } catch (e) { openModal('Organization', [emptyState(e.message)]); }
}

let dt;
function debounced() { clearTimeout(dt); dt = setTimeout(load, 250); }

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Organizations' }), h('span', { class: 'line' })]));
  const searchI = h('input', { type: 'text', placeholder: 'Search organizations…', style: 'max-width:280px', oninput: (e) => { ST.search = e.target.value; ST.page = 0; debounced(); } });
  searchI.value = ST.search;
  view.appendChild(h('div', { class: 'filterbar' }, [searchI]));
  view.appendChild(h('div', { id: 'orgs-body' }));
  view.appendChild(h('div', { id: 'orgs-pager', class: 'pager' }));
  load();
}

export default { id: 'orgs', title: 'Organizations', rail: 'People', render(view) { mount(view); } };
