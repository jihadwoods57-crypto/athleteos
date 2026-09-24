// The launch splash, held until the app has something to show (cold launch, 2026-09-23).
//
// expo-router hides the native splash the moment its navigator is ready, which is long before the
// app exists: the WebView has not even been created then. A force-close + reopen therefore went
// splash -> an empty canvas -> a spinner (biometric check, proto extraction) -> the WebView's own
// blank first frames -> the skeleton -> Home. Held here instead, and let go on the proto's
// PAINTED message (router.js painted(): the cached Home, the skeleton when there is no cache, or
// Welcome), so the splash fades straight into a finished frame.
//
// Every path out lets go: the lock screen, a load error, and a timer, so the splash can never
// outstay a proto that says nothing. All of this is JS (expo-splash-screen's native module is in
// every binary since the dark splash shipped), so it rides an OTA.
import * as SplashScreen from 'expo-splash-screen';

/** Longest the splash may stay up, counted from the moment it is held (the app's first JS). */
export const SPLASH_MAX_MS = 4000;

let held = false;
let released = false;

/** Call at module scope, before the router can auto-hide (Expo's documented pattern). The
 *  ceiling starts HERE, in the same breath as the hold: nothing that happens later (a font that
 *  never loads, a proto that never posts, a component that never mounts) can keep it up. */
export function holdSplash(): void {
  if (held) return;
  held = true;
  try { SplashScreen.setOptions({ duration: 200, fade: true }); } catch { /* older binary: a cut, not a fade */ }
  SplashScreen.preventAutoHideAsync().catch(() => undefined);
  releaseSplashAfter();
}

/** Idempotent: the first caller wins, every later one is a no-op. */
export function releaseSplash(): void {
  if (released) return;
  released = true;
  try { SplashScreen.hide(); } catch { /* never let the splash be the thing that throws */ }
}

/** The ceiling: releases after `ms` unless something released it first. Returns the cancel. */
export function releaseSplashAfter(ms: number = SPLASH_MAX_MS): () => void {
  const t = setTimeout(releaseSplash, ms);
  return () => clearTimeout(t);
}

/** Test seam: forget both latches. */
export function resetSplashForTest(): void {
  held = false;
  released = false;
}
