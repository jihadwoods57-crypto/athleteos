/* What THIS BINARY can do, told to the proto before its first line runs (final review I-1, I-2).

   The proto and this JS ship together over the air, so an OTA lands the same bridge shim on every
   build: `OnStandardNative.location` and `.maps.pick` exist even on a binary built before
   expo-location and expo-maps. A method existing therefore says nothing. The answer has to come
   from the NATIVE side, and it has to be synchronous, because the coach's setup renders its place
   step in one pass. So ProtoApp puts this object on `window.__OS_NATIVE_CAPS` at document start:
     location  ExpoLocation is compiled into this binary ("I'm here" can take a reading)
     walkIn    walk-in (region) check-in may be offered here (WALK_IN in lib/location/geofence.ts)
     maps      the coach's map can open AND search (ExpoMaps + ExpoLocation, and the OS can draw it)
     mapReason when maps is false: 'update' (the binary lacks the modules) or 'os' (it has them,
               but this OS cannot draw the map: iOS below 17, or Android with no maps key)
   A browser preview or the QC harness has no such object, and the proto reads that as all false. */
import { isLocationAvailable, walkInAllowed } from '../lib/location';
import { mapSupport, locationModule } from '../lib/maps/mapsNative';

export type NativeCaps = { location: boolean; walkIn: boolean; maps: boolean; mapReason: 'update' | 'os' | null };

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function nativeCaps(): NativeCaps {
  const location = safe(() => isLocationAvailable(), false);
  const support = safe(() => mapSupport(), { ok: false as const, reason: 'Update OnStandard to see the map.' });
  const search = safe(() => !!locationModule(), false);
  const maps = support.ok && search;
  const mapReason: NativeCaps['mapReason'] = maps ? null
    : (!support.ok && !/update/i.test(support.reason)) ? 'os' : 'update';
  return { location, walkIn: location && safe(() => walkInAllowed(), false), maps, mapReason };
}

/** The document-start line ProtoApp injects. JSON of booleans and a fixed word: nothing to escape. */
export function nativeCapsScript(caps: NativeCaps = nativeCaps()): string {
  return `window.__OS_NATIVE_CAPS = ${JSON.stringify(caps)}; true;`;
}
