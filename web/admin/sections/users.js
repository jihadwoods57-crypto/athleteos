// OnStandard — Command Center · Users. Platform-wide list with search/role/status filters + pagination,
// and a read-only drill-down. Minor/guardian/payment-failed are badged; minor contact PII is masked in
// the list (server-side) and viewing a real minor's profile is audited (server-side). Read-only in 1A —
// mutations (role, pause, reset, refunds) arrive in Phase 1B behind step-up reauth.
import { rpc } from '../api.js';
import { $, h, num, one, usd4, toast, tbl, row, openModal, closeModal, badge, emptyState, withReauth } from '../ui.js';

const ROLES = ['athlete', 'parent', 'coach', 'trainer'];

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
    if (r.suspended) nameCell.appendChild(badge('paused', 'warn'));
    tr.className = 'click';
    tr.addEventListener('click', () => openProfile(r.user_id, { suspended: r.suspended, role: r.primary_role }));
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

async function openProfile(uid, ctx = {}) {
  openModal('User', [emptyState('Loading…')]);
  try {
    const p = one(await rpc('admin_athlete_profile', { p_user: uid }));
    const suspended = !!ctx.suspended;
    const banner = [];
    if (p.is_minor) banner.push(badge('minor', 'warn'));
    if (p.has_guardian) banner.push(badge('guardian', 'note'));
    if (p.payment_failed) banner.push(badge('payment failed', 'warn'));
    if (suspended) banner.push(badge('paused', 'warn'));
    const nodes = [];
    if (banner.length) nodes.push(h('div', { style: 'margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap' }, banner));
    nodes.push(
      row('Name', p.full_name || '—'), row('Email', p.email || '—'), row('Role', p.primary_role || '—'),
      row('Joined', fmtDate(p.created_at)), row('Last active', p.last_active || '—'),
      row('Meals · total', num(p.meals_total)), row('Meals · 7d', num(p.meals_7d)),
      row('AI cost · 30d', usd4(p.ai_cost_30d)),
      row('Subscription', `${p.sub_tier || 'none'}${p.sub_status ? ' · ' + p.sub_status : ''}`),
    );
    // ----- actions (behind server-verified step-up reauth) -----
    nodes.push(h('div', { class: 'sec-h', style: 'margin:18px 0 10px' }, [h('h2', { text: 'Actions' }), h('span', { class: 'line' })]));
    const roleSel = h('select', { class: 'sel' }, ROLES.map((rr) => h('option', { value: rr, text: rr })));
    roleSel.value = p.primary_role || 'athlete';
    nodes.push(h('div', { class: 'filterbar' }, [
      h('span', { class: 'cap', text: 'Primary role' }), roleSel,
      h('button', { class: 'btn', text: 'Change role', onclick: () => doRoleChange(uid, roleSel.value, p.primary_role, ctx) }),
    ]));
    const pauseBtn = suspended
      ? h('button', { class: 'btn', text: 'Reactivate account', onclick: () => doAction(uid, 'admin_reactivate_account', 'Account reactivated', false, ctx) })
      : h('button', { class: 'btn', text: 'Pause account', onclick: () => doAction(uid, 'admin_pause_account', 'Account paused', true, ctx) });
    const tagBtn = h('button', { class: 'btn ghost', text: 'Tag for review', onclick: async () => {
      try { await rpc('admin_tag_user_for_review', { p_user: uid, p_note: 'flagged from command center' }); toast('Tagged for review · audited'); }
      catch (e) { toast('Failed: ' + e.message, true); }
    } });
    nodes.push(h('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin-top:6px' }, [pauseBtn, tagBtn]));
    nodes.push(h('p', { class: 'cap', style: 'margin-top:12px', text: 'Role change and pause/reactivate require re-entering your password (step-up) and are audited. Session revoke, password reset, resend invite, and hard-suspension enforcement arrive with the GoTrue admin edge function.' }));
    openModal('User profile', nodes);
  } catch (e) { openModal('User', [emptyState(e.message)]); }
}

// Role change: fetch the blast-radius preview, confirm, then the reauth-gated mutation.
async function doRoleChange(uid, newRole, curRole, ctx) {
  if (newRole === (curRole || '')) { toast('Already ' + newRole); return; }
  let pv;
  try { pv = await rpc('admin_role_change_preview', { p_user: uid, p_new_role: newRole }); }
  catch (e) { toast('Preview failed: ' + e.message, true); return; }
  openModal('Confirm role change', [
    h('p', { class: 'cap', text: `${curRole || '—'} → ${newRole}. Primary role is GLOBAL — it changes which app flow the user sees on next launch. Blast radius:` }),
    row('Team memberships (as athlete)', num(pv.team_memberships_as_athlete)),
    row('Team staff roles', num(pv.team_staff_roles)),
    row('Guardian of', num(pv.guardianships_as_guardian)),
    row('Has guardians', num(pv.guardianships_as_athlete)),
    row('Subscription', pv.subscription ? `${pv.subscription.tier || '—'} · ${pv.subscription.status || '—'}` : 'none'),
    h('div', { style: 'height:12px' }),
    h('button', { class: 'btn pri', text: `Change to ${newRole}`, onclick: () => withReauth('user_mutation', async () => {
      try { await rpc('admin_correct_primary_role', { p_user: uid, p_role: newRole }); toast(`Role changed to ${newRole} · audited`); openProfile(uid, ctx); load(); }
      catch (e) { toast('Failed: ' + e.message, true); }
    }) }),
  ]);
}

async function doAction(uid, fn, okMsg, newSuspended, ctx) {
  withReauth('user_mutation', async () => {
    try { await rpc(fn, { p_user: uid }); toast(okMsg + ' · audited'); openProfile(uid, { ...ctx, suspended: newSuspended }); load(); }
    catch (e) { toast('Failed: ' + e.message, true); }
  });
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
