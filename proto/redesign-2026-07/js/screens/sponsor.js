/* Sponsor access: a sponsor buys a batch of premium seats and gets a redemption code to hand out.
   Reached from Profile's Settings section. Buy flow opens Stripe Checkout in the system browser
   (same pattern as my-trainer-offers.js); below the buy form, a list of the sponsor's own
   sponsorships with the code prominent so it's easy to read out or copy. */
import { backHead, esc, errorState, copyText, statusMsg } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';

let CACHE = { rows: null, loaded: false, failed: false };
// openedCheckout: Stripe Checkout was opened this session and the purchase hasn't landed yet.
// The button used to re-arm instantly as "Buy seats", which read as "that didn't work".
let UI = { seats: '10', label: '', buying: false, copied: null, openedCheckout: false };

async function load(force) {
  if (CACHE.loaded && !force) return;
  const before = (CACHE.rows || []).length;
  const rows = await roles.fetchMySponsorships();
  // null = the read FAILED. "No sponsorships yet — buy a batch above" must never be shown to
  // someone whose purchased seats just didn't load; that's a money claim, not an empty list.
  CACHE = { rows: rows === null ? CACHE.rows : rows, loaded: true, failed: rows === null };
  // The purchase landing as a NEW sponsorship row is the refresh that retires the "checkout
  // opened" reminder: the bought seats now list right below where it stood.
  if (rows !== null && rows.length > before) UI.openedCheckout = false;
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
      <input class="ob-input" id="sp-label" maxlength="60" value="${esc(UI.label)}" placeholder="e.g. Fall roster, Jones family" />
      <div style="height:14px"></div>
      ${/* This form asked for a seat COUNT and never said what a seat costs, so the first time
            anyone saw a number was the Stripe page — and the default seat price is a server secret
            (SPONSOR_SEAT_PRICE_CENTS), so echoing a figure here would be a second source of truth
            that silently drifts the day the founder changes it. State the terms and say plainly
            where the total appears, which is both honest and cannot go stale. */ ''}
      <div style="font-size:12px;font-weight:600;color:var(--text-3);line-height:1.5;margin-bottom:12px">
        Seats are billed once, per athlete, for a year of premium. Stripe shows the exact total for
        ${esc(String(Math.max(0, parseInt(UI.seats, 10) || 0)))} seat${(parseInt(UI.seats, 10) || 0) === 1 ? '' : 's'} before you pay. Nothing is charged until you confirm there.
      </div>
      <div id="sp-err" style="color:var(--red);font-size:13px;font-weight:600;min-height:18px"></div>
      <button class="btn primary" id="sp-buy" ${UI.buying ? 'disabled style="opacity:.6"' : ''}>${icon('bolt', 18)} ${UI.buying ? 'Starting checkout…' : UI.openedCheckout ? 'Reopen checkout' : 'Buy seats'}</button>
      ${UI.openedCheckout ? statusMsg({ text: 'Checkout opened in your browser. Finished paying? It shows here within a minute.', style: 'display:block;color:var(--text-2);margin-top:8px' }) : ''}
    </section>
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Secure checkout via Stripe</div><div class="ts">Opens in your browser. OnStandard never sees or stores your card details.</div></div></div>

    <div class="eyebrow" style="margin-top:16px">Your sponsorships</div>
    ${!CACHE.loaded ? `
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`
    : CACHE.failed && !rows.length ? errorState({
      title: "Couldn't load your sponsorships",
      body: 'Any seats you bought are safe on the server. Reconnect and they list right here.',
      retryId: 'sp-retry',
    })
    : rows.length ? `
    <section class="card" style="padding:6px 16px">
      ${rows.map((r, i) => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="tt" style="font-size:20px;font-weight:900;letter-spacing:1px;font-family:monospace">${esc(r.code || '')}</div>
          <div class="ls" style="margin-top:2px">${esc(String(r.seats_claimed != null ? r.seats_claimed : 0))} / ${esc(String(r.seats != null ? r.seats : '?'))} claimed${r.sponsor_label ? ` · ${esc(r.sponsor_label)}` : ''}</div>
        </div>
        <button class="btn ghost sm" data-copy="${esc(r.code || '')}" data-idx="${i}" style="width:auto;padding:0 14px;height:44px;flex:none">${UI.copied === i ? 'Copied' : 'Copy'}</button>
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
    const spRetry = root.querySelector('#sp-retry');
    if (spRetry) spRetry.addEventListener('click', () => { CACHE = { rows: null, loaded: false, failed: false }; window.__render(); load(true); });
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
      if (r && r.url) { UI.openedCheckout = true; roles.openExternal(r.url); if (window.__render) window.__render(); }
      else { if (window.__render) window.__render(); const e2 = root.querySelector('#sp-err'); if (e2) e2.textContent = (r && r.error) || 'Could not start checkout'; }
    });

    root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const code = b.getAttribute('data-copy');
      const idx = Number(b.getAttribute('data-idx'));
      // Only claim "Copied" when it is true; on failure the code stays legible on screen.
      if (!(await copyText(code))) return;
      UI.copied = idx; if (window.__render) window.__render();
      setTimeout(() => { UI.copied = null; if (window.__render) window.__render(); }, 1500);
    }));
  },
};
