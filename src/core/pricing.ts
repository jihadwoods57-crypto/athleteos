// OnStandard — pricing catalog (pure TS, no RN imports). The "pricing is DATA, not code"
// seed (DECISION-MEMO D4 + docs/founding/LAUNCH-PRICING.md). These are the recommended
// OPENING numbers; at go-live they move to a backend pricing-catalog table so prices,
// trials, seat limits, promos, and regional pricing change with no app release. The
// checkout UI reads this catalog; nothing here charges anyone.
import type { Flow } from './types';

/** How a plan is billed. Consumer plans go through Apple/Google IAP (App Store rule);
 *  business plans (trainers/orgs) go through Stripe off-platform (no 30% cut). */
export type BillingRail = 'iap' | 'stripe';
export type PlanAudience = 'individual' | 'professional' | 'organization';

export interface PricedPlan {
  id: string;
  name: string;
  audience: PlanAudience;
  rail: BillingRail;
  /** USD per month (0 for custom/enterprise). */
  monthly: number;
  /** USD per year (≈ 2 months free). */
  annual: number;
  /** Free-trial length in days. */
  trialDays: number;
  /** Active clients/participants included (undefined = unlimited/custom). */
  seatLimit?: number;
  /** USD per extra active client beyond the limit, when the plan allows add-ons. */
  extraSeatMonthly?: number;
  /** One-line "who it's for / what's included". */
  blurb: string;
  /** Enterprise = "Custom" (no self-serve price). */
  custom?: boolean;
}

// The recommended opening catalog (docs/founding/LAUNCH-PRICING.md).
export const PLAN_CATALOG: PricedPlan[] = [
  { id: 'individual', name: 'Individual', audience: 'individual', rail: 'iap', monthly: 14.99, annual: 149, trialDays: 7,
    blurb: 'Keep your history, score, AI coach, and daily game plan — on your own.' },
  { id: 'individual_plus', name: 'Individual Plus', audience: 'individual', rail: 'iap', monthly: 24.99, annual: 249, trialDays: 7,
    blurb: 'Adds your full portable record across every team + a shareable recruiting card.' },
  // Cost sweep 2026-07-04: Solo/Professional were repriced up (69->99, 124.99->179) and the extra-seat
  // add-on 3->10. The old numbers sat at/below the per-seat AI-cost floor once a trainer's roster was
  // genuinely engaged, so a MORE successful trainer earned us LESS margin. New floor: ~$4/seat of budget
  // against a ~$2 heavy-user AI cost, and the $10 overage stays clean margin as a roster grows past 50.
  // Nothing was anchored to the old prices (free preview), so this is free.
  { id: 'pro_solo', name: 'Solo', audience: 'professional', rail: 'stripe', monthly: 99, annual: 990, trialDays: 14, seatLimit: 25,
    blurb: 'For the independent trainer or nutritionist. Up to 25 active clients.' },
  { id: 'professional', name: 'Professional', audience: 'professional', rail: 'stripe', monthly: 179, annual: 1790, trialDays: 14, seatLimit: 50, extraSeatMonthly: 10,
    blurb: 'For a busy practice. Up to 50 active clients; $10/mo each beyond.' },
  { id: 'org_starter', name: 'Starter', audience: 'organization', rail: 'stripe', monthly: 249, annual: 2490, trialDays: 14, seatLimit: 30,
    blurb: 'Teams, gyms & facilities. Up to 30 active participants.' },
  { id: 'org_growth', name: 'Growth', audience: 'organization', rail: 'stripe', monthly: 499, annual: 4990, trialDays: 14, seatLimit: 75,
    blurb: 'Up to 75 active participants.' },
  { id: 'org_performance', name: 'Performance', audience: 'organization', rail: 'stripe', monthly: 799, annual: 7990, trialDays: 14, seatLimit: 150,
    blurb: 'Up to 150 active participants.' },
  { id: 'enterprise', name: 'Enterprise', audience: 'organization', rail: 'stripe', monthly: 0, annual: 0, trialDays: 14, custom: true,
    blurb: 'Athletic departments, multi-location & 150+. SSO, API, white-glove onboarding.' },
];

/** Format a USD amount: whole dollars drop the cents ($69), otherwise two places ($14.99). */
export function formatPrice(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** The annual saving vs paying monthly, as whole dollars (0 for custom). */
export function annualSavings(p: PricedPlan): number {
  if (p.custom || !p.annual) return 0;
  return Math.max(0, Math.round(p.monthly * 12 - p.annual));
}

/** The audience to show for a given dashboard flow: athlete/parent → individual plans;
 *  trainer → professional; coach (incl. gyms) → organization. */
export function audienceForFlow(flow: Flow): PlanAudience {
  switch (flow) {
    case 'trainer': return 'professional';
    case 'coach': return 'organization';
    default: return 'individual'; // app (athlete) + parent
  }
}

/** The plans to offer a given flow, in catalog order. */
export function plansForFlow(flow: Flow): PricedPlan[] {
  const a = audienceForFlow(flow);
  return PLAN_CATALOG.filter((p) => p.audience === a);
}

export function planById(id: string): PricedPlan | undefined {
  return PLAN_CATALOG.find((p) => p.id === id);
}

export interface PlanTerms {
  /** "$14.99 / month" or "Custom pricing". */
  price: string;
  /** "Billed monthly, auto-renews until canceled." */
  renewal: string;
  /** "7-day free trial" or "" when none. */
  trial: string;
  /** "Cancel anytime in your account settings — no phone call, no runaround." */
  cancellation: string;
  /** The annual alternative, or "" for custom/none. */
  annual: string;
}

/**
 * The plain, up-front terms a compliant checkout MUST show BEFORE purchase (FTC / state
 * auto-renewal law): price, billing frequency, auto-renewal, trial, and how to cancel.
 * Pure — the UI just renders these strings, so the disclosure rules live in one tested place.
 */
export function planTerms(p: PricedPlan): PlanTerms {
  if (p.custom) {
    return {
      price: 'Custom pricing',
      renewal: 'Billed per your contract.',
      trial: '',
      cancellation: 'Cancellation terms are set in your enterprise agreement.',
      annual: '',
    };
  }
  const cadenceWord = p.rail === 'iap' ? 'in the App Store / Google Play' : 'in your account settings';
  return {
    price: `${formatPrice(p.monthly)} / month`,
    renewal: 'Billed monthly, auto-renews until canceled.',
    trial: p.trialDays > 0 ? `${p.trialDays}-day free trial, then ${formatPrice(p.monthly)}/month.` : '',
    cancellation: `Cancel anytime ${cadenceWord} — no phone call, no runaround.`,
    annual: p.annual ? `Or ${formatPrice(p.annual)}/year (save ${formatPrice(annualSavings(p))}).` : '',
  };
}

/** The CTA label that carries the auto-renewal terms (FTC: consent before charge). */
export function purchaseCtaLabel(p: PricedPlan): string {
  return purchaseCtaLabelFor(p, 'monthly');
}

// ---------------------------------------------------------------- billing cadence
// Annual-first checkout (revenue build 2026-07-04): annual is the highlighted default at
// checkout — the buyer saves two months, the business gets cash up front and roughly half
// the churn surface. These helpers keep every cadence-dependent string in one tested place.

export type BillingCadence = 'monthly' | 'annual';

/** The charge for a plan at a cadence (what the card is actually hit for). */
export function cadenceAmount(p: PricedPlan, cadence: BillingCadence): number {
  return cadence === 'annual' ? p.annual : p.monthly;
}

/** Price display for a plan card at a cadence: "$99" + "/ month", or "$990" + "/ year". */
export function cadencePriceParts(p: PricedPlan, cadence: BillingCadence): { amount: string; per: string } {
  return cadence === 'annual'
    ? { amount: formatPrice(p.annual), per: '/ year' }
    : { amount: formatPrice(p.monthly), per: '/ month' };
}

/** The cadence-aware CTA, still carrying the auto-renewal consent in the label. */
export function purchaseCtaLabelFor(p: PricedPlan, cadence: BillingCadence): string {
  if (p.custom) return 'Contact sales';
  return cadence === 'annual'
    ? `Start — ${formatPrice(p.annual)}/yr, auto-renews`
    : `Start — ${formatPrice(p.monthly)}/mo, auto-renews`;
}

/** The one-line saving pitch under the annual option ("Save $198 vs monthly"), or '' . */
export function annualSavingsLine(p: PricedPlan): string {
  const saved = annualSavings(p);
  return saved > 0 ? `Save ${formatPrice(saved)} vs monthly` : '';
}
