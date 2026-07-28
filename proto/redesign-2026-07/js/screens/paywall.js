/* Consumer paywall — the in-app membership screen. Shows the three consumer plans with the
   30%-off annual math, the up-front FTC auto-renewal disclosure, and a purchase CTA that calls
   the native store (App Store / Play IAP via RevenueCat) through the bridge. Reached from the
   monthly-report locked card and the Plan & billing screen.

   Honest by construction: the store rail may not be live yet (browser/preview, or before the
   founder wires react-native-purchases + store products). When it isn't, the CTA reads
   "Available at launch" — never a dead button — and the always-working sponsor-code path is
   right there. The numbers a member unlocks are the written coaching, never the athlete's stats. */
import { backHead, esc } from '../components.js';
import { icon } from '../icons.js';
import { RT } from '../state.js';
import * as roles from '../roles.js';
import { track, EVENTS } from '../analytics.js';
import { CONSUMER_PLANS, planById, productId, cadencePriceParts, effectiveMonthly, annualSavings, fmtPrice, disclosure } from '../pricing.js';

// iapReady: null = not checked yet, true/false = native store can transact.
let UI = { cadence: 'annual', planId: 'individual', busy: false, iapReady: null, status: null };

function planCard(p) {
  const selected = p.id === UI.planId;
  const parts = cadencePriceParts(p, UI.cadence);
  const sub = UI.cadence === 'annual'
    ? `${fmtPrice(effectiveMonthly(p))}/mo · billed yearly`
    : 'billed monthly';
  const seat = p.seatLimit ? `<span class="status-pill b" style="margin-left:6px">Up to ${p.seatLimit}</span>` : '';
  return `
  <div class="pw-plan${selected ? ' on' : ''}" data-pw-plan="${p.id}" role="button" aria-pressed="${selected}">
    <div class="pw-plan-top">
      <div class="pw-plan-name">${esc(p.name)}${seat}</div>
      <div class="pw-plan-price"><span class="n">${parts.amount}</span><span class="per">${parts.per}</span></div>
    </div>
    <div class="pw-plan-sub">${esc(sub)}</div>
    <div class="pw-plan-blurb">${esc(p.blurb)}</div>
  </div>`;
}

function ctaState() {
  const p = planById(UI.planId);
  if (!p) return '';
  if (UI.busy) return `<button class="btn green" style="width:100%" disabled>Opening the store…</button>`;
  if (UI.iapReady === false) {
    return `<button class="btn green" style="width:100%;opacity:.6" disabled>Memberships open at launch</button>
      <div class="pw-note">You'll be able to start the moment we launch. Have a sponsor code? Redeem it below to unlock premium today.</div>`;
  }
  const label = p.trialDays > 0 ? `Start ${p.trialDays}-day free trial` : `Start ${esc(p.name)}`;
  return `<button class="btn green" id="pw-buy" style="width:100%">${label}</button>
    <div class="pw-note">${esc(disclosure(p, UI.cadence))} No charge today.</div>`;
}

function statusBanner() {
  const s = UI.status;
  if (!s) return '';
  if (s.kind === 'ok') {
    return `<div class="sidebox" style="margin-top:10px"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 18)}</div>
      <div><div class="tt">You're a member</div><div class="ts">Premium is unlocked. Your report and Deep Dive are ready.</div></div></div>`;
  }
  if (s.kind === 'error') {
    return `<div style="color:var(--red);font-size:13px;font-weight:600;margin-top:10px;text-align:center">${esc(s.message || "Something went wrong. You weren't charged.")}</div>`;
  }
  return '';
}

export default {
  tab: 'progress',
  render() {
    const saved = annualSavings(planById('individual'));
    return `${backHead('Membership', 'Unlock the written coaching', 'progress')}

    <div class="pw-toggle" role="tablist">
      <button class="pw-seg${UI.cadence === 'annual' ? ' on' : ''}" data-pw-cadence="annual" role="tab" aria-selected="${UI.cadence === 'annual'}">Annual <span class="pw-save">Save 30%</span></button>
      <button class="pw-seg${UI.cadence === 'monthly' ? ' on' : ''}" data-pw-cadence="monthly" role="tab" aria-selected="${UI.cadence === 'monthly'}">Monthly</button>
    </div>

    <div class="pw-plans">
      ${CONSUMER_PLANS.map(planCard).join('')}
    </div>

    <section class="card pad" style="margin-top:4px">
      ${ctaState()}
    </section>
    ${statusBanner()}

    <div class="mr-or">or</div>
    <div class="sidebox mr-coderow" data-go="redeem-code" role="button" aria-label="Redeem a sponsor code to unlock premium instantly">
      <div class="req-icon b" style="width:38px;height:38px">${icon('key', 17)}</div>
      <div><div class="tt">Have a sponsor code?</div><div class="ts">Redeem it to unlock premium instantly</div></div>
    </div>

    <div style="text-align:center;margin-top:14px">
      <button class="btn ghost sm" id="pw-restore" style="width:auto;padding:0 18px">Restore purchases</button>
    </div>

    <div style="height:12px"></div>
    <div style="text-align:center;font-size:11.5px;font-weight:600;color:var(--text-3);padding:0 20px;line-height:1.4">Your stats are always yours. Membership adds the written coaching, not the numbers. Cancel anytime in the App Store or Google Play.</div>
    <div style="height:14px"></div>
    `;
  },
  async mount(root) {
    // Plan + cadence selection (local UI toggles — wired here rather than via the state.js
    // action registry so nothing paywall-specific leaks into global actions).
    root.querySelectorAll('[data-pw-cadence]').forEach((el) => el.addEventListener('click', () => {
      UI.cadence = el.getAttribute('data-pw-cadence') === 'monthly' ? 'monthly' : 'annual';
      if (window.__render) window.__render();
    }));
    root.querySelectorAll('[data-pw-plan]').forEach((el) => el.addEventListener('click', () => {
      const id = el.getAttribute('data-pw-plan');
      if (planById(id)) { UI.planId = id; if (window.__render) window.__render(); }
    }));

    // Probe the native store once so the CTA reads honestly (real button vs "at launch").
    if (UI.iapReady === null) {
      UI.iapReady = await roles.iapAvailable();
      if (window.__render) window.__render();
    }
    const buy = root.querySelector('#pw-buy');
    if (buy) buy.addEventListener('click', async () => {
      const p = planById(UI.planId); if (!p) return;
      UI.busy = true; UI.status = null; if (window.__render) window.__render();
      track(EVENTS.TRIAL_STARTED, { plan: UI.planId, cadence: UI.cadence });
      const res = await roles.purchaseConsumerPlan(productId(UI.planId, UI.cadence), RT.userId);
      UI.busy = false;
      if (res && res.ok) UI.status = { kind: 'ok' };
      else if (res && res.reason === 'cancelled') UI.status = null;         // user backed out — silent
      else if (res && res.reason === 'unavailable') UI.iapReady = false;    // store not live — degrade honestly
      else UI.status = { kind: 'error', message: res && res.message };
      if (window.__render) window.__render();
    });
    const restore = root.querySelector('#pw-restore');
    if (restore) restore.addEventListener('click', async () => {
      restore.disabled = true; restore.textContent = 'Restoring…';
      const res = await roles.restoreConsumerPurchases(RT.userId);
      UI.status = (res && res.ok) ? { kind: 'ok' }
        : { kind: 'error', message: res && res.reason === 'unavailable' ? 'Purchases restore once memberships are live.' : 'Nothing to restore on this account.' };
      if (window.__render) window.__render();
    });
  },
};
