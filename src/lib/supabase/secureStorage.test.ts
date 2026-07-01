// OnStandard — encrypted auth-token storage adapter (L1). Proves the chunking round-trips any size
// (incl. tokens past SecureStore's 2KB cap), survives a stale->new overwrite, treats a missing
// chunk as absent (safe re-auth), and that the web path delegates to AsyncStorage.
//
// expo-secure-store resolves to jest/expoSecureStoreMock.js (an in-memory, inspectable stand-in)
// via moduleNameMapper, so the native chunking path runs end-to-end here.
import * as SecureStore from 'expo-secure-store';

// The mock exposes its backing map + a reset for assertions (test-only helpers).
const mock = SecureStore as unknown as { __store: Map<string, string>; __reset: () => void };

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
