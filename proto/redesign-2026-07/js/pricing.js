/* Consumer plan catalog for the in-app paywall. Mirrors the consumer subset of
   src/core/pricing.ts (the source of truth) and the RevenueCat product ids in
   supabase/functions/_shared/revenuecat.ts CONSUMER_PRODUCTS. Pure data + display
   helpers — nothing here charges anyone; the store SDK does that via the bridge.

   Annual = monthly * 12 * 0.70 (30% off, 2026-07-21). Keep in sync with pricing.ts. */

export const CONSUMER_PLANS = [
  { id: 'individual', name: 'Individual', monthly: 14.99, annual: 126, trialDays: 7, seatLimit: 0,
    blurb: 'Your history, score, AI coach, and daily game plan — on your own.' },
  { id: 'individual_plus', name: 'Individual Plus', monthly: 24.99, annual: 210, trialDays: 7, seatLimit: 0,
    blurb: 'Adds your full portable record across every team + a shareable recruiting card.' },
  { id: 'family', name: 'Family', monthly: 39.99, annual: 336, trialDays: 7, seatLimit: 4,
    blurb: 'One household, up to 4 athletes, one bill. Parents see every dashboard.' },
];

export function planById(id) { return CONSUMER_PLANS.find((p) => p.id === id) || null; }

/** Whole dollars drop the cents ($126), otherwise two places ($14.99). */
export function fmtPrice(n) { return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`; }

/** The effective monthly cost when billed annually ($10.50 for Individual). */
export function effectiveMonthly(p) { return Math.round((p.annual / 12) * 100) / 100; }

/** Whole-dollar saving of annual vs 12× monthly. */
export function annualSavings(p) { return Math.max(0, Math.round(p.monthly * 12 - p.annual)); }

/** The RevenueCat / store product id for a plan + cadence — must match CONSUMER_PRODUCTS. */
export function productId(planId, cadence) {
  return `onstandard_${planId}_${cadence === 'annual' ? 'annual' : 'monthly'}`;
}

/** The amount actually charged for a plan at a cadence. */
export function cadenceAmount(p, cadence) { return cadence === 'annual' ? p.annual : p.monthly; }

/** The price + per-unit for a plan card at a cadence. */
export function cadencePriceParts(p, cadence) {
  return cadence === 'annual'
    ? { amount: fmtPrice(p.annual), per: '/yr' }
    : { amount: fmtPrice(p.monthly), per: '/mo' };
}

/** The plain, up-front auto-renewal terms a compliant checkout must show BEFORE purchase
    (FTC / state auto-renewal law). Cancellation is store-managed for IAP. */
export function disclosure(p, cadence) {
  if (cadence === 'annual') {
    const eff = fmtPrice(effectiveMonthly(p));
    const trial = p.trialDays > 0 ? `Free for ${p.trialDays} days, then ` : '';
    return `${trial}${fmtPrice(p.annual)}/year (${eff}/mo). Auto-renews yearly until canceled in the App Store or Google Play.`;
  }
  const trial = p.trialDays > 0 ? `Free for ${p.trialDays} days, then ` : '';
  return `${trial}${fmtPrice(p.monthly)}/month. Auto-renews monthly until canceled in the App Store or Google Play.`;
}
