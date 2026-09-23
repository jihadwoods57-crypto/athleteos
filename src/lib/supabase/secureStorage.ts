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
//
// READABLE WHILE THE PHONE IS LOCKED (2026-09-23). The walk-in check-in runs in the background when
// iOS wakes the app for a region crossing, typically with the phone locked in a pocket. The iOS
// default accessibility (WHEN_UNLOCKED) makes the session unreadable then, so the arrival RPC went
// out anonymous and nothing was recorded. Every write now uses AFTER_FIRST_UNLOCK: readable
// whenever the phone has been unlocked once since it booted, still encrypted at rest.
//
// WHO WRITES THE SESSION. The session athletes actually have is written by the PROTO (its own
// supabase-js, through the bridge's SECURE_SET), under the same key and chunk layout; bridge.ts
// passes the same AFTER_FIRST_UNLOCK option. Items written by older builds are NOT rewritten here:
// a read-and-rewrite at launch raced the proto's own token rotation and could put a revoked
// refresh token back (signing the athlete out). The next ordinary refresh moves them instead,
// because both writers delete before they add, and expo-secure-store applies keychainAccessible
// only when it ADDS an item (writing an existing key updates the value and keeps the old class).
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** Stay safely under SecureStore's ~2048-byte per-value limit. */
const CHUNK = 2000;
/** SecureStore is iOS/Android only; on web (and SSR) we delegate to AsyncStorage. */
const useSecure = Platform.OS !== 'web';

/** Every SecureStore write. keychainAccessible is iOS-only; Android ignores it. The bridge's
 *  SECURE_SET (src/proto/bridge.ts) passes the same option, so both writers use the same class. */
const KEYCHAIN_WRITE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** A keychain call that has not answered in this long is treated as failed, so one hung call can
 *  never stall every later auth read queued behind it. */
const KEYCHAIN_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('secure-store timed out')), KEYCHAIN_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

const kGet = (k: string) => withTimeout(SecureStore.getItemAsync(k));
const kSet = (k: string, v: string) => withTimeout(SecureStore.setItemAsync(k, v, KEYCHAIN_WRITE_OPTS));
const kDel = (k: string) => withTimeout(SecureStore.deleteItemAsync(k));

// SecureStore keys allow [A-Za-z0-9._-]; Supabase's key ("sb-<ref>-auth-token") qualifies, and the
// suffixes below stay in that set.
const countKey = (key: string) => `${key}.__n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

/* This adapter's own operations run one at a time, so a read can never see a half-written chunk
   set from a concurrent write. (The proto writes through the bridge on its own schedule; nothing
   here reads-then-rewrites, so the two cannot put a stale token back.) */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch(() => undefined);
  return run;
}

/** Delete every SecureStore entry for a key (single value + any chunk set), so no stale chunk lingers. */
async function clearSecure(key: string): Promise<void> {
  const n = Number(await kGet(countKey(key)));
  await kDel(key);
  await kDel(countKey(key));
  if (n && !Number.isNaN(n)) {
    for (let i = 0; i < n; i++) await kDel(chunkKey(key, i));
  }
}

/** The {getItem,setItem,removeItem} shape Supabase's auth storage option expects. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!useSecure) return AsyncStorage.getItem(key);
    return serial(async () => {
      const n = Number(await kGet(countKey(key)));
      if (!n || Number.isNaN(n)) return kGet(key); // single (small) value
      let out = '';
      for (let i = 0; i < n; i++) {
        const part = await kGet(chunkKey(key, i));
        if (part == null) return null; // a missing chunk => treat as absent (forces a safe re-auth)
        out += part;
      }
      return out;
    });
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!useSecure) return AsyncStorage.setItem(key, value);
    return serial(async () => {
      await clearSecure(key); // drop any prior representation first (and with it the old class)
      if (value.length <= CHUNK) {
        await kSet(key, value);
        return;
      }
      const n = Math.ceil(value.length / CHUNK);
      await kSet(countKey(key), String(n));
      for (let i = 0; i < n; i++) {
        await kSet(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
    });
  },

  async removeItem(key: string): Promise<void> {
    if (!useSecure) return AsyncStorage.removeItem(key);
    return serial(() => clearSecure(key));
  },
};
