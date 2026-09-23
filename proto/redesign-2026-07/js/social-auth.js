/* Sign in with Apple / Google, shared by the Sign-in screen and every onboarding account step
 * (review pass 2026-09-23: G-R5, A-B5, G-P4, G-R4).
 *
 * Three rules live here so the two screens cannot drift:
 *   1. Guideline 4.8. The social block shows only when Sign in with Apple is available, and
 *      Google only alongside it. The two used to be gated separately, so a phone whose Google
 *      seam was up and Apple's was not showed Google alone.
 *   2. Apple's button looks like Apple's (HIG): the Apple glyph, black on light, white on dark.
 *   3. Sign in with Apple hands back the one-time authorization code too. The server exchanges
 *      it for a refresh token (apple-token), which is what lets account deletion revoke the
 *      Apple sign-in (delete-account). Best effort: a failed exchange never blocks sign-in.
 *
 * No import from state.js; callers pass what they need.
 */

export const APPLE_GLYPH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.4-2.85 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13zM14.6 4.5c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-3 1.54-.66.76-1.24 1.98-1.08 3.15 1.14.09 2.31-.58 3.02-1.44z"/></svg>';
export const GOOGLE_GLYPH = '<svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>';

/** The rule for which buttons show, pure: Apple is required for Google (Guideline 4.8). */
export function socialButtons({ apple = false, google = false } = {}) {
  return { apple: !!apple, google: !!apple && !!google };
}

/* A NEW identity (review I2). profiles.primary_role is NOT NULL DEFAULT 'athlete' and
   handle_new_user fills it, so it can never tell a brand-new Apple/Google account from a real
   athlete. What does: onboarding is the only thing that stamps profiles.tos_accepted_at
   (state.js _stampConsent, every role's flow), and Supabase creates the auth user inside the very
   signInWithIdToken call, so its created_at is seconds old. Both together = never onboarded. */
export const NEW_IDENTITY_MS = 10 * 60 * 1000;

/** Created within the last few minutes. Pure. */
export function isFreshUser(user, nowMs = Date.now()) {
  const t = Date.parse((user && user.created_at) || '');
  return Number.isFinite(t) && nowMs - t >= -60000 && nowMs - t < NEW_IDENTITY_MS;
}

/** Never onboarded: no terms accepted AND the account was made just now. Pure. */
export function isNewIdentity(user, prof, nowMs = Date.now()) {
  if (prof && prof.tos_accepted_at) return false;
  return isFreshUser(user, nowMs);
}

/** The profile facts both screens decide from. { known:false } when the read failed. */
export async function readIdentity(userId) {
  try {
    const { data, error } = await window.sb.from('profiles').select('primary_role,tos_accepted_at').eq('id', userId).maybeSingle();
    if (error) return { known: false, prof: null };
    return { known: true, prof: data || null };
  } catch { return { known: false, prof: null }; }
}

/**
 * The onboarding account step's decision for a social identity (pure, tested).
 *   'adopt'  a new or never-onboarded account of THIS flow's role: take the chosen role and save
 *            the onboarding (onSession).
 *   'route'  an account that is already someone: go to its own home, never re-roled.
 * A never-onboarded OLD account whose role differs from this flow is routed, not converted, so a
 * coach can never be turned into an athlete (or the reverse) by tapping Apple on the wrong flow.
 */
export function accountStepDecision({ user, prof, role, nowMs = Date.now() }) {
  if (prof && prof.tos_accepted_at) return 'route';
  if (isFreshUser(user, nowMs)) return 'adopt';
  return prof && prof.primary_role && prof.primary_role !== role ? 'route' : 'adopt';
}

/** Ask the native shell what it offers, then apply the rule. Never throws. */
export async function socialAvailability() {
  const N = typeof window !== 'undefined' ? window.OnStandardNative : null;
  const ask = async (k) => {
    try { return !!(N && N[k] && typeof N[k].available === 'function' && await N[k].available()); } catch { return false; }
  };
  return socialButtons({ apple: await ask('apple'), google: await ask('google') });
}

/** The two buttons' markup, HIG style for Apple. `idPrefix` keeps ids unique per screen. */
export function socialButtonHtml(provider, idPrefix = 'sso') {
  return provider === 'apple'
    ? `<button type="button" class="btn sso-apple" id="${idPrefix}-apple"><span class="sso-ic">${APPLE_GLYPH}</span><span>Continue with Apple</span></button>`
    : `<button type="button" class="btn ghost sso-google" id="${idPrefix}-google"><span class="sso-ic">${GOOGLE_GLYPH}</span><span>Continue with Google</span></button>`;
}

/**
 * Run the native sign-in and exchange its token for a Supabase session. Resolves
 * { user } on success, { cancelled: true } when the person backed out, or { error }.
 * For Apple, the authorization code (when the shell can hand it over) goes to apple-token after
 * the session exists, so deletion can later revoke it.
 */
export async function socialSignIn(provider) {
  const N = typeof window !== 'undefined' ? window.OnStandardNative : null;
  const sb = typeof window !== 'undefined' ? window.sb : null;
  const native = N && N[provider];
  if (!native || !sb) return { error: 'unavailable' };
  let token = null;
  let code = null;
  try {
    if (provider === 'apple' && typeof native.credential === 'function') {
      const c = await native.credential();
      token = c && c.identityToken ? c.identityToken : null;
      code = c && c.authorizationCode ? c.authorizationCode : null;
    } else {
      token = await native.signIn();
    }
  } catch { return { error: 'failed' }; }
  if (!token) return { cancelled: true };
  try {
    const { data, error } = await sb.auth.signInWithIdToken({ provider, token });
    if (error || !data || !data.user) return { error: 'failed' };
    if (code) {
      // Fire and forget: sign-in never waits on, or fails because of, the token exchange.
      try { void sb.functions.invoke('apple-token', { body: { authorizationCode: code } }).catch(() => {}); } catch { /* best effort */ }
    }
    return { user: data.user };
  } catch { return { error: 'failed' }; }
}
