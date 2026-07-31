// OnStandard — Founding 50: making the landing page's promise enforceable.
//
// THE PROMISE (web/landing/index.html, hero + story + pricing fine print)
//   "the first 50 coaches and facilities lock today's price permanently — including the $10/month
//    per active client beyond a plan's limit. A later price rise never touches them."
//
// The copy also said "free through the beta" until 2026-07-30. That clause is RETIRED (founder
// decision; see docs/go-live/FOUNDING-50.md and web/landing-src/fix-founding-free.py) — it was
// never implemented, it contradicted a claim path that requires a paid checkout, and free access
// for the most engaged cohort on the platform is the retired 50%-off offer made worse. Founding
// members get the standard 14-day trial and then pay; the lock is the whole offer.
//
// Until now that had NO implementation anywhere: no counter, no record of who claimed it, and
// nothing stopping customer #51 — or #500 — from being told they were founding. It would have been
// honored by hand in the Stripe dashboard, from memory, which is not a thing you can promise
// "permanently" and mean.
//
// HOW A PERMANENT LOCK ACTUALLY WORKS HERE
// Prices are not in this codebase. They live in Stripe as Price objects, resolved by lookup_key
// (`pro_solo_monthly`), which is what lets the founder change a price without a deploy. So a lock
// cannot be "remember 99 dollars" — it has to be "keep resolving to the Price object that existed
// when you joined".
//
// That is a GENERATION. Today everyone is on the base generation (empty string, keys unsuffixed).
// When prices rise, the founder creates new Prices suffixed with the new generation
// (`pro_solo_monthly_v2`) and sets PRICE_GENERATION=v2. New buyers resolve to v2; a founding member
// keeps resolving to the generation stored on their row, forever, with no coupon arithmetic and no
// migration of anyone's subscription.
//
// Pure. No I/O — the caller supplies the founding row.

/** The promise says fifty. It is enforced in the database, not here (see 0161). */
export const FOUNDING_CAP = 50;

export type Cadence = 'monthly' | 'annual';

/** What the DB knows about a buyer's founding status. */
export interface FoundingLock {
  /** The price generation this member is pinned to, forever. '' is the launch generation. */
  lockedGeneration: string;
  /** Cents per active client beyond the plan's seat limit, locked at claim time. */
  lockedExtraSeatCents: number;
}

/**
 * The Stripe Price lookup_key for a plan + cadence in a given generation.
 * The base generation is unsuffixed, so every Price that exists today keeps working untouched.
 */
export function generationalLookupKey(planId: string, cadence: Cadence, generation: string): string {
  const g = normalizeGeneration(generation);
  return g ? `${planId}_${cadence}_${g}` : `${planId}_${cadence}`;
}

/** Generations are short slugs. Anything else is treated as the base generation rather than
 *  being interpolated into a lookup_key, which would silently resolve to no Price at all. */
export function normalizeGeneration(g: string | null | undefined): string {
  if (!g) return '';
  const s = String(g).trim().toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(s) ? s : '';
}

/**
 * Which generation a buyer pays at. A founding member's locked generation always wins — that IS
 * the promise. Everyone else gets the current one.
 */
export function generationFor(lock: FoundingLock | null, currentGeneration: string): string {
  if (lock) return normalizeGeneration(lock.lockedGeneration);
  return normalizeGeneration(currentGeneration);
}

/**
 * Cents per seat beyond the plan limit. Locked for founding members, which the landing page
 * promises explicitly ("including the $10/month per active client beyond a plan's limit") and
 * which is the part a hand-managed lock would most easily forget.
 */
export function extraSeatCentsFor(lock: FoundingLock | null, currentCents: number): number {
  const cur = Number.isFinite(currentCents) && currentCents >= 0 ? Math.floor(currentCents) : 0;
  if (!lock) return cur;
  const locked = Number(lock.lockedExtraSeatCents);
  return Number.isFinite(locked) && locked >= 0 ? Math.floor(locked) : cur;
}

/** True when a founding claim is still available. Advisory only — the cap is enforced atomically
 *  in claim_founding_slot() so two simultaneous claims can never both take slot 50. */
export function slotsRemaining(claimed: number): number {
  const n = Number.isFinite(claimed) && claimed > 0 ? Math.floor(claimed) : 0;
  return Math.max(0, FOUNDING_CAP - n);
}
