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
const fetchDaysSince = jest.fn<Promise<DayRow[]>, [string, string]>();
const fetchActiveTrustPass = jest.fn(async () => null);

/** Load a fresh copy of sync.ts with `isBackendLive` forced to a given value. */
function loadSync(backendLive: boolean) {
  let mod!: typeof import('./sync');
  jest.isolateModules(() => {
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      db: { upsertDay, fetchDay, fetchDaysSince, fetchActiveTrustPass },
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
  fetchDaysSince.mockReset().mockResolvedValue([]);
});

const dayRow = (date: string, score: number | null, weight: number | null): DayRow => ({
  id: date, athlete_id: 'a-1', date,
  meals: {}, hydration_l: 0, tasks: [], quick_added: [], current_weight: weight,
  checkin: {}, score, grade: null, computed_at: null, updated_at: '',
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

  it("writes the day under the STATE's dateStamp, not the wall clock", async () => {
    // A 12:05am action before the rollover fires must upsert YESTERDAY's day under
    // yesterday's date — not overwrite today's server row with yesterday's meals.
    const { pushDay } = loadSync(true);
    const lateNight: AppState = { ...adultConsenting(), dateStamp: '2026-07-02' };
    await pushDay(lateNight, 'athlete-1');
    const row = upsertDay.mock.calls[0][0] as DayRow;
    expect(row.date).toBe('2026-07-02');
  });
});

describe('cross-device day roundtrip — the score survives hydration', () => {
  it('mapStateToDayRow → dayRowToState preserves check-in + commitment (score parity)', () => {
    // Before: hydration dropped ciSubmitted/answers and dailyCommitment, so the same
    // lived day recomputed ~35 points lower on a second device — and the next push
    // then overwrote the server row with the collapsed number.
    const { mapStateToDayRow, dayRowToState } = loadSync(true);
    const { computeDerived } = require('@/core/scoring');
    const lived: AppState = {
      ...adultConsenting(),
      ciSubmitted: true,
      ciEnergy: 9,
      ciRecovery: 8,
      ciSleep: 9,
      ciConfidence: 8,
      dailyCommitment: 'yes',
    };
    const row = mapStateToDayRow(lived, 'a-1', '2026-07-03');
    const restored: AppState = { ...adultConsenting(), ...dayRowToState(row as DayRow) };
    expect(restored.ciSubmitted).toBe(true);
    expect(restored.dailyCommitment).toBe('yes');
    expect(computeDerived(restored).athleteScore).toBe(computeDerived(lived).athleteScore);
  });

  it('a legacy row without the new checkin keys hydrates without inventing a check-in', () => {
    const { dayRowToState } = loadSync(true);
    const slice = dayRowToState(dayRow('2026-07-01', 70, 180));
    expect(slice.ciSubmitted).toBeUndefined();
    expect(slice.dailyCommitment).toBeUndefined();
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

describe('history backfill (audit item 14)', () => {
  it('historyFromDayRows maps score + weight and skips today (live) and null cells', () => {
    const { historyFromDayRows } = loadSync(true);
    const rows = [
      dayRow('2026-06-20', 85, 180),
      dayRow('2026-06-21', 92, null), // no weight -> only a score point
      dayRow('2026-06-22', null, 179), // no score -> only a weight point
      dayRow('2026-06-23', 88, 178), // this is "today" in the call below -> skipped
    ];
    const { scoreHistory, weightHistory } = historyFromDayRows(rows, '2026-06-23');
    expect(scoreHistory).toEqual([
      { date: '2026-06-20', score: 85 },
      { date: '2026-06-21', score: 92 },
    ]);
    expect(weightHistory).toEqual([
      { date: '2026-06-20', weight: 180 },
      { date: '2026-06-22', weight: 179 },
    ]);
  });

  it('hydrateHistory is null when the flag is off (never reads remote)', async () => {
    const { hydrateHistory } = loadSync(false);
    expect(await hydrateHistory('a-1')).toBeNull();
    expect(fetchDaysSince).not.toHaveBeenCalled();
  });

  it('hydrateHistory returns the rebuilt record when live rows exist', async () => {
    const { hydrateHistory } = loadSync(true);
    fetchDaysSince.mockResolvedValue([dayRow('2026-06-20', 85, 180), dayRow('2026-06-21', 92, 181)]);
    const slice = await hydrateHistory('a-1');
    expect(slice?.scoreHistory).toHaveLength(2);
    expect(slice?.weightHistory).toHaveLength(2);
  });

  it('hydrateHistory returns null on an empty read (never wipes the local cache)', async () => {
    const { hydrateHistory } = loadSync(true);
    fetchDaysSince.mockResolvedValue([]);
    expect(await hydrateHistory('a-1')).toBeNull();
  });
});
