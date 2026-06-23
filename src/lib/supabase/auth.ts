// AthleteOS — auth wrappers (inert until configured).
// Thin, typed wrappers over supabase.auth so screens never import the raw client.
// Each returns a discriminated result instead of throwing, so the mock sign-in
// flow can adopt them incrementally without try/catch noise.
import { isSupabaseConfigured, requireSupabase } from './client';

export type AuthResult =
  | { ok: true; userId: string }
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
  return { ok: true, userId: data.user.id };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await requireSupabase().auth.signOut();
}

/** Current signed-in user id, or null (also null when unconfigured). */
export async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await requireSupabase().auth.getUser();
  return data.user?.id ?? null;
}
