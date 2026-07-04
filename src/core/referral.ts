// OnStandard — referral loop (pure TS, no RN imports).
//
// Give a month, get a month. Every account owns a short share code; a new trainer/org who
// checks out with it gets one free month (applied at Stripe Checkout), and the referrer earns
// one free month back (applied to their subscription by the stripe-webhook). This module is
// the PURE half: code shape, share copy, and the earned-months read model the Profile screen
// renders. Persistence is the 0042 tables; the reward itself happens in Stripe — the app never
// grants anything client-side.

/** Referral codes are 8 chars from an unambiguous alphabet (no 0/O/1/I/L) — easy to read
 *  aloud across a gym floor, matching the 0026 vanity-code discipline. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

/** Server-side rule from 0042: 6-12 chars, A-Z/0-9. Client validates before sending. */
export function isValidReferralCode(code: string): boolean {
  return /^[A-Z0-9]{6,12}$/.test(code);
}

/** Generate a fresh share code. `rand` is injectable for tests (defaults to Math.random). */
export function generateReferralCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return out;
}

/** Normalize user input of a code (paste/typing): uppercase, strip spaces and dashes. */
export function normalizeReferralCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '').trim();
}

export interface RedemptionLike {
  status: string;
  rewarded_at?: string | null;
}

export interface ReferralSummary {
  /** People who joined on this code (any status). */
  joined: number;
  /** Free months already applied to the referrer's billing. */
  monthsEarned: number;
  /** Referrals recorded but not yet rewarded (e.g. referrer has no live plan yet). */
  pending: number;
  /** One honest line for the Profile row. */
  line: string;
}

/** The read model for "your referrals" — counts only what the server recorded. */
export function referralSummary(redemptions: RedemptionLike[]): ReferralSummary {
  const joined = redemptions.length;
  const monthsEarned = redemptions.filter((r) => r.status === 'rewarded').length;
  const pending = redemptions.filter((r) => r.status === 'pending').length;
  let line: string;
  if (joined === 0) {
    line = 'Share your code. When someone subscribes with it, you both get a free month.';
  } else {
    const parts = [`${joined} ${joined === 1 ? 'person' : 'people'} joined on your code`];
    if (monthsEarned > 0) parts.push(`${monthsEarned} free ${monthsEarned === 1 ? 'month' : 'months'} earned`);
    if (pending > 0) parts.push(`${pending} pending`);
    line = parts.join(' · ') + '.';
  }
  return { joined, monthsEarned, pending, line };
}

/** The share-sheet message. Plain, honest, no hype. */
export function referralShareMessage(code: string): string {
  return `I use OnStandard to keep my athletes accountable. Use my code ${code} when you subscribe and we both get a free month. https://onstandard.app`;
}
