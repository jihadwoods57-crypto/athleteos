/* Where the meal outbox keeps photo bytes: IndexedDB, keyed by outbox job key (2026-09-26).
 *
 * Lazy (meal-outbox.js imports it on first use), so it costs the boot nothing. localStorage is
 * ~5MB shared with every cache in the app, and a meal photo is 150-250KB of base64: keeping the
 * bytes there is what let an unrelated cache push the founder's breakfast photo out before it
 * uploaded. IndexedDB has its own, much larger budget.
 *
 * The backend is injectable (setBackend) so the outbox is tested in Node against a fake store.
 * A backend is { put(k, b64), get(k) -> b64|null, del(k), keys() -> [k] oldest first }, all async.
 * No IndexedDB (or it refuses to open) → null backend → meal-outbox's localStorage fallback. */
import { readQueue, writeQueue, patchJob, fallback } from './meal-outbox.js';

/** Most photos kept at once. The guard for IndexedDB's own budget; normal use holds 1-4. */
export const MAX_IDB_PHOTOS = 30;
const DB = 'onstd-outbox', ST = 'photos';

let backend;  // undefined = not resolved yet; null = no IndexedDB here
export function setBackend(b) { backend = b; }

function idbBackend() {
  const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
  if (!idb) return null;
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'k' }).createIndex('at', 'at');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  }).catch((e) => { dbp = null; throw e; }));
  const run = (mode, fn) => open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(ST, mode);
    const q = fn(t.objectStore(ST));
    t.oncomplete = () => res(q ? q.result : undefined);
    t.onerror = t.onabort = () => rej(t.error || new Error('idb'));
  }));
  return {
    put: (k, b64) => run('readwrite', (s) => { s.put({ k, b64, at: Date.now() }); }),
    get: (k) => run('readonly', (s) => s.get(k)).then((r) => (r && r.b64) || null),
    del: (k) => run('readwrite', (s) => { s.delete(k); }),
    // Keys only, oldest first: the index walk never loads the photos themselves.
    keys: () => run('readonly', (s) => s.index('at').getAllKeys()).then((ks) => ks || []),
  };
}
function store() {
  if (backend === undefined) { try { backend = idbBackend(); } catch { backend = null; } }
  return backend;
}

/** Persist one job's bytes. Any failure falls back to the queue itself (localStorage). */
export async function stash(k, b64) {
  const s = store();
  try {
    if (!s) throw new Error('no idb');
    await s.put(k, b64);
    await guard(s);
  } catch { fallback(k, b64); }
}

export async function load(k) { const s = store(); return s ? s.get(k) : null; }
export async function drop(k) { const s = store(); if (s) await s.del(k).catch(() => {}); }

/** Keep at most MAX_IDB_PHOTOS. The oldest go first; their jobs are told (bytes: null) so the
 *  drain decides honestly what that costs (state.js _runMealJob). */
async function guard(s, max = MAX_IDB_PHOTOS) {
  const ks = await s.keys();
  if (ks.length <= max) return;
  const cut = ks.slice(0, ks.length - max);
  await Promise.all(cut.map((k) => s.del(k)));
  const gone = new Set(cut);
  writeQueue(readQueue().map((e) => (gone.has(e.k) && e.bytes === 'idb' ? { ...e, bytes: null } : e)));
}

let migrated = false;
/** Once per session, on the first drain: entries an older build left with base64 in localStorage
 *  move it here (the queue keeps `bytes: 'idb'`), and bytes whose job is gone are deleted. */
export async function migrate() {
  const s = store();
  if (!s || migrated) return;
  migrated = true;
  try {
    const moved = [];
    for (const e of readQueue()) if (e.base64 && e.k) { await s.put(e.k, e.base64); moved.push(e.k); }
    let q = readQueue();
    for (const k of moved) q = patchJob(q, k, { base64: null, bytes: 'idb' });
    if (moved.length) writeQueue(q);
    const have = await s.keys();
    const live = new Set(readQueue().map((e) => e.k));   // read AFTER the keys: a job queued meanwhile is kept
    await Promise.all(have.filter((k) => !live.has(k)).map((k) => s.del(k)));
    await guard(s);
  } catch { migrated = false; /* the next drain tries again; the base64 is still in the queue */ }
}

/** Tests only. */
export function _resetMigration() { migrated = false; }
