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
> is the test that catches a catalog left behind (and since 2026-09-21 it checks
> `proto/.../pricing.js` too, which was the one mirror it never covered).
>
> **Play Console is still untouched.**

> ## ✅ CONSUMER RE-MAPPED — STORE AND CODE AGREE (2026-09-21 ruling, applied 2026-09-22)
>
> Founder ruling, design in `docs/superpowers/specs/2026-09-21-subscription-remap-design.md` §7.
> **Four products, not six.** The console was done first and the code catalog followed, which is
> the required order: the store's price is the one that binds.
>
> | Product | Was | Now | State |
> |---|---|---|---|
> | `onstandard_individual_monthly` | $9.99 | **$19.99** | 175 territories, `READY_TO_SUBMIT` |
> | `onstandard_individual_annual` | $84 | **$199.99** | 175 territories, `READY_TO_SUBMIT` |
> | `onstandard_family_monthly` | $18.99 | **$24.99** | 175 territories, `READY_TO_SUBMIT` |
> | `onstandard_family_annual` | $155.99 | **$249.99** | 175 territories, `READY_TO_SUBMIT` |
> | `onstandard_individual_plus_monthly` | $14.99 | **DELETED** | gone from ASC and RevenueCat |
> | `onstandard_individual_plus_annual` | $125.99 | **DELETED** | gone from ASC and RevenueCat |
>
> The console pass, its read-backs and the API gotchas it paid for are in
> **`REPRICING-2026-09-22.md`** — including the one that nearly shipped a silent no-op (a
> price-point's territory is encoded in its id, not in a relationship, so a repricing that reports
> "skipped 174 of 175" is a bug and only a non-USA read-back catches it). The 14-day introductory
> offers survived the reprice, checked explicitly.
>
> **Individual Plus is retired.** It charged $5 more for the recruiting card and the portable
> record, and `has_premium_access()` never read `tier`, so every paid athlete already had both.
> Both plus products were deleted outright (never submitted, never sold, zero subscribers), and
> their selling points are now part of the Individual description on every screen.
>
> Should a plus product id ever surface anyway — an old receipt replayed, a restore — it is not
> stranded: `planIdFromProduct` in `supabase/functions/_shared/revenuecat.ts` resolves any
> `*individual_plus*` id to plan `individual` through its loose contains-match, and
> `src/core/revenuecat.test.ts` pins that.

Create auto-renewable subscription products with ids matching
`supabase/functions/_shared/revenuecat.ts` `CONSUMER_PRODUCTS`:
- `onstandard_individual_monthly` / `onstandard_individual_annual`
- `onstandard_family_monthly` / `onstandard_family_annual`

Prices (from `src/core/pricing.ts`): Individual $19.99 / $199.99·yr; Family $24.99 / $249.99·yr.
14-day free trials. (Family = up to 4 seats — enforced app-side.)

> **Family has to move whenever Individual moves, and this trap has been re-opened twice.** At
> $336 a two-athlete household — the modal family — paid $84 MORE than two Individuals at $126, so
> the obvious family choice was the expensive one (fixed 2026-09-07). At $18.99 against a $9.99
> Individual it saved $0.99 a month, which is not a reason to choose a plan (fixed 2026-09-21).
> At $24.99 against $19.99 it saves $14.99. `src/core/pricing.test.ts` now asserts the comparison
> directly. If these products already exist in a console when you read this, the price there is
> the one that binds.

## 2. RevenueCat dashboard

> **Full step-by-step with links, credentials and the sandbox proof: `docs/go-live/REVENUECAT-SETUP.md`.**
> Also recorded there, verified 2026-09-18: the webhook is already DEPLOYED AND CONFIGURED (it
> answers 401, not 503) and migration `0102` is already APPLIED to live prod, so steps 4 below are
> largely done. What is NOT done is the RevenueCat project itself and the `appl_` key in `eas.json`.

- Add the iOS + Android apps; create one **Offering** containing the four products above. (Done:
  offering `default` carries exactly those four packages as of 2026-09-22; it was six until
  Individual Plus was retired.)
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
- Sandbox test: buy Individual annual ($199.99) → confirm the RevenueCat webhook writes a
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
