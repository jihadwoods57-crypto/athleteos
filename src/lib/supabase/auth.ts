// OnStandard — auth wrappers (inert until configured).
// Thin, typed wrappers over supabase.auth so screens never import the raw client.
// Each returns a discriminated result instead of throwing, so the mock sign-in
// flow can adopt them incrementally without try/catch noise.
import { isSupabaseConfigured, requireSupabase } from './client';

export type AuthResult =
  | { ok: true; userId: string; needsConfirmation?: boolean }
  | { ok: false; error: string };

/** Email/password sign-in. `notConfigured` lets the caller fall back to mock auth. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'notConfigured' };
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, error: error?.message ?? 'Sign-in failed' };
  return { ok: true, userId: data.user.id };
}

/** Create an account. `full_name` is stored in user metadata; the DB trigger
 *  `handle_new_user` copies it into `profiles` on insert. */
export async function signUp(
  email: string,
  password: string,
  fullName?: string,
): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'notConfigured' };
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: { data: fullName ? { full_name: fullName } : undefined },
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? 'Sign-up failed' };
  // With email-confirmation ON, Supabase returns the user but NO session until the link is
  // clicked. `!data.session` is the honest "we actually need them to confirm" signal, so the UI
  // only claims a link was sent when one truly was (and confirm-OFF skips that copy).
  return { ok: true, userId: data.user.id, needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await requireSupabase().auth.signOut();
}

/** Send a password-reset email. `notConfigured` lets the caller show the same
 *  neutral "if an account exists, we sent a link" copy without a backend. */
export async function resetPassword(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'notConfigured' };
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim());
  if (error) return { ok: false, error: error.message };
  // No userId on a reset request; the union still needs the field.
  return { ok: true, userId: '' };
}

/**
 * Exchange an Apple identity token for a Supabase session (App Store requires Sign
 * in with Apple when you offer email login). The token comes from
 * `expo-apple-authentication`, which needs the Apple Sign-In entitlement + a
 * Services ID configured in app.json + the Apple Developer portal — set up on the
 * founder's machine at go-live; it cannot be wired or runtime-verified here. The
 * button that obtains the token is gated to iOS + isBackendLive. Inert until then.
 */
export async function signInWithAppleToken(identityToken: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'notConfigured' };
  const { data, error } = await requireSupabase().auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? 'Apple sign-in failed' };
  return { ok: true, userId: data.user.id };
}

/** Current signed-in user id, or null (also null when unconfigured). */
export async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await requireSupabase().auth.getUser();
  return data.user?.id ?? null;
}
