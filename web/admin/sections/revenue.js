// OnStandard — Command Center · Revenue. Truthful, separated metrics (design spec §8): ESTIMATED
// subscription value (plan prices × active subs) is clearly NOT collected revenue. Collected / net /
// refunds require the payments ledger + live billing (Phase 1B) — shown as a labeled empty state, never
// faked. Plus a failed-payment rollup from subscriptions.payment_failed_at.
import { rpc } from '../api.js';
import { $, h, num, one, usd2, card, row, tbl, ago, emptyState } from '../ui.js';

async function load() {
  const kpi = $('rev-kpi'), grid = $('rev-grid');
  try {
    const [rev, failed] = await Promise.all([
      rpc('admin_revenue').then(one),
      rpc('admin_failed_payments', { p_limit: 100 }),
    ]);
    kpi.textContent = '';
    kpi.appendChild(h('div', { class: 'big num sig', text: usd2(num(rev.estimated_subscription_value_usd)) }));
    kpi.appendChild(h('div', { class: 'cap', text: 'estimated subscription value / month · from plan prices, not collected revenue' }));

    grid.textContent = '';
    grid.appendChild(card('Subscriptions', [
      row('Active', num(rev.active_subs)),
      row('Team', num(rev.team_subs)),
      row('Consumer', num(rev.consumer_subs)),
      row('Seats used', num(rev.seats_used)),
    ]));
    grid.appendChild(card('Collected revenue', [
      emptyState('Billing is not live on prod yet. Collected revenue, net revenue, and refunds appear here from the payments ledger once billing secrets are set (Phase 1B).'),
    ]));
    const rows = failed || [];
    grid.appendChild(card('Failed payments', rows.length
      ? [tbl(['owner', 'tier', 'plan', 'status', 'when'],
          rows.slice(0, 20).map((r) => [String(r.owner_id).slice(0, 8) + '…', r.tier || '—', r.plan_id || '—', r.status || '—', ago(r.payment_failed_at)]))]
      : [emptyState('No failed payments on record.')]));
  } catch (e) { $('rev-grid').textContent = ''; $('rev-grid').appendChild(emptyState('Error: ' + e.message)); }
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Revenue' }), h('span', { class: 'line' })]));
  view.appendChild(h('section', { class: 'hero' }, [h('div', { class: 'inner', id: 'rev-kpi' })]));
  view.appendChild(h('div', { class: 'grid', id: 'rev-grid' }));
  load();
}

export default { id: 'revenue', title: 'Revenue', rail: 'Money & AI', render(view) { mount(view); }, poll() { load(); } };
