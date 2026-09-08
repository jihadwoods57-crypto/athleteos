/* What an iOS build may sell (2026-09-08, first App Store submission).
 *
 * App Store Review Guideline 3.1.1: digital features unlocked inside the app must be bought with
 * in-app purchase, and an app may not link, button, or otherwise call the customer out to another
 * purchasing mechanism. 3.1.3(b) lets a multiplatform service show what was bought elsewhere and
 * say plainly that purchasing happens elsewhere, as long as it does not point the way. Every
 * consumer, coach, parent and sponsor plan here is billed by Stripe from a browser, which is fine
 * on the web and on Android and is the single most common reason a first iOS submission is
 * rejected. The consumer paywall has an in-app-purchase rail (roles.purchaseConsumerPlan) that
 * is honest about not being live yet, and "not live yet" is a placeholder Apple also rejects
 * (2.1 App Completeness).
 *
 * So the iOS build sells nothing it cannot sell through Apple. Every Stripe checkout and billing
 * portal gates on canOpenExternalCheckout(); on iOS the surface keeps what it can honestly show
 * (what is already paid for, a sponsor code that redeems access bought elsewhere) and states,
 * without a link, that purchasing is not done in the app. The platform comes from the native
 * shell (ProtoApp.tsx injects window.__PLATFORM); a plain browser has none and keeps Stripe.
 *
 * The marketplace (a client paying a human trainer through Stripe Connect) is deliberately NOT
 * gated: that is a person-to-person service delivered by a person, the category 3.1.3(e) and
 * 3.1.5 carve out, and it is named as such in the App Review notes. If Apple disagrees, the one
 * import below is the switch.
 */
import { icon } from './icons.js';
import { esc } from './components.js';

export const isIOSApp = () => typeof window !== 'undefined' && window.__PLATFORM === 'ios';

/** May this build open a Stripe Checkout or the Stripe billing portal? */
export const canOpenExternalCheckout = () => !isIOSApp();

/* The one sentence the iOS build says instead. No URL, no "cheaper", no verb aimed at a
   browser: a statement of fact about where the account is managed, which is the line 3.1.3(b)
   draws. `what` names the thing so the sentence is not the same on every screen. */
export function storeNotice(what, extra = '') {
  return `<div class="sidebox">
    <div class="req-icon b s38">${icon('lock', 17)}</div>
    <div><div class="tt">Not bought in the app</div>
    <div class="ts">${esc(what)} ${esc(extra)}</div></div>
  </div>`;
}
