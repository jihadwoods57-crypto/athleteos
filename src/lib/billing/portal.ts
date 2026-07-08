// OnStandard — billing transport (Stripe rail for trainer/org plans).
//
// The model: business plans (trainers/orgs/gyms) are billed off-platform via Stripe, so
// checkout and "manage / cancel / pause" open Stripe-hosted pages in the browser — no
// in-app payment UI, no Apple 30% (Apple's IAP rule is for consumer in-app purchases).
// The consumer Individual/Family plans use Apple/Google IAP (RevenueCat) and are wired
// separately at store launch.
//
// Two server calls, both holding the Stripe key server-side:
//   * billing-checkout — creates a Checkout Session for {planId, cadence} and returns its URL.
//   * billing-portal   — creates a per-customer Billing Portal session (manage / update card /
//                        pause / cancel), already signed in to the caller's own billing.
//
// GATING: isBillingConfigured is true when the backend is reachable (same env pair the AI
// endpoints use). Until the founder deploys the billing functions + Stripe keys, a checkout
// attempt returns 503 and the UI keeps its honest "available at launch" copy — so shipping
// this file first is safe. A static EXPO_PUBLIC_BILLING_PORTAL_URL remains as a portal
// fallback for accounts created before the per-customer path existed.
import { Linking } from 'react-native';
import { supabase } from '@/lib/supabase/client';

const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** Legacy static Stripe portal link (pre-0042 seam). Kept as a fallback only. */
export const billingPortalUrl: string | null = process.env.EXPO_PUBLIC_BILLING_PORTAL_URL?.trim() || null;

/** True when the billing backend can be reached (or the legacy static portal link exists).
 *  Gates the live checkout CTA; with this false the UI shows "available at launch". */
export const isBillingConfigured: boolean = Boolean(supaUrl && anonKey) || billingPortalUrl !== null;

/** Why a checkout/portal attempt did not produce a URL — for honest UI copy. */
export type BillingFailure = 'not_configured' | 'sign_in_required' | 'not_available_yet' | 'error';

export type BillingResult = { ok: true } | { ok: false; reason: BillingFailure };

function fnUrl(name: string): string {
  return supaUrl ? `${supaUrl}/functions/v1/${name}` : '';
}

/** Headers for a billing function call: the signed-in user's token (required — billing is
 *  never anonymous), apikey = anon key for the gateway. */
async function authHeaders(): Promise<Record<string, string> | null> {
  if (!anonKey) return null;
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (!token) return null;
    return { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${token}` };
  } catch {
    return null;
  }
}

/** POST a billing function and open the URL it returns. */
async function openBillingUrl(fn: string, body: Record<string, unknown>): Promise<BillingResult> {
  const endpoint = fnUrl(fn);
  if (!endpoint) return { ok: false, reason: 'not_configured' };
  const headers = await authHeaders();
  if (!headers) return { ok: false, reason: 'sign_in_required' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 503) return { ok: false, reason: 'not_available_yet' };
    if (res.status === 401) return { ok: false, reason: 'sign_in_required' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = (await res.json()) as { url?: unknown };
    if (typeof data.url !== 'string' || !/^https:\/\//.test(data.url)) return { ok: false, reason: 'error' };
    await Linking.openURL(data.url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Start Stripe Checkout for a business plan. Opens the hosted payment page in the browser;
 * the webhook flips the entitlement when payment completes (the app re-reads it on next
 * launch/login). `referralCode` applies the give-a-month referral discount when valid.
 */
export async function startCheckout(
  planId: string,
  cadence: 'monthly' | 'annual',
  referralCode?: string,
): Promise<BillingResult> {
  return openBillingUrl('billing-checkout', { planId, cadence, ...(referralCode ? { referralCode } : {}) });
}

/** Open the hosted billing portal (manage / update card / pause / cancel). Prefers the
 *  per-customer session; falls back to the legacy static link. Never throws. */
export async function openBillingPortal(): Promise<boolean> {
  const viaFn = await openBillingUrl('billing-portal', {});
  if (viaFn.ok) return true;
  if (!billingPortalUrl) return false;
  try {
    await Linking.openURL(billingPortalUrl);
    return true;
  } catch {
    return false;
  }
}
