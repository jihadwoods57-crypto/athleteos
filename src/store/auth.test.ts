// OnStandard — live-auth store seam (Stage B). Proves the auth actions are inert
// when the flag is off (mock path untouched) and route through the auth wrappers,
// storing userId / authError, when on. The supabase lib is mocked; isBackendLive is
// toggled per case via isolateModules so both flag states are exercised in node.
import type { AuthResult } from '@/lib/supabase/auth';
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const signIn = jest.fn<Promise<AuthResult>, [string, string]>();
const fetchDay = jest.fn<Promise<unknown>, [string, string]>();
const joinTeam = jest.fn<Promise<string | null>, [string]>();
const joinPractice = jest.fn<Promise<string | null>, [string]>();
const signUp = jest.fn<Promise<AuthResult>, [string, string, string | undefined]>();
const signOut = jest.fn<Promise<void>, []>();
const resetPassword = jest.fn<Promise<AuthResult>, [string]>();
const signInWithAppleToken = jest.fn<Promise<AuthResult>, [string]>();
const createTeam = jest.fn<Promise<string | null>, [string, string | undefined]>();
const coachSetGoals = jest.fn<Promise<void>, [string, unknown, unknown]>();
const fetchEntitlement = jest.fn<Promise<unknown>, [string]>();
const fetchProfile = jest.fn<Promise<unknown>, [string]>();

// The real store type (including the persist API, which the hydration-settling
// tests below use) rather than a bare UseBoundStore.
type LiveStore = typeof import('./useStore').useStore;

function loadStore(backendLive: boolean): LiveStore {
  let store!: LiveStore;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: { signIn, signUp, signOut, resetPassword, signInWithAppleToken },
      // signInLive hydrates the day after auth; no remote row in these unit tests.
      db: { fetchDay, upsertDay: jest.fn().mockResolvedValue(undefined), fetchActiveTrustPass: jest.fn().mockResolvedValue(null), createTeam, coachSetGoals, fetchEntitlement, fetchProfile, fetchGuardianRequests: jest.fn().mockResolvedValue([]), revokeViewer: jest.fn().mockResolvedValue(undefined), joinTeam, joinPractice },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => {
  signIn.mockReset();
  fetchDay.mockReset().mockResolvedValue(null);
  joinTeam.mockReset().mockResolvedValue('team-1');
  joinPractice.mockReset().mockResolvedValue('practice-1');
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

  it('signInLive with no remote day resets the unowned showcase day to an honest empty day', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-1' });
    const useStore = loadStore(true);
    await useStore.persist.rehydrate(); // settle async hydration before acting
    // The pre-sign-in local state is the seeded showcase (blank athleteName,
    // 3 demo meals pre-logged). An account must never adopt it as its real day.
    expect(useStore.getState().athleteName).toBe('');
    expect(useStore.getState().meals.breakfast).toBe(true);
    await useStore.getState().signInLive('a@b.io', 'pw');
    const s = useStore.getState();
    expect(s.meals).toEqual({ breakfast: false, lunch: false, snack: false, dinner: false });
    expect(s.hydrationL).toBe(0);
    expect(s.tasks.some((t) => t.done)).toBe(false);
  });

  it('signInLive keeps a REAL local day when the server has none (same-device re-sign-in)', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-1' });
    const useStore = loadStore(true);
    await useStore.persist.rehydrate(); // settle async hydration before acting
    useStore.setState({
      athleteName: 'Marcus Cole',
      meals: { breakfast: true, lunch: false, snack: false, dinner: false },
      hydrationL: 1.2,
    });
    await useStore.getState().signInLive('a@b.io', 'pw');
    const s = useStore.getState();
    expect(s.meals).toEqual({ breakfast: true, lunch: false, snack: false, dinner: false });
    expect(s.hydrationL).toBe(1.2);
  });

  it('signInLive adopts the server day when one exists', async () => {
    signIn.mockResolvedValue({ ok: true, userId: 'u-1' });
    fetchDay.mockResolvedValue({
      athlete_id: 'u-1',
      date: '2026-07-03',
      meals: { breakfast: false, lunch: true, snack: false, dinner: false },
      hydration_l: 0.8,
      tasks: [],
      quick_added: [false, false, false],
      current_weight: 172,
      checkin: null,
      score: 61,
      grade: 'D',
    });
    const useStore = loadStore(true);
    await useStore.persist.rehydrate(); // settle async hydration before acting
    await useStore.getState().signInLive('a@b.io', 'pw');
    const s = useStore.getState();
    expect(s.meals.lunch).toBe(true);
    expect(s.meals.breakfast).toBe(false);
    expect(s.hydrationL).toBe(0.8);
    expect(s.currentWeight).toBe(172);
  });

  it('signInLive surfaces a FRIENDLY error + leaves userId null on failure', async () => {
    signIn.mockResolvedValue({ ok: false, error: 'Invalid login credentials' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signInLive('a@b.io', 'bad');
    expect(ok).toBe(false);
    expect(useStore.getState().userId).toBeNull();
    // The raw Supabase string is rewritten in product voice (audit copy fix), never leaked.
    expect(useStore.getState().authError).not.toBe('Invalid login credentials');
    expect(useStore.getState().authError).toMatch(/doesn't match/i);
  });

  it('signUpLive stores userId + forwards the full name + role + keeps the email', async () => {
    signUp.mockResolvedValue({ ok: true, userId: 'u-2' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().signUpLive(' c@d.io ', 'pw', ' Carla ');
    expect(ok).toBe(true);
    // Role rides the signup call so a returning overseer routes correctly (2026-07-04 fix);
    // the default onboarding role maps to 'athlete'.
    expect(signUp).toHaveBeenCalledWith('c@d.io', 'pw', 'Carla', 'athlete');
    expect(useStore.getState().userId).toBe('u-2');
    expect(useStore.getState().athleteEmail).toBe('c@d.io');
    expect(useStore.getState().emailConfirmPending).toBe(false); // no needsConfirmation -> no false "check email"
  });

  it('signUpLive persists a COACH role in the signup metadata', async () => {
    signUp.mockResolvedValue({ ok: true, userId: 'u-3' });
    const useStore = loadStore(true);
    useStore.setState({ role: 'sports_perf_coach' });
    await useStore.getState().signUpLive('coach@d.io', 'pw', 'Coach Reyes');
    expect(signUp).toHaveBeenCalledWith('coach@d.io', 'pw', 'Coach Reyes', 'coach');
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

  it('requestPasswordReset stays neutral on a real error but surfaces it (friendly)', async () => {
    resetPassword.mockResolvedValue({ ok: false, error: 'rate limited' });
    const useStore = loadStore(true);
    const ok = await useStore.getState().requestPasswordReset('a@b.io');
    expect(ok).toBe(false);
    // Surfaced in product voice, not the raw machine string.
    expect(useStore.getState().authError).toMatch(/too many attempts/i);
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
    expect(useStore.getState().entitlement).toEqual({
      tier: 'team', status: 'active', seats: 24, seatsUsed: 18, renewsAt: '2026-08-01',
      // 0042 lifecycle fields default safe on a pre-0042 row.
      planId: null, cancelAtPeriodEnd: false, paymentFailedAt: null,
    });
  });

  it('pushAthleteGoals routes a roster athlete plan through coach_set_goals', async () => {
    const useStore = loadStore(true);
    const t = { protein: 180, calories: 3200, weight: 184 };
    const ok = await useStore.getState().pushAthleteGoals('ath-1', t);
    expect(ok).toBe(true);
    expect(coachSetGoals).toHaveBeenCalledWith('ath-1', t, null);
  });

  it('pushAthleteGoals persists the chosen scoring profile inside the targets jsonb', async () => {
    // Constitution 11a: the coach owns the profile. Before this, the picker was
    // decorative — the selection was discarded on close and the editor re-seeded
    // recommendation defaults, silently overwriting the coach's prior plan.
    const useStore = loadStore(true);
    const t = { protein: 160, calories: 2400, weight: 170 };
    const ok = await useStore.getState().pushAthleteGoals('ath-1', t, 'general');
    expect(ok).toBe(true);
    expect(coachSetGoals).toHaveBeenCalledWith('ath-1', { ...t, profile: 'general' }, null);
  });

  it('joinTeamLive marks the coach connection only AFTER the join succeeds', async () => {
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    const ok = await useStore.getState().joinTeamLive('gators');
    expect(ok).toBe(true);
    expect(joinTeam).toHaveBeenCalledWith('GATORS');
    expect(useStore.getState().supportTeam).toContain('coach');
    expect(useStore.getState().inviteCode).toBe('GATORS');
  });

  it('joinTeamLive returns false and connects NOTHING when the join RPC fails', async () => {
    // Before: connectCoach fired joinTeam fire-and-forget and the UI showed
    // "You're on the roster" regardless — the athlete then waited forever for a
    // coach who never saw them.
    joinTeam.mockRejectedValue(new Error('revoked code'));
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    const ok = await useStore.getState().joinTeamLive('GATORS');
    expect(ok).toBe(false);
    expect(useStore.getState().supportTeam).not.toContain('coach');
    expect(useStore.getState().inviteCode).toBe('');
  });

  it('joinPracticeLive mirrors the same contract for trainers', async () => {
    joinPractice.mockRejectedValue(new Error('nope'));
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    expect(await useStore.getState().joinPracticeLive('APEX99')).toBe(false);
    expect(useStore.getState().supportTeam).not.toContain('trainer');
  });

  it('hydrateProfile routes a returning coach to the COACH app, not the athlete Home', async () => {
    // signinDone unconditionally lands every returning user on flow 'app' (athlete),
    // so a coach reinstalling saw an athlete demo day with no path to their roster.
    fetchProfile.mockResolvedValue({ full_name: 'Dana Reyes', org_name: 'Eastside HS', email: 'c@d.io', primary_role: 'hs_coach' });
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    useStore.setState({ userId: 'u-9', flow: 'app', role: null });
    await useStore.getState().hydrateProfile();
    expect(useStore.getState().flow).toBe('coach');
    expect(useStore.getState().role).toBe('hs_coach');
  });

  it('hydrateProfile never yanks an in-progress onboarding to another flow', async () => {
    fetchProfile.mockResolvedValue({ full_name: 'Dana Reyes', org_name: null, email: 'c@d.io', primary_role: 'hs_coach' });
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    useStore.setState({ userId: 'u-9', flow: 'onboarding', role: null });
    await useStore.getState().hydrateProfile();
    expect(useStore.getState().flow).toBe('onboarding');
  });

  it('grantTrustPass / endTrustPass are INERT when live — the pass is server-authoritative', async () => {
    // The athlete-facing Profile card carried a self-serve "Start 10-day pass"
    // button wired to a plain client set — under copy reading "Your coach unlocks
    // this." Live, only the coach RPC grants and only the server ends a pass.
    const useStore = loadStore(true);
    await useStore.persist.rehydrate();
    useStore.getState().grantTrustPass(10);
    expect(useStore.getState().trustPass).toBeNull();
    useStore.setState({ trustPass: { grantedDate: '2026-07-01', lengthDays: 10 } });
    useStore.getState().endTrustPass();
    expect(useStore.getState().trustPass).not.toBeNull();
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
    expect(createTeam).toHaveBeenCalledWith('Eastside Eagles', 'Football', null, false); // trimmed
    expect(useStore.getState().teamCode).toBe('K7M2QX');
  });

  it('createTeamLive falls back to a default team name when none given', async () => {
    createTeam.mockResolvedValue('AB12CD');
    const useStore = loadStore(true);
    await useStore.getState().createTeamLive('   ', undefined);
    expect(createTeam).toHaveBeenCalledWith('My Team', undefined, null, false);
  });

  it('createTeamLive forwards the selected school (org id) + discoverability', async () => {
    createTeam.mockResolvedValue('ZZ99YY');
    const useStore = loadStore(true);
    await useStore.getState().createTeamLive('Eastside HS', 'Football', 'org-123', true);
    expect(createTeam).toHaveBeenCalledWith('Eastside HS', 'Football', 'org-123', true);
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
