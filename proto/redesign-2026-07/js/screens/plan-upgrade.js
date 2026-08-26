/* Plan upgrade — the first surface where a coach or trainer can actually BUY OnStandard.
 *
 * The subscription review's flattest finding: the pro/org plans — the actual business — were
 * purchasable nowhere. billing-checkout was deployed, correct, and reachable from no UI; the only
 * paywall in the app listed the three consumer plans. A coach who wanted to pay had no button.
 *
 * This screen is that button. It renders the operator plans for the signed-in role (trainer →
 * pro/seat variants, coach → org), the Founding 50 line with the REAL slots-left count (0163 —
 * the first time the paywall could say a number instead of vibes), and hands off to Stripe
 * Checkout in the SYSTEM browser via the OPEN_URL bridge: Stripe's hosted page in an embedded
 * WebView is both against their integration guidance and a credential-safety smell.
 *
 * What deliberately does NOT live here: prices (server resolves by lookup_key + generation),
 * the trial (server sends trial_period_days), the duplicate-subscription guard (server 409s and
 * this screen routes to the portal). The client states intent and renders answers.
 */
import { RT, act, roleNav } from '../state.js';
import { icon } from '../icons.js';
import { backHead, alertMsg, statusMsg } from '../components.js';
import { PLANS, planCard } from '../ob2.js';
import { track, EVENTS } from '../analytics.js';

const UP = { busy: null, note: null, slots: null, loaded: false, loading: false };

/* `loaded` is only true AFTER the round trip, and render() is what kicks this off — so every
   repaint that lands while the first call is still in flight used to fire another one (and if the
   lookup ever rejected, `loaded` stayed false and each repaint fired one more, forever: the same
   unbounded-network shape that hung the coach commitments board). `loading` is the in-flight guard;
   the finally clause is what guarantees a failed lookup settles instead of looping. */
async function loadSlots() {
  if (UP.loading) return;
  UP.loading = true;
  try {
    const roles = await import('../roles.js');
    UP.slots = await roles.foundingSlotsLeft();
  } finally {
    UP.loading = false;
    UP.loaded = true;
    if (window.__render) window.__render();
  }
}

/** Which operator plan list this account shops from. Trainers and dietitians buy the pro
 *  plans; coaches and org staff the org ladder. (Athletes/parents never reach this screen —
 *  their plans are IAP, on the consumer paywall.) */
function listFor() {
  const role = RT.authRole || '';
  return role === 'trainer' ? PLANS.seat : PLANS.org;
}

export const planUpgrade = {
  tab: 'profile',
  hideTabs: true,
  // Shared-utility nav resolution (the settings/billing pattern): without this the router's
  // mirror guard reads the default 'athlete' nav and bounces every coach — the exact audience
  // this screen exists for — back to their dashboard.
  get nav() { return roleNav(); },

  render() {
    if (!UP.loaded) void loadSlots();
    const plans = listFor();
    // Overage rate differs by ladder — org (gym/facility) is $15/mo, pro/seat is $10/mo.
    const overageRate = RT.authRole === 'trainer' ? 10 : 15;
    const founding = UP.slots != null && UP.slots > 0
      ? `<section class="card" style="padding:14px 16px;border-color:var(--green-border);margin-top:14px">
          <div style="display:flex;gap:12px;align-items:center">
            <div class="req-icon g" style="width:40px;height:40px">${icon('flame', 19)}</div>
            <div><div style="font-size:14.5px;font-weight:800">Founding 50 · ${UP.slots} spot${UP.slots === 1 ? '' : 's'} left</div>
            <div style="font-size:12px;font-weight:600;color:var(--text-2);line-height:1.5">Today's price locked for good, including the $${overageRate}/mo per active client over your limit. Claimed automatically when you subscribe.</div></div>
          </div>
        </section>`
      : '';
    // The plan picked during onboarding arrives preselected — this is the same choice they
    // already made, honored, not a fresh decision forced twice.
    const picked = (RT.ob && RT.ob.plan) || null;
    // "Every paid plan starts with a free trial" was not true and this screen is where someone
    // decides to pay: billing-checkout sends trial_period_days only when there is no existing
    // Stripe customer, because a second free fortnight on every re-subscribe is a churn incentive.
    // A returning coach reading an unconditional promise here would be billed on click.
    return `<div id="pu-root">${backHead('Choose a plan', 'First plan starts with a free 14-day trial', 'settings')}
    ${founding}
    <div class="eyebrow" style="margin-top:16px">${picked && plans.some((p) => p.id === picked) ? 'Your pick from onboarding' : 'Plans'}</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${plans.map((p) => {
        const card = planCard({ ...p, on: p.id === picked });
        // Busy is RENDERED state, not a hand-set el.style: the tapped card carries aria-busy and
        // says what is happening, and the other cards go inert so a second checkout can't start
        // while the first is in flight. Cleared when the round trip settles either way.
        if (UP.busy === p.id) return `<div aria-busy="true" style="opacity:.6">${card}<div style="font-size:var(--t-sm);font-weight:700;color:var(--text-2);text-align:center;padding:6px 0 0">Opening Stripe…</div></div>`;
        return UP.busy ? `<div style="opacity:.55;pointer-events:none" aria-disabled="true">${card}</div>` : card;
      }).join('')}
    </div>
    ${/* The header promises a 14-day trial but only one card carries the tag. This states the
          server's actual rule: trial_period_days rides only the FIRST checkout. */''}
    <div style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);margin-top:10px">The 14-day trial applies to whichever plan you start first.</div>
    <div style="font-size:11.5px;font-weight:600;color:var(--text-3);line-height:1.55;margin-top:14px">
      Billed by Stripe in your browser. The app never sees your card. Included seats count
      <b>active</b> athletes only: someone who stops logging stops counting, and $${overageRate}/mo covers each
      active athlete beyond your plan. Cancel anytime in your account settings.
    </div>
    ${/* Failures and info notes shared one amber div, so "checkout failed" and "opening your
          portal" wore the same clothes. A failure is red and announced (alertMsg, role=alert);
          an informational note is quiet grey (statusMsg, role=status). */''}
    ${UP.note ? (UP.note.kind === 'error'
      ? alertMsg({ text: UP.note.text, style: 'color:var(--red);font-size:var(--t-sm);font-weight:700;text-align:center;padding:12px 8px 0' })
      : statusMsg({ text: UP.note.text, style: 'display:block;color:var(--text-2);font-size:var(--t-sm);font-weight:700;text-align:center;padding:12px 8px 0' })) : ''}
    <div style="height:20px"></div></div>`;
  },

  mount(root) {
    root.querySelectorAll('.ob2-plan').forEach((el) => el.addEventListener('click', async () => {
      if (UP.busy) return;
      const planId = el.getAttribute('data-val');
      const plan = listFor().find((p) => p.id === planId);
      if (!plan) return;
      if (plan.custom) {
        // Enterprise has no self-serve price — the honest CTA is a conversation.
        try { window.OnStandardNative?.openUrl?.('https://onstandard.app/coaches#pricing'); } catch { /* web */ }
        UP.note = { kind: 'info', text: 'Enterprise is quoted. Email support@onstandard.app and we’ll set it up with you.' };
        window.__render && window.__render();
        return;
      }
      UP.busy = planId; UP.note = null;
      window.__render && window.__render();
      track(EVENTS.PLAN_SELECTED, { plan: planId });
      const roles = await import('../roles.js');
      // MONTHLY, because monthly is what this screen SHOWS. The operator plan cards (ob2.js PLANS
      // .pro/.org/.seat) carry `price: '$99'` with the default `/mo` unit — they have no annual
      // variant to render — so opening an annual checkout charged $990 against a card that said
      // "$99/mo". Stripe's confirm page would have shown the real figure, which makes it a broken
      // promise rather than a silent overcharge, but it is still not the thing they agreed to.
      // If annual is wanted here it needs a cadence toggle and annual prices on the cards first.
      const r = await roles.startPlanCheckout(planId, 'monthly');
      UP.busy = null;
      if (r.ok) {
        // Reaching a real checkout closes the onboarding loop however they got here — the home
        // card should not reappear behind a coach who is already at Stripe.
        try { act.markObPlanCtaDone(); } catch { /* display-state only */ }
        // Stripe opens in the SYSTEM browser; the webhook writes the row; entitlement lands on
        // the next open. On web (no bridge) fall through to a plain navigation.
        if (window.OnStandardNative?.openUrl) { window.OnStandardNative.openUrl(r.url); window.__render && window.__render(); }
        else location.href = r.url;
        return;
      }
      if (r.action === 'portal') {
        UP.note = { kind: 'info', text: 'You already have a plan. Opening your billing portal to change it.' };
        window.__render && window.__render();
        const p = await roles.openBillingPortal();
        if (p.ok) {
          if (window.OnStandardNative?.openUrl) window.OnStandardNative.openUrl(p.url);
          else location.href = p.url;
        } else { UP.note = { kind: 'error', text: p.error || 'Could not open the billing portal. Try again.' }; window.__render && window.__render(); }
        return;
      }
      UP.note = { kind: 'error', text: r.error || 'Could not start checkout. Try again.' };
      window.__render && window.__render();
    }));
  },
};
