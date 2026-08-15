/* Parent "Funded plans": what the parent is paying for, with a Cancel on recurring plans. */
import { backHead, esc, errorState } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { groupFundedPlans } from '../funded.js';

let CACHE = { rows: null, loaded: false };
let UI = { cancelling: null };

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
    if (!CACHE.loaded) {
      return `${backHead('Funded plans', 'What you’re paying for', 'parent')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading…</div></div></div>`;
    }
    // A billing screen never guesses. With the read failed we do not know what is being charged,
    // and "No funded plans yet" would tell a paying parent they are paying for nothing.
    if (CACHE.rows && CACHE.rows.error) {
      return `${backHead('Funded plans', 'What you’re paying for', 'parent')}
      ${errorState({
    title: "Couldn't load your plans",
    body: 'Nothing changed and nothing was charged. Reconnect and what you pay for loads right here.',
    retryId: 'fpl-retry',
  })}`;
    }
    const plans = groupFundedPlans(CACHE.rows);
    return `${backHead('Funded plans', 'What you’re paying for', 'parent')}
    ${plans.length ? `<section class="card" style="padding:6px 16px">
      ${plans.map(p => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(p.offer_name)} ${p.cancelled ? '<span class="ls">· cancelled</span>' : ''}</div>
          <div class="ls">${esc(money(p.amount_cents))}${esc(per(p.cadence))}${p.child_name ? ' · for ' + esc(p.child_name) : ''}</div></div>
        ${(p.recurring && !p.cancelled) ? `<button class="btn ghost micro" data-cancel="${esc(p.id)}" style="width:auto">${UI.cancelling === p.id ? '…' : 'Cancel'}</button>` : ''}
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
      if (!window.confirm('Cancel this plan? No future charges will be made.')) return;
      UI.cancelling = id; if (window.__render) window.__render();
      const r = await roles.cancelFundedSubscription(id);
      UI.cancelling = null;
      if (r && r.ok) { await load(true); }
      else { if (window.__render) window.__render(); const e = root.querySelector('#fpl-err'); if (e) e.textContent = (r && r.error) || 'Could not cancel'; }
    }));
  },
};
