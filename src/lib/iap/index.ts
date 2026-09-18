// OnStandard — consumer in-app-purchase seam, backed by RevenueCat (react-native-purchases).
//
// Consumer subscriptions MUST go through App Store / Play IAP: it is an App Store rule, and web
// checkout costs ~30% in conversion for this category (docs/paywall/event-schema.md). The SERVER
// side was already complete — revenuecat-webhook → subscriptions.tier='consumer' → isPro /
// has_premium_access. This file is the CLIENT last mile: present the store paywall and report the
// result back to the proto so the WebView can refresh entitlement and unlock without a restart.
//
// WIRED 2026-09-18, in answer to App Review rejecting build 33 (1.0 (33), submission
// d07c2cf9-32fa-4d1f-ae74-a1c5a93b61fb) twice under Guideline 2.1(b): the app showed membership
// plans that nothing could buy, because this file returned 'unavailable' from every call and
// react-native-purchases had never been installed. The store paywall is the screen App Review
// reads closest; a membership screen with no purchasable product is an incomplete app.
//
// ⚠ THE MODULE IS REQUIRED OPTIONALLY, AND THAT IS NOT DEFENSIVE PROGRAMMING — IT IS LOAD-BEARING.
// runtimeVersion policy is "appVersion" (app.json), so adding native code does NOT bump the
// runtime version, which means this JS can and will be delivered over the air to binaries built
// BEFORE react-native-purchases existed — builds 40 and earlier have no Purchases module compiled
// in at all. A static import would throw at launch and brick the app for every existing user.
// src/lib/health/index.ts carries the identical guard for the identical reason; read its header
// before changing this one.
//
// ⚠ isIapAvailable IS DERIVED, NEVER HARDCODED. docs/go-live/CONSUMER-IAP.md step 4 said "set
// isIapAvailable = true"; a literal `true` would claim the store can transact inside an OTA
// running on an old binary, in a simulator, and in any build whose RevenueCat key env var was
// not set — and the paywall would render a live "Start 14-day free trial" CTA that throws on
// tap. Deriving it from (JS module resolved) AND (the RNPurchases NATIVE module is in this
// binary) AND (platform is a store platform) AND (a public SDK key was compiled in) keeps the
// paywall's existing honesty contract: no key, no promise, and the screen degrades to the
// sponsor-code path exactly as it did before this was wired.
import { Platform, NativeModules } from 'react-native';

type PurchasesModule = typeof import('react-native-purchases');

let RNP: PurchasesModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  RNP = require('react-native-purchases');
} catch {
  RNP = null;
}

/** The Purchases class itself. The package default-exports it; interop keeps CJS builds working. */
const Purchases = RNP ? (RNP.default ?? (RNP as unknown as PurchasesModule['default'])) : null;

/**
 * RevenueCat PUBLIC SDK key for this platform (EXPO_PUBLIC_* is inlined at build time, so this
 * resolves to a literal in the shipped bundle). Public keys are safe in a client binary — they
 * can only read offerings and post receipts; the webhook secret is the one that must stay server
 * side. Set in eas.json env per profile.
 */
const RC_KEY: string = (Platform.OS === 'ios'
  ? process.env.EXPO_PUBLIC_REVENUECAT_IOS
  : Platform.OS === 'android'
    ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID
    : '') || '';

/**
 * Whether the NATIVE half of the SDK is actually compiled into THIS binary.
 *
 * This is the check the OTA case turns on, and it is not the same question as "did the JS
 * module resolve". Metro bundles react-native-purchases' JavaScript into every update, so on a
 * binary built before the pod existed the `require` above SUCCEEDS and only the first native
 * call fails — which would leave isIapAvailable true, paint a live "Start 14-day free trial"
 * CTA, and throw the SDK's own "Native module (RNPurchases) not found" on tap. Asking
 * NativeModules directly is the one question that separates the two, and it is synchronous, so
 * the paywall never has to render against a maybe.
 */
const hasNativePurchases: boolean = (() => {
  try {
    return !!(NativeModules as Record<string, unknown> | undefined)?.RNPurchases;
  } catch {
    return false;
  }
})();

/** Flipped true only where the SDK's JS, its NATIVE module, the platform and a real key all
 *  line up. See the header, and hasNativePurchases above for why the native check is separate. */
export const isIapAvailable: boolean = !!Purchases && !!RC_KEY && hasNativePurchases
  && (Platform.OS === 'ios' || Platform.OS === 'android');

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'error'; message?: string };

const UNAVAILABLE: PurchaseResult = { ok: false, reason: 'unavailable' };

/** RevenueCat's code for "the person tapped Cancel on Apple's sheet" (errors.d.ts marks the
 *  older `userCancelled` boolean deprecated in favour of this, so both are read below). */
const CANCELLED_CODE = '1';

/** Which appUserID the SDK is currently configured for, so configure() runs once and a genuine
 *  account switch becomes a logIn() rather than a second configure(). */
let configuredFor: string | null = null;

/** Narrow an unknown thrown value to the shape RevenueCat actually throws. */
function readError(e: unknown): { cancelled: boolean; message: string } {
  const err = (e ?? {}) as { code?: unknown; userCancelled?: unknown; message?: unknown };
  const cancelled = err.userCancelled === true || String(err.code ?? '') === CANCELLED_CODE;
  return { cancelled, message: String(err.message ?? e ?? 'Purchase failed') };
}

/**
 * Point RevenueCat at the signed-in athlete so webhook events carry the owner. RC App User ID
 * MUST equal the profile UUID (revenuecat-webhook resolves the owner from app_user_id) — an
 * anonymous id here means a paid subscription that attaches to nobody. No-op where the store is
 * unavailable. Never throws: a paywall that crashes is worse than one that cannot sell.
 */
export async function configureIap(appUserId: string): Promise<void> {
  if (!isIapAvailable || !Purchases) return;
  const uid = String(appUserId || '').trim();
  if (!uid) return;                      // never configure anonymously — see above
  if (configuredFor === uid) return;
  try {
    if (configuredFor === null) {
      Purchases.configure({ apiKey: RC_KEY, appUserID: uid });
    } else {
      // Same install, different account (a shared device, or sign-out → sign-in). configure()
      // a second time is not the supported call; logIn() moves the SDK to the new subject and
      // keeps the purchase history attached to the id that actually bought it.
      await Purchases.logIn(uid);
    }
    configuredFor = uid;
  } catch {
    configuredFor = null;                // leave it unconfigured so the next call retries
  }
}

/**
 * Present the store purchase sheet for a consumer product (e.g. `onstandard_individual_annual`)
 * and return whether it completed. On success the RevenueCat webhook writes the `consumer`
 * subscription row server-side; the caller then re-pulls entitlement.
 *
 * Buys the OFFERING PACKAGE where one carries this product id, and only falls back to the bare
 * store product when it does not: purchasePackage keeps the offering/paywall context RevenueCat
 * needs to attribute the sale, which purchaseStoreProduct cannot reconstruct afterwards.
 */
export async function purchaseConsumer(productId: string, appUserId: string): Promise<PurchaseResult> {
  if (!isIapAvailable || !Purchases) return UNAVAILABLE;
  const wanted = String(productId || '').trim();
  if (!wanted) return { ok: false, reason: 'error', message: 'No product requested.' };
  await configureIap(appUserId);
  if (configuredFor === null) return { ok: false, reason: 'error', message: 'Could not reach the store. You were not charged.' };
  try {
    // Offerings first. `current` is the offering the RevenueCat dashboard marks default; `all`
    // covers a product parked in a non-default offering so a dashboard change cannot silently
    // drop it to the fallback path.
    const offerings = await Purchases.getOfferings();
    const pools = [offerings.current, ...Object.values(offerings.all ?? {})];
    for (const offering of pools) {
      const pkg = offering?.availablePackages?.find((p) => p.product?.identifier === wanted);
      if (pkg) {
        await Purchases.purchasePackage(pkg);
        return { ok: true };
      }
    }
    const [product] = await Purchases.getProducts([wanted]);
    if (!product) return { ok: false, reason: 'error', message: 'That plan is not available in your region yet.' };
    await Purchases.purchaseStoreProduct(product);
    return { ok: true };
  } catch (e) {
    const { cancelled, message } = readError(e);
    // A cancel is not a failure and must never paint an error: the paywall treats 'cancelled'
    // as silence (paywall.js sets UI.status = null), which is what backing out of Apple's sheet
    // should look like.
    return cancelled ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'error', message };
  }
}

/**
 * Restore a prior purchase (App Store / Play "Restore" — required by Apple, Guideline 3.1.1).
 * Re-triggers the RevenueCat webhook so the server row is rebuilt.
 *
 * `{ ok:false, reason:'cancelled' }` is this function's "nothing on this account": the paywall
 * maps a non-'error' failure to the neutral "Nothing to restore on this account." line, while a
 * genuine throw stays 'error' so a DROPPED CHECK is never reported as a verdict about the
 * account. Those are three different truths and the screen already renders them differently.
 */
export async function restoreConsumer(appUserId: string): Promise<PurchaseResult> {
  if (!isIapAvailable || !Purchases) return UNAVAILABLE;
  await configureIap(appUserId);
  if (configuredFor === null) return { ok: false, reason: 'error', message: 'Could not reach the store. Nothing changed.' };
  try {
    const info = await Purchases.restorePurchases();
    const active = (info?.activeSubscriptions ?? []).length > 0
      || Object.keys(info?.entitlements?.active ?? {}).length > 0;
    return active ? { ok: true } : { ok: false, reason: 'cancelled' };
  } catch (e) {
    return { ok: false, reason: 'error', message: readError(e).message };
  }
}
