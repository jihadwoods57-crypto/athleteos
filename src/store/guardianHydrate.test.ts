// AthleteOS — guardian-consent read-back store seam (go-live G2). Proves hydrateGuardianConsent
// is inert when the backend flag is off (a minor stays gated, status untouched) and, when on,
// reflects ONLY the server's value — a real 'verified' row unblocks the minor; pending/revoked/
// absent leave them gated. The supabase lib is mocked; isBackendLive is toggled per case.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

type GReq = { status: string };
const fetchGuardianRequests = jest.fn<Promise<GReq[]>, [string]>();
const signIn = jest.fn();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn, signOut: jest.fn().mockResolvedValue(undefined) },
      db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay: jest.fn().mockResolvedValue(undefined), fetchGuardianRequests },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => {
  fetchGuardianRequests.mockReset().mockResolvedValue([]);
  signIn.mockReset();
});

describe('flag OFF: guardian read-back is inert', () => {
  it('no-ops and never touches the query (a minor stays gated)', async () => {
    const useStore = loadStore(false);
    useStore.setState({ userId: 'minor-1', guardianStatus: 'pending' });
    await useStore.getState().hydrateGuardianConsent();
    expect(fetchGuardianRequests).not.toHaveBeenCalled();
    expect(useStore.getState().guardianStatus).toBe('pending'); // untouched
  });
});

describe('flag ON: reflects the SERVER status only', () => {
  it('a server-verified row unblocks the minor (pending -> verified)', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'minor-1', guardianStatus: 'pending' });
    fetchGuardianRequests.mockResolvedValueOnce([{ status: 'verified' }]);
    await useStore.getState().hydrateGuardianConsent();
    expect(fetchGuardianRequests).toHaveBeenCalledWith('minor-1');
    expect(useStore.getState().guardianStatus).toBe('verified');
  });

  it('a pending row stays pending', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'minor-1', guardianStatus: 'none' });
    fetchGuardianRequests.mockResolvedValueOnce([{ status: 'pending' }]);
    await useStore.getState().hydrateGuardianConsent();
    expect(useStore.getState().guardianStatus).toBe('pending');
  });

  it('no rows (or only revoked) resolves to none', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'minor-1', guardianStatus: 'pending' });
    fetchGuardianRequests.mockResolvedValueOnce([{ status: 'revoked' }]);
    await useStore.getState().hydrateGuardianConsent();
    expect(useStore.getState().guardianStatus).toBe('none');
  });

  it('does nothing without a signed-in user', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: null, guardianStatus: 'pending' });
    await useStore.getState().hydrateGuardianConsent();
    expect(fetchGuardianRequests).not.toHaveBeenCalled();
    expect(useStore.getState().guardianStatus).toBe('pending');
  });

  it('keeps the fail-closed local status if the query throws', async () => {
    const useStore = loadStore(true);
    useStore.setState({ userId: 'minor-1', guardianStatus: 'pending' });
    fetchGuardianRequests.mockRejectedValueOnce(new Error('network'));
    await useStore.getState().hydrateGuardianConsent();
    expect(useStore.getState().guardianStatus).toBe('pending'); // never downgraded on error
  });
});
