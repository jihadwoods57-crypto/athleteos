// OnStandard — Sign in with Google seam (gated, native-deferred; mirrors apple.ts).
//
// The real flow needs @react-native-google-signin/google-signin (native module) plus Google
// Cloud OAuth client IDs: a WEB client ID (the ID-token audience Supabase validates) and an
// iOS client ID (whose reversed value also goes in app.json as the plugin `iosUrlScheme`).
// Those are created in the founder's Google Cloud Console at go-live and supplied per build via
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID / EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (eas.json env).
//
// Gated like apple.ts: available only when the module is present, the platform is native, AND
// the web client ID is configured. requestGoogleIdToken returns null on absence/cancel/failure,
// so the caller treats null as "not signed in" and never crashes.
import { Platform } from 'react-native';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export const isGoogleAuthAvailable: boolean = (() => {
  if (Platform?.OS === 'web') return false;
  if (!WEB_CLIENT_ID) return false; // not configured until the Cloud Console client IDs exist
  try {
    require.resolve('@react-native-google-signin/google-signin');
    return true;
  } catch {
    return false;
  }
})();

let configured = false;
function ensureConfigured(GoogleSignin: { configure: (o: unknown) => void }): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    offlineAccess: false,
  });
  configured = true;
}

/**
 * Native Google Sign-In → a Google ID token to exchange for a Supabase session
 * (auth.signInWithIdToken 'google'). Returns null when the module is absent, the user cancels,
 * or the request fails. Handles both the v13+ ({ data: { idToken } }) and older ({ idToken })
 * response shapes.
 */
export async function requestGoogleIdToken(): Promise<string | null> {
  if (!isGoogleAuthAvailable) return null;
  try {
    // Lazy require (mirrors apple.ts / biometrics.ts): touch the native module only after the gate.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    ensureConfigured(GoogleSignin);
    if (typeof GoogleSignin.hasPlayServices === 'function') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
    }
    const res: { data?: { idToken?: string | null }; idToken?: string | null } = await GoogleSignin.signIn();
    return res?.data?.idToken ?? res?.idToken ?? null;
  } catch {
    // ERR_SIGN_IN_CANCELLED or any failure → "not signed in".
    return null;
  }
}
