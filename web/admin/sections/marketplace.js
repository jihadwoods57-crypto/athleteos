// OnStandard — Command Center · Marketplace. The Coach Partner Program back office: the
// application queue (approve / reject / request info, with notes), credential verification
// (view the actual document, verify or reject — the ONLY path a credential leaves 'submitted'),
// listing suspension, and the coach-report queue. Every action lands in admin_audit_log via the
// 0186 RPCs; nothing here writes tables directly.
import { rpc, sb } from '../api.js';
import { $, h, badge, tbl, ago, openModal, toast, emptyState } from '../ui.js';

const ST = { appStatus: 'submitted', repStatus: 'open' };
const CAT_LABEL = { accountability: 'Accountability', cpt: 'CPT', snc: 'S&C' };

async function load() {
  const apps = $('mkt-apps'); const reps = $('mkt-reports');
  if (!apps || !reps) return;
  apps.textContent = ''; apps.appendChild(emptyState('Loading…'));
  reps.textContent = ''; reps.appendChild(emptyState('Loading…'));
  try {
    const rows = await rpc('admin_mkt_list_applications', { p_status: ST.appStatus || null });
    renderApps(rows || []);
  } catch (e) { apps.textContent = ''; apps.appendChild(emptyState('Error: ' + e.message)); }
  try {
    const rows = await rpc('admin_mkt_list_reports', { p_status: ST.repStatus || null });
    renderReports(rows || []);
  } catch (e) { reps.textContent = ''; reps.appendChild(emptyState('Error: ' + e.message)); }
}

function renderApps(rows) {
  const body = $('mkt-apps'); body.textContent = '';
  if (!rows.length) { body.appendChild(emptyState('No applications match.')); return; }
  const t = tbl(['applicant', 'categories', 'credentials', 'status', 'submitted'],
    rows.map((r) => [r.display_name || r.legal_name || '—', '', '', r.status, r.submitted_at ? ago(r.submitted_at) : 'draft']));
  const trs = t.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i];
    const c = tr.children[1];
    (r.categories || []).forEach((k) => c.appendChild(badge(CAT_LABEL[k] || k, '')));
    const cr = tr.children[2];
    (r.credentials || []).forEach((x) => cr.appendChild(badge(`${x.category}:${x.status}`,
      x.status === 'verified' ? 'ok' : x.status === 'rejected' ? 'warn' : 'note')));
    tr.className = 'click';
    tr.addEventListener('click', () => openApp(r));
  });
  body.appendChild(t);
}

async function viewDoc(cred) {
  try {
    const { data, error } = await sb.storage.from('coach-credentials').createSignedUrl(cred.doc_path, 300);
    if (error) throw error;
    window.open(data.signedUrl, '_blank');
  } catch (e) { toast('Doc unavailable: ' + e.message, true); }
}

function openApp(r) {
  const noteInput = h('input', { type: 'text', placeholder: 'Internal note (applicant never sees this)…' });
  const credNodes = (r.credentials || []).map((cred) => h('div', { class: 'item' }, [
    h('div', { class: 'lbl' }, [
      badge(CAT_LABEL[cred.category] || cred.category, ''),
      h('span', { text: ` ${cred.title || 'untitled'} · ${cred.status}` }),
    ]),
    h('div', { class: 'val', style: 'display:flex;gap:6px' }, [
      h('button', { class: 'btn', text: 'View doc', onclick: () => viewDoc(cred) }),
      ...(cred.status === 'submitted' ? [
        h('button', { class: 'btn pri', text: 'Verify', onclick: () => credAction(r, cred, 'verified', noteInput.value) }),
        h('button', { class: 'btn', text: 'Reject', onclick: () => credAction(r, cred, 'rejected', noteInput.value) }),
      ] : []),
    ]),
  ]));
  const act = (action, label) => h('button', {
    class: action === 'approved' ? 'btn pri' : 'btn', text: label,
    onclick: async () => {
      try {
        await rpc('admin_mkt_review_application', { p_id: r.id, p_action: action, p_note: noteInput.value.trim() || '' });
        toast(`Application ${action} · audited`); closeAndReload();
      } catch (e) { toast('Failed: ' + e.message, true); }
    },
  });
  openModal('Application', [
    h('div', { style: 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap' }, [
      badge(r.status, r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'warn' : ''),
      ...(r.categories || []).map((k) => badge(CAT_LABEL[k] || k, 'note')),
    ]),
    h('p', { class: 'lead', style: 'font-size:16px', text: `${r.display_name || '—'} (legal: ${r.legal_name || '—'})` }),
    h('p', { class: 'cap', text: `${r.email || ''} · tz ${r.timezone || '—'} · capacity ${r.capacity} · languages ${(r.languages || []).join(', ') || '—'}` }),
    h('div', { class: 'sec-h', style: 'margin:12px 0 8px' }, [h('h2', { text: 'Bio' }), h('span', { class: 'line' })]),
    h('p', { text: r.bio || '—' }),
    h('div', { class: 'sec-h', style: 'margin:12px 0 8px' }, [h('h2', { text: 'Experience' }), h('span', { class: 'line' })]),
    h('p', { text: r.experience || '—' }),
    h('div', { class: 'sec-h', style: 'margin:12px 0 8px' }, [h('h2', { text: 'Credentials' }), h('span', { class: 'line' })]),
    ...(credNodes.length ? credNodes : [h('p', { class: 'cap', text: 'None claimed — accountability only.' })]),
    ...(r.notes || []).length ? [
      h('div', { class: 'sec-h', style: 'margin:12px 0 8px' }, [h('h2', { text: 'Internal notes' }), h('span', { class: 'line' })]),
      ...(r.notes).map((n) => h('p', { class: 'cap', text: `${n.note} · ${ago(n.at)}` })),
    ] : [],
    h('div', { style: 'height:12px' }), h('label', { class: 'fld', text: 'Note' }), noteInput,
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
      r.status === 'approved' ? [] : [
        act('under_review', 'Mark reviewing'),
        act('info_needed', 'Request info'),
        act('rejected', 'Reject'),
        act('approved', 'Approve'),
      ]),
    ...(r.listing ? [h('p', { class: 'cap', style: 'margin-top:8px', text: 'Listing exists — suspension controls are below in this modal.' })] : []),
  ]);
}

async function credAction(app, cred, action, note) {
  try {
    await rpc('admin_mkt_verify_credential', { p_id: cred.id, p_action: action, p_note: note || '' });
    toast(`Credential ${action} · audited`); closeAndReload();
  } catch (e) { toast('Failed: ' + e.message, true); }
}

function renderReports(rows) {
  const body = $('mkt-reports'); body.textContent = '';
  if (!rows.length) { body.appendChild(emptyState('No reports match.')); return; }
  const t = tbl(['coach', 'reason', 'detail', 'status', 'opened'],
    rows.map((r) => [r.coach_name || String(r.practice_id || '').slice(0, 8) + '…', '', r.detail || '—', r.status, ago(r.created_at)]));
  const trs = t.querySelectorAll('tbody tr');
  rows.forEach((r, i) => {
    const tr = trs[i];
    tr.children[1].appendChild(badge(r.reason, r.reason === 'scope' || r.reason === 'conduct' ? 'warn' : ''));
    tr.className = 'click';
    tr.addEventListener('click', () => openReport(r));
  });
  body.appendChild(t);
}

function openReport(r) {
  const resInput = h('input', { type: 'text', placeholder: 'Resolution note…' });
  const act = (status, label, pri) => h('button', {
    class: pri ? 'btn pri' : 'btn', text: label,
    onclick: async () => {
      try {
        await rpc('admin_mkt_resolve_report', { p_id: r.id, p_status: status, p_resolution: resInput.value.trim() || '' });
        toast(`Report ${status} · audited`); closeAndReload();
      } catch (e) { toast('Failed: ' + e.message, true); }
    },
  });
  openModal('Coach report', [
    h('div', { style: 'display:flex;gap:6px;margin-bottom:8px' }, [badge(r.reason, 'warn'), badge(r.status, '')]),
    h('p', { class: 'lead', text: r.coach_name || 'Unknown coach' }),
    h('p', { text: r.detail || '(no detail given)' }),
    h('p', { class: 'cap', text: `opened ${ago(r.created_at)}` }),
    h('div', { style: 'height:12px' }), h('label', { class: 'fld', text: 'Resolution' }), resInput,
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
      act('reviewing', 'Mark reviewing'),
      act('dismissed', 'Dismiss'),
      act('resolved', 'Resolve', true),
      ...(r.practice_id ? [h('button', {
        class: 'btn', text: 'Suspend listing', onclick: async () => {
          try {
            await rpc('admin_mkt_suspend_listing', { p_practice: r.practice_id, p_suspend: true, p_reason: resInput.value.trim() || r.reason });
            toast('Listing suspended · audited'); closeAndReload();
          } catch (e) { toast('Failed: ' + e.message, true); }
        },
      }), h('button', {
        class: 'btn', text: 'Unsuspend', onclick: async () => {
          try {
            await rpc('admin_mkt_suspend_listing', { p_practice: r.practice_id, p_suspend: false, p_reason: '' });
            toast('Listing unsuspended · audited'); closeAndReload();
          } catch (e) { toast('Failed: ' + e.message, true); }
        },
      })] : []),
    ]),
  ]);
}

function closeAndReload() {
  const m = $('modal-root'); if (m) m.textContent = '';
  load();
}

function sel(opts, val, onchange, allLabel) {
  const s = h('select', { class: 'sel', onchange: (e) => onchange(e.target.value) }, opts.map((o) => h('option', { value: o, text: o || allLabel })));
  s.value = val; return s;
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Coach applications' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'filterbar' }, [
    sel(['submitted', 'under_review', 'info_needed', 'approved', 'rejected', 'draft', ''], ST.appStatus, (v) => { ST.appStatus = v; load(); }, 'any status'),
  ]));
  view.appendChild(h('div', { id: 'mkt-apps' }));
  view.appendChild(h('div', { class: 'sec-h', style: 'margin-top:18px' }, [h('h2', { text: 'Coach reports' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'filterbar' }, [
    sel(['open', 'reviewing', 'resolved', 'dismissed', ''], ST.repStatus, (v) => { ST.repStatus = v; load(); }, 'any status'),
  ]));
  view.appendChild(h('div', { id: 'mkt-reports' }));
  load();
}

export default { id: 'marketplace', title: 'Marketplace', rail: 'People', render(view) { mount(view); }, poll() { load(); } };
