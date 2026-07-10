// OnStandard — Face ID / biometric app-unlock seam (gated, native-deferred; mirrors apple.ts).
// Real flow needs `expo-local-authentication` (native module), added by the founder at
// go-live. Until then: available=false (opt-in UI never shows), authenticate=true (the
// lock gate NEVER locks a user out when the module is absent or errors).
import { Platform } from 'react-native';

export const isBiometricsAvailable: boolean = (() => {
  if (Platform?.OS === 'web') return false;
  try {
    require.resolve('expo-local-authentication');
    return true;
  } catch {
    return false;
  }
})();

/** Hardware present AND biometrics enrolled — drives whether the opt-in sheet shows. */
export async function biometricsUsable(): Promise<boolean> {
  if (!isBiometricsAvailable) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LA = require('expo-local-authentication');
    return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Prompt Face ID / Touch ID. Fail-open: absence or errors return true (never lock out). */
export async function authenticateBiometric(): Promise<boolean> {
  if (!isBiometricsAvailable) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LA = require('expo-local-authentication');
    if (!(await LA.hasHardwareAsync()) || !(await LA.isEnrolledAsync())) return true;
    const r = await LA.authenticateAsync({ promptMessage: 'Unlock OnStandard' });
    return !!r.success;
  } catch {
    return true;
  }
}
