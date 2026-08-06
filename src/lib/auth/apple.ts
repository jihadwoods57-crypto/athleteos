// OnStandard — Sign in with Apple seam.
//
// App Store Guideline 4.8 requires Sign in with Apple when an app offers email
// login. The native module (`expo-apple-authentication`) HAS shipped in the binary
// since 2026-07-18 — but the ENTITLEMENT is deliberately stripped at build time
// (plugins/withDeferredAppleSignIn.js) because the App Store provisioning profile
// doesn't carry the capability yet (build #19 failed code-signing on it).
//
// The 2026-08-05 fix: availability now follows `ios.usesAppleSignIn` in app config —
// the SAME flag that decides whether the entitlement ships — instead of mere module
// presence. Module-presence gating made the button render on a binary that could not
// sign in: `signInAsync` threw against the missing entitlement, the catch returned
// null, and the athlete got a silent dead button (the worst possible UX for a launch
// requirement). Now the config says what the binary can do, and the button tells the
// truth either way.
//
// To go live (founder, in this order): enable Sign in with Apple on the
// com.onstandard.app App ID + regenerate the App Store profile → set
// `ios.usesAppleSignIn: true` and remove `./plugins/withDeferredAppleSignIn` from
// app.json → configure the Apple provider in Supabase Auth (client ID
// com.onstandard.app) → new native build (entitlements are binary-level; no OTA can
// deliver this last step).
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
