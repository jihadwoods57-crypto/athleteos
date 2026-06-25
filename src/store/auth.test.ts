// AthleteOS — live-auth store seam (Stage B). Proves the auth actions are inert
// when the flag is off (mock path untouched) and route through the auth wrappers,
// storing userId / authError, when on. The supabase lib is mocked; isBackendLive is
// toggled per case via isolateModules so both flag states are exercised in node.
import type { AuthResult } from '@/lib/supabase/auth';
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const signIn = jest.fn<Promise<AuthResult>, [string, string]>();
const signUp = jest.fn<Promise<AuthResult>, [string, string, string | undefined]>();
const signOut = jest.fn<Promise<void>, []>();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn, signUp, signOut },
      db: {},
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => {
  signIn.mockReset();
  signUp.mockReset();
  signOut.mockReset().mockResolvedValue(undefined);
});

describe('flag OFF: live auth is inert (mock path preserved)', () => {
  it('signInLive / signUpLive no-op and never touch the auth wrappers', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().signInLive('a@b.io', 'pw')).toBe(false);
    expect(await useStore.getState().signUpLive('a@b.io', 'pw', 'Ann')).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
    expect(useStore.getState().userId).toBeNull();
  });
});

describe('flag ON: live auth routes through the wrappers', () => {
  it('signInLive stores userId + clears error on success', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-1' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signInLive(' a@b.io ', 'pw');
    expect(ok).toBe(true);
    expect(signIn).toHaveBeenCalledWith('a@b.io', 'pw'); // trimmed email
    expect(useStore.getState().userId).toBe('u-1');
    expect(useStore.getState().authError).toBeNull();
  });

  it('signInLive surfaces the error + leaves userId null on failure', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'Invalid login credentials' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signInLive('a@b.io', 'bad');
    expect(ok).toBe(false);
    expect(useStore.getState().userId).toBeNull();
    expect(useStore.getState().authError).toBe('Invalid login credentials');
  });

  it('signUpLive stores userId + forwards the full name', async () => {
    signUp.mockResolvedValue({ ok: true, userId: 'u-2' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signUpLive('c@d.io', 'pw', ' Carla ');
    expect(ok).toBe(true);
    expect(signUp).toHaveBeenCalledWith('c@d.io', 'pw', 'Carla');
    expect(useStore.getState().userId).toBe('u-2');
  });

  it('signOutLive calls the wrapper and clears the session', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-1' });
    const useStore = loadStore(true);
    await useStore.getState().signInLive('a@b.io', 'pw');
    useStore.getState().recordConsent(true);
    await useStore.getState().signOutLive();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(useStore.getState().userId).toBeNull();
    expect(useStore.getState().realDataConsent).toBe(false);
  });
});

describe('recordConsent / setAuthError', () => {
  it('recordConsent flips the hard gate flag both ways', () => {
    const useStore = loadStore(true);
    useStore.getState().recordConsent(true);
    expect(useStore.getState().realDataConsent).toBe(true);
    useStore.getState().recordConsent(false);
    expect(useStore.getState().realDataConsent).toBe(false);
  });

  it('setAuthError sets and clears the message', () => {
    const useStore = loadStore(true);
    useStore.getState().setAuthError('boom');
    expect(useStore.getState().authError).toBe('boom');
    useStore.getState().setAuthError(null);
    expect(useStore.getState().authError).toBeNull();
  });
});
