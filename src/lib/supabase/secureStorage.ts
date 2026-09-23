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
// whenever the phone has been unlocked once since it booted, still encrypted at rest, and still
// migrates to a new device through an encrypted backup like the default does. Items written by
// older builds are moved over once by migrateKeychainAccessibility().
//
// NOTE ON iOS: expo-secure-store only applies keychainAccessible when it ADDS an item; writing a
// key that already exists updates the value and keeps the old class. setItem below always deletes
// first (clearSecure), which is what makes a re-write actually change the class.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** Stay safely under SecureStore's ~2048-byte per-value limit. */
const CHUNK = 2000;
/** SecureStore is iOS/Android only; on web (and SSR) we delegate to AsyncStorage. */
const useSecure = Platform.OS !== 'web';

/** Every SecureStore write. keychainAccessible is iOS-only; Android ignores it. */
const WRITE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** Set once every stored key has been re-written with WRITE_OPTS. */
const MIGRATION_MARK = 'onstandard.keychain.afu.v1';

// SecureStore keys allow [A-Za-z0-9._-]; Supabase's key ("sb-<ref>-auth-token") qualifies, and the
// suffixes below stay in that set.
const countKey = (key: string) => `${key}.__n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

/* ONE queue for every SecureStore operation this adapter does. The migration reads a session and
   writes it back; if Supabase refreshed the token in between, writing the old value back would
   throw away a refresh token the server has already rotated, and sign the athlete out. Running
   everything in order makes that interleaving impossible. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.catch(() => undefined);
  return run;
}

/** Delete every SecureStore entry for a key (single value + any chunk set), so no stale chunk lingers. */
async function clearSecure(key: string): Promise<void> {
  const n = Number(await SecureStore.getItemAsync(countKey(key)));
  await SecureStore.deleteItemAsync(key);
  await SecureStore.deleteItemAsync(countKey(key));
  if (n && !Number.isNaN(n)) {
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
}

async function readSecure(key: string): Promise<string | null> {
  const n = Number(await SecureStore.getItemAsync(countKey(key)));
  if (!n || Number.isNaN(n)) return SecureStore.getItemAsync(key); // single (small) value
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part == null) return null; // a missing chunk => treat as absent (forces a safe re-auth)
    out += part;
  }
  return out;
}

/** `opts` undefined = the iOS default class, used ONLY to put a session back after a failed
 *  migration write (it is how the item was stored before). */
async function writeSecure(key: string, value: string, opts: SecureStore.SecureStoreOptions | undefined = WRITE_OPTS): Promise<void> {
  await clearSecure(key); // drop any prior representation first (and with it the old class)
  const set = (k: string, v: string) => (opts ? SecureStore.setItemAsync(k, v, opts) : SecureStore.setItemAsync(k, v));
  if (value.length <= CHUNK) {
    await set(key, value);
    return;
  }
  const n = Math.ceil(value.length / CHUNK);
  await set(countKey(key), String(n));
  for (let i = 0; i < n; i++) {
    await set(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
}

/** The {getItem,setItem,removeItem} shape Supabase's auth storage option expects. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!useSecure) return AsyncStorage.getItem(key);
    return serial(() => readSecure(key));
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!useSecure) return AsyncStorage.setItem(key, value);
    return serial(() => writeSecure(key, value));
  },

  async removeItem(key: string): Promise<void> {
    if (!useSecure) return AsyncStorage.removeItem(key);
    return serial(() => clearSecure(key));
  },
};

/** Supabase's default auth storage key for a project URL ("sb-<project ref>-auth-token"), exactly
 *  as supabase-js derives it. client.ts passes it explicitly so the migration below and the client
 *  can never disagree about which key holds the session. */
export function defaultAuthStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

/** Move items written by older builds (iOS default class, unreadable while locked) to
 *  AFTER_FIRST_UNLOCK. Run while the app is in the FOREGROUND, where the phone is unlocked.
 *
 *  - Idempotent: a marker is set when every key is done, and after that it touches nothing.
 *  - A read that throws (the phone is locked, so the old item is unreadable) writes NOTHING and
 *    leaves the marker unset: it simply runs again next time.
 *  - A write that fails puts the value straight back the way it was stored before, and leaves the
 *    marker unset. The value is held in memory throughout, so a session is never lost.
 *  - Serialized with every Supabase read and write (see `serial`), so a token refresh can never be
 *    overwritten by the older value this read.
 *  - A key with nothing stored (signed out) needs nothing: the next sign-in writes the new class. */
export async function migrateKeychainAccessibility(
  keys: string[],
): Promise<'done' | 'already' | 'skipped' | 'failed'> {
  if (!useSecure) return 'skipped';
  return serial(async () => {
    try {
      if ((await SecureStore.getItemAsync(MIGRATION_MARK)) === '1') return 'already';
    } catch {
      return 'failed';
    }
    for (const key of keys) {
      let value: string | null;
      try {
        value = await readSecure(key);
      } catch {
        return 'failed'; // locked: nothing written, retry on the next foreground
      }
      if (value == null) continue;
      try {
        await writeSecure(key, value);
      } catch {
        try { await writeSecure(key, value, undefined); } catch { /* the next Supabase write re-creates it */ }
        return 'failed';
      }
    }
    try {
      await SecureStore.setItemAsync(MIGRATION_MARK, '1', WRITE_OPTS);
    } catch {
      return 'failed';
    }
    return 'done';
  });
}
