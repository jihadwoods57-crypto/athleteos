/* Loads expo-maps and expo-location only when they can work. The picker ships over the air, so it
   can land on a binary built before either native module existed; requiring a missing native view
   at module scope would take the whole shell down with it. Every entry point here degrades to
   "no map" or "no search" instead, and the picker says so in plain words. */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type MapsModule = typeof import('expo-maps');
export type LocationModule = typeof import('expo-location');

export type MapSupport = { ok: true; maps: MapsModule } | { ok: false; reason: string };

function nativeModulePresent(name: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const core = require('expo-modules-core') as { requireOptionalNativeModule: (n: string) => unknown };
    return !!core.requireOptionalNativeModule(name);
  } catch {
    return false;
  }
}

/** Android draws Google Maps, which needs an API key baked into the binary (app.json
 *  android.config.googleMaps.apiKey). None is configured today. */
function androidKeyConfigured(): boolean {
  const android = Constants.expoConfig?.android as { config?: { googleMaps?: { apiKey?: string } } } | undefined;
  return !!android?.config?.googleMaps?.apiKey;
}

let cached: MapSupport | null = null;

export function mapSupport(): MapSupport {
  if (cached) return cached;
  cached = resolveSupport();
  return cached;
}

function resolveSupport(): MapSupport {
  if (Platform.OS === 'ios') {
    // expo-maps draws nothing below iOS 17 (SwiftUI Map); say so rather than show a blank.
    if (parseFloat(String(Platform.Version)) < 17) return { ok: false, reason: 'The map needs iOS 17 or later.' };
  } else if (Platform.OS === 'android') {
    if (!androidKeyConfigured()) return { ok: false, reason: 'The map isn’t available on Android yet.' };
  } else {
    return { ok: false, reason: 'The map isn’t available here.' };
  }
  if (!nativeModulePresent('ExpoMaps')) return { ok: false, reason: 'Update OnStandard to see the map.' };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return { ok: true, maps: require('expo-maps') as MapsModule };
  } catch {
    return { ok: false, reason: 'Update OnStandard to see the map.' };
  }
}

let location: LocationModule | null | undefined;

/** expo-location, or null on a binary without it (then search and "start where I am" are off). */
export function locationModule(): LocationModule | null {
  if (location !== undefined) return location;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    location = nativeModulePresent('ExpoLocation') ? (require('expo-location') as LocationModule) : null;
  } catch {
    location = null;
  }
  return location;
}
