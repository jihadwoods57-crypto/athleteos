# Go-live: consumer in-app purchases (checkout close)

> ## ⚠ THIS IS A REJECTION BLOCKER, NOT A ROADMAP ITEM (2026-09-18)
>
> App Review rejected **1.0 (33)** (submission `d07c2cf9-32fa-4d1f-ae74-a1c5a93b61fb`, reviewed on
> an iPad Air 11-inch) **twice** under Guideline 2.1(b) for this exact gap:
>
> - *"the app includes references to membership plans but the associated In-App Purchase products
>   have not been submitted for review"*
> - *"the in-app purchase options were not displayed accordingly at the purchase wall"*
>
> **Status 2026-09-22: steps 1–4 are DONE** (products READY_TO_SUBMIT, RevenueCat wired, key in
> build 41, webhook + migration live) and build 41 is attached to version 1.0. The one thing left
> that keeps this rejection open is the **Paid Apps Agreement**, still Pending in ASC → Business.
> While it is Pending, Apple serves no product metadata, so the paywall's purchase tap fails —
> finding #3 again. Then: sandbox purchase, iPhone recording, resubmit. See
> `APP-REVIEW-2026-09-18.md`.
>
> Do not resubmit before step 5 passes a sandbox purchase.

The **client last mile is built** — paywall, Plan & billing screen, wired trial CTA, the
`OnStandardNative.iap.*` bridge, and the `src/lib/iap` seam. Everything degrades honestly when the
store is not reachable (the paywall shows "Opens at launch" and the sponsor-code path works). What
remains is the store/console work that **no code can do from a dev machine**. Do these in order.

## 1. Store products (App Store Connect / Play Console)

> **iOS: DONE 2026-09-18, via the ASC API.** Subscription group **"OnStandard Membership"**
> (`22394757`) holds all six products, each localized, priced in all 175 available territories,
> carrying a 14-day free trial in every territory, and with an App Review screenshot whose asset
> state reads `COMPLETE`. Regenerate the screenshot any time with `npm run shots:iap`.
>
> Two prices moved, and the code catalog moved with them: **$126 → $125.99** and **$156 → $155.99**.
> Neither round number exists as an App Store price point (the ladder runs …124.99, 125.99,
> 126.99…; $84 does exist, so Individual is untouched). Rounding down is the only safe direction —
> the store must never charge more than the paywall printed. `src/core/pricing.ts`,
> `proto/.../pricing.js` and `proto/.../ob2.js` all carry the new figures; `obPlanPricingParity`
> is the test that catches a catalog left behind.
>
> **Play Console is still untouched.**

Create auto-renewable subscription products with ids matching
`supabase/functions/_shared/revenuecat.ts` `CONSUMER_PRODUCTS`:
- `onstandard_individual_monthly` / `onstandard_individual_annual`
- `onstandard_individual_plus_monthly` / `onstandard_individual_plus_annual`
- `onstandard_family_monthly` / `onstandard_family_annual`

Prices (from `src/core/pricing.ts`): Individual $9.99 / $84·yr; Individual Plus $14.99 / $125.99·yr;
Family $18.99 / $155.99·yr. 14-day free trials. (Family = up to 4 seats — enforced app-side.)

> **Family was repriced 2026-09-07, before any store product existed.** At $336 a two-athlete
> household — the modal family — paid $84 MORE than two Individuals at $126, so the obvious
> family choice was the expensive one. $228 wins at two ($24) and at three and four. If these
> products already exist in a console when you read this, the price there is the one that binds.

## 2. RevenueCat dashboard

> **Full step-by-step with links, credentials and the sandbox proof: `docs/go-live/REVENUECAT-SETUP.md`.**
> Also recorded there, verified 2026-09-18: the webhook is already DEPLOYED AND CONFIGURED (it
> answers 401, not 503) and migration `0102` is already APPLIED to live prod, so steps 4 below are
> largely done. What is NOT done is the RevenueCat project itself and the `appl_` key in `eas.json`.

- Add the iOS + Android apps; create one **Offering** containing the six products above.
- Copy the **public SDK keys** → paste into `EXPO_PUBLIC_REVENUECAT_IOS` / `EXPO_PUBLIC_REVENUECAT_ANDROID`
  in `eas.json`. The keys exist there as **empty strings in all three profiles** — empty is the
  safe state (the paywall stays honest), and it is also the state that keeps the app rejected, so
  this line is the one that unblocks resubmission.
- Set the **webhook**: URL = the deployed `revenuecat-webhook` function; Authorization header =
  a secret you also `supabase secrets set REVENUECAT_WEBHOOK_SECRET=...`.

## 3. Wire the native SDK (one file) — ✅ DONE 2026-09-18
- `react-native-purchases` is installed (`^10.10.0`, picked by `npx expo install`).
- `configureIap` / `purchaseConsumer` / `restoreConsumer` are implemented in `src/lib/iap/index.ts`,
  covered by `src/lib/iap/index.test.ts` (15 tests). Nothing else in the app changed — the bridge,
  paywall and billing screen already called these.

> **`isIapAvailable` is DERIVED, and this step no longer means "set it true".** The old instruction
> here said to hardcode `true`. Do not. It is now computed from four facts, all of which must hold:
> the SDK's JS resolved, the **RNPurchases native module is in this binary**, the platform is iOS or
> Android, and a RevenueCat public key was compiled in. The native-module check is load-bearing:
> `runtimeVersion` policy is `appVersion`, so this JS ships over the air to binaries built before
> the pod existed, where the JS resolves fine and only the first native call throws. A hardcoded
> `true` would paint a live "Start 14-day free trial" on those installs and fail on tap.
>
> **The practical consequence: a build with no key in `eas.json` still sells nothing.** Step 2 is
> what actually turns the paywall on.

## 4. Backend
- Apply migration `0102_consumer_iap_subscriptions.sql` to the live project.
- Deploy `revenuecat-webhook` (it's 503-inert until `REVENUECAT_WEBHOOK_SECRET` is set).
- Set `MONTHLY_REQUIRES_PLAN=1` when you want the monthly-report paywall enforced (until then the
  report is free and the paywall is reachable but non-blocking).

## 5. Build & verify
> **Apple also requires the IAP products themselves to be SUBMITTED for review**, with an
> **App Review screenshot** attached to each one in App Store Connect, and the **Paid Apps
> Agreement** accepted by the Account Holder (Business section). Missing any of those three is the
> literal text of the first 2.1(b) rejection. Products are reviewed in the sandbox and do not need
> prior approval to function during review.
- EAS production build (IAP does not work in Expo Go; needs a real signed build).
- Sandbox test: buy Individual annual → confirm the RevenueCat webhook writes a
  `subscriptions` row `tier='consumer', status='active'` → confirm the monthly report + weekly
  Deep Dive unlock, and Plan & billing shows the plan + renewal date.

## How the pieces connect (already built)
```
Paywall / Plan&billing  →  OnStandardNative.iap.purchase(productId, profileUUID)   [proto]
  → IAP_PURCHASE bridge msg → purchaseConsumer()  [src/lib/iap]  → react-native-purchases
    → App Store / Play charge → RevenueCat → revenuecat-webhook
      → subscriptions.tier='consumer'  → has_premium_access() / isPro  → report + Deep Dive unlock
```
RC App User ID **must** equal the profile UUID (passed as `appUserId` from the proto) so the
webhook attributes the purchase to the right account — this is already handled by the bridge call.
