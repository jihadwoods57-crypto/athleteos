// OnStandard — RevenueCat webhook mapping (pure; shared by revenuecat-webhook + its test).
//
// The CONSUMER IAP rail: turn a normalized RevenueCat webhook event into the `subscriptions`
// row fields the webhook upserts. No I/O, no Deno globals — so it is unit-tested from src (the
// risky part of a webhook is the mapping, not the plumbing).
//
// KEEP product ids + plan ids in sync with src/core/pricing.ts (the client catalog).

export type ConsumerStatus = 'active' | 'past_due' | 'canceled' | 'paused';

// Store product identifier -> our catalog plan id. The founder creates these products in App
// Store Connect / Play Console; both cadences of a plan map to the same plan_id (cadence is not
// an entitlement axis). Unknown products are still honored as a generic consumer plan
// (planId=null) so a newly-added SKU never silently DENIES access.
export const CONSUMER_PRODUCTS: Record<string, string> = {
  onstandard_individual_monthly: 'individual',
  onstandard_individual_annual: 'individual',
  onstandard_individual_plus_monthly: 'individual_plus',
  onstandard_individual_plus_annual: 'individual_plus',
  onstandard_family_monthly: 'family',
  onstandard_family_annual: 'family',
};

// Loose fallback order: most specific id first (so "individual_plus" wins over "individual").
const PLAN_IDS = ['individual_plus', 'family', 'individual'];

/** plan_id from a store product id: exact map first, then a loose contains-match so a renamed or
 *  region-suffixed SKU still resolves; null when nothing matches (still a valid consumer plan). */
export function planIdFromProduct(productId: string | null | undefined): string | null {
  if (!productId) return null;
  if (productId in CONSUMER_PRODUCTS) return CONSUMER_PRODUCTS[productId];
  const p = productId.toLowerCase();
  for (const id of PLAN_IDS) if (p.includes(id)) return id;
  return null;
}

/** Normalize RevenueCat's store enum to our two consumer stores, or null (unsupported store). */
export function mapStore(store: string | null | undefined): 'app_store' | 'play_store' | null {
  const s = String(store || '').toUpperCase();
  if (s === 'APP_STORE' || s === 'MAC_APP_STORE') return 'app_store';
  if (s === 'PLAY_STORE') return 'play_store';
  return null;
}

export interface RcEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  store?: string;
  expiration_at_ms?: number | null;
  period_type?: string; // TRIAL | NORMAL | INTRO | PROMOTIONAL
  cancel_reason?: string | null;
}

export interface ConsumerRowFields {
  status: ConsumerStatus;
  tier: 'consumer' | 'preview';
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  store: 'app_store' | 'play_store' | null;
  store_product_id: string | null;
  rc_app_user_id: string | null;
  payment_failed_at: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RC event types this webhook acts on. Everything else is acknowledged (200) and ignored. */
export const HANDLED_RC_EVENTS = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', // -> active
  'CANCELLATION',        // auto-renew off / refund flag -> active, ending at period end
  'BILLING_ISSUE',       // -> past_due (grace window; app shows "update your card")
  'SUBSCRIPTION_PAUSED', // -> paused
  'EXPIRATION',          // -> canceled, tier back to preview
]);

/** ms epoch -> ISO, or null for missing/garbage. */
function iso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

/** The owner (profile UUID) an event belongs to, or null if it isn't a clean UUID — never guess. */
export function ownerOf(ev: RcEvent): string | null {
  const id = ev.app_user_id || ev.original_app_user_id || '';
  return UUID_RE.test(id) ? id : null;
}

/** Map an RC event to the subscription-row fields to upsert, or null if it isn't one we act on. */
export function rcEventToRow(ev: RcEvent, nowIso: string): ConsumerRowFields | null {
  const type = ev.type || '';
  if (!HANDLED_RC_EVENTS.has(type)) return null;

  const common = {
    plan_id: planIdFromProduct(ev.product_id),
    current_period_end: iso(ev.expiration_at_ms),
    store: mapStore(ev.store),
    store_product_id: ev.product_id || null,
    rc_app_user_id: ev.app_user_id || null,
  };

  if (type === 'EXPIRATION') {
    return { ...common, status: 'canceled', tier: 'preview', cancel_at_period_end: false, payment_failed_at: null };
  }
  if (type === 'BILLING_ISSUE') {
    return { ...common, status: 'past_due', tier: 'consumer', cancel_at_period_end: false, payment_failed_at: nowIso };
  }
  if (type === 'SUBSCRIPTION_PAUSED') {
    return { ...common, status: 'paused', tier: 'consumer', cancel_at_period_end: false, payment_failed_at: null };
  }
  if (type === 'CANCELLATION') {
    // Auto-renew turned off (or a refund flagged by reason). Access continues to expiry; the actual
    // end arrives later as its own EXPIRATION. Keep active + mark ending so the app can offer a save.
    return { ...common, status: 'active', tier: 'consumer', cancel_at_period_end: true, payment_failed_at: null };
  }
  // INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / UNCANCELLATION
  return { ...common, status: 'active', tier: 'consumer', cancel_at_period_end: false, payment_failed_at: null };
}
