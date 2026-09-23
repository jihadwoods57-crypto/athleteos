// OnStandard — encrypted auth-token storage adapter (L1). Proves the chunking round-trips any size
// (incl. tokens past SecureStore's 2KB cap), survives a stale->new overwrite, treats a missing
// chunk as absent (safe re-auth), and that the web path delegates to AsyncStorage.
//
// expo-secure-store resolves to jest/expoSecureStoreMock.js (an in-memory, inspectable stand-in)
// via moduleNameMapper, so the native chunking path runs end-to-end here.
import * as SecureStore from 'expo-secure-store';

// The mock exposes its backing map + a reset for assertions (test-only helpers).
const mock = SecureStore as unknown as {
  __store: Map<string, string>;
  __opts: Map<string, { keychainAccessible?: number } | undefined>;
  __reset: () => void;
};

beforeEach(() => mock.__reset());

describe('secureStorage (native: chunked SecureStore)', () => {
  it('round-trips a small value (single entry, no chunking)', async () => {
    const { secureStorage } = require('./secureStorage');
    await secureStorage.setItem('sb-x-auth-token', 'small');
    expect(await secureStorage.getItem('sb-x-auth-token')).toBe('small');
    expect(mock.__store.has('sb-x-auth-token.__n')).toBe(false); // no chunk marker
  });

  it('round-trips a value LARGER than the 2KB cap (chunked)', async () => {
    const { secureStorage } = require('./secureStorage');
    const big = 'A'.repeat(2000) + 'B'.repeat(2000) + 'C'.repeat(500); // 4500 chars, 3 chunks
    await secureStorage.setItem('sb-x-auth-token', big);
    expect(await secureStorage.getItem('sb-x-auth-token')).toBe(big);
    // proof it actually split across entries
    expect(mock.__store.get('sb-x-auth-token.__n')).toBe('3');
    expect(mock.__store.has('sb-x-auth-token.0')).toBe(true);
    expect(mock.__store.has('sb-x-auth-token.2')).toBe(true);
  });

  it('overwriting large with small leaves no stale chunks', async () => {
    const { secureStorage } = require('./secureStorage');
    await secureStorage.setItem('k', 'X'.repeat(5000));
    await secureStorage.setItem('k', 'tiny');
    expect(await secureStorage.getItem('k')).toBe('tiny');
    expect(mock.__store.has('k.__n')).toBe(false);
    expect(mock.__store.has('k.0')).toBe(false);
  });

  it('removeItem clears the single value and every chunk', async () => {
    const { secureStorage } = require('./secureStorage');
    await secureStorage.setItem('k', 'Y'.repeat(5000));
    await secureStorage.removeItem('k');
    expect(await secureStorage.getItem('k')).toBeNull();
    expect([...mock.__store.keys()].filter((x) => x.startsWith('k'))).toEqual([]);
  });

  it('a missing chunk reads as absent (forces a safe re-auth, never a corrupt token)', async () => {
    const { secureStorage } = require('./secureStorage');
    await secureStorage.setItem('k', 'Z'.repeat(5000));
    mock.__store.delete('k.1'); // simulate partial loss
    expect(await secureStorage.getItem('k')).toBeNull();
  });

  it('getItem is null when nothing was stored', async () => {
    const { secureStorage } = require('./secureStorage');
    expect(await secureStorage.getItem('absent')).toBeNull();
  });
});

describe('secureStorage (web: delegates to AsyncStorage)', () => {
  it('a large value round-trips through AsyncStorage (no chunking) on web', async () => {
    const asyncMem = new Map<string, string>();
    let secureStorageWeb: typeof import('./secureStorage').secureStorage;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        getItem: async (k: string) => (asyncMem.has(k) ? asyncMem.get(k)! : null),
        setItem: async (k: string, v: string) => { asyncMem.set(k, v); },
        removeItem: async (k: string) => { asyncMem.delete(k); },
      }));
      secureStorageWeb = require('./secureStorage').secureStorage;
    });
    const big = 'B'.repeat(5000);
    await secureStorageWeb!.setItem('k', big);
    expect(await secureStorageWeb!.getItem('k')).toBe(big);
    // the whole value lives in AsyncStorage as-is (web branch never chunked into SecureStore)
    expect(asyncMem.get('k')).toBe(big);
    expect(mock.__store.size).toBe(0);
  });
});

/* A region crossing at 5:43 AM wakes the app with the phone LOCKED in a pocket. The session has to
   be readable then, or the arrival RPC goes out anonymous and nothing is recorded. The iOS default
   (WHEN_UNLOCKED) is not readable while locked; AFTER_FIRST_UNLOCK is, once the phone has been
   unlocked once since boot. */
const AFU = (SecureStore as unknown as { AFTER_FIRST_UNLOCK: number }).AFTER_FIRST_UNLOCK;
const MARK = 'onstandard.keychain.afu.v1';

describe('secureStorage: readable while the phone is locked', () => {
  it('every write carries keychainAccessible AFTER_FIRST_UNLOCK (single value and every chunk)', async () => {
    const { secureStorage } = require('./secureStorage');
    await secureStorage.setItem('small', 'v');
    await secureStorage.setItem('big', 'Q'.repeat(4500));
    for (const k of ['small', 'big.__n', 'big.0', 'big.1', 'big.2']) {
      expect(mock.__opts.get(k)).toEqual({ keychainAccessible: AFU });
    }
  });
});

/* No read-and-rewrite migration (fix round 2). At launch it raced the proto's own token rotation
   and could write a revoked refresh token back, signing the athlete out. Old-class items move over
   on the next ordinary refresh instead (both writers delete before they add). Loading the client
   must therefore never write, rewrite or delete an existing session item. */
describe('startup never rewrites an existing session', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it('loading the Supabase client with a stored (old-class) session writes and deletes nothing', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const session = JSON.stringify({
      access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: future,
      user: { id: 'u1', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    });
    await SecureStore.setItemAsync('sb-abcdefghij-auth-token', session); // no options = the old class
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://abcdefghij.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const set = jest.spyOn(SecureStore, 'setItemAsync');
    const del = jest.spyOn(SecureStore, 'deleteItemAsync');
    let client: typeof import('./client') | undefined;
    jest.isolateModules(() => {
      // Pin the native stubs: an earlier test doMock'd react-native as web, and a fresh registry
      // would otherwise load a SECOND secure-store mock that cannot see the item seeded above.
      jest.doMock('react-native', () => jest.requireActual('../../../jest/reactNativeMock.js'));
      jest.doMock('expo-secure-store', () => SecureStore);
      client = require('./client');
    });
    expect(client!.supabase).not.toBeNull();
    await client!.supabase!.auth.getSession(); // let the client finish initializing from storage
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(mock.__store.get('sb-abcdefghij-auth-token')).toBe(session);
    expect(mock.__opts.get('sb-abcdefghij-auth-token')).toBeUndefined();
    client!.supabase!.auth.stopAutoRefresh();
    set.mockRestore();
    del.mockRestore();
  });

  it('the adapter exposes no migration', () => {
    const mod = require('./secureStorage');
    expect(Object.keys(mod)).toEqual(['secureStorage']);
  });
});

describe('a hung keychain call cannot stall every read behind it', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a call that never answers fails after 5 s, and the next read still goes through', async () => {
    const { secureStorage } = require('./secureStorage');
    await SecureStore.setItemAsync('ok', 'v');
    const get = jest.spyOn(SecureStore, 'getItemAsync');
    get.mockImplementationOnce(() => new Promise(() => {})); // the hung call
    const hung = secureStorage.getItem('stuck');
    const next = secureStorage.getItem('ok');
    const hungOutcome = hung.then(() => 'resolved', (e: Error) => e.message);
    await jest.advanceTimersByTimeAsync(4999);
    await jest.advanceTimersByTimeAsync(1);
    expect(await hungOutcome).toBe('secure-store timed out');
    get.mockRestore();
    await jest.advanceTimersByTimeAsync(0);
    expect(await next).toBe('v');
  });
});
