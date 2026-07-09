// OnStandard — one shared, stakes-honest sign-out confirmation.
//
// Sign-out resets local state to a fresh install. For a user whose data lives ONLY on this device
// (not signed in, or no sync consent — including a minor with an unverified guardian) that is an
// IRREVERSIBLE erase of their whole record. Delete-account confirms; a one-tap sign-out must too.
//
// Both the Profile and the Account sign-out buttons call THIS helper so the confirmation and its
// honest wording can never drift apart again (the Profile copy had lost its confirm entirely and
// erased local-only data on a single tap).
import { Alert } from 'react-native';
import { haptics } from '@/ui/haptics';

/** The store fields the confirmation reads. */
export interface SignOutConfirmable {
  userId?: string | null;
  realDataConsent?: boolean;
  signOut: () => void;
}

export interface ConfirmButton {
  text: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
}
export type AlertFn = (title: string, message: string, buttons: ConfirmButton[]) => void;

/** True when this device holds the only copy of the user's data, so sign-out is irreversible. */
export function isLocalOnly(s: SignOutConfirmable): boolean {
  return !s.userId || !s.realDataConsent;
}

/** The honest stakes shown in the confirmation body. */
export function signOutMessage(localOnly: boolean): string {
  return localOnly
    ? 'Signing out clears the data stored on this device. Your history here is not backed up anywhere — it will be gone.'
    : 'Signing out clears this device. Your synced history stays safe in your account.';
}

/**
 * Confirm, then sign out only on the destructive button. `alert` is injectable so the wiring is
 * unit-testable in the node env; it defaults to React Native's Alert.alert (evaluated lazily, so
 * importing this module never touches the native Alert).
 */
export function confirmSignOut(s: SignOutConfirmable, alert: AlertFn = Alert.alert): void {
  haptics.tap();
  alert('Sign out', signOutMessage(isLocalOnly(s)), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => s.signOut() },
  ]);
}
