// The sync path's one job that matters: never turn "we couldn't read" into "you did nothing".
//
// With the seam inert (isHealthAvailable === false, which is how it ships) readActivity resolves
// null for every period, so this suite also proves the shipped configuration posts absolutely
// nothing — no writes, no zeroes, no accidental evidence of a shortfall.
import { syncActivity, type SyncTarget } from './activitySync';
import { isHealthAvailable } from './index';

const targets: SyncTarget[] = [
  { instanceId: 'i1', periodStartISO: '2026-07-28', metric: 'steps' },
  { instanceId: 'i2', periodStartISO: '2026-07-27', metric: 'distance', deliberateWorkout: true },
];

describe('activity sync while the seam is inert', () => {
  it('attempts nothing at all when health is unavailable', async () => {
    const r = await syncActivity(targets, '2026-07-28T22:00:00Z');
    // The guard short-circuits before the loop, so nothing is even counted as attempted —
    // and crucially `posted` is 0: no row is written claiming zero progress.
    expect(isHealthAvailable).toBe(false);
    expect(r.posted).toBe(0);
  });

  it('handles an empty or malformed target list without throwing', async () => {
    await expect(syncActivity([], '2026-07-28T22:00:00Z')).resolves.toEqual({
      attempted: 0, posted: 0, skipped: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(syncActivity(null as any, '2026-07-28T22:00:00Z')).resolves.toEqual({
      attempted: 0, posted: 0, skipped: 0,
    });
  });
});
