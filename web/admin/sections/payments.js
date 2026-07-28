// OnStandard — Command Center · Payments. Two money flows, RECONCILED (no duplication):
//  (1) OnStandard Pay — trainer→client Connect charges + the platform FEE revenue (REUSES offer_payments).
//  (2) platform SUBSCRIPTIONS — the payments ledger (fills forward once billing is live).
// Financial actions are provider-capability-gated + use a single-use step-up grant (mechanism shipped +
// verified). The provider-CALLING edge fns are deferred to live billing (can't be tested until then).
import { rpc } from '../api.js';
import { $, h, num, one, card, row, tbl, ago, emptyState } from '../ui.js';

const usdc = (c) => '$' + (Number(c || 0) / 100).toFixed(2);
const BILLING_CONNECTED = false; // flips when STRIPE_*/REVENUECAT_* secrets are set + bootstrap updated

const PROVIDER_CAPS = [
  ['Stripe (team/org subscriptions)', 'refund · credit · plan-change · cancel (API)'],
  ['RevenueCat · App Store · Play (consumer IAP)', 'store-managed — refunds handled by the store; reflected only'],
];

async function load() {
  const g = $('pay-grid'); if (!g) return;
  g.textContent = ''; g.appendChild(emptyState('Loading…'));
  try {
    const [fee, offers, subs] = await Promise.all([
      rpc('admin_offer_fee_revenue', { p_days: 30 }).then(one),
      rpc('admin_offer_payments', { p_days: 30, p_limit: 50 }),
      rpc('admin_payments', { p_days: 30, p_limit: 50 }),
    ]);
    g.textContent = '';
    g.appendChild(card('OnStandard Pay — fee revenue · 30d', [
      h('div', { class: 'big num sig', text: usdc(fee.platform_fee_cents) }),
      h('div', { class: 'cap', text: 'your platform cut (application fee) — real, from offer_payments' }),
      row('Gross processed', usdc(fee.gross_cents)),
      row('Paid charges', num(fee.paid_count)),
      row('Refunded', num(fee.refunded_count)),
    ]));
    g.appendChild(card('OnStandard Pay — recent charges', (offers || []).length
      ? [tbl(['payer', 'amount', { t: 'fee', num: 1 }, 'status', 'when'],
          offers.map((o) => [String(o.payer_id || '').slice(0, 8) + '…', usdc(o.amount_cents), usdc(o.application_fee_cents), o.status, ago(o.created_at)]))]
      : [emptyState('No OnStandard Pay charges in the window. Trainer→client payments appear once a trainer connects Stripe + a client pays; refunds run through OnStandard Pay (trainer-side).')]));
    g.appendChild(card('Subscription revenue ledger (Stripe + IAP)', (subs || []).length
      ? [tbl(['owner', 'kind', { t: 'amount', num: 1 }, 'status', 'when'],
          subs.map((s) => [String(s.owner_id || '').slice(0, 8) + '…', s.kind, usdc(s.amount_cents), s.status, ago(s.occurred_at)]))]
      : [emptyState('Billing is not live on prod yet — this subscription-charge ledger fills forward once STRIPE_*/REVENUECAT_* secrets are set and the webhook captures subscription events.')]));
    g.appendChild(renderActionsCard());
  } catch (e) { g.textContent = ''; g.appendChild(emptyState('Error: ' + e.message)); }
}

function renderActionsCard() {
  const nodes = [h('p', { class: 'cap', text: 'Financial actions are provider-capability-gated, use a single-use step-up grant, call the real provider API, and are audited.' })];
  for (const [rail, caps] of PROVIDER_CAPS) nodes.push(row(rail, caps));
  nodes.push(h('div', { style: 'height:10px' }));
  nodes.push(emptyState(BILLING_CONNECTED
    ? 'Billing connected — select a subscription charge in the ledger to refund/credit/change-plan (behind step-up reauth).'
    : 'Billing not connected. Set STRIPE_*/REVENUECAT_* secrets on prod to enable subscription refunds / credits / plan-changes. The mechanism (single-use financial grant + provider-capability gating) is shipped; the provider-calling edge functions land with live billing so they can be tested. Trainer→client offer refunds already run through OnStandard Pay.'));
  return card('Financial actions', nodes);
}

function mount(view) {
  view.appendChild(h('div', { class: 'sec-h' }, [h('h2', { text: 'Payments' }), h('span', { class: 'line' })]));
  view.appendChild(h('div', { class: 'grid', id: 'pay-grid' }));
  load();
}

export default { id: 'payments', title: 'Payments', rail: 'Money & AI', render(view) { mount(view); }, poll() { load(); } };
