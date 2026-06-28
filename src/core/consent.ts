// AthleteOS — real-data consent gate (pure TS, no RN imports).
// Before the live backend collects an athlete's real body-weight / meal data,
// consent must be in place — and for a minor (under 18) that consent is required,
// not optional. This is the deterministic guard the go-live data path checks so it
// can never push a minor's real data without a recorded consent. Fails closed.

import type { GuardianStatus } from './guardianConsent';

export interface ConsentContext {
  /** Whether the data backend is live (EXPO_PUBLIC_BACKEND_LIVE). */
  backendLive: boolean;
  /** Account role; only athletes generate the sensitive health data. */
  role: string;
  /** Athlete age in years, when known. */
  age?: number | null;
  /** Whether the athlete (or guardian, for a minor) granted data-sharing consent. */
  consentGiven: boolean;
  /** For a minor, the guardian-verification state. Absent is treated as 'none' (fail-safe):
   *  a minor's real data only leaves the device once a guardian is 'verified'. */
  guardianStatus?: GuardianStatus;
  /** Athlete pressed "Pause all sharing" (Profile data-sharing controls). While true
   *  nothing leaves the device, regardless of consent — honors "stop sharing at any
   *  time". Absent/false = not paused (unchanged behaviour). */
  sharingPaused?: boolean;
}

export type ConsentReason =
  | 'backend-off'
  | 'minor-consent-required'
  | 'minor-guardian-unverified'
  | 'consent-required'
  | 'sharing-paused'
  | 'ok';

/** True for a known age under 18. Unknown age is treated as a minor (fail-safe). */
export function isMinor(age?: number | null): boolean {
  return age == null || age < 18;
}

/**
 * Whether the live backend may collect this user's REAL data. Fails closed:
 *  - backend off  -> never (local-only; nothing leaves the device);
 *  - a minor athlete without recorded consent -> blocked (the hard gate);
 *  - a minor athlete whose guardian is not 'verified' -> blocked (a self-tapped
 *    checkbox is not verifiable consent; COPPA requires a verified guardian);
 *  - any athlete without consent -> blocked;
 *  - otherwise ok.
 * Non-athlete roles (coach / parent / trainer) generate no athlete health data,
 * so they are not gated here.
 */
export function realDataConsent(c: ConsentContext): { ok: boolean; reason: ConsentReason } {
  if (!c.backendLive) return { ok: false, reason: 'backend-off' };
  if (c.role !== 'athlete') return { ok: true, reason: 'ok' };
  // Athlete paused sharing — block every push regardless of consent (revocable
  // control; flipping it back on resumes syncing).
  if (c.sharingPaused) return { ok: false, reason: 'sharing-paused' };
  if (!c.consentGiven) {
    return { ok: false, reason: isMinor(c.age) ? 'minor-consent-required' : 'consent-required' };
  }
  // A minor's real data stays on-device until a guardian has VERIFIABLY approved —
  // a self-tapped checkbox is not verifiable consent (COPPA). Fails closed: an
  // absent or non-'verified' status blocks the push, so local-only activation is safe.
  if (isMinor(c.age) && c.guardianStatus !== 'verified') {
    return { ok: false, reason: 'minor-guardian-unverified' };
  }
  return { ok: true, reason: 'ok' };
}

/** Plain-language line for the consent screen, honest about what linking shares AND
 *  that meal photos are analyzed by a third-party AI (Anthropic) — a disclosure App
 *  Store + privacy law require before that data leaves the device. */
export function consentSummary(isMinorAthlete: boolean): string {
  const who = isMinorAthlete ? 'You and a parent or guardian' : 'You';
  return `${who} control what is shared. Linking lets your coach see your daily score, ` +
    `compliance, and weight trend. Meal photos you log are analyzed by a third-party AI ` +
    `(Anthropic) to estimate nutrition. You can stop sharing at any time.`;
}
