/* Verified Commitments — geofence arming selection.
   The pure half of the location layer, which is the half worth testing: everything that decides
   WHAT the OS is asked to watch, and when it stops being watched. The Expo/OS calls themselves are
   a thin wrapper around this. */
import { selectArmable, GEOFENCE_CAP, toRegions, ARM_LEAD_MS, ARM_TAIL_MS } from './geofence';
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
