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

describe('migrateKeychainAccessibility (one time, never loses a session)', () => {
  /** Seed an item the way a build before this fix wrote it: no options = the iOS default class. */
  const seedLegacy = async (k: string, v: string) => { await SecureStore.setItemAsync(k, v); };

  it('re-writes an existing (old-class) session with AFTER_FIRST_UNLOCK, value unchanged, then marks done', async () => {
    const { migrateKeychainAccessibility, secureStorage } = require('./secureStorage');
    await seedLegacy('sb-x-auth-token', 'session-json');
    expect(mock.__opts.get('sb-x-auth-token')).toBeUndefined();
    expect(await migrateKeychainAccessibility(['sb-x-auth-token'])).toBe('done');
    expect(await secureStorage.getItem('sb-x-auth-token')).toBe('session-json');
    expect(mock.__opts.get('sb-x-auth-token')).toEqual({ keychainAccessible: AFU });
    expect(mock.__store.get(MARK)).toBe('1');
  });

  it('migrates a chunked session too', async () => {
    const { migrateKeychainAccessibility, secureStorage } = require('./secureStorage');
    const big = 'A'.repeat(2000) + 'B'.repeat(2000) + 'C'.repeat(10);
    await seedLegacy('k.__n', '3');
    await seedLegacy('k.0', big.slice(0, 2000));
    await seedLegacy('k.1', big.slice(2000, 4000));
    await seedLegacy('k.2', big.slice(4000));
    expect(await migrateKeychainAccessibility(['k'])).toBe('done');
    expect(await secureStorage.getItem('k')).toBe(big);
    for (const c of ['k.__n', 'k.0', 'k.1', 'k.2']) expect(mock.__opts.get(c)).toEqual({ keychainAccessible: AFU });
  });

  it('is idempotent: once marked, it touches nothing', async () => {
    const { migrateKeychainAccessibility } = require('./secureStorage');
    await seedLegacy('k', 'v');
    expect(await migrateKeychainAccessibility(['k'])).toBe('done');
    const spy = jest.spyOn(SecureStore, 'setItemAsync');
    expect(await migrateKeychainAccessibility(['k'])).toBe('already');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('signed out (nothing stored) still marks done: the next sign-in writes the new class anyway', async () => {
    const { migrateKeychainAccessibility } = require('./secureStorage');
    expect(await migrateKeychainAccessibility(['absent'])).toBe('done');
    expect(mock.__store.get(MARK)).toBe('1');
  });

  it('a read that throws (phone locked) writes NOTHING and leaves the marker unset, so it retries later', async () => {
    const { migrateKeychainAccessibility } = require('./secureStorage');
    await seedLegacy('k', 'v');
    const get = jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async (k: string) => {
      if (k === MARK) return null;
      throw new Error('errSecInteractionNotAllowed');
    });
    const set = jest.spyOn(SecureStore, 'setItemAsync');
    expect(await migrateKeychainAccessibility(['k'])).toBe('failed');
    expect(set).not.toHaveBeenCalled();
    get.mockRestore();
    set.mockRestore();
    expect(mock.__store.get('k')).toBe('v');
    expect(mock.__store.has(MARK)).toBe(false);
  });

  it('a failed re-write puts the session back the old way and leaves the marker unset', async () => {
    const { migrateKeychainAccessibility, secureStorage } = require('./secureStorage');
    await seedLegacy('k', 'session');
    const set = jest.spyOn(SecureStore, 'setItemAsync');
    set.mockImplementationOnce(async () => { throw new Error('errSecIO'); }); // the AFU write fails
    expect(await migrateKeychainAccessibility(['k'])).toBe('failed');
    set.mockRestore();
    expect(await secureStorage.getItem('k')).toBe('session'); // never lost
    expect(mock.__store.has(MARK)).toBe(false);
  });

  it('a Supabase write queued during the migration lands AFTER it, so a fresh token is never overwritten', async () => {
    const { migrateKeychainAccessibility, secureStorage } = require('./secureStorage');
    await seedLegacy('k', 'old-token');
    const m = migrateKeychainAccessibility(['k']);
    const w = secureStorage.setItem('k', 'refreshed-token');
    await Promise.all([m, w]);
    expect(await secureStorage.getItem('k')).toBe('refreshed-token');
  });

  it('the session key is the one supabase-js derives by default (so no existing session is orphaned)', () => {
    const { defaultAuthStorageKey } = require('./secureStorage');
    expect(defaultAuthStorageKey('https://abcdefghij.supabase.co')).toBe('sb-abcdefghij-auth-token');
    expect(defaultAuthStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });

  it('web has no keychain: skipped', async () => {
    let migrateWeb: typeof import('./secureStorage').migrateKeychainAccessibility;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      migrateWeb = require('./secureStorage').migrateKeychainAccessibility;
    });
    expect(await migrateWeb!(['k'])).toBe('skipped');
  });
});
