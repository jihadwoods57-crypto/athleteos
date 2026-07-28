// OnStandard — Command Center · Support. Founder queue over support_tickets (safety-first ordering),
// with per-ticket history (support_ticket_events), add-note, and resolve (both audited). Safety-category
// tickets are visually separated + auto-urgent. In-app intake is create_support_ticket (RN client).
import { rpc } from '../api.js';
import { $, h, badge, tbl, ago, openModal, toast, emptyState } from '../ui.js';

const ST = { status: 'open', category: '' };

async function load() {
  const body = $('support-body'); if (!body) return;
  body.textContent = ''; body.appendChild(emptyState('Loading…'));
  try {
    const rows = await rpc('admin_support_queue', { p_status: ST.status || null, p_category: ST.category || null });
    render(rows || []);
  } catch (e) { body.textContent = ''; body.appendChild(emptyState('Error: ' + e.message)); }
}

function render(rows) {
  const body = $('support-body'); body.textContent = '';
  if (!rows.length) { body.appendChild(emptyState('No tickets match.')); return; }
  const t = tbl(['user', 'category', 'priority', 'subject', 'status', 'opened'],
    rows.map((r) => ['', '', '', r.subject, r.status, ago(r.created_at)]));
  const trs = t.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i];
    const u = tr.children[0]; u.textContent = r.user_name || r.user_email || String(r.user_id).slice(0, 8) + '…';
    if (r.is_minor) u.appendChild(badge('minor', 'warn'));
    const c = tr.children[1]; c.appendChild(badge(r.category, r.category === 'safety' ? 'warn' : ''));
    const p = tr.children[2]; p.appendChild(badge(r.priority, r.priority === 'urgent' ? 'warn' : (r.priority === 'high' ? 'note' : '')));
    if (r.category === 'safety') tr.style.background = 'var(--warn-bg)';
    tr.className = 'click';
    tr.addEventListener('click', () => openTicket(r));
  });
  body.appendChild(t);
}

async function openTicket(r) {
  openModal('Ticket', [emptyState('Loading…')]);
  try {
    const events = await rpc('admin_ticket_events', { p_ticket: r.id });
    const noteInput = h('input', { type: 'text', placeholder: 'Add a note…' });
    const nodes = [
      h('div', { style: 'display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap' }, [
        badge(r.category, r.category === 'safety' ? 'warn' : ''),
        badge(r.priority, r.priority === 'urgent' ? 'warn' : ''),
        badge(r.status, r.status === 'resolved' ? 'ok' : ''),
        ...(r.is_minor ? [badge('minor reporter', 'warn')] : []),
      ]),
      h('p', { class: 'lead', style: 'font-size:16px', text: r.subject }),
      h('p', { class: 'cap', text: `from ${r.user_name || r.user_email || r.user_id} · ${new Date(r.created_at).toLocaleString()}` }),
      h('div', { class: 'sec-h', style: 'margin:12px 0 8px' }, [h('h2', { text: 'History' }), h('span', { class: 'line' })]),
    ];
    for (const e of (events || [])) {
      nodes.push(h('div', { class: 'item', style: 'display:block' }, [
        h('div', { class: 'lbl', text: `${e.kind}${e.body ? ': ' + e.body : ''}` }),
        h('div', { class: 'val', text: ago(e.created_at) }),
      ]));
    }
    nodes.push(h('div', { style: 'height:12px' }), h('label', { class: 'fld', text: 'Note' }), noteInput);
    const actions = [h('button', { class: 'btn', text: 'Add note', onclick: async () => {
      if (!noteInput.value.trim()) return;
      try { await rpc('admin_add_ticket_event', { p_ticket: r.id, p_kind: 'note', p_body: noteInput.value.trim() }); toast('Note added · audited'); openTicket(r); }
      catch (e) { toast('Failed: ' + e.message, true); }
    } })];
    if (r.status !== 'resolved') actions.push(h('button', { class: 'btn pri', text: 'Resolve', onclick: async () => {
      try { await rpc('admin_resolve_ticket', { p_ticket: r.id, p_note: noteInput.value.trim() || null }); toast('Resolved · audited'); load(); openTicket({ ...r, status: 'resolved' }); }
      catch (e) { toast('Failed: ' + e.message, true); }
    } }));
    nodes.push(h('div', { style: 'display:flex; gap:8px; margin-top:10px' }, actions));
    openModal('Ticket', nodes);
  } catch (e) { openModal('Ticket', [emptyState(e.message)]); }
}

function sel(opts, val, onchange, allLabel) {
  const s = h('select', { class: 'sel', onchange: (e) => onchange(e.target.value) }, opts.map((o) => h('option', { value: o, text: o || allLabel })));
  s.value = val; return s;
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Support' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'filterbar' }, [
    sel(['open', 'pending', 'resolved', ''], ST.status, (v) => { ST.status = v; load(); }, 'any status'),
    sel(['', 'question', 'bug', 'billing', 'safety'], ST.category, (v) => { ST.category = v; load(); }, 'all categories'),
  ]));
  view.appendChild(h('div', { id: 'support-body' }));
  load();
}

export default { id: 'support', title: 'Support', rail: 'Ops', render(view) { mount(view); }, poll() { load(); } };
