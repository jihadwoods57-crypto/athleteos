/* Parent "Fund a plan": each child's trainer's payable packages, with a Pay button that opens Stripe
   Checkout with the parent as payer and the child as beneficiary. Server verifies guardian+client. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let CACHE = { rows: null, loaded: false };
let UI = { paying: null };

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchFundedOffers();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time' : o.cadence === 'session' ? ' / session' : o.cadence === 'week' ? ' / wk' : ' / mo';
  return `$${n}${per}`;
}

function groupByChild(rows) {
  const map = new Map();
  for (const r of (rows || [])) {
    if (!map.has(r.child_id)) map.set(r.child_id, { child_id: r.child_id, child_name: r.child_name, trainer_name: r.trainer_name, offers: [] });
    map.get(r.child_id).offers.push(r);
  }
  return [...map.values()];
}

export default {
  render() {
    if (!CACHE.loaded) {
      return `${backHead('Fund a plan', 'Pay for your child’s coaching', 'parent')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`;
    }
    const groups = groupByChild(CACHE.rows);
    return `${backHead('Fund a plan', 'Pay for your child’s coaching', 'parent')}
    ${groups.length ? groups.map(g => `
    <div class="eyebrow">${esc(g.child_name || 'Your child')}${g.trainer_name ? ` · ${esc(g.trainer_name)}` : ''}</div>
    <section class="card" style="padding:6px 16px">
      ${g.offers.map(o => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="lt">${esc(o.name)}</div>
          <div class="ls">${esc(priceLabel(o))}${o.blurb ? ' · ' + esc(o.blurb) : ''}</div>
          ${(o.features || []).length ? `<div class="ls" style="margin-top:4px">${(o.features || []).map(f => esc(f)).join(' · ')}</div>` : ''}
        </div>
        <button class="btn green sm" data-pay="${esc(o.offer_id)}" data-child="${esc(o.child_id)}" style="width:auto;padding:0 14px;height:34px;flex:none">${UI.paying === o.offer_id ? '…' : 'Pay'}</button>
      </div>`).join('')}
    </section>`).join('') + `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>`
    : `<div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">Nothing to fund yet</div>
      <div class="sd-s">When your child connects with a trainer who accepts payments, their packages show up here.</div></div>`}
    <p id="fp-err" class="ls" style="color:var(--red-bright);padding:10px 16px"></p>`;
  },
  mount(root) {
    load();
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
      const offerId = b.getAttribute('data-pay');
      const childId = b.getAttribute('data-child');
      const err = root.querySelector('#fp-err'); if (err) err.textContent = '';
      UI.paying = offerId; if (window.__render) window.__render();
      const r = await roles.startFundedCheckout(offerId, childId);
      UI.paying = null;
      if (r && r.url) { roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#fp-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    }));
  },
};
