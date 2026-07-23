# Go-live: consumer in-app purchases (checkout close)

The **client last mile is now built** — paywall, Plan & billing screen, wired trial CTA, the
`OnStandardNative.iap.*` bridge, and the `src/lib/iap` seam. Everything degrades honestly today
(the paywall shows "Memberships open at launch" and the sponsor-code path works). What remains is
the store/console/build work that **no code can do from a dev machine**. Do these in order.

## 1. Store products (App Store Connect / Play Console)
Create auto-renewable subscription products with ids matching
`supabase/functions/_shared/revenuecat.ts` `CONSUMER_PRODUCTS`:
- `onstandard_individual_monthly` / `onstandard_individual_annual`
- `onstandard_individual_plus_monthly` / `onstandard_individual_plus_annual`
- `onstandard_family_monthly` / `onstandard_family_annual`

Prices (from `src/core/pricing.ts`): Individual $14.99 / $126·yr; Individual Plus $24.99 / $210·yr;
Family $39.99 / $336·yr. 7-day free trials. (Family = up to 4 seats — enforced app-side.)

## 2. RevenueCat dashboard
- Add the iOS + Android apps; create one **Offering** containing the six products above.
- Copy the **public SDK keys** → set as `EXPO_PUBLIC_REVENUECAT_IOS` and `_ANDROID` (eas.json env).
- Set the **webhook**: URL = the deployed `revenuecat-webhook` function; Authorization header =
  a secret you also `supabase secrets set REVENUECAT_WEBHOOK_SECRET=...`.

## 3. Wire the native SDK (one file)
- `npx expo install react-native-purchases` (let expo pick the SDK-57-compatible version).
- Implement `configureIap` / `purchaseConsumer` / `restoreConsumer` in `src/lib/iap/index.ts`
  against `react-native-purchases` (the function bodies have the exact calls in comments) and set
  `export const isIapAvailable = true`. **Nothing else in the app changes** — the bridge, paywall,
  and billing screen already call these.

## 4. Backend
- Apply migration `0102_consumer_iap_subscriptions.sql` to the live project.
- Deploy `revenuecat-webhook` (it's 503-inert until `REVENUECAT_WEBHOOK_SECRET` is set).
- Set `MONTHLY_REQUIRES_PLAN=1` when you want the monthly-report paywall enforced (until then the
  report is free and the paywall is reachable but non-blocking).

## 5. Build & verify
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
