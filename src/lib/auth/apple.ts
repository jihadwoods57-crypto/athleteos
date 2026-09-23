// OnStandard — Sign in with Apple seam.
//
// App Store Guideline 4.8 requires Sign in with Apple when an app offers another social login.
// Sign in with Apple is LIVE: `ios.usesAppleSignIn: true` in app.json, the
// com.apple.developer.applesignin entitlement ships in the binary, and the Apple provider is
// configured in Supabase Auth (client id com.onstandard.app). The old deferral plugin
// (plugins/withDeferredAppleSignIn.js) is deleted; nothing referenced it any more.
//
// Availability follows `ios.usesAppleSignIn` (the same flag that decides whether the entitlement
// ships) AND the module resolving, then `isAvailableAsync()` on the device. Module presence alone
// once rendered a button on a binary that could not sign in (2026-08-05).
//
// Account deletion must revoke the Apple sign-in (Apple's account-deletion rule, 5.1.1(v)). That
// needs a refresh token, which only the one-time authorizationCode can buy, so
// requestAppleCredential() hands the code back alongside the identity token; the proto sends it to
// the apple-token edge function after sign-in, and delete-account revokes it (G-R4, 2026-09-23).
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** True only when this build declares Apple Sign-In (config flag ⇒ entitlement present)
 *  AND the native module resolves. */
export const isAppleAuthAvailable: boolean = (() => {
  if (Platform?.OS !== 'ios') return false;
  if (Constants.expoConfig?.ios?.usesAppleSignIn !== true) return false;
  try {
    require.resolve('expo-apple-authentication');
    return true;
  } catch {
    return false;
  }
})();

/**
 * The identity token AND the one-time authorization code. The code is what the server exchanges
 * for a refresh token (apple-token), so account deletion can revoke the Apple sign-in. Null when
 * unavailable, cancelled or failed; `authorizationCode` may be null on its own.
 */
export async function requestAppleCredential(): Promise<{ identityToken: string; authorizationCode: string | null } | null> {
  if (!isAppleAuthAvailable) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AppleAuthentication = require('expo-apple-authentication');
    if (!(await AppleAuthentication.isAvailableAsync())) return null;
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!cred || !cred.identityToken) return null;
    return { identityToken: cred.identityToken, authorizationCode: cred.authorizationCode ?? null };
  } catch {
    return null;
  }
}

/**
 * Obtain an Apple identity token to exchange for a Supabase session
 * (signInWithIdToken in the proto's signin.js). Returns null when unavailable, the
 * user cancels, or the request fails — the caller treats null as "not signed in"
 * and never crashes.
 */
export async function requestAppleIdentityToken(): Promise<string | null> {
  if (!isAppleAuthAvailable) return null;
  try {
    // Lazy require (mirrors biometrics.ts) so the native-only module is touched only on iOS,
    // after the isAppleAuthAvailable gate.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AppleAuthentication = require('expo-apple-authentication');
    // Belt over the config gate's braces: an OTA that flips the flag can still land on an old
    // binary whose entitlement never shipped. isAvailableAsync is the device's own answer.
    if (!(await AppleAuthentication.isAvailableAsync())) return null;
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    return cred.identityToken ?? null;
  } catch {
    // User canceled (ERR_REQUEST_CANCELED) or the request failed → treat as "not signed in".
    return null;
  }
}
