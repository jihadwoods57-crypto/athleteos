/* Consumer plan catalog for the in-app paywall. Mirrors the consumer subset of
   src/core/pricing.ts (the source of truth) and the RevenueCat product ids in
   supabase/functions/_shared/revenuecat.ts CONSUMER_PRODUCTS. Pure data + display
   helpers — nothing here charges anyone; the store SDK does that via the bridge.

   ANNUAL IS A STORE PRICE POINT, NOT A PERCENTAGE (2026-09-21). It used to be monthly * 12 * 0.70.
   It is now the literal figure Apple's ladder carries ($199.99, $249.99) because the store's price
   is what the card is charged and this screen must never print less than that. Do not re-derive
   it; copy it from src/core/pricing.ts, which moves only alongside App Store Connect.

   THE CATALOG IS THE FALLBACK, NOT THE PRICE (2026-09-23, App Review pass G-R7). Apple sells this
   app in 175 storefronts and the figures below are the US ones. When the store answers
   (IAP_OFFERINGS through the bridge), quote() prints the store's own localized priceString, and
   the trial only when the store says this Apple ID is eligible for it. The catalog is printed only
   where there is no store: a browser, an old binary, or a store that did not answer. */

/* WHAT MEMBERSHIP ADDS, stated ONCE (2026-09-23, App Review pass A-M3).
   Four screens described membership four ways: the paywall said "the written coaching", the
   onboarding card sold the Daily Score, meal analysis, history and the recruiting card, and one
   screen said "The trial opens everything." Only one of those is behind a gate. What the server
   gates on has_premium_access() today:
     - monthly-report: MONTHLY_REQUIRES_PLAN=1 IS SET on production, so the written read of the
       month (wins, one focus, the coach's-voice summary) is the member-only part. The month's
       numbers stay free: monthly-report.js renders them on the locked card.
     - deep-analysis (DEEP_REQUIRES_PLAN) and verified-profile (VERIFIED_PROFILE_REQUIRES_PLAN):
       NOT set, so Deep Dive and the recruiting card are free today.
   If either of those secrets is ever flipped, these sentences change in the SAME change, and so
   do the plan blurbs below. Every screen that says what membership buys renders these strings. */
export const MEMBERSHIP_ADDS = 'Membership adds Nia’s monthly review: your three biggest wins, one focus for next month, and her written read of your month.';
export const FREE_KEEPS = 'Your score, meal analysis, streaks, history and recruiting card are free, and they stay yours.';
/** The one-line version for the foot of a screen. */
export const ENTITLEMENT_LINE = 'Your score and stats are always free. Membership adds Nia’s monthly review.';

/* Blurbs are the per-plan version of MEMBERSHIP_ADDS: what paying for THIS plan adds, never a free
   feature relabelled as a paid one.
   INDIVIDUAL PLUS RETIRED (2026-09-21 founder ruling). It charged $5 more for full history,
   unlimited supporters and the shareable verified record, and has_premium_access() never read
   tier, so every paying athlete already had all three. Two plans on this paywall now, not three. */
export const CONSUMER_PLANS = [
  { id: 'individual', name: 'Individual', monthly: 19.99, annual: 199.99, trialDays: 14, seatLimit: 0,
    blurb: 'For one athlete: Nia’s monthly review, on top of everything that is already free.' },
  { id: 'family', name: 'Family', monthly: 24.99, annual: 249.99, trialDays: 14, seatLimit: 4,
    blurb: 'One household, up to 4 athletes, one bill. Each athlete gets Nia’s monthly review.' },
];

/* Guideline 2.3.10: an iOS build never names another platform. The store is the one this build
   is sold through; a plain browser preview genuinely is either. window.__PLATFORM is injected by
   the native shell (ProtoApp.tsx). This is the ONE place the app decides which store it is in
   (A Polish 6): no screen reads navigator.userAgent for it. */
function platform() {
  const p = typeof window !== 'undefined' ? window.__PLATFORM : undefined;
  if (p === 'ios' || p === 'android') return p;
  // A plain browser has no shell. An Android browser still means Google Play for the "manage
  // your subscription" link; everything else defaults to Apple's.
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  return /android/i.test(ua) ? 'android-web' : 'web';
}
export function storeName() {
  const p = platform();
  if (p === 'ios') return 'the App Store';
  if (p === 'android') return 'Google Play';
  return 'the App Store or Google Play';
}
/** Where a store-billed membership is managed or cancelled. */
export function storeSubscriptionsUrl() {
  const p = platform();
  return p === 'android' || p === 'android-web'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';
}

/** What Restore says when this build has no store to ask. On a native build that means the binary
    predates the store module, and updating is the one thing that fixes it; "once memberships are
    live" was a coming-soon line (2.1). In a browser there is no store at all. */
export function restoreUnavailableLine() {
  const p = platform();
  return p === 'ios' || p === 'android' ? 'Update OnStandard to restore purchases.' : 'Purchases restore in the OnStandard app.';
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

/** The catalog price + per-unit for a plan at a cadence. quote() below is the store-aware one. */
export function cadencePriceParts(p, cadence) {
  return cadence === 'annual'
    ? { amount: fmtPrice(p.annual), per: '/yr' }
    : { amount: fmtPrice(p.monthly), per: '/mo' };
}

/* ---------- the store's own numbers ----------
   `offers` is the IAP_OFFERINGS answer, keyed by product id:
     { priceString, price, currencyCode, pricePerMonthString, trial: { count, unit } | null,
       trialEligible: true | false | null }
   Anything missing or malformed reads as "no store answer" for that product, never as a price. */

/** The store's answer for one plan + cadence, or null when there is none worth printing. */
export function storeQuote(offers, planId, cadence) {
  const q = offers && typeof offers === 'object' ? offers[productId(planId, cadence)] : null;
  return q && typeof q.priceString === 'string' && q.priceString.trim() ? q : null;
}

/** A store amount in its own currency, or null if this runtime cannot format it. Only the
    fallback for a missing pricePerMonthString; every other store amount is the store's string. */
function money(n, currency) {
  if (!Number.isFinite(n) || !currency) return null;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n); } catch { return null; }
}

const UNIT_WORD = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' };
/** "14 days", "2 weeks", "1 month" from the store's intro period; '' if it is not readable. */
export function trialLabel(trial) {
  if (!trial) return '';
  const n = Math.round(Number(trial.count));
  const w = UNIT_WORD[String(trial.unit || '').toUpperCase()];
  if (!w || !(n > 0)) return '';
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

/**
 * Everything a plan card, the CTA and the disclosure print for one plan at one cadence:
 *   amount, per   '$199.99' '/yr', or the store's localized string
 *   perMonth      the effective monthly for annual, else null
 *   saving        annual against 12 × monthly, else null
 *   trial         '14 days' when a free trial applies, else ''
 *   fromStore     true when the numbers came from the store
 * The trial shows ONLY when the store says this account is eligible (trialEligible === true):
 * an Apple ID that already used its trial is charged on day one, and "free for 14 days" would
 * be a false disclosure. Unknown eligibility shows no trial; the store sheet will still give it
 * to anyone who has it, so the screen can only under-promise.
 *
 * `storeLive` (review of 2026-09-23, I1): the store can transact, so a buy button is on screen.
 * If its price read then failed, timed out or left this product out, the catalog amount is all
 * there is, but the catalog TRIAL is not printed: nothing says this buyer is eligible, and
 * "Try it free … No charge today" over a sheet that charges today breaks 3.1.2. The catalog
 * trial shows only where nothing can be bought (storeLive false: a browser, an old build), where
 * it describes the plan rather than this buyer.
 */
export function quote(p, cadence, offers, { storeLive = false } = {}) {
  const annual = cadence === 'annual';
  const q = storeQuote(offers, p.id, cadence);
  if (!q) {
    return {
      amount: annual ? fmtPrice(p.annual) : fmtPrice(p.monthly),
      per: annual ? '/yr' : '/mo',
      perMonth: annual ? fmtPrice(effectiveMonthly(p)) : null,
      saving: annual && annualSavings(p) > 0 ? fmtPrice(annualSavings(p)) : null,
      trial: !storeLive && p.trialDays > 0 ? `${p.trialDays} days` : '',
      fromStore: false,
    };
  }
  /* The saving is NOT printed from the store's numbers: this runtime can only format it in the
     WebView's locale, which put "save €44" next to "219,99 €" (review Minor 3). The Save N% chip
     carries it, computed from the store's own two prices. */
  let perMonth = null;
  const saving = null;
  if (annual) {
    perMonth = (typeof q.pricePerMonthString === 'string' && q.pricePerMonthString) || money(q.price / 12, q.currencyCode);
  }
  return {
    amount: q.priceString, per: annual ? '/yr' : '/mo', perMonth, saving,
    trial: q.trialEligible === true ? trialLabel(q.trial) : '',
    fromStore: true,
  };
}

/** The annual chip's percentage: from the store's two prices when both answered, else the catalog. */
export function savePercent(p, offers) {
  const a = storeQuote(offers, p.id, 'annual'), m = storeQuote(offers, p.id, 'monthly');
  if (a && m && a.currencyCode === m.currencyCode && Number.isFinite(a.price) && Number.isFinite(m.price) && m.price > 0) {
    return Math.max(0, Math.round(((m.price * 12 - a.price) / (m.price * 12)) * 100));
  }
  return Math.round((annualSavings(p) / (p.monthly * 12)) * 100);
}

/** The plain, up-front auto-renewal terms a compliant checkout must show BEFORE purchase
    (FTC / state auto-renewal law). Cancellation is store-managed for IAP. */
export function disclosure(p, cadence, offers, opts = {}) {
  const qt = quote(p, cadence, offers, opts);
  const trial = qt.trial ? `Free for ${qt.trial}, then ` : '';
  // A live store whose price read failed: the catalog figure is US dollars, and the buyer's own
  // price is the one the store sheet shows. Say so rather than let the dollar figure stand alone.
  const local = opts.storeLive && !qt.fromStore ? ` Shown in US dollars; your price in ${storeName()} shows before you confirm.` : '';
  if (cadence === 'annual') {
    const eff = qt.perMonth ? ` (${qt.perMonth}/mo)` : '';
    return `${trial}${qt.amount}/year${eff}. Auto-renews yearly until canceled in ${storeName()}.${local}`;
  }
  return `${trial}${qt.amount}/month. Auto-renews monthly until canceled in ${storeName()}.${local}`;
}
