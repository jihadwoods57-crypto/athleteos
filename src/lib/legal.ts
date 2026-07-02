// OnStandard — open the hosted legal documents (Terms of Service, Privacy Policy).
//
// The signup screen must let a user read the Terms + Privacy before they agree, and
// the Account overlay links to the same documents. Both live at the founder-hosted
// URLs in core/constants.ts (placeholders until the real pages are published). This
// mirrors the safe open pattern in lib/billing/portal.ts: Linking.openURL wrapped so
// a failed open (no browser, bad URL) returns false instead of crashing the screen.
import { Linking } from 'react-native';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/core/constants';

async function open(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Open the Terms of Service in the browser. Never throws; false on failure. */
export function openTerms(): Promise<boolean> {
  return open(TERMS_URL);
}

/** Open the Privacy Policy in the browser. Never throws; false on failure. */
export function openPrivacyPolicy(): Promise<boolean> {
  return open(PRIVACY_POLICY_URL);
}
