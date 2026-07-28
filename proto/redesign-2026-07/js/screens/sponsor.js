/* Sponsor access: a sponsor buys a batch of premium seats and gets a redemption code to hand out.
   Reached from Profile's Settings section. Buy flow opens Stripe Checkout in the system browser
   (same pattern as my-trainer-offers.js); below the buy form, a list of the sponsor's own
   sponsorships with the code prominent so it's easy to read out or copy. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let CACHE = { rows: null, loaded: false };
let UI = { seats: '10', label: '', buying: false, copied: null };

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchMySponsorships();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

export default {
  render() {
    const rows = CACHE.rows || [];
    return `${backHead('Sponsor access', 'Fund premium seats for a group', 'profile')}

    <div class="eyebrow">Buy seats</div>
    <section class="card pad">
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Number of seats</div>
      <input class="ob-input" id="sp-seats" type="number" min="1" step="1" inputmode="numeric" value="${esc(UI.seats)}" placeholder="10" />
      <div style="height:10px"></div>
      <div style="font-size:12.5px;font-weight:700;color:var(--text-2);margin-bottom:4px">Label (optional)</div>
      <input class="ob-input" id="sp-label" value="${esc(UI.label)}" placeholder="e.g. Fall roster, Jones family" />
      <div style="height:14px"></div>
      <div id="sp-err" style="color:var(--red);font-size:13px;font-weight:600;min-height:18px"></div>
      <button class="btn primary" id="sp-buy" ${UI.buying ? 'disabled style="opacity:.6"' : ''}>${icon('bolt', 18)} ${UI.buying ? 'Starting checkout…' : 'Buy seats'}</button>
    </section>
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>

    <div class="eyebrow" style="margin-top:16px">Your sponsorships</div>
    ${!CACHE.loaded ? `
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`
    : rows.length ? `
    <section class="card" style="padding:6px 16px">
      ${rows.map((r, i) => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="tt" style="font-size:20px;font-weight:900;letter-spacing:1px;font-family:monospace">${esc(r.code || '')}</div>
          <div class="ls" style="margin-top:2px">${esc(String(r.seats_claimed != null ? r.seats_claimed : 0))} / ${esc(String(r.seats != null ? r.seats : '?'))} claimed${r.sponsor_label ? ` · ${esc(r.sponsor_label)}` : ''}</div>
        </div>
        <button class="btn ghost sm" data-copy="${esc(r.code || '')}" data-idx="${i}" style="width:auto;padding:0 14px;height:34px;flex:none">${UI.copied === i ? 'Copied' : 'Copy'}</button>
      </div>`).join('')}
    </section>`
    : `
    <div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
    <div class="sd-t">No sponsorships yet</div>
    <div class="sd-s">Buy a batch of seats above and you'll get a code to share.</div></div>`}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    load();
    const seatsEl = root.querySelector('#sp-seats');
    const labelEl = root.querySelector('#sp-label');
    if (seatsEl) seatsEl.addEventListener('input', () => { UI.seats = seatsEl.value; });
    if (labelEl) labelEl.addEventListener('input', () => { UI.label = labelEl.value; });

    const buy = root.querySelector('#sp-buy');
    if (buy) buy.addEventListener('click', async () => {
      const err = root.querySelector('#sp-err');
      if (err) err.textContent = '';
      const seats = parseInt(UI.seats, 10);
      if (!seats || seats < 1) { if (err) err.textContent = 'Enter a number of seats.'; return; }
      UI.buying = true; if (window.__render) window.__render();
      const r = await roles.startSponsorCheckout(seats, UI.label.trim());
      UI.buying = false;
      if (r && r.url) { roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#sp-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    });

    root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const code = b.getAttribute('data-copy');
      const idx = Number(b.getAttribute('data-idx'));
      try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code); } catch { /* clipboard unavailable — code is still shown on screen */ }
      UI.copied = idx; if (window.__render) window.__render();
      setTimeout(() => { UI.copied = null; if (window.__render) window.__render(); }, 1500);
    }));
  },
};
