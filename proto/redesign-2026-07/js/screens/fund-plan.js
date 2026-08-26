/* Parent "Fund a plan": each child's trainer's payable packages, with a Pay button that opens Stripe
   Checkout with the parent as payer and the child as beneficiary. Server verifies guardian+client. */
import { backHead, esc, errorState, skeletonRows, emptyState, alertMsg, statusMsg } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { priceLabel } from '../funded.js';

let CACHE = { rows: null, loaded: false };
let UI = { paying: null };
// offer_id -> true once Stripe Checkout was opened for it this session. The button used to
// re-arm instantly as "Pay", which read as "that didn't work" and invited a second checkout.
let OPENED = {};

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchFundedOffers();
  CACHE.loaded = true;
  // A successful refresh means the list reflects the server again (a finished purchase shows up
  // server-side), so the "checkout opened" reminder resets with the data it described.
  if (force && CACHE.rows && !CACHE.rows.error) OPENED = {};
  if (window.__render) window.__render();
}

// One group per (child, practice) — a child can be an active client of more than one trainer, and
// each trainer's packages must render under THAT trainer's name, never merged under the first seen.
function groupByChild(rows) {
  const map = new Map();
  for (const r of (rows || [])) {
    const key = `${r.child_id}|${r.practice_id}`;
    if (!map.has(key)) map.set(key, { child_id: r.child_id, child_name: r.child_name, practice_id: r.practice_id, trainer_name: r.trainer_name, offers: [] });
    map.get(key).offers.push(r);
  }
  return [...map.values()];
}

export default {
  render() {
    const head = backHead('Fund a plan', 'Pay for your child’s coaching', 'parent');
    // Offline is checked BEFORE the loading gate, the same order my-trainer-offers.js and
    // coach-roster use: a cold offline open would otherwise sit on the loading state forever,
    // because load() can never resolve to set CACHE.loaded.
    if (!CACHE.loaded && !navigator.onLine) {
      return `${head}${errorState({
    title: "You're offline",
    body: 'Nothing was charged. Your children’s trainers and their packages load right here when you reconnect.',
    retryId: 'fp-retry',
  })}`;
    }
    // A skeleton shaped like the list it stands in for, not a spinner in content — this screen
    // renders a list of packages, so it waits as one.
    if (!CACHE.loaded) {
      return `${head}${skeletonRows(3, 'Loading packages')}`;
    }
    // "Nothing to fund yet" is a statement about the child's trainer, so it may not be guessed
    // from a failed read: it would send a parent off to chase a trainer who is already set up.
    if (CACHE.rows && CACHE.rows.error) {
      return `${head}
      ${errorState({
    title: "Couldn't load the packages",
    body: 'Nothing was charged. Reconnect and your children’s trainers load right here.',
    retryId: 'fp-retry',
  })}`;
    }
    const groups = groupByChild(CACHE.rows);
    return `${head}
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
        ${/* disabled, not just relabelled: the button stayed tappable while checkout opened, so a
              second tap started a SECOND Stripe Checkout for the same package. The label carries
              the child's name because a parent funding two kids sees two identical "Pay" buttons. */''}
        ${o.price_cents != null ? `<button class="btn green sm" data-pay="${esc(o.offer_id)}" data-child="${esc(o.child_id)}"${UI.paying === o.offer_id ? ' disabled aria-busy="true"' : ''} aria-label="${OPENED[o.offer_id] ? `Reopen checkout for ${esc(o.name)}` : `Pay for ${esc(o.name)} for ${esc(g.child_name || 'your child')}, ${esc(priceLabel(o))}`}" style="width:auto;padding:0 14px;height:44px;flex:none">${UI.paying === o.offer_id ? '…' : OPENED[o.offer_id] ? 'Reopen checkout' : 'Pay'}</button>` : ''}
      </div>
      ${OPENED[o.offer_id] ? statusMsg({ text: 'Checkout opened in your browser. Finished paying? It shows here within a minute.', style: 'display:block;color:var(--text-2);padding:0 0 10px' }) : ''}`).join('')}
    </section>`).join('') + `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>`
    : emptyState({
      // No action: which trainer a child connects with is decided outside this screen entirely.
      // Same reasoning as my-trainer-offers.js — an invented CTA here would point nowhere real.
      icon: 'bolt', title: 'Nothing to fund yet',
      body: 'When your child connects with a trainer who accepts payments, their packages show up here.',
    })}
    ${alertMsg({ id: 'fp-err', style: 'color:var(--red);padding:10px 16px' })}`;
  },
  mount(root) {
    load();
    const retry = root.querySelector('#fp-retry');
    if (retry) retry.addEventListener('click', async () => { retry.disabled = true; await load(true); });
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', async () => {
      const offerId = b.getAttribute('data-pay');
      const childId = b.getAttribute('data-child');
      const err = root.querySelector('#fp-err'); if (err) err.textContent = '';
      UI.paying = offerId; if (window.__render) window.__render();
      const r = await roles.startFundedCheckout(offerId, childId);
      UI.paying = null;
      if (r && r.url) { OPENED[offerId] = true; roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#fp-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    }));
  },
};
