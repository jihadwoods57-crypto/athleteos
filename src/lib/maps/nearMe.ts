/* "Near me" for the coach's map. Opening the picker never prompts for location: it only READS the
   permission (to decide whether to draw the blue dot). The prompt comes from the coach tapping
   Near me, which is when the reason for it is obvious. One reading, never a stream, never logged. */
import type { LocationModule } from './mapsNative';
import type { LatLng } from './geometry';

export type NearMe = { ok: true; pos: LatLng } | { ok: false; reason: 'denied' | 'blocked' | 'nofix' | 'unavailable' };

/** Resolves `p`, or null after `ms`; the timer is cleared either way. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function permissionGranted(L: LocationModule | null): Promise<boolean> {
  if (!L) return false;
  try { return (await L.getForegroundPermissionsAsync()).granted; } catch { return false; }
}

export async function locateMe(L: LocationModule | null, timeoutMs = 4000): Promise<NearMe> {
  if (!L) return { ok: false, reason: 'unavailable' };
  try {
    let perm = await L.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await L.requestForegroundPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: perm.canAskAgain ? 'denied' : 'blocked' };
    const fix = (await L.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1000 }))
      ?? (await withTimeout(L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }), timeoutMs));
    if (!fix) return { ok: false, reason: 'nofix' };
    return { ok: true, pos: { lat: fix.coords.latitude, lng: fix.coords.longitude } };
  } catch {
    return { ok: false, reason: 'nofix' };
  }
}
