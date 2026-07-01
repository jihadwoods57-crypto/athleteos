// OnStandard — encrypted auth-token storage adapter (security audit L1).
//
// The Supabase session (access + refresh token) used to persist in plain AsyncStorage, which is
// unencrypted on disk. This adapter keeps it in the OS-backed secure store instead (iOS Keychain /
// Android Keystore), so the most sensitive local datum is encrypted at rest.
//
// SecureStore caps each value at ~2KB, and a Supabase session can exceed that, so a naive swap
// would throw. We CHUNK the value under that cap across numbered SecureStore entries (the OS
// already encrypts each one, so no hand-rolled crypto is needed). On web — and anywhere SecureStore
// is unavailable — we fall back to AsyncStorage unchanged (SecureStore is native-only), so the web
// preview keeps working exactly as before.
//
// (An alternative is the documented "AES key in SecureStore + ciphertext in AsyncStorage" pattern,
// which keeps SecureStore usage tiny; chunking is chosen here for zero extra crypto deps and a
// fully unit-testable surface. A few KB across 2-3 keychain items is well within reason.)
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** Stay safely under SecureStore's ~2048-byte per-value limit. */
const CHUNK = 2000;
/** SecureStore is iOS/Android only; on web (and SSR) we delegate to AsyncStorage. */
const useSecure = Platform.OS !== 'web';

// SecureStore keys allow [A-Za-z0-9._-]; Supabase's key ("sb-<ref>-auth-token") qualifies, and the
// suffixes below stay in that set.
const countKey = (key: string) => `${key}.__n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

/** Delete every SecureStore entry for a key (single value + any chunk set), so no stale chunk lingers. */
async function clearSecure(key: string): Promise<void> {
  const n = Number(await SecureStore.getItemAsync(countKey(key)));
  await SecureStore.deleteItemAsync(key);
  await SecureStore.deleteItemAsync(countKey(key));
  if (n && !Number.isNaN(n)) {
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
}

/** The {getItem,setItem,removeItem} shape Supabase's auth storage option expects. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!useSecure) return AsyncStorage.getItem(key);
    const n = Number(await SecureStore.getItemAsync(countKey(key)));
    if (!n || Number.isNaN(n)) return SecureStore.getItemAsync(key); // single (small) value
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null; // a missing chunk => treat as absent (forces a safe re-auth)
      out += part;
    }
    return out;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!useSecure) return AsyncStorage.setItem(key, value);
    await clearSecure(key); // drop any prior representation first
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const n = Math.ceil(value.length / CHUNK);
    await SecureStore.setItemAsync(countKey(key), String(n));
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!useSecure) return AsyncStorage.removeItem(key);
    await clearSecure(key);
  },
};
