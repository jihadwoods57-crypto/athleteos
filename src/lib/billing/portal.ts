// OnStandard — billing portal seam (gated, inert until go-live).
//
// The model: business plans (trainers/orgs/gyms) are billed off-platform via Stripe, so
// "manage / cancel" opens the Stripe Billing Portal in the browser — a hosted page, no
// in-app payment UI, no Apple 30% (Apple's IAP rule is for consumer in-app purchases).
// The consumer Individual plan uses Apple/Google IAP (RevenueCat) — cancellation is the
// OS subscription settings — and is wired at go-live.
//
// Until the founder sets EXPO_PUBLIC_BILLING_PORTAL_URL (the Stripe portal link), this is
// INERT: isBillingConfigured is false and openBillingPortal is a no-op. The checkout UI
// shows the compliant terms either way and labels the CTA honestly ("available at launch").
import { Linking } from 'react-native';

/** The Stripe Billing Portal URL, set at go-live. Null until then. */
export const billingPortalUrl: string | null = process.env.EXPO_PUBLIC_BILLING_PORTAL_URL?.trim() || null;

/** True once the portal link is configured — gates the live "Manage / cancel" CTA. */
export const isBillingConfigured: boolean = billingPortalUrl !== null;

/** Open the hosted billing portal (manage / cancel). No-op + false when unconfigured;
 *  never throws — a failed open must not crash the screen. */
export async function openBillingPortal(): Promise<boolean> {
  if (!billingPortalUrl) return false;
  try {
    await Linking.openURL(billingPortalUrl);
    return true;
  } catch {
    return false;
  }
}
