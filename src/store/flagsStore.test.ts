// Hermetic: stub the supabase client (no real session/network) and configure the backend URL so
// refresh() has an endpoint to hit. fetch is mocked per-test.
jest.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { useFlagsStore, DEFAULT_FLAGS, getFlag } from './flagsStore';

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://x.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

beforeEach(() => {
  useFlagsStore.setState({ map: { ...DEFAULT_FLAGS }, source: 'default' });
});

function mockFetchOnce(payload: unknown, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValueOnce({ ok, json: async () => payload });
}

describe('flagsStore', () => {
  test('refresh success replaces the map and marks source=network', async () => {
    mockFetchOnce({ flags: { engines: true }, fetched_at: 'now' });
    await useFlagsStore.getState().refresh();
    expect(useFlagsStore.getState().map.engines).toBe(true);
    expect(useFlagsStore.getState().source).toBe('network');
  });

  test('refresh merges over defaults (missing keys keep their default)', async () => {
    mockFetchOnce({ flags: { engines: true }, fetched_at: 'now' });
    await useFlagsStore.getState().refresh();
    expect(useFlagsStore.getState().map.meal_plans).toBe(false); // untouched default
  });

  test('refresh failure keeps existing map and does not throw', async () => {
    useFlagsStore.setState({ map: { engines: true }, source: 'cache' });
    (global as any).fetch = jest.fn().mockRejectedValueOnce(new Error('offline'));
    await expect(useFlagsStore.getState().refresh()).resolves.toBeUndefined();
    expect(useFlagsStore.getState().map.engines).toBe(true); // unchanged
  });

  test('non-ok response keeps existing map', async () => {
    useFlagsStore.setState({ map: { engines: true }, source: 'cache' });
    mockFetchOnce({ error: 'unavailable' }, false);
    await useFlagsStore.getState().refresh();
    expect(useFlagsStore.getState().map.engines).toBe(true);
  });

  test('getFlag returns compile-time default for an unknown flag', () => {
    useFlagsStore.setState({ map: {}, source: 'default' });
    expect(getFlag('does_not_exist')).toBe(false);
  });

  test('getFlag reads a known default when the map lacks the key', () => {
    useFlagsStore.setState({ map: {}, source: 'default' });
    expect(getFlag('engines')).toBe(DEFAULT_FLAGS.engines ?? false);
  });
});
