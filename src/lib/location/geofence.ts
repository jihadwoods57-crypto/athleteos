/* OnStandard — Verified Commitments: temporary geofencing.
 *
 * THE WHOLE PRIVACY DESIGN IN ONE PLACE:
 * The OS is asked to watch ONE circle per scheduled commitment, ONLY while that commitment is
 * within its arming window, and the registration is torn down when the window closes. Between
 * events nothing is registered and nothing is watched. We never read a position stream, never
 * store a coordinate, and never send one anywhere — the boundary crossing produces a boolean,
 * and the server records a verdict plus a timestamp.
 *
 * Deliberately split: selectArmable/toRegions are PURE and carry every decision worth testing
 * (which events, how many, in what order, with what shape). The Expo calls below are a thin
 * wrapper that cannot be unit-tested against a real OS.
 *
 * API per the Expo SDK 54+ docs (docs.expo.dev/versions/latest/sdk/location):
 *   Location.startGeofencingAsync(taskName, regions) / stopGeofencingAsync(taskName)
 *   TaskManager.defineTask(name, ({ data: { eventType, region }, error }) => …)
 *   GeofencingEventType.Enter | .Exit
 */

/** One instance the athlete could be verified against — exactly the shape my_armable_geofences
 *  (migration 0139) returns. Note what is NOT here: any position of the athlete. */
export type ArmableInstance = {
  instance_id: string;
  starts_at: string;
  ends_at: string | null;
  arrive_by_at: string | null;
  min_dwell_min: number | null;
  /** The place the COACH scheduled. Chosen by them, on their own schedule. */
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
};

export type Region = {
  identifier: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
};

/** iOS monitors at most 20 regions per app, process-wide. Capping at 16 leaves headroom for
 *  anything else that might register one later, and for the OS's own accounting. Instances past
 *  the cap fall back to tap-to-verify — the athlete is told, never silently left unverified. */
export const GEOFENCE_CAP = 16;

/** A commitment is armed from two hours before it starts until thirty minutes after it ends.
 *  Outside that, the app has no business knowing where anyone is. */
export const ARM_LEAD_MS = 2 * 60 * 60 * 1000;
export const ARM_TAIL_MS = 30 * 60 * 1000;
/** An event with no explicit end is treated as three hours long, matching migration 0139. */
const DEFAULT_LEN_MS = 3 * 60 * 60 * 1000;

const num = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Which instances the OS should be watching right now, nearest first, capped.
 *  Pure — `nowMs` is always an argument. */
export function selectArmable(
  instances: ArmableInstance[],
  nowMs: number,
  cap: number = GEOFENCE_CAP,
): ArmableInstance[] {
  if (!Array.isArray(instances)) return [];
  return instances
    .filter((i) => {
      if (!i || !i.instance_id) return false;
      // A malformed row must never be armed: lat/lng defaulting to 0 would put a geofence in the
      // Gulf of Guinea and quietly mark everyone unverified forever.
      if (!num(i.lat) || !num(i.lng) || !num(i.radius_m) || i.radius_m <= 0) return false;
      const start = Date.parse(i.starts_at);
      if (!isFinite(start)) return false;
      const end = i.ends_at ? Date.parse(i.ends_at) : start + DEFAULT_LEN_MS;
      const endMs = isFinite(end) ? end : start + DEFAULT_LEN_MS;
      return nowMs >= start - ARM_LEAD_MS && nowMs <= endMs + ARM_TAIL_MS;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, Math.max(0, cap));
}

/** The OS-facing shape. `identifier` carries the instance id so a crossing can be attributed to
 *  the right commitment without any lookup by coordinate. */
export function toRegions(instances: ArmableInstance[]): Region[] {
  if (!Array.isArray(instances)) return [];
  return instances.map((i) => ({
    identifier: i.instance_id,
    latitude: i.lat,
    longitude: i.lng,
    radius: i.radius_m,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
}

/** Is a phone at (lat,lng) inside this region? Used by the FOREGROUND tap path, where we take a
 *  single fix and compare it here — on the device — so only the boolean ever leaves.
 *  Equirectangular approximation: at facility scale (tens to hundreds of metres) its error is far
 *  below GPS noise, and it avoids pulling in a geo library for one comparison. */
export function isWithin(
  lat: number, lng: number, region: { latitude: number; longitude: number; radius: number },
  accuracyM = 0,
): boolean {
  if (!num(lat) || !num(lng)) return false;
  const R = 6371000;
  const dLat = ((lat - region.latitude) * Math.PI) / 180;
  const dLng = ((lng - region.longitude) * Math.PI) / 180;
  const meanLat = ((lat + region.latitude) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(meanLat);
  const metres = Math.sqrt(dLat * dLat + x * x) * R;
  // Give the athlete the benefit of their own GPS accuracy rather than punishing a weak fix.
  return metres <= region.radius + Math.max(0, accuracyM);
}

export const GEOFENCE_TASK = 'onstandard-commitment-geofence';
