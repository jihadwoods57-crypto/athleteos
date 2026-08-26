/* Parent "Funded plans": what the parent is paying for, with a Cancel on recurring plans. */
import { backHead, esc, errorState, skeletonRows } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { groupFundedPlans } from '../funded.js';

let CACHE = { rows: null, loaded: false };
let UI = { cancelling: null, confirmCancel: null };
let disarmTimer = null;

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.rows = await roles.fetchFundedPlans();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function money(c) { const d = c / 100; return `$${Number.isInteger(d) ? d : d.toFixed(2)}`; }
function per(cad) { return cad === 'one-time' ? ' one-time' : cad === 'session' ? ' / session' : cad === 'week' ? ' / wk' : cad === 'month' ? ' / mo' : ''; }

export default {
  render() {
    const head = backHead('Funded plans', 'What you’re paying for', 'parent');
    // Offline is checked BEFORE the loading gate, the same order fund-plan.js uses: a cold
    // offline open would otherwise sit on the skeleton forever, because load() never resolves.
    if (!CACHE.loaded && !navigator.onLine) {
      return `${head}${errorState({
        title: "You're offline",
        body: 'Nothing changed and nothing was charged. What you pay for loads right here when you reconnect.',
        retryId: 'fpl-retry',
      })}`;
    }
    // A skeleton shaped like the list it stands in for, not an ad-hoc "Loading…" sidebox.
    if (!CACHE.loaded) {
      return `${head}${skeletonRows(3, 'Loading your plans')}`;
    }
    // A billing screen never guesses. With the read failed we do not know what is being charged,
    // and "No funded plans yet" would tell a paying parent they are paying for nothing.
    if (CACHE.rows && CACHE.rows.error) {
      return `${head}
      ${errorState({
        title: "Couldn't load your plans",
        body: 'Nothing was lost. Reconnect and it loads right here.',
        retryId: 'fpl-retry',
      })}`;
    }
    const plans = groupFundedPlans(CACHE.rows);
    return `${head}
    ${plans.length ? `<section class="card" style="padding:6px 16px">
      ${plans.map(p => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm">
          <div class="lt">${esc(p.offer_name)} ${p.cancelled ? '<span class="status-pill muted">Cancelled</span>' : ''}</div>
          <div class="ls">${esc(money(p.amount_cents))}${esc(per(p.cadence))}${p.child_name ? ' · for ' + esc(p.child_name) : ''}</div>
          ${/* "Coverage runs to the end of the paid period" is verified, not guessed:
                cancel-offer-subscription only stops the subscription, and stripe-webhook (0189)
                deliberately leaves the funded grant running to period end plus grace. They paid
                for the month, so the month stands. */''}
          ${p.cancelled ? `<div class="ls" style="margin-top:2px;white-space:normal">No future charges. Coverage runs to the end of the paid period.</div>` : ''}
          ${UI.confirmCancel === p.id && !p.cancelled ? `<div class="ls" style="color:var(--red);margin-top:2px;white-space:normal">Stops future charges. Coverage runs to the end of the paid period.</div>` : ''}
        </div>
        ${(p.recurring && !p.cancelled) ? `<button class="btn ghost sm" data-cancel="${esc(p.id)}" style="width:auto;padding:0 14px;height:44px;flex:none${UI.confirmCancel === p.id ? ';color:var(--red)' : ''}">${UI.cancelling === p.id ? '…' : UI.confirmCancel === p.id ? 'Confirm cancel' : 'Cancel'}</button>` : ''}
      </div>`).join('')}
    </section>` : `<div class="state-demo"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">No funded plans yet</div>
      <div class="sd-s">Plans you pay for your child show up here.</div></div>`}
    <p id="fpl-err" class="ls" style="color:var(--red);padding:10px 16px"></p>`;
  },
  mount(root) {
    load();
    const retry = root.querySelector('#fpl-retry');
    if (retry) retry.addEventListener('click', () => { retry.disabled = true; load(true); });
    root.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-cancel');
      // Two-tap, inline (trainer-grow's refund pattern): the first tap arms and states the
      // consequence, and only the explicit "Confirm cancel" executes. No window.confirm: the
      // app's own surface carries the warning, and a stray tap can't kill a paid plan.
      if (UI.confirmCancel !== id) {
        UI.confirmCancel = id;
        if (disarmTimer) clearTimeout(disarmTimer);
        // The armed state times out: a parent who tapped once and walked away must not come
        // back to a live "Confirm cancel" primed under their thumb.
        disarmTimer = setTimeout(() => {
          if (UI.confirmCancel === id) { UI.confirmCancel = null; if (window.__render) window.__render(); }
        }, 6000);
        if (window.__render) window.__render();
        return;
      }
      if (disarmTimer) { clearTimeout(disarmTimer); disarmTimer = null; }
      UI.confirmCancel = null;
      UI.cancelling = id; if (window.__render) window.__render();
      const r = await roles.cancelFundedSubscription(id);
      UI.cancelling = null;
      if (r && r.ok) { await load(true); }
      else { if (window.__render) window.__render(); const e = root.querySelector('#fpl-err'); if (e) e.textContent = (r && r.error) || 'Could not cancel'; }
    }));
  },
};
