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
const resetPassword = jest.fn<Promise<AuthResult>, [string]>();
const signInWithAppleToken = jest.fn<Promise<AuthResult>, [string]>();
const createTeam = jest.fn<Promise<string | null>, [string, string | undefined]>();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn, signUp, signOut, resetPassword, signInWithAppleToken },
      // signInLive hydrates the day after auth; no remote row in these unit tests.
      db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay: jest.fn().mockResolvedValue(undefined), createTeam },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => {
  signIn.mockReset();
  signUp.mockReset();
  signOut.mockReset().mockResolvedValue(undefined);
  resetPassword.mockReset();
  signInWithAppleToken.mockReset();
  createTeam.mockReset();
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

  it('createTeamLive no-ops and leaves the EAGLES24-fallback teamCode empty', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().createTeamLive('Eastside Eagles', 'Football')).toBeNull();
    expect(createTeam).not.toHaveBeenCalled();
    expect(useStore.getState().teamCode).toBe('');
  });

  it('signInWithApple no-ops; requestPasswordReset shows a neutral local confirmation', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().signInWithApple('tok')).toBe(false);
    expect(signInWithAppleToken).not.toHaveBeenCalled();
    // reset is allowed to "succeed" locally so the screen behaves the same, but the
    // wrapper is never called and no email goes out.
    expect(await useStore.getState().requestPasswordReset('a@b.io')).toBe(true);
    expect(resetPassword).not.toHaveBeenCalled();
    expect(useStore.getState().passwordResetSent).toBe(true);
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

  it('signUpLive stores userId + forwards the full name + keeps the email', async () => {
    signUp.mockResolvedValue({ ok: true, userId: 'u-2' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signUpLive(' c@d.io ', 'pw', ' Carla ');
    expect(ok).toBe(true);
    expect(signUp).toHaveBeenCalledWith('c@d.io', 'pw', 'Carla');
    expect(useStore.getState().userId).toBe('u-2');
    expect(useStore.getState().athleteEmail).toBe('c@d.io');
  });

  it('requestPasswordReset routes through the wrapper + sets the sent flag', async () => {
    resetPassword.mockResolvedValue({ ok: true, userId: '' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().requestPasswordReset('a@b.io');
    expect(ok).toBe(true);
    expect(resetPassword).toHaveBeenCalledWith('a@b.io');
    expect(useStore.getState().passwordResetSent).toBe(true);
  });

  it('requestPasswordReset stays neutral on a real error but surfaces it', async () => {
    resetPassword.mockResolvedValue({ ok: false, error: 'rate limited' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().requestPasswordReset('a@b.io');
    expect(ok).toBe(false);
    expect(useStore.getState().authError).toBe('rate limited');
    expect(useStore.getState().passwordResetSent).toBe(false);
  });

  it('signInWithApple stores userId on a valid token', async () => {
    signInWithAppleToken.mockResolvedValue({ ok: true, userId: 'u-apple' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signInWithApple('tok');
    expect(ok).toBe(true);
    expect(signInWithAppleToken).toHaveBeenCalledWith('tok');
    expect(useStore.getState().userId).toBe('u-apple');
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

  it('createTeamLive mints a team + stores the real server code', async () => {
    createTeam.mockResolvedValue('K7M2QX');
    const useStore = loadStore(true);
    const code = await useStore.getState().createTeamLive('  Eastside Eagles ', 'Football');
    expect(code).toBe('K7M2QX');
    expect(createTeam).toHaveBeenCalledWith('Eastside Eagles', 'Football'); // trimmed
    expect(useStore.getState().teamCode).toBe('K7M2QX');
  });

  it('createTeamLive falls back to a default team name when none given', async () => {
    createTeam.mockResolvedValue('AB12CD');
    const useStore = loadStore(true);
    await useStore.getState().createTeamLive('   ', undefined);
    expect(createTeam).toHaveBeenCalledWith('My Team', undefined);
  });

  it('createTeamLive surfaces an RPC error and leaves teamCode empty', async () => {
    createTeam.mockRejectedValue(new Error('rpc boom'));
    const useStore = loadStore(true);
    const code = await useStore.getState().createTeamLive('Team', 'Soccer');
    expect(code).toBeNull();
    expect(useStore.getState().teamCode).toBe('');
    expect(useStore.getState().authError).toBe('rpc boom');
  });
});

describe('Stage C: a mutating action debounces a consent-gated pushDay', () => {
  let upsertDay: jest.Mock;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function loadStoreWithDb(backendLive: boolean) {
    upsertDay = jest.fn().mockResolvedValue(undefined);
    let useStore!: UseBoundStore<StoreApi<Store>>;
    jest.isolateModules(() => {
      jest.doMock('@react-native-async-storage/async-storage', () =>
        require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
      );
      jest.doMock('@/lib/supabase', () => ({
        isBackendLive: backendLive,
        isSupabaseConfigured: backendLive,
        auth: { signIn, signUp, signOut },
        db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay },
      }));
      useStore = require('./useStore').useStore;
    });
    return useStore;
  }

  it('flag ON + consent: addMeal schedules one pushDay after the debounce', async () => {
    const useStore = loadStoreWithDb(true);
    useStore.setState({ userId: 'u-1', realDataConsent: true, role: 'athlete', baseAge: 22 });
    useStore.getState().addMeal();
    expect(upsertDay).not.toHaveBeenCalled(); // debounced, not immediate
    await jest.advanceTimersByTimeAsync(1300);
    expect(upsertDay).toHaveBeenCalledTimes(1);
  });

  it('flag ON but NO consent: addMeal schedules a push that fails closed (no write)', async () => {
    const useStore = loadStoreWithDb(true);
    useStore.setState({ userId: 'u-1', realDataConsent: false, role: 'athlete', baseAge: 16 });
    useStore.getState().addMeal();
    await jest.advanceTimersByTimeAsync(1300);
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('flag OFF: addMeal schedules nothing (flag-OFF behaviour identical)', async () => {
    const useStore = loadStoreWithDb(false);
    useStore.setState({ userId: 'u-1', realDataConsent: true, role: 'athlete', baseAge: 22 });
    useStore.getState().addMeal();
    await jest.advanceTimersByTimeAsync(1300);
    expect(upsertDay).not.toHaveBeenCalled();
  });

  it('paused sharing fails the push closed even with consent; un-pausing resumes it', async () => {
    const useStore = loadStoreWithDb(true);
    useStore.setState({ userId: 'u-1', realDataConsent: true, role: 'athlete', baseAge: 22, sharingPaused: true });
    useStore.getState().addMeal();
    await jest.advanceTimersByTimeAsync(1300);
    expect(upsertDay).not.toHaveBeenCalled(); // paused -> nothing leaves the device
    useStore.getState().togglePauseSharing(); // resume -> schedules a push
    await jest.advanceTimersByTimeAsync(1300);
    expect(upsertDay).toHaveBeenCalledTimes(1);
  });

  it('removeViewer revokes a linked role from the accountability circle', () => {
    const useStore = loadStoreWithDb(true);
    useStore.setState({ supportTeam: ['coach', 'parent', 'trainer'] });
    useStore.getState().removeViewer('parent');
    expect(useStore.getState().supportTeam).toEqual(['coach', 'trainer']);
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
