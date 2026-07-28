// OnStandard — consumer in-app-purchase seam (inert behind isIapAvailable).
//
// Consumer subscriptions MUST go through App Store / Play IAP via RevenueCat: it is an
// App Store rule, and web checkout costs ~30% in conversion for this category
// (docs/paywall/event-schema.md). The SERVER side is already complete and inert-safe —
// revenuecat-webhook → subscriptions.tier='consumer' → isPro / has_premium_access. This
// file is the CLIENT last mile: present the store paywall and report the result back to
// the proto so the WebView can refresh entitlement and unlock without an app restart.
//
// Until the founder installs react-native-purchases + creates the store products,
// isIapAvailable is false and every call resolves to an honest { ok:false, reason:'unavailable' },
// so the paywall degrades to the working sponsor-code path and NEVER shows a dead button.
// Keeping the native SDK out of the import graph until then also keeps the app bundling &
// building exactly as it does today (same convention as src/lib/health).
//
// Activate (founder — see docs/go-live/CONSUMER-IAP.md):
//   1) `npx expo install react-native-purchases` (let expo pick the SDK-57-compatible version)
//   2) create products in App Store Connect / Play Console matching the ids in
//      supabase/functions/_shared/revenuecat.ts CONSUMER_PRODUCTS, and one offering in RevenueCat
//   3) add the RevenueCat public SDK keys as EXPO_PUBLIC_REVENUECAT_IOS / _ANDROID
//   4) implement configureIap / purchaseConsumer / restoreConsumer below against
//      react-native-purchases, and set isIapAvailable = true
//   5) apply migration 0102, deploy revenuecat-webhook with REVENUECAT_WEBHOOK_SECRET,
//      set MONTHLY_REQUIRES_PLAN=1 when ready to enforce the report paywall

/** Flipped true only once the native SDK + store products are wired (step 4 above). */
export const isIapAvailable = false;

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'error'; message?: string };

const UNAVAILABLE: PurchaseResult = { ok: false, reason: 'unavailable' };

/**
 * Point RevenueCat at the signed-in athlete so webhook events carry the owner. RC App User
 * ID MUST equal the profile UUID (revenuecat-webhook resolves the owner from app_user_id).
 * No-op until the SDK is wired. Never throws.
 */
export async function configureIap(_appUserId: string): Promise<void> {
  if (!isIapAvailable) return;
  // Real impl (once wired):
  //   Purchases.configure({ apiKey: RC_KEY, appUserID: _appUserId });
}

/**
 * Present the store purchase sheet for a consumer product (e.g. `onstandard_individual_annual`)
 * and return whether it completed. On success the RevenueCat webhook writes the `consumer`
 * subscription row server-side; the caller then re-pulls entitlement. Returns
 * { ok:false, reason:'unavailable' } until wired, so callers show the honest "at launch" state.
 */
export async function purchaseConsumer(_productId: string, _appUserId: string): Promise<PurchaseResult> {
  if (!isIapAvailable) return UNAVAILABLE;
  // Real impl (once wired):
  //   await configureIap(_appUserId);
  //   const offerings = await Purchases.getOfferings();
  //   const pkg = findPackage(offerings, _productId);
  //   try { await Purchases.purchasePackage(pkg); return { ok:true }; }
  //   catch (e) { return e.userCancelled ? { ok:false, reason:'cancelled' }
  //                                      : { ok:false, reason:'error', message:String(e?.message ?? e) }; }
  return UNAVAILABLE;
}

/**
 * Restore a prior purchase (App Store / Play "Restore" — required by Apple). Re-triggers the
 * RevenueCat webhook so the server row is rebuilt. Returns { ok:false, reason:'unavailable' } until wired.
 */
export async function restoreConsumer(_appUserId: string): Promise<PurchaseResult> {
  if (!isIapAvailable) return UNAVAILABLE;
  // Real impl (once wired):
  //   await configureIap(_appUserId);
  //   const info = await Purchases.restorePurchases();
  //   return info.activeSubscriptions.length ? { ok:true } : { ok:false, reason:'error', message:'nothing to restore' };
  return UNAVAILABLE;
}
