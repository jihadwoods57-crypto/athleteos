/* Client-facing OnStandard Pay screen: a connected client's trainer's payable offers, with a real
   "Pay" button that opens Stripe Checkout (destination charge) in the system browser. Reached from
   Profile's "Trainer Connection" card. Only ever shows offers from a trainer whose Connect account
   is fully active (my_trainer_offers RPC enforces this server-side) — never a dead "pay" button. */
import { backHead, esc, skeletonRows, errorState, emptyState, alertMsg, statusMsg } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { priceLabel } from '../funded.js';

let CACHE = { offers: null, failed: false, loaded: false };
let UI = { paying: null }; // offer_id currently starting checkout, or null
// offer_id -> true once Stripe Checkout was opened for it this session. The button used to
// re-arm instantly as "Pay", which read as "that didn't work" and invited a second checkout.
let OPENED = {};

async function load(force) {
  if (CACHE.loaded && !force) return;
  const r = await roles.fetchMyTrainerOffers();
  // { error: true } means the read FAILED — never render that as "your trainer has no packages".
  CACHE.failed = !!(r && !Array.isArray(r) && r.error);
  if (!CACHE.failed) CACHE.offers = Array.isArray(r) ? r : [];
  CACHE.loaded = true;
  // A successful refresh reflects the server again (a finished purchase shows up server-side),
  // so the "checkout opened" reminder resets with the data it described.
  if (force && !CACHE.failed) OPENED = {};
  if (window.__render) window.__render();
}

export default {
  render() {
    const head = backHead('Packages', 'Your trainer’s accountability packages', 'profile');
    if (!CACHE.loaded && !navigator.onLine) {
      return `${head}${errorState({ title: "You're offline", body: 'Your trainer’s packages load right here when you reconnect.', retryId: 'mto-retry' })}`;
    }
    if (!CACHE.loaded) {
      return `${head}${skeletonRows(3, 'Loading packages')}`;
    }
    if (CACHE.failed && !(CACHE.offers || []).length) {
      return `${head}${errorState({ title: "Couldn't load packages", body: 'Check your connection and retry; nothing was charged.', retryId: 'mto-retry' })}`;
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
          ${o.cadence === 'month' || o.cadence === 'week'
            ? `<div class="ls" style="margin-top:4px;color:var(--green-bright)">Includes OnStandard membership: no separate subscription.</div>` : ''}
        </div>
        ${/* disabled while this offer's checkout is opening, not just relabelled to '…': the
              button kept its data-pay and stayed tappable, so a second tap during the
              startOfferCheckout round trip opened a SECOND Stripe Checkout session for the same
              package. aria-label carries the offer name so the button is not a bare "Pay". */''}
        ${o.price_cents != null ? `<button class="btn green sm" data-pay="${esc(o.offer_id)}"${UI.paying === o.offer_id ? ' disabled aria-busy="true"' : ''} aria-label="${OPENED[o.offer_id] ? `Reopen checkout for ${esc(o.name)}` : `Pay for ${esc(o.name)}, ${esc(priceLabel(o))}`}" style="width:auto;padding:0 14px;height:44px;flex:none">${UI.paying === o.offer_id ? '…' : OPENED[o.offer_id] ? 'Reopen checkout' : 'Pay'}</button>` : ''}
      </div>
      ${OPENED[o.offer_id] ? statusMsg({ text: 'Checkout opened in your browser. Finished paying? It shows here within a minute.', style: 'display:block;color:var(--text-2);padding:0 0 10px' }) : ''}`).join('')}
    </section>
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>`
    : emptyState({
      // No action: a client has no in-app move that makes their trainer publish a package or
      // finish Connect setup. emptyState() supports action: null for exactly this — a fabricated
      // "Message your trainer" button with nowhere real to send it would be the dead pointer
      // DESIGN.md bans, which is worse than an honest empty state with none.
      icon: 'bolt', title: 'No packages yet',
      body: "Your trainer hasn't published any paid packages, or hasn't finished setting up payments yet.",
    })}
    ${alertMsg({ id: 'mto-err', style: 'color:var(--red);padding:10px 16px' })}
    `;
  },
  mount(root) {
    load();
    const retry = root.querySelector('#mto-retry');
    if (retry) retry.addEventListener('click', async () => { retry.disabled = true; await load(true); });
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
      const offerId = b.getAttribute('data-pay');
      const err = root.querySelector('#mto-err');
      if (err) err.textContent = '';
      UI.paying = offerId; if (window.__render) window.__render();
      const r = await roles.startOfferCheckout(offerId);
      UI.paying = null;
      if (r && r.url) { OPENED[offerId] = true; roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#mto-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    }));
  },
};
