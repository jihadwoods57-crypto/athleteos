// OnStandard — Command Center · Users. Platform-wide list with search/role/status filters + pagination,
// and a read-only drill-down. Minor/guardian/payment-failed are badged; minor contact PII is masked in
// the list (server-side) and viewing a real minor's profile is audited (server-side). Read-only in 1A —
// mutations (role, pause, reset, refunds) arrive in Phase 1B behind step-up reauth.
import { rpc } from '../api.js';
import { $, h, num, one, usd4, toast, tbl, row, openModal, badge, emptyState } from '../ui.js';

const PAGE_SIZE = 25;
const ST = { page: 0, search: '', role: '', status: '', total: 0 };

async function load() {
  const body = $('users-body'); if (!body) return;
  body.textContent = ''; body.appendChild(emptyState('Loading…'));
  try {
    const rows = await rpc('admin_list_users', {
      p_search: ST.search || null, p_role: ST.role || null, p_status: ST.status || null,
      p_page: ST.page, p_page_size: PAGE_SIZE,
    });
    ST.total = (rows && rows.length) ? num(rows[0].total_count) : 0;
    renderTable(rows || []);
  } catch (e) { body.textContent = ''; body.appendChild(emptyState('Error: ' + e.message)); }
}

function renderTable(rows) {
  const body = $('users-body'); body.textContent = '';
  if (!rows.length) { body.appendChild(emptyState('No users match.')); updatePager(); return; }
  const t = tbl(
    ['name', 'role', 'subscription', 'joined', 'last active'],
    rows.map((r) => ['', r.primary_role || '—', subLabel(r), fmtDate(r.created_at), r.last_active || '—']),
  );
  const trs = t.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i], nameCell = tr.children[0];
    nameCell.textContent = '';
    nameCell.appendChild(h('span', { text: r.full_name || r.email || String(r.user_id).slice(0, 8) + '…' }));
    if (r.is_minor) nameCell.appendChild(badge('minor', 'warn'));
    if (r.has_guardian) nameCell.appendChild(badge('guardian', 'note'));
    if (r.payment_failed) nameCell.appendChild(badge('payment failed', 'warn'));
    tr.className = 'click';
    tr.addEventListener('click', () => openProfile(r.user_id));
  });
  body.appendChild(t);
  updatePager();
}

const subLabel = (r) => (r.sub_status ? `${r.sub_tier || '—'} · ${r.sub_status}` : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

function updatePager() {
  const p = $('users-pager'); if (!p) return; p.textContent = '';
  const pages = Math.max(1, Math.ceil(ST.total / PAGE_SIZE));
  p.appendChild(h('span', { class: 'cap', text: `${ST.total} users · page ${ST.page + 1}/${pages}` }));
  const prev = h('button', { class: 'btn sm ghost', text: 'Prev', onclick: () => { if (ST.page > 0) { ST.page--; load(); } } });
  const next = h('button', { class: 'btn sm ghost', text: 'Next', onclick: () => { if (ST.page + 1 < pages) { ST.page++; load(); } } });
  prev.disabled = ST.page <= 0; next.disabled = ST.page + 1 >= pages;
  p.appendChild(prev); p.appendChild(next);
}

async function openProfile(uid) {
  openModal('User', [emptyState('Loading…')]);
  try {
    const p = one(await rpc('admin_athlete_profile', { p_user: uid }));
    const banner = [];
    if (p.is_minor) banner.push(badge('minor', 'warn'));
    if (p.has_guardian) banner.push(badge('guardian', 'note'));
    if (p.payment_failed) banner.push(badge('payment failed', 'warn'));
    const nodes = [];
    if (banner.length) nodes.push(h('div', { style: 'margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap' }, banner));
    nodes.push(
      row('Name', p.full_name || '—'), row('Email', p.email || '—'), row('Role', p.primary_role || '—'),
      row('Joined', fmtDate(p.created_at)), row('Last active', p.last_active || '—'),
      row('Meals · total', num(p.meals_total)), row('Meals · 7d', num(p.meals_7d)),
      row('AI cost · 30d', usd4(p.ai_cost_30d)),
      row('Subscription', `${p.sub_tier || 'none'}${p.sub_status ? ' · ' + p.sub_status : ''}`),
      h('p', { class: 'cap', style: 'margin-top:14px', text: 'Read-only in Phase 1A. Actions (correct role, pause, reset onboarding, refunds) arrive in Phase 1B behind step-up reauth.' }),
    );
    openModal('User profile', nodes);
  } catch (e) { openModal('User', [emptyState(e.message)]); }
}

let dt;
function debounced() { clearTimeout(dt); dt = setTimeout(load, 250); }

function sel(opts, val, onchange, allLabel) {
  const s = h('select', { class: 'sel', onchange: (e) => onchange(e.target.value) },
    opts.map((o) => h('option', { value: o, text: o || allLabel })));
  s.value = val;
  return s;
}

function mount(view, arg) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Users' }), h('span', { class: 'line' })]));
  const searchI = h('input', { type: 'text', placeholder: 'Search name, email, or id…', style: 'max-width:280px', oninput: (e) => { ST.search = e.target.value; ST.page = 0; debounced(); } });
  searchI.value = ST.search;
  view.appendChild(h('div', { class: 'filterbar' }, [
    searchI,
    sel(['', 'athlete', 'parent', 'coach', 'trainer'], ST.role, (v) => { ST.role = v; ST.page = 0; load(); }, 'all roles'),
    sel(['', 'active', 'past_due', 'canceled', 'paused', 'preview'], ST.status, (v) => { ST.status = v; ST.page = 0; load(); }, 'any status'),
  ]));
  view.appendChild(h('div', { id: 'users-body' }));
  view.appendChild(h('div', { id: 'users-pager', class: 'pager' }));
  load();
  if (arg) openProfile(arg);
}

export default { id: 'users', title: 'Users', rail: 'People', render(view, arg) { mount(view, arg); } };
