// OnStandard — pure input validation (no React/RN imports).
// Used to gate onboarding "Continue" until required fields are sane. Deliberately
// permissive: we block obviously-incomplete input, not deliverability.

/** A name is valid once it has at least two non-whitespace characters. */
export function isValidName(name: string): boolean {
  return name.trim().length >= 2;
}

/** Pragmatic email check: a non-empty local part, a single @, and a dotted
 *  domain, with no internal whitespace. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** The account onboarding step is complete once both fields validate. */
export function accountStepValid(name: string, email: string): boolean {
  return isValidName(name) && isValidEmail(email);
}
