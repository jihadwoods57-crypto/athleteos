// OnStandard — linking store actions (coach/trainer connect, join requests, connect
// overlay). Proves the actions route through the right RPC when live and stay inert /
// local-only when the backend is off. The supabase lib is mocked; isBackendLive is
// toggled per case via isolateModules (mirrors auth.test.ts). The SQL/RLS convergence
// invariants (pending invisible until active, one-row on either order) are verified with
// psql against a project — they can't run in node.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const joinTeam = jest.fn<Promise<string | null>, [string, string?]>();
const joinPractice = jest.fn<Promise<string | null>, [string]>();
const requestJoinTeam = jest.fn<Promise<string | null>, [string, string?]>();
const createPractice = jest.fn<Promise<string | null>, [string, string?, boolean?]>();
const createTeam = jest.fn<Promise<string | null>, [string, string?, string?, boolean?]>();
const setMyTeamCode = jest.fn<Promise<string | null>, [string]>();
const regenerateMyTeamCode = jest.fn<Promise<string | null>, []>();
const setMyPracticeCode = jest.fn<Promise<string | null>, [string]>();
const regenerateMyPracticeCode = jest.fn<Promise<string | null>, []>();

function loadStore(backendLive: boolean): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      isSupabaseConfigured: backendLive,
      auth: {},
      db: {
        fetchDay: jest.fn().mockResolvedValue(null),
        upsertDay: jest.fn().mockResolvedValue(undefined),
        fetchGuardianRequests: jest.fn().mockResolvedValue([]),
        joinTeam,
        joinPractice,
        requestJoinTeam,
        createPractice,
        createTeam,
        setMyTeamCode,
        regenerateMyTeamCode,
        setMyPracticeCode,
        regenerateMyPracticeCode,
      },
    }));
    store = require('./useStore').useStore;
  });
  return store;
}

beforeEach(() => {
  joinTeam.mockReset().mockResolvedValue('t1');
  joinPractice.mockReset().mockResolvedValue('p1');
  requestJoinTeam.mockReset().mockResolvedValue('t1');
  createPractice.mockReset().mockResolvedValue(null);
  createTeam.mockReset().mockResolvedValue(null);
  setMyTeamCode.mockReset();
  regenerateMyTeamCode.mockReset();
  setMyPracticeCode.mockReset();
  regenerateMyPracticeCode.mockReset();
});

describe('connectCoach / connectTrainer (code door)', () => {
  it('connectCoach marks the coach + joins the team by code when live', () => {
    const useStore = loadStore(true);
    useStore.getState().connectCoach('  eagles24 ');
    const s = useStore.getState();
    expect(s.supportTeam).toContain('coach');
    expect(s.inviteCode).toBe('EAGLES24'); // trimmed + uppercased
    expect(joinTeam).toHaveBeenCalledWith('EAGLES24');
  });

  it('connectTrainer marks the trainer + joins the practice by code when live', () => {
    const useStore = loadStore(true);
    useStore.getState().connectTrainer('apex01');
    const s = useStore.getState();
    expect(s.supportTeam).toContain('trainer');
    expect(joinPractice).toHaveBeenCalledWith('APEX01');
  });

  it('connectTrainer updates the local model but skips the RPC when the backend is off', () => {
    const useStore = loadStore(false);
    useStore.getState().connectTrainer('APEX01');
    expect(useStore.getState().supportTeam).toContain('trainer');
    expect(joinPractice).not.toHaveBeenCalled();
  });
});

describe('requestJoinTeamLive (athlete-first request)', () => {
  it('calls request_join_team and reports success when live', async () => {
    const useStore = loadStore(true);
    expect(await useStore.getState().requestJoinTeamLive('team-1', 'WR')).toBe(true);
    expect(requestJoinTeam).toHaveBeenCalledWith('team-1', 'WR');
  });

  it('is inert (false) when the backend is off', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().requestJoinTeamLive('team-1')).toBe(false);
    expect(requestJoinTeam).not.toHaveBeenCalled();
  });
});

describe('createPracticeLive (trainer mint)', () => {
  it('mints a practice with the @handle and stores the code when live', async () => {
    createPractice.mockResolvedValue('CODE99');
    const useStore = loadStore(true);
    const code = await useStore.getState().createPracticeLive('Apex', 'coachmaya', true);
    expect(code).toBe('CODE99');
    expect(createPractice).toHaveBeenCalledWith('Apex', 'coachmaya', true);
    expect(useStore.getState().teamCode).toBe('CODE99');
  });

  it('no-ops when the backend is off', async () => {
    const useStore = loadStore(false);
    expect(await useStore.getState().createPracticeLive('Apex', 'h')).toBeNull();
    expect(createPractice).not.toHaveBeenCalled();
  });
});

describe('Connect overlay + Home card state', () => {
  it('openConnect carries a prefill code; closeConnect clears it', () => {
    const useStore = loadStore(false);
    useStore.getState().openConnect('EAGLES24');
    expect(useStore.getState().connectOpen).toBe(true);
    expect(useStore.getState().connectPrefillCode).toBe('EAGLES24');
    useStore.getState().closeConnect();
    expect(useStore.getState().connectOpen).toBe(false);
    expect(useStore.getState().connectPrefillCode).toBeNull();
  });

  it('dismissConnectCard sets the persisted dismissal flag', () => {
    const useStore = loadStore(false);
    expect(useStore.getState().connectCardDismissed).toBe(false);
    useStore.getState().dismissConnectCard();
    expect(useStore.getState().connectCardDismissed).toBe(true);
  });
});

describe('custom / regenerate invite code', () => {
  it('coach: setInviteCodeCustom routes to the team RPC + stores the saved code', async () => {
    setMyTeamCode.mockResolvedValue('GATORS');
    const useStore = loadStore(true);
    useStore.getState().enterCoach();
    const res = await useStore.getState().setInviteCodeCustom('gators');
    expect(res.ok).toBe(true);
    expect(setMyTeamCode).toHaveBeenCalledWith('gators');
    expect(useStore.getState().teamCode).toBe('GATORS');
  });

  it('trainer: setInviteCodeCustom routes to the practice RPC', async () => {
    setMyPracticeCode.mockResolvedValue('APEX');
    const useStore = loadStore(true);
    useStore.getState().enterTrainer();
    const res = await useStore.getState().setInviteCodeCustom('apex');
    expect(res.ok).toBe(true);
    expect(setMyPracticeCode).toHaveBeenCalledWith('apex');
    expect(setMyTeamCode).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error when the code is taken', async () => {
    setMyTeamCode.mockRejectedValue(new Error('That code is already taken — try another'));
    const useStore = loadStore(true);
    useStore.getState().enterCoach();
    const res = await useStore.getState().setInviteCodeCustom('TAKEN');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already taken/);
  });

  it('regenerateInviteCode (coach) stores the new random code', async () => {
    regenerateMyTeamCode.mockResolvedValue('AB12CD');
    const useStore = loadStore(true);
    useStore.getState().enterCoach();
    const code = await useStore.getState().regenerateInviteCode();
    expect(code).toBe('AB12CD');
    expect(useStore.getState().teamCode).toBe('AB12CD');
  });

  it('is inert (no RPC) when the backend is off', async () => {
    const useStore = loadStore(false);
    useStore.getState().enterCoach();
    const res = await useStore.getState().setInviteCodeCustom('X');
    expect(res.ok).toBe(false);
    expect(setMyTeamCode).not.toHaveBeenCalled();
  });
});
