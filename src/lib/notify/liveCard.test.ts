// What happens to the lock-screen card after an answer that did NOT come through a window code:
// the app's drain of a native tap, and an in-app "I'm up". Only roll-call-ack's code path sends the
// answered update by itself, so these ask the server to (the refresh route), and an older binary
// or a failed refresh ends the card locally rather than leave it counting down until the close.
const mockState = {
  invoked: [] as Array<{ name: string; body: unknown }>,
  refresh: { data: { ok: true, refreshed: true } as unknown, error: null as unknown },
  rpcError: null as null | { message: string },
  ackPoster: true,
  ended: [] as string[],
  taps: [] as Array<{ instanceId: string; at: number; board?: boolean }>,
  store: new Map<string, string>(),
};

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockState.store.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockState.store.set(k, v); },
  },
}));
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async () => ({ error: mockState.rpcError }),
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        mockState.invoked.push({ name, body: opts.body });
        return mockState.refresh;
      },
    },
  },
}));
jest.mock('../../../modules/rollcall-live', () => ({
  drainPendingTaps: () => { const t = mockState.taps; mockState.taps = []; return t; },
  hasAckPoster: () => mockState.ackPoster,
  endLiveActivity: async (id: string) => { mockState.ended.push(id); },
  cancelWakeAlarm: () => undefined,
  isAlarmSupported: () => false,
}));

import { settleLiveCard, drainLiveActivityTaps, takeBoardRoute } from './rollcall';

beforeEach(() => {
  mockState.invoked = [];
  mockState.refresh = { data: { ok: true, refreshed: true }, error: null };
  mockState.rpcError = null;
  mockState.ackPoster = true;
  mockState.ended = [];
  mockState.taps = [];
  mockState.store.clear();
  takeBoardRoute();
});

describe('settleLiveCard', () => {
  test('asks the server to turn the card, for that instance only', async () => {
    expect(await settleLiveCard('i1')).toBe('sent');
    expect(mockState.invoked).toEqual([{ name: 'roll-call-ack', body: { action: 'refresh', instance_id: 'i1' } }]);
    expect(mockState.ended).toEqual([]);
  });

  test('a throttled refresh (a code ack already turned it) leaves the card alone', async () => {
    mockState.refresh = { data: { ok: true, refreshed: false }, error: null };
    expect(await settleLiveCard('i1')).toBe('skipped');
    expect(mockState.ended).toEqual([]);
  });

  test('an older binary ends the card, as it always did', async () => {
    mockState.ackPoster = false;
    await settleLiveCard('i1');
    expect(mockState.ended).toEqual(['i1']);
  });

  test('a refresh that failed (offline, a queued answer) ends the card rather than leave it counting', async () => {
    mockState.refresh = { data: null, error: { message: 'offline' } };
    expect(await settleLiveCard('i1')).toBe('failed');
    expect(mockState.ended).toEqual(['i1']);
  });

  test('does nothing for an empty id', async () => {
    expect(await settleLiveCard('')).toBe('failed');
    expect(mockState.invoked).toEqual([]);
    expect(mockState.ended).toEqual([]);
  });
});

describe('the drain', () => {
  test('a drained tap that lands refreshes the card instead of ending it', async () => {
    mockState.taps = [{ instanceId: 'i1', at: Date.now() - 1000 }];
    expect(await drainLiveActivityTaps()).toBe(1);
    expect(mockState.invoked).toEqual([{ name: 'roll-call-ack', body: { action: 'refresh', instance_id: 'i1' } }]);
    expect(mockState.ended).toEqual([]);
  });

  test('on an older binary the drained tap ends the card', async () => {
    mockState.ackPoster = false;
    mockState.taps = [{ instanceId: 'i1', at: Date.now() - 1000 }];
    await drainLiveActivityTaps();
    expect(mockState.ended).toEqual(['i1']);
  });

  test('a tap the server refused touches nothing on the card', async () => {
    mockState.rpcError = { message: 'closed' };
    mockState.taps = [{ instanceId: 'i1', at: Date.now() - 1000 }];
    expect(await drainLiveActivityTaps()).toBe(0);
    expect(mockState.invoked).toEqual([]);
    expect(mockState.ended).toEqual([]);
  });

  test('a fresh tap from the alarm button asks for the board; a stale one does not', async () => {
    mockState.taps = [{ instanceId: 'i1', at: Date.now() - 60_000, board: true }];
    await drainLiveActivityTaps();
    expect(takeBoardRoute()).toBe('rollcall-board/i1');
    expect(takeBoardRoute()).toBeNull();
    mockState.taps = [{ instanceId: 'i2', at: Date.now() - 2 * 3600_000, board: true }];
    await drainLiveActivityTaps();
    expect(takeBoardRoute()).toBeNull();
  });
});
