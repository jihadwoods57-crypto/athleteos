// OnStandard — credential validation (pure TS, no RN imports).
// Drives inline field errors on the sign-up / sign-in / reset screens so the rules
// live in one tested place, not scattered across the UI. Mirrors the minimum
// Supabase auth enforces server-side (email shape; password length) plus a friendly
// strength floor, surfaced before the network round-trip. Email shape reuses the
// single isValidEmail in validate.ts.
import { isValidEmail } from './validate';

export interface PasswordCheck {
  ok: boolean;
  /** A short, user-facing reason when not ok (empty string when ok). */
  reason: string;
}

/** Password floor: at least 8 chars with a letter AND a number. Kept modest so it
 *  never blocks a real user, but enough to reject the obvious weak cases. */
export function checkPassword(password: string): PasswordCheck {
  if (password.length < 8) return { ok: false, reason: 'Use at least 8 characters.' };
  if (!/[A-Za-z]/.test(password)) return { ok: false, reason: 'Include at least one letter.' };
  if (!/[0-9]/.test(password)) return { ok: false, reason: 'Include at least one number.' };
  return { ok: true, reason: '' };
}

export interface CredentialError {
  email?: string;
  password?: string;
  confirm?: string;
}

/**
 * Validate a full sign-up form (email + password + optional confirm). Returns a
 * field-keyed error map; an empty map means the form is submittable. `confirm` is
 * only checked when provided (sign-in omits it).
 */
export function validateCredentials(email: string, password: string, confirm?: string): CredentialError {
  const errors: CredentialError = {};
  if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  const pw = checkPassword(password);
  if (!pw.ok) errors.password = pw.reason;
  if (confirm !== undefined && confirm !== password) errors.confirm = 'Passwords do not match.';
  return errors;
}

/** True when the form has no field errors — convenience for disabling a submit button. */
export function credentialsOk(errors: CredentialError): boolean {
  return !errors.email && !errors.password && !errors.confirm;
}
