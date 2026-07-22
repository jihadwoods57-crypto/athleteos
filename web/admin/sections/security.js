// OnStandard — Command Center · Security. Surfaces the admin sign-in event log (admin_recent_logins)
// and any active lockouts (admin_active_locks) so the founder can actually SEE the watch. Suspicious
// sign-ins are flagged here (and alerted out via email + push by admin-auth-monitor). Read-only.
import { rpc } from '../api.js';
import { $, h, ago, badge, emptyState, card } from '../ui.js';

async function load() {
  const body = $('sec-body'); if (!body) return;
  body.textContent = ''; body.appendChild(emptyState('Loading…'));
  try {
    const [logins, locks] = await Promise.all([
      rpc('admin_recent_logins', { p_limit: 100 }),
      rpc('admin_active_locks'),
    ]);
    body.textContent = '';

    if ((locks || []).length) {
      const rows = locks.map((l) => h('div', { class: 'row' }, [
        h('span', { class: 'k', text: String(l.user_id || '').slice(0, 8) + '…' }),
        h('span', { class: 'v', text: 'locked until ' + new Date(l.locked_until).toLocaleTimeString() }),
      ]));
      const c = card('Active lockouts', rows);
      c.style.borderColor = 'var(--warn)';
      body.appendChild(c);
    }

    if (!(logins || []).length) {
      body.appendChild(emptyState('No sign-in events yet. The monitor records these each minute.'));
      return;
    }
    const head = h('tr', {}, ['when', 'event', 'IP', 'country', 'flags'].map((t) => h('th', { text: t })));
    const rows = logins.map((r) => {
      const flags = Array.isArray(r.flags) ? r.flags : [];
      const flagCell = h('td', {}, flags.length
        ? flags.map((f) => badge(String(f).replace(/_/g, ' '), 'warn'))
        : [h('span', { class: 'empty', text: '—' })]);
      return h('tr', { class: flags.length ? 'warn' : '' }, [
        h('td', { text: ago(r.occurred_at) }),
        h('td', { text: r.event_type || '—' }),
        h('td', { text: r.ip || '—' }),
        h('td', { text: r.country || '—' }),
        flagCell,
      ]);
    });
    body.appendChild(h('table', {}, [h('thead', {}, [head]), h('tbody', {}, rows)]));
  } catch (e) {
    body.textContent = '';
    body.appendChild(emptyState('Error: ' + e.message));
  }
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Security' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'cap', style: 'margin:0 2px 12px',
    text: 'Admin sign-ins and lockouts. Suspicious events are flagged and alerted (email + push).' }));
  view.appendChild(h('div', { id: 'sec-body' }));
  load();
}

export default { id: 'security', title: 'Security', rail: 'Trust', render(view) { mount(view); }, poll() { load(); } };
