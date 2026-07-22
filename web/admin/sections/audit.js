// OnStandard — Command Center · Audit Log. Searchable view over admin_audit_log (via admin_audit_search)
// — the append-only founder-action ledger (append-only enforcement lands in Phase 1B, 0121). Row click
// shows the before/after jsonb via textContent (no innerHTML).
import { rpc } from '../api.js';
import { $, h, ago, tbl, openModal, emptyState } from '../ui.js';

const ST = { action: '' };

async function load() {
  const body = $('audit-body'); if (!body) return;
  body.textContent = ''; body.appendChild(emptyState('Loading…'));
  try {
    const rows = await rpc('admin_audit_search', { p_action: ST.action || null, p_actor: null, p_limit: 200 });
    body.textContent = '';
    if (!(rows || []).length) { body.appendChild(emptyState('No audit entries.')); return; }
    const t = tbl(['when', 'action', 'target', 'actor'],
      rows.map((r) => [ago(r.created_at), r.action, String(r.target || '').slice(0, 40), String(r.actor_id || '').slice(0, 8) + '…']));
    t.querySelectorAll('tbody tr').forEach((tr, i) => { tr.className = 'click'; tr.addEventListener('click', () => openRow(rows[i])); });
    body.appendChild(t);
  } catch (e) { body.textContent = ''; body.appendChild(emptyState('Error: ' + e.message)); }
}

function openRow(r) {
  const pre = (label, obj) => obj == null ? null : h('div', {}, [
    h('div', { class: 'cap', style: 'margin-top:10px', text: label }),
    h('pre', { class: 'jsonpre', text: JSON.stringify(obj, null, 2) }),
  ]);
  openModal('Audit entry', [
    h('div', { class: 'cap', text: `${r.action} · ${new Date(r.created_at).toLocaleString()} · actor ${String(r.actor_id || '').slice(0, 8)}…` }),
    h('div', { class: 'cap', style: 'margin-top:4px', text: `target: ${r.target || '—'}` }),
    pre('before', r.before), pre('after', r.after),
  ].filter(Boolean));
}

let dt;
function debounced() { clearTimeout(dt); dt = setTimeout(load, 250); }

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Audit Log' }), h('span', { class: 'line' })]));
  const searchI = h('input', { type: 'text', placeholder: 'Filter by action (e.g. feature_flag, attention, user)…', style: 'max-width:340px', oninput: (e) => { ST.action = e.target.value; debounced(); } });
  searchI.value = ST.action;
  view.appendChild(h('div', { class: 'filterbar' }, [searchI]));
  view.appendChild(h('div', { id: 'audit-body' }));
  load();
}

export default { id: 'audit', title: 'Audit Log', rail: 'Trust', render(view) { mount(view); }, poll() { load(); } };
