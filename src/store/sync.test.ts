// OnStandard — sync bridge consent gate (Stage C safety core).
// Proves the single real-data write path (`pushDay`) FAILS CLOSED: it writes only
// when the backend is live AND realDataConsent passes, and the projection helpers
// round-trip a day slice. The supabase lib is mocked so the node env drives the gate
// without a real client; `isBackendLive` is toggled per case via isolateModules.
import { createInitialState } from '@/core/defaultState';
import type { AppState } from '@/core/types';
import type { DayRow } from '@/lib/supabase';

const upsertDay = jest.fn<Promise<void>, [unknown]>();
const fetchDay = jest.fn<Promise<DayRow | null>, [string, string]>();
const fetchActiveTrustPass = jest.fn(async () => null);

/** Load a fresh copy of sync.ts with `isBackendLive` forced to a given value. */
function loadSync(backendLive: boolean) {
  let mod!: typeof import('./sync');
  jest.isolateModules(() => {
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      db: { upsertDay, fetchDay, fetchActiveTrustPass },
    }));
    mod = require('./sync');
  });
  return mod;
}

const adultConsenting = (): AppState => ({
  ...createInitialState(),
  role: 'athlete',
  baseAge: 22,
  realDataConsent: true,
});

beforeEach(() => {
  upsertDay.mockReset().mockResolvedValue(undefined);
  fetchDay.mockReset().mockResolvedValue(null);
});

describe('pushDay consent gate', () => {
  it('does NOT push and reads backend-off when the flag is off', async () => {
    const { pushDay } = loadSync(false);
    const res = await pushDay(adultConsenting(), 'athlete-1');
    expect(res).toEqual({ pushed: false, reason: 'backend-off' });
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('pushes when backend live + adult with consent', async () => {
    const { pushDay } = loadSync(true);
    const res = await pushDay(adultConsenting(), 'athlete-1');
    expect(res).toEqual({ pushed: true, reason: 'ok' });
    expect(upsertDay).toHaveBeenCalledTimes(1);
    const row = upsertDay.mock.calls[0][0] as DayRow;
    expect(row.athlete_id).toBe('athlete-1');
    expect(typeof row.score).toBe('number');
  });

  it('blocks a minor athlete without consent (fails closed)', async () => {
    const { pushDay } = loadSync(true);
    const minor: AppState = { ...adultConsenting(), baseAge: 15, realDataConsent: false };
    const res = await pushDay(minor, 'minor-1');
    expect(res).toEqual({ pushed: false, reason: 'minor-consent-required' });
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('blocks an adult athlete without consent', async () => {
    const { pushDay } = loadSync(true);
    const adult: AppState = { ...adultConsenting(), realDataConsent: false };
    const res = await pushDay(adult, 'a-2');
    expect(res).toEqual({ pushed: false, reason: 'consent-required' });
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('treats a null role as an athlete (gated), not waved through', async () => {
    const { pushDay } = loadSync(true);
    const noRole: AppState = { ...createInitialState(), role: null, baseAge: 30, realDataConsent: false };
    const res = await pushDay(noRole, 'a-3');
    expect(res.pushed).toBe(false);
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('does not gate a non-athlete overseer role (generates no health data)', async () => {
    const { pushDay } = loadSync(true);
    const coach: AppState = { ...createInitialState(), role: 'hs_coach', realDataConsent: false };
    const res = await pushDay(coach, 'coach-1');
    expect(res).toEqual({ pushed: true, reason: 'ok' });
  });
});

describe('consentContextFromState', () => {
  it('maps backend-off straight through (no push possible)', () => {
    const { consentContextFromState } = loadSync(true);
    const ctx = consentContextFromState(adultConsenting(), false);
    expect(ctx.backendLive).toBe(false);
    expect(ctx.role).toBe('athlete');
    expect(ctx.consentGiven).toBe(true);
  });
});

describe('hydrateDay', () => {
  it('returns null when the flag is off (never reads remote)', async () => {
    const { hydrateDay } = loadSync(false);
    expect(await hydrateDay('a-1')).toBeNull();
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it('maps a remote row back onto the day slice when live', async () => {
    const { hydrateDay } = loadSync(true);
    fetchDay.mockResolvedValue({
      id: 'd1', athlete_id: 'a-1', date: '2026-06-25',
      meals: { breakfast: true, lunch: false, snack: false, dinner: false },
      hydration_l: 1.8, tasks: [], quick_added: [], current_weight: 181,
      checkin: {}, score: 72, grade: 'C', computed_at: null, updated_at: '',
    } as DayRow);
    const slice = await hydrateDay('a-1');
    expect(slice?.hydrationL).toBe(1.8);
    expect(slice?.currentWeight).toBe(181);
    expect(slice?.dateStamp).toBe('2026-06-25');
  });

  it('returns null when no remote row exists yet', async () => {
    const { hydrateDay } = loadSync(true);
    fetchDay.mockResolvedValue(null);
    expect(await hydrateDay('a-1')).toBeNull();
  });
});
