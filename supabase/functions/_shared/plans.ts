// OnStandard — server-side plan facts shared by the billing edge functions.
//
// The MINIMAL slice of the pricing catalog the SERVER needs: which plan ids are purchasable
// on the Stripe rail, and how many seats each grants. Kept deliberately tiny — prices
// themselves live in Stripe (Prices with lookup_keys `<plan_id>_monthly` / `<plan_id>_annual`),
// so a price change is a Stripe dashboard edit, never a deploy. KEEP THE SEAT NUMBERS IN SYNC
// with src/core/pricing.ts (the client catalog) until the catalog moves to a table (memo D4).
//
// Consumer plans (individual / individual_plus / family) are Apple/Google IAP by App Store
// rule — they are NOT in this map, and billing-checkout rejects them.

export interface ServerPlan {
  /** Athlete/client seats the plan includes (null = custom/enterprise, not self-serve). */
  seats: number | null;
}

export const STRIPE_PLANS: Record<string, ServerPlan> = {
  pro_solo: { seats: 25 },
  professional: { seats: 50 },
  org_starter: { seats: 30 },
  org_growth: { seats: 75 },
  org_performance: { seats: 150 },
};

export type Cadence = 'monthly' | 'annual';

export function isCadence(x: unknown): x is Cadence {
  return x === 'monthly' || x === 'annual';
}

/** The Stripe Price lookup_key for a plan+cadence, e.g. `pro_solo_monthly`. The founder
 *  creates each Price with this exact lookup_key (docs/go-live/STRIPE-SETUP.md). */
export function priceLookupKey(planId: string, cadence: Cadence): string {
  return `${planId}_${cadence}`;
}

/** plan_id from a Stripe Price lookup_key (`professional_annual` -> `professional`),
 *  or null when the key isn't one of ours. */
export function planIdFromLookupKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const m = key.match(/^(.+)_(monthly|annual)$/);
  if (!m) return null;
  return m[1] in STRIPE_PLANS ? m[1] : null;
}
