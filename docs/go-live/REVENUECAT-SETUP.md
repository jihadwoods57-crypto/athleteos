# RevenueCat setup — the last thing between the app and its first dollar

Everything else is done. The six App Store products are `READY_TO_SUBMIT`, the client rail is
implemented (`src/lib/iap`), the webhook is deployed and configured, and migration `0102` is
applied to live prod. **This document is the only remaining work, and all of it is in two
dashboards.**

> ## Why this is urgent, not housekeeping
>
> `MONTHLY_REQUIRES_PLAN=1` is **set on live prod** (verified 2026-09-18). That means
> `has_premium_access` already gates the monthly report — so today an athlete is shown a paywall
> with nothing behind it. The report is locked and cannot be bought. RevenueCat is what opens the
> door, and until it is wired the product is in its worst possible state: gated and unpurchasable.

## What is already true (do not redo these)

| Thing | State | How it was checked |
| ----- | ----- | ------------------ |
| Six subscription products | `6/6 READY_TO_SUBMIT`, priced in 175 territories, 14-day trial everywhere, review screenshots accepted | read back from the ASC API |
| `revenuecat-webhook` | **deployed and configured** — it answers `401 unauthorized`, not `503 server not configured` | `POST` to the live URL |
| `REVENUECAT_WEBHOOK_SECRET` | set (2026-07-21) | `supabase secrets list` |
| Migration `0102` | **applied to live prod** — `rc_app_user_id`, `store`, `store_product_id` exist and the tier check allows `'consumer'` | `supabase db query --linked` |
| App User ID = profile UUID | handled in code (`configureIap`) | `src/lib/iap/index.test.ts` |

---

## ✅ DONE 2026-09-18 — RevenueCat is configured

Built through the v2 API and read back to confirm. Project **`projb14991df`** ("Onstandard").

| Piece | State |
| ----- | ----- |
| App Store app `appb67dffb647` | `bundle_id: com.onstandard.app`, `subscription_key_configured: true` |
| Products | all six created, ids match `CONSUMER_PRODUCTS` exactly |
| Entitlement `premium` | all six products attached |
| Offering `default` | **is_current: true**, six packages, each carrying its product |
| Webhook `whintgr6e3f346982` | → the Supabase function, all event types |
| `REVENUECAT_WEBHOOK_SECRET` | **rotated** 2026-09-18 and proven end to end |

Webhook proof, both directions:

```
wrong secret   -> 401
correct secret -> 200 {"received":true,"note":"no owner reference"}
consumer rows  -> 0        (the smoke test wrote nothing, by design)
```

### ✅ The public SDK key is in, and it was tested before trusting it

`EXPO_PUBLIC_REVENUECAT_IOS` now carries the `appl_` key in all three `eas.json` profiles. It was
not merely pasted — it was exercised against RevenueCat with the same call the SDK makes:

```
GET /v1/subscribers/<throwaway>/offerings   Authorization: Bearer appl_…   X-Platform: ios
 -> 200
    current offering: default
    6 packages: onstandard_individual_monthly, onstandard_individual_annual,
                onstandard_individual_plus_monthly, onstandard_individual_plus_annual,
                onstandard_family_monthly, onstandard_family_annual
```

That is the whole chain proven from the client's side: key → project → current offering → the six
product identifiers `purchaseConsumer()` matches on. A wrong key would have cost a 20-minute build
to discover on a device.

> **This key is committed to a PUBLIC repo, and that is correct.** A RevenueCat *public* SDK key is
> designed to live in a client binary — anyone can extract it from an IPA — and it can only read
> offerings and post receipts. What must NEVER leave `.env` is `RC_V2_SECRET_KEY` (the `sk_` key
> that configured all of this) and the Apple `.p8` files. `.env` and `ios-certs/` are both
> gitignored; that was checked, not assumed.

Android stays empty on purpose: Play Console is not set up, and a blank key keeps the Android
build honest rather than promising a store it has no account with.

> ## ⚠️ CORRECTION 2026-09-18 — THE SHARED SECRET IS NOT OPTIONAL
>
> This document previously said the App-Specific Shared Secret could be skipped because it is
> "StoreKit 1 only". That came from RevenueCat's credentials page, and it is **wrong in practice**.
> Their own troubleshooting page lists as the FIRST cause of unfetchable products:
>
> > "Both the App-Specific Shared Secret and In-App Purchase Key must be configured. Missing
> > either of these credentials can prevent products and offerings from being fetched in your app."
>
> Build 41 on a real iPhone hit exactly that: the paywall rendered all three plans from the local
> catalog and then RevenueCat reported *"None of the products registered in the RevenueCat
> dashboard could be fetched from App Store Connect."* RevenueCat's own copy of the products
> carries `duration=null` and `trial_duration=null`, which is what "never actually read them from
> Apple" looks like.
>
> **Add the shared secret.** App Store Connect → My Apps → OnStandard → **App Information** →
> scroll to the bottom → **App-Specific Shared Secret → Manage**. Then paste it into the RevenueCat
> app's App Store configuration.
>
> Direct link: <https://appstoreconnect.apple.com/apps/6787705639/appstore/info>

What remains: **a build (41+), a sandbox purchase, and the iPhone recording.** Nothing else in
either dashboard.

---

## Reference — how it was set up

## Step 0 — Confirm the Paid Apps Agreement (2 minutes)

<https://appstoreconnect.apple.com/business>

Apple will not process a paid transaction without it, and neither RevenueCat nor a sandbox purchase
will work. There is no API for this; you have to look. You need the **Paid Applications** agreement
in **Active**, with banking and tax filled in.

Creating the products worked without it, so this has *not* been proven either way.

---

## Step 1 — Apple credentials that RevenueCat needs

RevenueCat validates purchases server-to-server with Apple, so it needs its own key. Two separate
things, both from App Store Connect.

### 1a. In-App Purchase Key (the StoreKit 2 path, and the one to use)

App Store Connect → **Users and Access → Integrations → In-App Purchase** → **Generate In-App
Purchase Key** (or the `+` next to *Active*).

- **You get exactly one chance to download the `.p8`.** Save it next to the others in
  `ios-certs/` and do not lose it.
- Note the **Issuer ID** and **Key ID** from the same page.

Docs: <https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration>

### 1b. App-Specific Shared Secret (legacy receipts, still worth setting)

App Store Connect → **My Apps → OnStandard → App Information** (under *General*) → **App-Specific
Shared Secret → Manage**.

Docs: <https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret>

---

## Step 2 — Create the RevenueCat project and connect the App Store

<https://app.revenuecat.com/>

1. Create an account, then a **Project** (call it `OnStandard`).
2. **Connect a store → App Store.** It asks for exactly four things:
   - **App name** — `OnStandard`
   - **Bundle ID** — `com.onstandard.app`
   - **Shared Secret** — from step 1b
   - **In-App Purchase Key** — upload the `.p8` from step 1a, plus its Issuer ID

   Docs: <https://www.revenuecat.com/docs/projects/connect-a-store>

3. Optionally also add your **App Store Connect API Key** so RevenueCat can fetch products
   directly. You already have one that works: `ios-certs/AuthKey_TNS4WL4GLR.p8`, Key ID
   `TNS4WL4GLR`, Issuer ID `3dcac87d-ec88-493a-8f31-e298ae76af64`.

4. **Apple Server-to-Server Notifications.** In the RevenueCat app settings, find *Apple Server to
   Server notification settings* and click **Apply in App Store Connect** — it writes the URL into
   both Production and Sandbox for you. Use **Version 2**.

   Docs: <https://www.revenuecat.com/docs/platform-resources/server-notifications/apple-server-notifications>

---

## Step 3 — Products, Entitlement, Offering

Create them in this order. The names below are not cosmetic — step 5 depends on them.

### 3a. Products

Import from the App Store (or add by identifier). All six, exactly:

```
onstandard_individual_monthly
onstandard_individual_annual
onstandard_individual_plus_monthly
onstandard_individual_plus_annual
onstandard_family_monthly
onstandard_family_annual
```

### 3b. Entitlement

Create **one** entitlement — `premium` is fine — and attach all six products to it.

> The webhook does **not** care what you call it. `supabase/functions/_shared/revenuecat.ts` maps
> the **`product_id`** to a plan, not the entitlement. But `restoreConsumer` in `src/lib/iap`
> accepts either `activeSubscriptions` or `entitlements.active`, and RevenueCat's own dashboard is
> far easier to read with one, so make it.

### 3c. Offering — **this one is required**

Create an Offering, mark it **Current**, and add a **Package** for each of the six products.

> `purchaseConsumer()` calls `getOfferings()` first and buys the *package*, because that is what
> preserves RevenueCat's attribution for the sale. It falls back to `getProducts()` if no offering
> carries the product, so a missing Offering will not break the purchase — but you will lose the
> analytics, and the fallback is a safety net, not the design.

---

## Step 4 — The webhook

RevenueCat → **Integrations → Webhooks → Add**.

- **URL**
  ```
  https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/revenuecat-webhook
  ```
- **Authorization header** — the value of `REVENUECAT_WEBHOOK_SECRET`.

> ⚠ **You cannot read the existing secret back.** `supabase secrets list` returns a SHA-256 digest,
> not the value. Unless you have it saved somewhere, set a fresh one and use the *same string* in
> both places:
>
> ```bash
> # pick a long random string, paste the SAME one into RevenueCat
> npx supabase secrets set REVENUECAT_WEBHOOK_SECRET=<new-long-random-string> --project-ref ftwrvylzoyznhbzhgism
> ```
>
> The endpoint accepts the bare secret or `Bearer <secret>`, and compares in constant time.

The function is already deployed with `--no-verify-jwt`; you do not need to redeploy unless you
change its code.

---

## Step 5 — The keys that actually switch the paywall on

RevenueCat → **Project settings → API keys** → the **App-specific public key** for iOS. It starts
with `appl_`. This is a *public* key: safe in a client binary, it can only read offerings and post
receipts.

Paste it into **`eas.json`**, into all three profiles (`development`, `preview`, `production`),
where the empty slots already wait:

```json
"EXPO_PUBLIC_REVENUECAT_IOS": "appl_xxxxxxxxxxxxxxxxxxxxx",
"EXPO_PUBLIC_REVENUECAT_ANDROID": ""
```

> ⚠ **This is build-time, not over-the-air.** `EXPO_PUBLIC_*` is inlined into the bundle when EAS
> builds, so the key only exists in a binary built *after* you paste it. An OTA update cannot
> deliver it. You need a new build regardless, because `react-native-purchases` is a new native
> dependency — but do not expect an `eas update` to turn the store on.

`isIapAvailable` in `src/lib/iap/index.ts` is derived from four things, all of which must hold:
the JS module resolved, **`NativeModules.RNPurchases` is in the binary**, the platform is iOS or
Android, and this key is non-empty. Leave the key blank and the paywall honestly reads "Opens at
launch" — which is also exactly the state Apple rejected.

---

## Step 6 — Build, then prove it with a sandbox purchase

```bash
npm run verify                      # 17/17 before you build anything
eas build --platform ios --profile production
```

Create a sandbox tester: App Store Connect → **Users and Access → Sandbox → Test Accounts**. Sign
out of the App Store on the device first; the sandbox prompt appears during purchase.

Then, on the device:

1. Sign in as `review-athlete@onstandard.app`.
2. Profile → **Plan & billing → See plans**. The three plans must render with prices and a live
   **"Start 14-day free trial"** button. If it says *"Opens at launch"*, the key did not make it
   into the build — go back to step 5.
3. Buy **Individual annual**. Apple's sandbox sheet should appear.
4. Confirm the server actually learned about it:

```bash
npx supabase db query --linked "select owner_id, tier, status, plan_id, store, store_product_id, rc_app_user_id from subscriptions where tier='consumer' order by updated_at desc limit 5;"
```

You want `tier='consumer'`, `status='active'`, and `rc_app_user_id` equal to the athlete's profile
UUID. **If `rc_app_user_id` is an anonymous RevenueCat id instead, stop** — the purchase is
attached to nobody and the entitlement will never resolve. That means `configureIap` did not run
with the signed-in UUID.

5. Confirm the monthly report unlocks (it is gated by `MONTHLY_REQUIRES_PLAN=1`).

---

## Step 7 — Submit

The six products **do not get submitted separately**. `READY_TO_SUBMIT` is their finished state;
they travel with the app version. Upload the new build, attach it to version 1.0, confirm the
version page lists all six products, and submit once.

Do not forget the two replies Apple is waiting on, and the iPhone screen recording — see
`docs/go-live/APP-REVIEW-2026-09-18.md`.

---

## If something goes wrong

| Symptom | Cause |
| ------- | ----- |
| Paywall says "Opens at launch" on a real device | The `appl_` key is not in that build. It is build-time; OTA cannot fix it. |
| Purchase throws "Native module (RNPurchases) not found" | The binary predates `react-native-purchases`. Build again. |
| Webhook returns `503` | `REVENUECAT_WEBHOOK_SECRET` is unset. |
| Webhook returns `401` | The header value does not match the secret — normal for a probe, wrong for RevenueCat. |
| Purchase succeeds, no `subscriptions` row | Webhook not configured in RevenueCat, or the secret differs between the two places. |
| Row appears with an anonymous `rc_app_user_id` | `configureIap` ran before sign-in. The RC App User ID **must** be the profile UUID. |
| Sandbox purchase fails outright | Paid Apps Agreement not active (step 0). |
