/* Verified Commitments — geofence arming selection.
   The pure half of the location layer, which is the half worth testing: everything that decides
   WHAT the OS is asked to watch, and when it stops being watched. The Expo/OS calls themselves are
   a thin wrapper around this. */
import { selectArmable, GEOFENCE_CAP, toRegions, ARM_LEAD_MS, ARM_TAIL_MS, handleRegionEvent } from './geofence';
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

  test('regions carry the instance id so a crossing can be attributed', () => {
    const regions = toRegions(selectArmable([at('2026-07-22T09:30:00Z')], NOW));
    expect(regions).toEqual([{
      identifier: '2026-07-22T09:30:00Z',
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

  test('an Enter event reports a position, never a bare yes', async () => {
    const rpc = okRpc();
    await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => fix });
    expect(rpc).toHaveBeenCalledWith('verify_arrival_at', {
      p_instance: 'inst-1', p_source: 'geofence', p_lat: 28.6, p_lng: -81.2, p_accuracy_m: 12,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test('the Expo enum value for Enter (1) is the same as "enter"', async () => {
    const rpc = okRpc();
    const out = await handleRegionEvent({ eventType: 1, region: { identifier: 'inst-1' } }, { rpc, position: async () => fix });
    expect(out).toBe('arrival');
    expect(rpc.mock.calls[0][0]).toBe('verify_arrival_at');
  });

  test('no reading means NOTHING is reported, not a guess', async () => {
    const rpc = okRpc();
    const failing = async () => { throw new Error('kCLErrorLocationUnknown'); };
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: failing })).toBe('no_fix');
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => null })).toBe('no_fix');
    const nan = { coords: { latitude: NaN, longitude: -81.2, accuracy: 12 } };
    expect(await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => nan })).toBe('no_fix');
    expect(rpc).not.toHaveBeenCalled();
  });

  test('a missing accuracy is sent as null, never as a made-up number', async () => {
    const rpc = okRpc();
    const noAcc = { coords: { latitude: 28.6, longitude: -81.2, accuracy: null } };
    await handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => noAcc });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_accuracy_m: null });
  });

  test('an Exit event records the departure and takes no reading', async () => {
    const rpc = okRpc();
    const position = jest.fn();
    const out = await handleRegionEvent({ eventType: 2, region: { identifier: 'inst-1' } }, { rpc, position });
    expect(out).toBe('departure');
    expect(rpc).toHaveBeenCalledWith('record_departure', { p_instance: 'inst-1' });
    expect(position).not.toHaveBeenCalled();
    await handleRegionEvent({ eventType: 'exit', region: { identifier: 'inst-2' } }, { rpc, position });
    expect(rpc).toHaveBeenLastCalledWith('record_departure', { p_instance: 'inst-2' });
  });

  test('an event with no region, or an unknown type, does nothing', async () => {
    const rpc = okRpc();
    const position = jest.fn(async () => fix);
    expect(await handleRegionEvent({ eventType: 'enter', region: null }, { rpc, position })).toBe('ignored');
    expect(await handleRegionEvent({ eventType: 3, region: { identifier: 'inst-1' } }, { rpc, position })).toBe('ignored');
    expect(await handleRegionEvent(null, { rpc, position })).toBe('ignored');
    expect(rpc).not.toHaveBeenCalled();
    expect(position).not.toHaveBeenCalled();
  });

  test('a failing server call never throws out of the background task', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc, position: async () => fix })).resolves.toBe('failed');
    await expect(handleRegionEvent({ eventType: 'exit', region: { identifier: 'inst-1' } }, { rpc, position: async () => fix })).resolves.toBe('failed');
    const refused = jest.fn().mockResolvedValue({ data: null, error: { message: 'not_authorized' } });
    await expect(handleRegionEvent({ eventType: 'enter', region: { identifier: 'inst-1' } }, { rpc: refused, position: async () => fix })).resolves.toBe('failed');
  });
});
