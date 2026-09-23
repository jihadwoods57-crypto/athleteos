/* OnStandard — Verified Commitments: temporary geofencing.
 *
 * THE WHOLE PRIVACY DESIGN IN ONE PLACE:
 * The OS is asked to watch ONE circle per scheduled commitment, ONLY while that commitment is
 * within its arming window, and the registration is torn down when the window closes. Between
 * events nothing is registered and nothing is watched. We never read a position stream and never
 * store a coordinate.
 *
 * WHAT CHANGED IN 0242 (founder 2026-09-23). An Enter now tries ONE position reading and sends it
 * to verify_arrival_at, which measures the distance to the coach's place on the server, records
 * only the verdict (and, when it is a miss, "N m from <place>"), and discards the coordinate. One
 * reading per crossing or per "I'm here" tap; never a track.
 *
 * THE BINARY HAS NO BACKGROUND-LOCATION MODE (controller ruling 2026-09-23; App Review 2.5.4 was
 * exactly that key). Region monitoring does not need it, but without it iOS may refuse a reading
 * during the background wake. When it does, the Enter is still reported: verify_arrival_at with
 * source 'geofence' and NULL coordinates means "the OS matched the region the server armed"
 * (0242 section 5b). The manual "I'm here" path is always distance-verified.
 *
 * Deliberately split: selectArmable/toRegions/handleRegionEvent are PURE (the OS and the network
 * are injected) and carry every decision worth testing. The Expo calls in index.ts are a thin
 * wrapper that cannot be unit-tested against a real OS.
 *
 * API per the Expo SDK 57 docs (docs.expo.dev/versions/v57.0.0/sdk/location):
 *   Location.startGeofencingAsync(taskName, regions) / stopGeofencingAsync(taskName)
 *   TaskManager.defineTask(name, ({ data: { eventType, region }, error }) => …)
 *   GeofencingEventType.Enter (1) | .Exit (2)
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

export const GEOFENCE_TASK = 'onstandard-commitment-geofence';

/** What refreshGeofences should do with my_armable_geofences' answer. */
export type ArmingPlan =
  | { action: 'keep' }
  | { action: 'disarm' }
  | { action: 'arm'; regions: Region[]; capped: number };

/** Pure. A failed or malformed answer (network blip, server error, a throw) KEEPS whatever is
 *  already armed: tearing regions down on a blip would leave the athlete walking in at 5:43 AM
 *  unseen until the next successful refresh. Only a SUCCESSFUL answer with nothing inside its
 *  window disarms. Sign-out disarms separately (LOCATION_DISARM). */
export function armingPlan(
  answer: { data?: unknown; error?: unknown; thrown?: boolean },
  nowMs: number,
): ArmingPlan {
  if (answer.thrown || answer.error || !Array.isArray(answer.data)) return { action: 'keep' };
  const rows = answer.data as ArmableInstance[];
  const armable = selectArmable(rows, nowMs);
  if (!armable.length) return { action: 'disarm' };
  return { action: 'arm', regions: toRegions(armable), capped: Math.max(0, rows.length - armable.length) };
}

/* ---------------------------------------------------------------- one reading, one report */

/** The shape of a position fix, as expo-location's getCurrentPositionAsync returns it. */
export type PositionFix = {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
};

/** The arguments verify_arrival_at (0242) takes. The coordinate goes to the server exactly once,
 *  in this call; the server compares it to the coach's place and does not keep it. lat/lng are
 *  null ONLY for the geofence region-match report (regionMatchArgs). */
export type ArrivalArgs = {
  p_instance: string;
  p_source: 'geofence' | 'manual';
  p_lat: number | null;
  p_lng: number | null;
  p_accuracy_m: number | null;
};

/** The server forgives at most this much of the phone's stated error (0242: least(accuracy, 75)).
 *  On the geofence path a reading WORSE than this is not sent: the OS has already placed the phone
 *  inside the region, and a poor fix could only turn that into "unverified, N m away". */
export const MAX_TRUSTED_ACCURACY_M = 75;

/** The geofence report when no reading could be taken: the OS matched the armed region. The
 *  server accepts null coordinates from the geofence source only. */
export function regionMatchArgs(instanceId: string): ArrivalArgs {
  return { p_instance: instanceId, p_source: 'geofence', p_lat: null, p_lng: null, p_accuracy_m: null };
}

/** Build the verify_arrival_at arguments from one fix, or null when the fix is not a real
 *  position. A missing or non-finite accuracy goes as null (the server treats that as 0 m of
 *  forgiveness), never as a number we made up. */
export function arrivalArgs(
  instanceId: string, source: 'geofence' | 'manual', fix: PositionFix | null | undefined,
): ArrivalArgs | null {
  const c = fix?.coords;
  if (!instanceId || !c || !num(c.latitude) || !num(c.longitude)) return null;
  return {
    p_instance: instanceId,
    p_source: source,
    p_lat: c.latitude,
    p_lng: c.longitude,
    p_accuracy_m: num(c.accuracy) ? c.accuracy : null,
  };
}

export type RpcFn = (fn: string, args: Record<string, unknown>) =>
  PromiseLike<{ data: unknown; error: unknown }>;

export type RegionEventDeps = {
  rpc: RpcFn;
  /** One position reading. Null (or a throw) means there is no fix. */
  position: () => Promise<PositionFix | null | undefined>;
};

export type RegionEvent = {
  /** expo-location's GeofencingEventType (Enter = 1, Exit = 2); 'enter'/'exit' are accepted too. */
  eventType: number | string;
  region?: { identifier?: string | null } | null;
} | null | undefined;

/** 'arrival' = reported with a reading (distance-checked); 'region_match' = no reading could be
 *  taken, so the OS region match was reported instead. */
export type RegionOutcome = 'arrival' | 'region_match' | 'departure' | 'failed' | 'ignored';

/* Mirrors expo-location's LocationGeofencingEventType. Written out here so this file stays pure
   (no native import) and the tests can run without the module. */
const ENTER = 1;
const EXIT = 2;

const isEnter = (t: unknown) => t === ENTER || t === 'enter';
const isExit = (t: unknown) => t === EXIT || t === 'exit';

/** What the background geofence task does with one region crossing. Never throws: this runs in
 *  the few seconds iOS gives a backgrounded app, and an exception there is simply lost.
 *
 *  ENTER tries ONE reading and sends it to verify_arrival_at (source 'geofence'), where the server
 *  measures it. If there is no reading (iOS refused a fix in the background wake, it timed out, or
 *  it was not a real position) or the reading is less accurate than MAX_TRUSTED_ACCURACY_M, the OS
 *  region match itself is reported: verify_arrival_at with null coordinates, which the server
 *  accepts from the geofence source only.
 *
 *  EXIT reports the bare crossing to record_departure (0208) and takes no reading. The server
 *  decides what a departure means (a re-entry erases it; the grace absorbs indoor wobble), and
 *  record_departure cannot write `status`, so a stray Exit can neither invent a departure with no
 *  arrival nor mark anyone missed. */
export async function handleRegionEvent(event: RegionEvent, deps: RegionEventDeps): Promise<RegionOutcome> {
  const instanceId = event?.region?.identifier;
  if (!event || !instanceId) return 'ignored';
  try {
    if (isEnter(event.eventType)) {
      let fix: PositionFix | null | undefined = null;
      try { fix = await deps.position(); } catch { fix = null; }
      let args = arrivalArgs(instanceId, 'geofence', fix);
      if (args && args.p_accuracy_m != null && args.p_accuracy_m > MAX_TRUSTED_ACCURACY_M) args = null;
      const { error } = await deps.rpc('verify_arrival_at', args ?? regionMatchArgs(instanceId));
      if (error) return 'failed';
      return args ? 'arrival' : 'region_match';
    }
    if (isExit(event.eventType)) {
      const { error } = await deps.rpc('record_departure', { p_instance: instanceId });
      return error ? 'failed' : 'departure';
    }
    return 'ignored';
  } catch {
    return 'failed';
  }
}
