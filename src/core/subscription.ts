// OnStandard — subscription / entitlement model (pure TS, no RN imports).
//
// INERT SEAM. OnStandard is in free preview; there is no payment SDK wired. This is
// the deterministic entitlement model the app reads so that, when monetization turns
// on, only the data source changes — not every call site. Designed around the chosen
// model: the COACH / ORG pays per athlete (B2B per-seat, most likely Stripe so it
// sidesteps Apple's IAP cut); athletes inherit access under their coach's plan.
//
// The entitlement defaults to `preview`, so with no backend every account reads
// exactly as today ("Free preview"). A Stripe webhook flips a `subscriptions` row at
// go-live; the app reads it (db.fetchEntitlement, gated) into this model and the gates
// below decide what's unlocked. Nothing here charges anyone.
import type { Flow } from './types';

/** preview = free beta; team = a paid coach/org plan. */
export type PlanTier = 'preview' | 'team';
/** Lifecycle of a paid plan (preview accounts are simply 'preview'). */
export type PlanStatus = 'preview' | 'active' | 'past_due' | 'canceled';

export interface Entitlement {
  tier: PlanTier;
  status: PlanStatus;
  /** Paid athlete seats on the plan (team tier only). */
  seats?: number;
  /** Seats currently consumed, for the "X of N seats" line. */
  seatsUsed?: number;
  /** ISO date the current period renews / ends, when active. */
  renewsAt?: string | null;
}

/** The default for every account until a real subscription is read in. */
export function previewEntitlement(): Entitlement {
  return { tier: 'preview', status: 'preview' };
}

/** The minimal slice of a `subscriptions` row this model reads. A SubscriptionRow
 *  (lib/supabase) satisfies it structurally, so core never imports the lib type. */
export interface SubscriptionLike {
  tier: string | null;
  status: string | null;
  seats: number | null;
  seats_used: number | null;
  current_period_end: string | null;
}

/** Project a stored subscription row into the entitlement model. Null/garbage rows
 *  fall back to free preview (fail-safe — never accidentally grant paid access). */
export function entitlementFromRow(row?: SubscriptionLike | null): Entitlement {
  if (!row || row.tier !== 'team') return previewEntitlement();
  return normalizeEntitlement({
    tier: 'team',
    status: (row.status ?? 'preview') as PlanStatus,
    seats: row.seats ?? undefined,
    seatsUsed: row.seats_used ?? undefined,
    renewsAt: row.current_period_end ?? null,
  });
}

/** Normalize a possibly-partial/older persisted value back to a valid entitlement. */
export function normalizeEntitlement(e?: Partial<Entitlement> | null): Entitlement {
  if (!e || (e.tier !== 'team' && e.tier !== 'preview')) return previewEntitlement();
  const status: PlanStatus =
    e.status === 'active' || e.status === 'past_due' || e.status === 'canceled' ? e.status : 'preview';
  return { tier: e.tier, status, seats: e.seats, seatsUsed: e.seatsUsed, renewsAt: e.renewsAt ?? null };
}

/** Whether paid features are unlocked. A team plan unlocks while active OR past_due
 *  (a grace window — don't lock a coach out the instant a card fails); canceled and
 *  preview do not. The single gate the app should check, mirroring isBackendLive. */
export function isPro(e: Entitlement): boolean {
  return e.tier === 'team' && (e.status === 'active' || e.status === 'past_due');
}

// ---------------------------------------------------------------- feature entitlements
// The single gate every paid-only feature should check (memo D4 / doc 11 future-proofing
// #3): generalize isPro() into hasFeature(entitlement, key). The tier->feature map below
// is the DEFAULT catalog; at go-live it becomes pricing-catalog DATA (so prices, bundles,
// and limits change without an app build). NOTHING is wired to a screen in Phase A — this
// is the seam only; the beta stays all-features-on until the catalog says otherwise.

/** Features the app may gate behind a plan. */
export type FeatureKey =
  | 'dev_score' | 'meal_analysis' | 'daily_game_plan'        // the core loop — free tier
  | 'ai_coach' | 'restaurant_intel' | 'weekly_insights'      // individual+ value
  | 'client_dashboard' | 'accountability_engine' | 'reports' | 'groups'; // professional/program

export const FEATURE_KEYS: readonly FeatureKey[] = [
  'dev_score', 'meal_analysis', 'daily_game_plan',
  'ai_coach', 'restaurant_intel', 'weekly_insights',
  'client_dashboard', 'accountability_engine', 'reports', 'groups',
];

// Default entitlement catalog. `preview` keeps the core loop free; `team` unlocks
// everything. (Today's beta policy is effectively all-on; the live catalog overrides
// this map.) A team plan that lapses (canceled) falls back to the free set.
const FEATURES_BY_TIER: Record<PlanTier, ReadonlySet<FeatureKey>> = {
  preview: new Set<FeatureKey>(['dev_score', 'meal_analysis', 'daily_game_plan']),
  team: new Set<FeatureKey>(FEATURE_KEYS),
};

/** The tier whose features are actually in force (a canceled team plan reverts to free). */
function effectiveTier(e: Entitlement): PlanTier {
  return isPro(e) ? 'team' : 'preview';
}

/** The single feature gate. Replaces ad-hoc isPro() checks at call sites so the eventual
 *  paywall is a catalog/data change, never a code hunt. */
export function hasFeature(e: Entitlement, key: FeatureKey): boolean {
  return FEATURES_BY_TIER[effectiveTier(e)].has(key);
}

/** The full set a given entitlement unlocks (for surfacing "what's included"). */
export function entitlementFeatures(e: Entitlement): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => hasFeature(e, k));
}

/** Short status label for chips/headers. */
export function planLabel(e: Entitlement): string {
  if (e.tier !== 'team') return 'Free preview';
  switch (e.status) {
    case 'active': return 'Team plan';
    case 'past_due': return 'Team · payment due';
    case 'canceled': return 'Team · canceled';
    default: return 'Free preview';
  }
}

export interface BillingRowCopy {
  hint: string;
  detail: string;
}

/**
 * Copy for the Account "Billing & plan" row, derived from the real entitlement and
 * the viewer's flow. Preview is byte-identical to the prior static row. A coach/org
 * on a paid plan sees seat usage + a manage-billing pointer; an athlete/parent sees
 * that their access rides their coach's plan (they never pay in this model).
 */
export function billingRowCopy(e: Entitlement, flow: Flow): BillingRowCopy {
  const overseer = flow === 'coach' || flow === 'trainer';
  if (e.tier !== 'team') {
    return {
      hint: 'Free preview',
      detail: overseer
        ? 'OnStandard is in free preview, so your whole roster is free while we run the beta. Paid team plans (billed per athlete) arrive at launch.'
        : 'OnStandard is in free preview. There is no billing on this account yet.',
    };
  }
  if (!overseer) {
    return { hint: 'Team plan', detail: "Your access is covered by your coach's team plan. There's nothing to pay." };
  }
  const seatLine = e.seats != null ? `${e.seatsUsed ?? 0} of ${e.seats} athlete seats in use. ` : '';
  const renew = e.renewsAt ? `Renews ${e.renewsAt}. ` : '';
  const seatHint = e.seats != null ? `Team · ${e.seats} seats` : 'Team plan';
  switch (e.status) {
    case 'active':
      return { hint: seatHint, detail: `${seatLine}${renew}Manage billing or change seats from your account portal.` };
    case 'past_due':
      return { hint: 'Payment due', detail: `${seatLine}Your last payment did not go through, so update billing to keep your team's access.` };
    case 'canceled':
      return { hint: 'Canceled', detail: `${seatLine}Your team plan is canceled. Reactivate any time to restore paid features.` };
    default:
      return { hint: 'Free preview', detail: 'OnStandard is in free preview.' };
  }
}
