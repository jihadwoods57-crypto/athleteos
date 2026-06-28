// AthleteOS — Sign in with Apple seam (gated, native-deferred).
//
// App Store Guideline 4.8 requires Sign in with Apple when an app offers email
// login. The real flow needs `expo-apple-authentication` (a native module) plus the
// Apple Sign-In capability + a Services ID configured in app.json and the Apple
// Developer portal — all of which are set up on the founder's machine + Apple portal
// at go-live and CANNOT be installed or runtime-verified in this environment.
//
// So this module is a typed seam: `isAppleAuthAvailable` is false until the native
// module is present, and `requestAppleIdentityToken` returns null. The button that
// calls it (onboarding) renders only when the seam reports available AND the backend
// is live, so today it is inert and never crashes. When the founder adds the dep,
// swap the dynamic import block in and the button lights up — no caller changes.
import { Platform } from 'react-native';

/** True only when the native Apple-auth module is present and the platform supports
 *  it (iOS). False here (module not installed), so the button is hidden until go-live. */
export const isAppleAuthAvailable: boolean = (() => {
  if (Platform.OS !== 'ios') return false;
  try {
    // Present only once `expo-apple-authentication` is added to the project.
    require.resolve('expo-apple-authentication');
    return true;
  } catch {
    return false;
  }
})();

/**
 * Obtain an Apple identity token to exchange for a Supabase session
 * (auth.signInWithAppleToken). Returns null when the native module is absent, the
 * user cancels, or the request fails — the caller treats null as "not signed in"
 * and never crashes. Real implementation (enable at go-live):
 *
 *   import * as AppleAuthentication from 'expo-apple-authentication';
 *   const cred = await AppleAuthentication.signInAsync({
 *     requestedScopes: [
 *       AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
 *       AppleAuthentication.AppleAuthenticationScope.EMAIL,
 *     ],
 *   });
 *   return cred.identityToken ?? null;
 */
export async function requestAppleIdentityToken(): Promise<string | null> {
  if (!isAppleAuthAvailable) return null;
  return null; // replaced by the signInAsync block above once the dep is added
}
