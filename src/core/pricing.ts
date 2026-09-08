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
  /** Free-trial length in days.
   *
   *  FOURTEEN ON BOTH RAILS (2026-09-08). Consumer used to be 7 while Stripe was 14, and the
   *  split was never a decision — it was two numbers set at different times. Seven days is the
   *  wrong length for THIS product specifically: the pitch is "log for a week and watch the
   *  number move", so a 7-day trial shows an athlete the mechanism and never the trend, and the
   *  trend is the entire argument the score makes. Fourteen gives two full scored weeks, matches
   *  the figure the founder ratified on 2026-07-30, and costs about $5 of model spend — the
   *  cheapest conversion lever on this rail. `planTerms()`, the FTC-disclosure function, reads
   *  this field, so it is now one number to disclose instead of two. */
  trialDays: number;
  /** ACTIVE clients/participants included (undefined = unlimited/custom). "Active" is the billing
   *  metric, not roster size: an athlete who logged >= ACTIVE_DAYS_THRESHOLD days that month
   *  (see server active_athlete_count, migration 0163). Idle seats are free — a coach is never
   *  billed for a kid who quit, and our AI cost only accrues for athletes who actually log. */
  seatLimit?: number;
  /** USD per extra ACTIVE client beyond the included count. On every Stripe plan (2026-07-30):
   *  it was declared on `professional` only while the website promised it on all plans, and it is
   *  the expansion-revenue lever — growth past the included seats bills automatically instead of
   *  hitting a wall. Billed via the metered overage Price (billing-overage-report). */
  extraSeatMonthly?: number;
  /** One-line "who it's for / what's included". */
  blurb: string;
  /** Enterprise = "Custom" (no self-serve price). */
  custom?: boolean;
}

// The recommended opening catalog (docs/founding/LAUNCH-PRICING.md).
export const PLAN_CATALOG: PricedPlan[] = [
  // Consumer annual discount deepened to 30% (2026-07-21): fitness revenue is annual-dominated,
  // and a strong long-term anchor is the single highest-leverage paywall lever for this category.
  // Annual = monthly * 12 * 0.70, rounded to a clean effective /mo ($10.50 / $17.50 / $28.00).
  // Pro/org (Stripe, B2B) keep the 2-months-free anchor below — different buyer, different churn.
  // CONSUMER IS PRICED FOR CAPTURE, NOT ARPU (2026-09-08). It was $14.99/$126, which is a
  // category-competitive anchor price — and this rail is not an anchor. BUSINESS_MODEL.md §3 is
  // explicit that consumer is a "free byproduct only, never a paid-acquisition target": its job
  // is to keep a graduating athlete's record alive at ~$0 CAC, and that record is the
  // word-of-mouth asset that feeds the org channel we actually sell. A price that maximises
  // consumer ARPU therefore optimises the wrong number twice — fewer athletes keep the record,
  // and the channel gets less of the thing it runs on. $9.99/$84 keeps the ladder's own 30%
  // annual rule and a clean $7.00 effective month.
  // No cannibalisation of the org tier: Starter's $2,490/yr over 30 seats is $83/athlete, but a
  // coach cannot assemble a roster out of Individual subscriptions — Individual sells the
  // ATHLETE their record, the org tiers sell the COACH the roster, priorities and assignments.
  // Different products on the same data.
  { id: 'individual', name: 'Individual', audience: 'individual', rail: 'iap', monthly: 9.99, annual: 84, trialDays: 14,
    blurb: 'Keep your history, score, AI coach, and daily game plan — on your own.' },
  { id: 'individual_plus', name: 'Individual Plus', audience: 'individual', rail: 'iap', monthly: 14.99, annual: 126, trialDays: 14,
    blurb: 'Adds the recruiting card a coach can open, and your record carried across every team.' },
  // Family plan (add-on build 2026-07-04): a parent with 2-4 athlete kids pays one bill.
  // Families churn slower than solo teens, and the parent digest gives the payer their own
  // value. IAP rail (consumer), same as Individual — 30% annual too.
  //
  // The whole consumer ladder was repriced again 2026-09-08 (see the Individual note above);
  // Family had to move with it or the same trap reopened at the new Individual price.
  //
  // REPRICED 2026-09-07, before any store product existed. It was $39.99/$336, which made the
  // plan a TRAP at the modal family size: two athletes on Individual cost $252/yr, so the
  // household that picked the obviously-family option paid $84 MORE for it. A plan whose name
  // says "family" and whose price punishes the commonest family is a packaging bug, not a
  // premium. At $228 it wins at two ($24), three ($150) and four ($276), and it still holds the
  // catalog's own rule that annual = monthly * 12 * 0.70 rounded to a clean effective /mo
  // ($19.00). The cost is margin on 3-4 athlete households; the gain is that 2-athlete
  // households stop having a rational reason to refuse the plan. Consumer is a free byproduct
  // in this model (BUSINESS_MODEL.md §3), so capture beats ARPU here.
  { id: 'family', name: 'Family', audience: 'individual', rail: 'iap', monthly: 18.99, annual: 156, trialDays: 14, seatLimit: 4,
    blurb: 'One household, up to 4 athletes, one bill. Parents see every dashboard.' },
  // Cost sweep 2026-07-04: Solo/Professional were repriced up (69->99, 124.99->179) and the extra-seat
  // add-on 3->10. The old numbers sat at/below the per-seat AI-cost floor once a trainer's roster was
  // genuinely engaged, so a MORE successful trainer earned us LESS margin. New floor: ~$4/seat of budget
  // against a ~$2 heavy-user AI cost, and the $10 overage stays clean margin as a roster grows past 50.
  // Nothing was anchored to the old prices (free preview), so this is free.
  // Active-athlete billing + universal overage (2026-07-30). Two structural fixes in one sweep:
  //   1. seatLimit counts ACTIVE athletes, and idle seats are free — the coach's biggest objection
  //      to seat pricing ("I'm paying for kids who quit") becomes the pitch, and the billing metric
  //      finally points the same way as our AI cost (only active athletes burn analyze-meal calls).
  //   2. extraSeatMonthly on EVERY Stripe plan. It existed on `professional` alone, which made the
  //      $179 tier both the only capped-with-escape plan AND worse per-seat than Solo ($3.58 vs
  //      $3.96) — the best customer was the worst margin. At $10/active seat the overage is ~4x the
  //      measured AI cost, so growth past the included count is margin, not loss, and net revenue
  //      retention can exceed 100% without a sales conversation.
  { id: 'pro_solo', name: 'Solo', audience: 'professional', rail: 'stripe', monthly: 99, annual: 990, trialDays: 14, seatLimit: 25, extraSeatMonthly: 10,
    blurb: 'For the independent trainer or nutritionist. 25 active clients included; $10/mo per active client beyond. Idle clients are free.' },
  { id: 'professional', name: 'Professional', audience: 'professional', rail: 'stripe', monthly: 179, annual: 1790, trialDays: 14, seatLimit: 50, extraSeatMonthly: 10,
    blurb: 'For a busy practice. 50 active clients included; $10/mo per active client beyond. Idle clients are free.' },
  { id: 'org_starter', name: 'Starter', audience: 'organization', rail: 'stripe', monthly: 249, annual: 2490, trialDays: 14, seatLimit: 30, extraSeatMonthly: 15,
    blurb: 'Teams, gyms & facilities. 30 active athletes included; $15/mo per active athlete beyond.' },
  { id: 'org_growth', name: 'Growth', audience: 'organization', rail: 'stripe', monthly: 499, annual: 4990, trialDays: 14, seatLimit: 75, extraSeatMonthly: 15,
    blurb: '75 active athletes included; $15/mo per active athlete beyond.' },
  { id: 'org_performance', name: 'Performance', audience: 'organization', rail: 'stripe', monthly: 799, annual: 7990, trialDays: 14, seatLimit: 150, extraSeatMonthly: 15,
    blurb: '150 active athletes included; $15/mo per active athlete beyond.' },
  // trialDays 0, not 14: planTerms() suppresses the trial for custom plans, so a nonzero value here
  // was dead data that any future consumer of trialDays would have read as a real promise.
  { id: 'enterprise', name: 'Enterprise', audience: 'organization', rail: 'stripe', monthly: 0, annual: 0, trialDays: 0, custom: true,
    blurb: 'Athletic departments, multi-location & 150+. White-label branding, SSO, API, white-glove onboarding.' },
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
// checkout — the buyer saves 30% on consumer plans (two months on pro/org), the business gets
// cash up front and roughly half the churn surface. These helpers keep every cadence-dependent
// string in one tested place.

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
