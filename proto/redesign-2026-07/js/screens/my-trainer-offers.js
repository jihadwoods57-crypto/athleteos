/* Client-facing OnStandard Pay screen: a connected client's trainer's payable offers, with a real
   "Pay" button that opens Stripe Checkout (destination charge) in the system browser. Reached from
   Profile's "Trainer Connection" card. Only ever shows offers from a trainer whose Connect account
   is fully active (my_trainer_offers RPC enforces this server-side) — never a dead "pay" button. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let CACHE = { offers: null, loaded: false };
let UI = { paying: null }; // offer_id currently starting checkout, or null

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.offers = await roles.fetchMyTrainerOffers();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time' : o.cadence === 'session' ? ' / session' : o.cadence === 'week' ? ' / wk' : ' / mo';
  return `$${n}${per}`;
}

export default {
  render() {
    if (!CACHE.loaded) {
      return `${backHead('Packages', 'Your trainer’s accountability packages', 'profile')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`;
    }
    const offers = CACHE.offers || [];
    const trainerName = offers[0] && offers[0].trainer_name;
    return `${backHead('Packages', trainerName ? `From ${esc(trainerName)}` : 'Your trainer’s accountability packages', 'profile')}

    ${offers.length ? `
    <section class="card" style="padding:6px 16px">
      ${offers.map(o => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="lt">${esc(o.name)}</div>
          <div class="ls">${esc(priceLabel(o))}${o.blurb ? ' · ' + esc(o.blurb) : ''}</div>
          ${(o.features || []).length ? `<div class="ls" style="margin-top:4px">${(o.features || []).map(f => esc(f)).join(' · ')}</div>` : ''}
        </div>
        ${o.price_cents != null ? `<button class="btn green sm" data-pay="${esc(o.offer_id)}" style="width:auto;padding:0 14px;height:34px;flex:none">${UI.paying === o.offer_id ? '…' : 'Pay'}</button>` : ''}
      </div>`).join('')}
    </section>
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>`
    : `
    <div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
    <div class="sd-t">No packages yet</div>
    <div class="sd-s">Your trainer hasn't published any paid packages, or hasn't finished setting up payments yet.</div></div>`}
    <p id="mto-err" class="ls" style="color:var(--red);padding:10px 16px"></p>
    `;
  },
  mount(root) {
    load();
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
      const offerId = b.getAttribute('data-pay');
      const err = root.querySelector('#mto-err');
      if (err) err.textContent = '';
      UI.paying = offerId; if (window.__render) window.__render();
      const r = await roles.startOfferCheckout(offerId);
      UI.paying = null;
      if (r && r.url) { roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#mto-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    }));
  },
};
