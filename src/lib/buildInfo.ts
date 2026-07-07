// OnStandard — build stamp surfaced to the running app.
//
// Combines the commit/time injected at build time (app.config.ts → extra) with
// the live expo-updates facts (which channel this binary listens to, and whether
// it's currently running an embedded bundle or a downloaded OTA update). The
// Account footer renders this so you can look at your phone and know exactly
// which code it came from — no more guessing whether TestFlight shipped the
// newest work.
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

type Stamp = { commit: string; builtAt: string };

const stamp = (Constants.expoConfig?.extra?.buildInfo ?? {}) as Partial<Stamp>;

/** Short git commit the binary was built from (e.g. "7c22df6"). */
export const BUILD_COMMIT = stamp.commit ?? 'local';
/** ISO timestamp of when the build config was evaluated. */
export const BUILD_AT = stamp.builtAt ?? '';

/** expo-updates channel this build listens to ("production", etc.) or "dev"
 *  when updates are disabled (Expo Go / local run). Reads defensively: the
 *  module throws in some dev contexts. */
export const UPDATE_CHANNEL: string = safe(() => Updates.channel) ?? 'dev';

/** True when the running JS is a downloaded OTA update, not the bundle embedded
 *  at build time. Lets you tell an OTA-patched build apart from a fresh binary. */
export const IS_OTA: boolean = safe(() => !Updates.isEmbeddedLaunch) ?? false;

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Compact stamp for the Account footer, e.g. "7c22df6 · 2026-07-07 · production". */
export function buildLine(): string {
  const date = BUILD_AT ? BUILD_AT.slice(0, 10) : '—';
  const parts = [BUILD_COMMIT, date, UPDATE_CHANNEL];
  if (IS_OTA) parts.push('OTA');
  return parts.join(' · ');
}
