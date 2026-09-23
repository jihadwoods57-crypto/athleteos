/* Verified Commitments — geofence arming selection.
   The pure half of the location layer, which is the half worth testing: everything that decides
   WHAT the OS is asked to watch, and when it stops being watched. The Expo/OS calls themselves are
   a thin wrapper around this. */
import {
  selectArmable, GEOFENCE_CAP, toRegions, ARM_LEAD_MS, ARM_TAIL_MS, handleRegionEvent, armingPlan, MAX_TRUSTED_ACCURACY_M,
  regionId, parseRegionId, pruneRegions, nextClose, armWindow, WALK_IN, walkInEnabled,
} from './geofence';
import type { ArmableInstance } from './geofence';

const at = (startsAt: string, over: Partial<ArmableInstance> = {}): ArmableInstance => ({
  instance_id: startsAt,
  starts_at: startsAt,
  ends_at: null,
  arrive_by_at: null,
  min_dwell_min: null,
  name: 'Football Facility',
  lat: 28.6024,
  lng: -81.2001,
  radius_m: 120,
  ...over,
});

const NOW = Date.parse('2026-07-22T09:00:00Z');

describe('geofence arming selection', () => {
  test('the cap leaves headroom under the iOS 20-region limit', () => {
    expect(GEOFENCE_CAP).toBe(16);
  });

  test('the arming window is two hours ahead and thirty minutes past the end', () => {
    expect(ARM_LEAD_MS).toBe(2 * 60 * 60 * 1000);
    expect(ARM_TAIL_MS).toBe(30 * 60 * 1000);
  });

  test('only instances inside the arming window are armed', () => {
    const picked = selectArmable([
      at('2026-07-22T09:30:00Z'),                              // 30 min out — armed
      at('2026-07-22T20:00:00Z'),                              // 11 hours out — not yet
      at('2026-07-22T04:00:00Z', { ends_at: '2026-07-22T05:00:00Z' }), // over hours ago
    ], NOW);
    expect(picked.map((p) => p.instance_id)).toEqual(['2026-07-22T09:30:00Z']);
  });

  test('an event still running is armed even though it started before now', () => {
    const picked = selectArmable(
      [at('2026-07-22T08:30:00Z', { ends_at: '2026-07-22T10:00:00Z' })], NOW);
    expect(picked).toHaveLength(1);
  });

  test('an event with no end time is armed for three hours after it starts', () => {
    expect(selectArmable([at('2026-07-22T06:30:00Z')], NOW)).toHaveLength(1);   // +2.5h, still on
    expect(selectArmable([at('2026-07-22T05:00:00Z')], NOW)).toHaveLength(0);   // +4h, done
  });

  test('more than the cap arms the nearest ones and reports nothing silently', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      at(new Date(NOW + (i + 1) * 60_000).toISOString()));
    const picked = selectArmable(many, NOW);
    expect(picked).toHaveLength(GEOFENCE_CAP);
    // nearest first — the 16 soonest, not an arbitrary 16
    expect(picked[0].instance_id).toBe(many[0].instance_id);
    expect(picked[GEOFENCE_CAP - 1].instance_id).toBe(many[GEOFENCE_CAP - 1].instance_id);
  });

  test('a malformed row is dropped rather than armed at the equator', () => {
    const picked = selectArmable([
      at('2026-07-22T09:30:00Z', { lat: null as unknown as number }),
      at('2026-07-22T09:31:00Z', { radius_m: 0 }),
      at('2026-07-22T09:32:00Z'),
    ], NOW);
    expect(picked.map((p) => p.instance_id)).toEqual(['2026-07-22T09:32:00Z']);
  });

  test('regions carry the instance id AND its window so a crossing can be attributed and timed', () => {
    const regions = toRegions(selectArmable([at('2026-07-22T09:30:00Z')], NOW));
    const start = Date.parse('2026-07-22T09:30:00Z');
    expect(regions).toEqual([{
      identifier: `2026-07-22T09:30:00Z|${start - ARM_LEAD_MS}|${start + 3 * 3600_000 + ARM_TAIL_MS}`,
      latitude: 28.6024,
      longitude: -81.2001,
      radius: 120,
      notifyOnEnter: true,
      notifyOnExit: true,
    }]);
  });

  test('an empty list arms nothing and never throws', () => {
    expect(selectArmable([], NOW)).toEqual([]);
    expect(selectArmable(null as unknown as ArmableInstance[], NOW)).toEqual([]);
    expect(toRegions([])).toEqual([]);
  });
});

/* Arrival is verified by DISTANCE on the server since 0242. The device's job on a region crossing
   is to send one position reading (Enter) or the bare fact of leaving (Exit). It never decides the
   verdict itself, and it never reports an arrival without a reading to back it. */
describe('handleRegionEvent', () => {
  const fix = { coords: { latitude: 28.6, longitude: -81.2, accuracy: 12 } };
  const okRpc = () => jest.fn().mockResolvedValue({ data: { within: true }, error: null });
  // Every region carries its window (regionId); these events land inside it.
  const W = (id: string) => regionId(id, NOW - 3600_000, NOW + 3600_000);
  const now = () => NOW;

  test('an Enter event reports a position when it can get one', async () => {
    const rpc = okRpc();
    await handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position: async () => fix, now });
    expect(rpc).toHaveBeenCalledWith('verify_arrival_at', {
      p_instance: 'inst-1', p_source: 'geofence', p_lat: 28.6, p_lng: -81.2, p_accuracy_m: 12,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test('the Expo enum value for Enter (1) is the same as "enter"', async () => {
    const rpc = okRpc();
    const out = await handleRegionEvent({ eventType: 1, region: { identifier: W('inst-1') } }, { rpc, position: async () => fix, now });
    expect(out).toBe('arrival');
    expect(rpc.mock.calls[0][0]).toBe('verify_arrival_at');
  });

  /* No UIBackgroundModes "location" (controller ruling 2026-09-23): iOS may refuse a reading
     during a region wake. The OS region match is then reported with NO coordinates, which the
     server accepts from the geofence source only (0242 section 5b). */
  test('no reading: the OS region match is reported with null coordinates, source geofence', async () => {
    const regionOnly = { p_instance: 'inst-1', p_source: 'geofence', p_lat: null, p_lng: null, p_accuracy_m: null };
    const failing = async () => { throw new Error('kCLErrorLocationUnknown'); };
    const nan = { coords: { latitude: NaN, longitude: -81.2, accuracy: 12 } };
    for (const position of [failing, async () => null, async () => nan]) {
      const rpc = okRpc();
      expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position, now })).toBe('region_match');
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('verify_arrival_at', regionOnly);
    }
  });

  test('a missing accuracy is sent as null, never as a made-up number', async () => {
    const rpc = okRpc();
    const noAcc = { coords: { latitude: 28.6, longitude: -81.2, accuracy: null } };
    await handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position: async () => noAcc, now });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_accuracy_m: null });
  });

  /* The server forgives at most 75 m of the phone's stated error. A reading worse than that can
     land "unverified, N m away" on someone the OS has already placed inside the region, so the
     geofence path reports the region match instead. */
  test('a reading less accurate than the server pad cap (75 m) is replaced by the region match', async () => {
    expect(MAX_TRUSTED_ACCURACY_M).toBe(75);
    const rpc = okRpc();
    const poor = { coords: { latitude: 28.61, longitude: -81.2, accuracy: 180 } };
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position: async () => poor, now })).toBe('region_match');
    expect(rpc).toHaveBeenCalledWith('verify_arrival_at', { p_instance: 'inst-1', p_source: 'geofence', p_lat: null, p_lng: null, p_accuracy_m: null });
  });

  test('a reading at exactly 75 m accuracy is still sent (the server can pad it fully)', async () => {
    const rpc = okRpc();
    const edge = { coords: { latitude: 28.6, longitude: -81.2, accuracy: 75 } };
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position: async () => edge, now })).toBe('arrival');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_lat: 28.6, p_accuracy_m: 75 });
  });

  test('an Exit event records the departure and takes no reading', async () => {
    const rpc = okRpc();
    const position = jest.fn();
    const out = await handleRegionEvent({ eventType: 2, region: { identifier: W('inst-1') } }, { rpc, position, now });
    expect(out).toBe('departure');
    expect(rpc).toHaveBeenCalledWith('record_departure', { p_instance: 'inst-1' });
    expect(position).not.toHaveBeenCalled();
    await handleRegionEvent({ eventType: 'exit', region: { identifier: W('inst-2') } }, { rpc, position, now });
    expect(rpc).toHaveBeenLastCalledWith('record_departure', { p_instance: 'inst-2' });
  });

  test('an event with no region, or an unknown type, does nothing', async () => {
    const rpc = okRpc();
    const position = jest.fn(async () => fix);
    expect(await handleRegionEvent({ eventType: 'enter', region: null }, { rpc, position, now })).toBe('ignored');
    expect(await handleRegionEvent({ eventType: 3, region: { identifier: W('inst-1') } }, { rpc, position, now })).toBe('ignored');
    expect(await handleRegionEvent(null, { rpc, position, now })).toBe('ignored');
    expect(rpc).not.toHaveBeenCalled();
    expect(position).not.toHaveBeenCalled();
  });

  test('a failing server call never throws out of the background task', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc, position: async () => fix, now })).resolves.toBe('failed');
    await expect(handleRegionEvent({ eventType: 'exit', region: { identifier: W('inst-1') } }, { rpc, position: async () => fix, now })).resolves.toBe('failed');
    const refused = jest.fn().mockResolvedValue({ data: null, error: { message: 'not_authorized' } });
    await expect(handleRegionEvent({ eventType: 'enter', region: { identifier: W('inst-1') } }, { rpc: refused, position: async () => fix, now })).resolves.toBe('failed');
  });

  /* Final review I2: a region the app could not disarm at the close still fires (the app was
     killed; nothing ran). Out of its window it takes no reading, sends nothing and is dropped. */
  test('an event after the region\'s window closed sends nothing and drops that region', async () => {
    for (const eventType of ['enter', 'exit', 1, 2]) {
      const rpc = okRpc();
      const position = jest.fn(async () => fix);
      const disarm = jest.fn(async () => undefined);
      const id = regionId('inst-old', NOW - 5 * 3600_000, NOW - 60_000);
      expect(await handleRegionEvent({ eventType, region: { identifier: id } }, { rpc, position, now, disarm })).toBe('outside');
      expect(rpc).not.toHaveBeenCalled();
      expect(position).not.toHaveBeenCalled();
      expect(disarm).toHaveBeenCalledWith(id);
    }
  });

  test('an event before the region\'s window opens sends nothing either', async () => {
    const rpc = okRpc(); const position = jest.fn(async () => fix); const disarm = jest.fn();
    const id = regionId('inst-next', NOW + 60_000, NOW + 5 * 3600_000);
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: id } }, { rpc, position, now, disarm })).toBe('outside');
    expect(rpc).not.toHaveBeenCalled();
    expect(position).not.toHaveBeenCalled();
  });

  test('a region with no window in its identifier is never trusted', async () => {
    const rpc = okRpc(); const position = jest.fn(async () => fix); const disarm = jest.fn();
    for (const identifier of ['inst-1', 'inst-1|abc|123', 'inst-1|200|100', '|1|2']) {
      expect(await handleRegionEvent({ eventType: 'enter', region: { identifier } }, { rpc, position, now, disarm })).toBe('outside');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a disarm that throws never escapes the background task', async () => {
    const rpc = okRpc();
    const disarm = jest.fn(async () => { throw new Error('gone'); });
    const id = regionId('inst-old', NOW - 5 * 3600_000, NOW - 60_000);
    await expect(handleRegionEvent({ eventType: 'enter', region: { identifier: id } }, { rpc, position: async () => fix, now, disarm })).resolves.toBe('outside');
  });
});

describe('region windows', () => {
  test('regionId and parseRegionId round-trip; anything else is null', () => {
    expect(parseRegionId(regionId('abc-1', 100, 200))).toEqual({ instanceId: 'abc-1', open: 100, close: 200 });
    expect(parseRegionId('abc-1')).toBeNull();
    expect(parseRegionId(null)).toBeNull();
    expect(parseRegionId('a|1|2|3')).toBeNull();
  });

  test('the window is the arming window: two hours before the start to thirty minutes after the end', () => {
    expect(armWindow({ starts_at: '2026-07-22T09:30:00Z', ends_at: '2026-07-22T10:00:00Z' })).toEqual({
      open: Date.parse('2026-07-22T07:30:00Z'), close: Date.parse('2026-07-22T10:30:00Z'),
    });
    expect(armWindow({ starts_at: 'nope', ends_at: null })).toBeNull();
  });

  test('pruneRegions keeps open and upcoming regions, drops closed ones and the one named', () => {
    const open = { identifier: regionId('a', NOW - 1000, NOW + 1000) };
    const upcoming = { identifier: regionId('b', NOW + 1000, NOW + 9000) };
    const closed = { identifier: regionId('c', NOW - 9000, NOW - 1000) };
    const bare = { identifier: 'd' };
    expect(pruneRegions([open, upcoming, closed, bare], NOW)).toEqual([open, upcoming]);
    expect(pruneRegions([open, upcoming], NOW, open.identifier)).toEqual([upcoming]);
    expect(pruneRegions(null as never, NOW)).toEqual([]);
  });

  test('nextClose is the earliest close, for the in-app disarm timer', () => {
    expect(nextClose([{ identifier: regionId('a', 0, 500) }, { identifier: regionId('b', 0, 300) }, { identifier: 'x' }])).toBe(300);
    expect(nextClose([])).toBeNull();
  });
});

/* The device-test fallback: walk-in check-in is one switch per platform, shipped by OTA. */
describe('WALK_IN', () => {
  test('is on for both platforms in this build, and off anywhere else', () => {
    expect(WALK_IN).toEqual({ ios: true, android: true });
    expect(walkInEnabled('ios')).toBe(true);
    expect(walkInEnabled('android')).toBe(true);
    expect(walkInEnabled('web')).toBe(false);
  });
});

/* What refreshGeofences does with the server's answer. A network blip must not tear down regions
   that are already armed: the athlete walking in at 5:43 AM would simply not be seen. Only a
   SUCCESSFUL empty answer (nothing is in its window) disarms; sign-out disarms through
   LOCATION_DISARM. */
describe('armingPlan', () => {
  const soon = at('2026-07-22T09:30:00Z');

  test('an error from my_armable_geofences keeps whatever is armed', () => {
    expect(armingPlan({ data: null, error: { message: 'Network request failed' } }, NOW)).toEqual({ action: 'keep' });
  });

  test('a throw (no response at all) keeps whatever is armed', () => {
    expect(armingPlan({ thrown: true }, NOW)).toEqual({ action: 'keep' });
  });

  test('a malformed (non-array) answer is treated like an error, not like "nothing to arm"', () => {
    expect(armingPlan({ data: { oops: 1 }, error: null }, NOW)).toEqual({ action: 'keep' });
  });

  test('a successful empty list disarms', () => {
    expect(armingPlan({ data: [], error: null }, NOW)).toEqual({ action: 'disarm' });
  });

  test('a successful list with nothing inside its window disarms', () => {
    expect(armingPlan({ data: [at('2026-07-22T20:00:00Z')], error: null }, NOW)).toEqual({ action: 'disarm' });
  });

  test('a successful list arms the selection and reports what the cap left out', () => {
    const plan = armingPlan({ data: [soon], error: null }, NOW);
    expect(plan).toEqual({ action: 'arm', regions: toRegions([soon]), capped: 0 });
    const many = Array.from({ length: 18 }, (_, i) => at(new Date(NOW + (i + 1) * 60_000).toISOString()));
    const capped = armingPlan({ data: many, error: null }, NOW);
    expect(capped.action).toBe('arm');
    expect(capped.action === 'arm' && capped.regions).toHaveLength(GEOFENCE_CAP);
    expect(capped.action === 'arm' && capped.capped).toBe(2);
  });
});
