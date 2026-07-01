// OnStandard — openMealHistory store action. Proves the client-history fetch is gated:
// flag OFF -> never fetches, mealHistory stays null (overlay falls back to local
// meals); flag ON with a signed-in user -> fetches the bounded window and stores the
// rows. The supabase lib is mocked; isBackendLive is toggled via isolateModules.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { MealRow } from '@/lib/supabase';

const fetchRecentMeals = jest.fn<Promise<MealRow[]>, [string, string]>();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn() },
      db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay: jest.fn().mockResolvedValue(undefined), fetchRecentMeals },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fetchRecentMeals.mockReset().mockResolvedValue([]);
});

describe('openMealHistory', () => {
  it('flag OFF: opens the overlay but never fetches (local fallback, mealHistory null)', async () => {
    const useStore = loadStore(false);
    useStore.getState().openMealHistory();
    await flush();
    expect(useStore.getState().mealHistoryOpen).toBe(true);
    expect(useStore.getState().mealHistory).toBeNull();
    expect(fetchRecentMeals).not.toHaveBeenCalled();
  });

  it('flag ON but no signed-in user: opens, does not fetch', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: null });
    useStore.getState().openMealHistory();
    await flush();
    expect(useStore.getState().mealHistoryOpen).toBe(true);
    expect(fetchRecentMeals).not.toHaveBeenCalled();
  });

  it('flag ON + user: fetches the window and stores the rows', async () => {
    const rows = [
      { id: 'm1', athlete_id: 'u-1', day_date: '2026-06-28', type: 'dinner', photo_path: null, name: 'Chicken', protein: 52, kcal: 680, carbs: 64, fat: 18, quality: 94, detected: [], note: null, logged_at: '2026-06-28T19:00:00Z' },
    ] as MealRow[];
    fetchRecentMeals.mockResolvedValue(rows);
    const useStore = loadStore(true);
    useStore.setState({ userId: 'u-1' });
    useStore.getState().openMealHistory();
    await flush();
    expect(fetchRecentMeals).toHaveBeenCalledTimes(1);
    expect(fetchRecentMeals.mock.calls[0][0]).toBe('u-1');
    expect(useStore.getState().mealHistory).toEqual(rows);
  });

  it('closeMealHistory hides the overlay', () => {
    const useStore = loadStore(false);
    useStore.getState().openMealHistory();
    useStore.getState().closeMealHistory();
    expect(useStore.getState().mealHistoryOpen).toBe(false);
  });
});
