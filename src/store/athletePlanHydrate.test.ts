// OnStandard — athlete-plan hydration seam. A managed client's coach-set plan (nutrition targets +
// scoring profile) lived only in athlete_profiles, read by the COACH's editor and never by the
// client themselves — so on a fresh sign-in a lose-fat client fell back to the gain-oriented
// defaults (+13 lb target, 3200 kcal, 180 g) and was shown/scored on them, tripping the
// constitution's "a lose-fat athlete is never told to gain". Proves the client now reads its OWN
// plan back, gated + soft-fail. The supabase lib is mocked; isBackendLive is toggled per case.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const fetchAthleteProfile = jest.fn<Promise<unknown>, [string]>();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn: jest.fn(), signOut: jest.fn().mockResolvedValue(undefined) },
      db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay: jest.fn().mockResolvedValue(undefined), fetchAthleteProfile },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => fetchAthleteProfile.mockReset().mockResolvedValue(null));

// A trainer's lose-fat client: lower calories, a LOSS weight target (below the gain default of 184).
const loseFatPlan = { targets: { protein: 200, calories: 2200, weight: 165, profile: 'general' } };

describe('flag OFF: plan hydration is inert', () => {
  it('no-ops and never reads (keeps local/default targets)', async () => {
    const useStore = loadStore(false);
    useStore.setState({ userId: 'client-1' });
    const before = useStore.getState().calTarget;
    await useStore.getState().hydrateAthletePlan();
    expect(fetchAthleteProfile).not.toHaveBeenCalled();
    expect(useStore.getState().calTarget).toBe(before);
  });
});

describe('flag ON: the client reads its OWN coach-set plan', () => {
  it("replaces the gain defaults with the coach's lose-fat targets", async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'client-1' });
    fetchAthleteProfile.mockResolvedValueOnce(loseFatPlan);
    await useStore.getState().hydrateAthletePlan();
    expect(fetchAthleteProfile).toHaveBeenCalledWith('client-1');
    const s = useStore.getState();
    expect(s.proteinTarget).toBe(200);
    expect(s.calTarget).toBe(2200);
    expect(s.weightTarget).toBe(165);
    expect(s.weightTargetTouched).toBe(true);
    expect(s.scoringProfile).toBe('general');
  });

  it('leaves the local plan intact when there is no coach plan row', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'client-1' });
    const before = useStore.getState().calTarget;
    fetchAthleteProfile.mockResolvedValueOnce(null);
    await useStore.getState().hydrateAthletePlan();
    expect(useStore.getState().calTarget).toBe(before);
  });

  it('ignores a malformed plan row (partial targets) rather than half-applying', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'client-1' });
    const before = useStore.getState().calTarget;
    fetchAthleteProfile.mockResolvedValueOnce({ targets: { protein: 200 } });
    await useStore.getState().hydrateAthletePlan();
    expect(useStore.getState().calTarget).toBe(before);
  });

  it('does nothing without a signed-in user', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: null });
    await useStore.getState().hydrateAthletePlan();
    expect(fetchAthleteProfile).not.toHaveBeenCalled();
  });

  it('keeps the local plan if the read throws (offline / not permitted)', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'client-1' });
    const before = useStore.getState().calTarget;
    fetchAthleteProfile.mockRejectedValueOnce(new Error('network'));
    await useStore.getState().hydrateAthletePlan();
    expect(useStore.getState().calTarget).toBe(before);
  });
});
