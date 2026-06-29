// AthleteOS — verifiable guardian-consent model for MINORS (pure TS, no RN imports).
//
// A minor's (under-18) personal data may not be collected for backend use until a guardian has
// VERIFIABLY consented. A self-tapped checkbox is not verifiable. This protects minors' health
// data and satisfies app-store policy for apps used by minors; it is NOT COPPA. COPPA governs
// children under 13, and the app bars under-13 signup by construction (MIN_SIGNUP_AGE), so COPPA
// is out of scope. This is the client-side state machine + gate; the actual verification (a link
// emailed to the guardian, confirmed by the chosen consent vendor) is a backend + vendor step.
// Until a guardian is 'verified', the consent gate (consent.ts) keeps a minor's real data
// on-device only.

export type GuardianStatus = 'none' | 'pending' | 'verified';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A syntactically valid guardian email (real deliverability is verified server-side). */
export function isValidGuardianEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Treats unknown age as a minor (fail-safe), mirroring consent.ts:isMinor. */
function isMinorAge(age?: number | null): boolean {
  return age == null || age < 18;
}

/**
 * Whether this athlete still needs VERIFIED guardian consent before any real data may be
 * collected. True for a minor whose guardian is not yet 'verified'; false for adults and
 * for minors with a verified guardian. This is the gate the backend-sync path must honor.
 */
export function guardianConsentRequired(age: number | null | undefined, status: GuardianStatus): boolean {
  return isMinorAge(age) && status !== 'verified';
}

/**
 * Reduce the athlete's server-side guardian-consent rows to a single client status. An athlete
 * may have asked more than one guardian, so the rule is most-approving-wins: ANY 'verified' row
 * means the minor is cleared ('verified'); else any still-open request means 'pending'; anything
 * else (no rows, only 'revoked') means 'none'. Server-owned: a client never derives 'verified'
 * from anything but a real 'verified' row the backend wrote. Fail-safe by construction — an
 * unknown/garbage status is ignored, so it can only ever keep a minor MORE gated, never less.
 */
export function guardianStatusFromRequests(rows: { status: string }[]): GuardianStatus {
  if (rows.some((r) => r.status === 'verified')) return 'verified';
  if (rows.some((r) => r.status === 'pending')) return 'pending';
  return 'none';
}

/** Honest one-line status copy for the guardian-consent UI. */
export function guardianConsentCopy(status: GuardianStatus): string {
  switch (status) {
    case 'verified':
      return 'A parent or guardian has approved this account.';
    case 'pending':
      return 'We sent your parent or guardian an approval request. Your data stays on this device until they confirm.';
    default:
      return 'A parent or guardian must approve before your data can be shared with a coach.';
  }
}
