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
const coachSetGoals = jest.fn<Promise<void>, [string, unknown, unknown]>();
const fetchEntitlement = jest.fn<Promise<unknown>, [string]>();
const fetchProfile = jest.fn<Promise<unknown>, [string]>();

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
      db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay: jest.fn().mockResolvedValue(undefined), createTeam, coachSetGoals, fetchEntitlement, fetchProfile, fetchGuardianRequests: jest.fn().mockResolvedValue([]), revokeViewer: jest.fn().mockResolvedValue(undefined) },
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
  coachSetGoals.mockReset().mockResolvedValue(undefined);
  fetchEntitlement.mockReset().mockResolvedValue(null);
  fetchProfile.mockReset().mockResolvedValue(null);
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

  it('pushAthleteGoals no-ops when off (never touches the RPC)', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().pushAthleteGoals('ath-1', { protein: 180, calories: 3200, weight: 184 })).toBe(false);
    expect(coachSetGoals).not.toHaveBeenCalled();
  });

  it('refreshEntitlement no-ops when off (stays on free preview)', async () => {
    const useStore = loadStore(false);
    useStore.setState({ userId: 'coach-1' });
    await useStore.getState().refreshEntitlement();
    expect(fetchEntitlement).not.toHaveBeenCalled();
    expect(useStore.getState().entitlement.tier).toBe('preview');
  });

  it('hydrateProfile no-ops when off (identity stays local)', async () => {
    const useStore = loadStore(false);
    useStore.setState({ userId: 'coach-1' });
    await useStore.getState().hydrateProfile();
    expect(fetchProfile).not.toHaveBeenCalled();
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
    expect(useStore.getState().emailConfirmPending).toBe(false); // no needsConfirmation -> no false "check email"
  });

  it('signUpLive flags emailConfirmPending when the project requires confirmation (confirm-ON)', async () => {
    signUp.mockResolvedValue({ ok: true, userId: 'u-3', needsConfirmation: true });
    const useStore = loadStore(true);
    await useStore.getState().signUpLive('e@f.io', 'pw', 'Eve');
    expect(useStore.getState().emailConfirmPending).toBe(true); // panel will honestly say "check your email"
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

  it('hydrateProfile reads the real name/org/email back from the profile row', async () => {
    fetchProfile.mockResolvedValue({ id: 'u1', full_name: 'Coach Reyes', org_name: 'North HS', email: 'c@s.io', primary_role: 'coach' });
    const useStore = loadStore(true);
    useStore.setState({ userId: 'u1', athleteName: '', orgName: '', athleteEmail: '' });
    await useStore.getState().hydrateProfile();
    expect(fetchProfile).toHaveBeenCalledWith('u1');
    expect(useStore.getState().athleteName).toBe('Coach Reyes');
    expect(useStore.getState().orgName).toBe('North HS');
    expect(useStore.getState().athleteEmail).toBe('c@s.io');
  });

  it('hydrateProfile keeps the local identity when the backend fields are empty', async () => {
    fetchProfile.mockResolvedValue({ id: 'u1', full_name: null, org_name: null, email: null, primary_role: 'coach' });
    const useStore = loadStore(true);
    useStore.setState({ userId: 'u1', athleteName: 'Local Name', orgName: 'Local Org' });
    await useStore.getState().hydrateProfile();
    expect(useStore.getState().athleteName).toBe('Local Name');
    expect(useStore.getState().orgName).toBe('Local Org');
  });

  it('refreshEntitlement reads a team subscription into the entitlement', async () => {
    fetchEntitlement.mockResolvedValue({ tier: 'team', status: 'active', seats: 24, seats_used: 18, current_period_end: '2026-08-01' });
    const useStore = loadStore(true);
    useStore.setState({ userId: 'coach-1' });
    await useStore.getState().refreshEntitlement();
    expect(fetchEntitlement).toHaveBeenCalledWith('coach-1');
    expect(useStore.getState().entitlement).toEqual({ tier: 'team', status: 'active', seats: 24, seatsUsed: 18, renewsAt: '2026-08-01' });
  });

  it('pushAthleteGoals routes a roster athlete plan through coach_set_goals', async () => {
    const useStore = loadStore(true);
    const t = { protein: 180, calories: 3200, weight: 184 };
    const ok = await useStore.getState().pushAthleteGoals('ath-1', t);
    expect(ok).toBe(true);
    expect(coachSetGoals).toHaveBeenCalledWith('ath-1', t, null);
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

  it('signOut terminates the Supabase session AND resets navigation', async () => {
    // The Sign-out buttons call signOut, which must do BOTH: end the real session
    // (auth.signOut + clear userId/consent) so no live session/token lingers, and
    // reset nav back to onboarding. A nav-only reset would leave a signed-in session.
    signIn.mockResolvedValue({ ok: true, userId: 'u-9' });
    const useStore = loadStore(true);
    await useStore.getState().signInLive('a@b.io', 'pw');
    useStore.getState().recordConsent(true);
    useStore.setState({ flow: 'app', role: 'athlete', accountOpen: true });
    useStore.getState().signOut();
    await Promise.resolve(); // let the backgrounded signOutLive settle
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(useStore.getState().userId).toBeNull();
    expect(useStore.getState().realDataConsent).toBe(false);
    expect(useStore.getState().flow).toBe('onboarding');
    expect(useStore.getState().role).toBeNull();
    expect(useStore.getState().accountOpen).toBe(false);
  });

  it('signOut resets onboarding profile state so the next user does not inherit goal/targets', async () => {
    const useStore = loadStore(true);
    useStore.setState({ baseGoal: 'lose', primaryGoal: 'lose_fat', weightTarget: 164, sport: 'Football' });
    useStore.getState().signOut();
    await Promise.resolve();
    expect(useStore.getState().primaryGoal).toBeNull(); // back to a clean onboarding
    expect(useStore.getState().weightTarget).not.toBe(164); // stale target cleared (no leak into next user)
    expect(useStore.getState().sport).toBeNull();
  });

  it('deleteAccount erases server-side then ends the local session', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-7' });
    const useStore = loadStore(true);
    await useStore.getState().signInLive('a@b.io', 'pw');
    await useStore.getState().deleteAccount();
    // auth.signOut is called so the deleted account's refresh token doesn't linger.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(useStore.getState().userId).toBeNull();
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
        db: { fetchDay: jest.fn().mockResolvedValue(null), upsertDay, revokeViewer: jest.fn().mockResolvedValue(undefined) },
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
