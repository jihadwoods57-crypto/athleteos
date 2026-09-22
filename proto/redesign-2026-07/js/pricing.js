/* Consumer plan catalog for the in-app paywall. Mirrors the consumer subset of
   src/core/pricing.ts (the source of truth) and the RevenueCat product ids in
   supabase/functions/_shared/revenuecat.ts CONSUMER_PRODUCTS. Pure data + display
   helpers — nothing here charges anyone; the store SDK does that via the bridge.

   ANNUAL IS A STORE PRICE POINT, NOT A PERCENTAGE (2026-09-21). It used to be monthly * 12 * 0.70.
   It is now the literal figure Apple's ladder carries ($199.99, $249.99) because the store's price
   is what the card is charged and this screen must never print less than that. Do not re-derive
   it; copy it from src/core/pricing.ts, which moves only alongside App Store Connect. */

/* Blurbs state the SAME facts as ob2.js PLANS.individual: the onboarding plan cards and this
   paywall describe one plan each, and two descriptions of one plan is how a member buys a thing
   the other screen never promised. Keep the two in step. */
/* INDIVIDUAL PLUS RETIRED (2026-09-21 founder ruling). It charged $5 more for full history,
   unlimited supporters and the shareable verified record, and has_premium_access() never read
   tier, so every paying athlete already had all three. The features did not go away with the
   plan: they are written into the Individual blurb below, which is where they always belonged.
   Two plans on this paywall now, not three. */
export const CONSUMER_PLANS = [
  { id: 'individual', name: 'Individual', monthly: 19.99, annual: 199.99, trialDays: 14, seatLimit: 0,
    blurb: 'Your daily score, AI meal analysis and streaks, your full history and trends, unlimited supporters, and the recruiting card a coach can open.' },
  { id: 'family', name: 'Family', monthly: 24.99, annual: 249.99, trialDays: 14, seatLimit: 4,
    blurb: 'One household, up to 4 athletes, one bill. Parents see every dashboard.' },
];

/* Guideline 2.3.10: an iOS build never names another platform. The store is the one this build
   is sold through; a plain browser preview genuinely is either. window.__PLATFORM is injected by
   the native shell (ProtoApp.tsx). */
export function storeName() {
  const p = typeof window !== 'undefined' ? window.__PLATFORM : undefined;
  if (p === 'ios') return 'the App Store';
  if (p === 'android') return 'Google Play';
  return 'the App Store or Google Play';
}

export function planById(id) { return CONSUMER_PLANS.find((p) => p.id === id) || null; }

/** Whole dollars drop the cents ($99), otherwise two places ($19.99). */
export function fmtPrice(n) { return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`; }

/** The effective monthly cost when billed annually ($16.67 for Individual). */
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
    return `${trial}${fmtPrice(p.annual)}/year (${eff}/mo). Auto-renews yearly until canceled in ${storeName()}.`;
  }
  const trial = p.trialDays > 0 ? `Free for ${p.trialDays} days, then ` : '';
  return `${trial}${fmtPrice(p.monthly)}/month. Auto-renews monthly until canceled in ${storeName()}.`;
}
