/* Durable meal outbox: the work that must survive a closed app. One entry per logged meal carrying
 * the WHOLE remaining job (upload, insert, analyse, answers), written before any network call.
 *
 * PHOTO BYTES DO NOT LIVE HERE (2026-09-26). The queue in localStorage is metadata; the ~250KB of
 * base64 per capture lives in IndexedDB (outbox-photos.js, lazy) and in MEM for this session. The
 * old writeQueue shed every photo when localStorage was full, which lost the founder's breakfast.
 * Now nothing is shed on a refused write: the queue stays in memory (SHADOW), storage-guard.js
 * evicts throwaway caches and retries, and a photo counts as gone only when the drain finds no copy
 * (state.js _runMealJob → shedPhoto). No IndexedDB: the bytes ride in the entry's base64 as before,
 * at most MAX_PHOTOS of them in localStorage. Pure queue math first; Node-testable. */

const KEY = 'onstd-proto-outbox-v1';
const MAX_PHOTOS = 2;      // localStorage FALLBACK only: entries whose base64 rides in the queue
const MAX_TRIES = 3;       // analysis attempts before it becomes a visible, manual retry
const CAP_MIN = 32;        // backoff ceiling, minutes

/* ---------------- pure queue math (no browser) ---------------- */

/** Entry key: one job per athlete-day-slot. Re-logging the same slot replaces, never duplicates. */
export function jobKey(uid, date, slot) { return `${uid}/${date}/${slot}`; }

/** Retry delay: 3s, 12s, 48s, 3m, 13m, 32m… seconds first: the usual failure is one cold read. */
export function backoffMs(tries) {
  return Math.min(3 * 4 ** Math.max(0, tries), CAP_MIN * 60) * 1000;
}

/** Is this entry allowed to run right now? */
export function runnable(entry, now) {
  if (!entry || entry.dead) return false;
  if (!entry.needUpload && !entry.needInsert && !entry.needAnalysis && !entry.needMealRowSync) return false;
  // An entry waiting on the athlete's clarifying answers is not runnable until they arrive.
  if (entry.needAnalysis && entry.pendingQuestions && !entry.answers) return false;
  if (!entry.lastTryAt) return true;
  return now - entry.lastTryAt >= backoffMs(entry.tries || 0);
}

/** Insert-or-replace by key, newest last. Pure. */
export function enqueue(list, entry) {
  const rest = (list || []).filter((e) => e.k !== entry.k);
  return rest.concat([entry]);
}

export function dropJob(list, k) { return (list || []).filter((e) => e.k !== k); }

export function patchJob(list, k, patch) {
  return (list || []).map((e) => (e.k === k ? { ...e, ...patch } : e));
}

/**
 * What a job becomes once no copy of its photo is left. Uploaded already (needUpload false): the
 * photo is safe in storage, so the meals row is STILL inserted with its photo_path and only the
 * read is lost (`readLost`; "Read it again" rescues it from storage). Never uploaded: nothing can
 * reach the server (0251 refuses a meal with no real photo), so the job is dead and the thread
 * offers a retake (`lostPhoto`). Pure.
 */
export function shedPhoto(e) {
  const lost = !!e.needUpload;
  return { ...e, base64: null, bytes: null, lostPhoto: lost, needUpload: false, needAnalysis: false,
    ...(lost ? { dead: 'lost', needInsert: false } : { readLost: true }) };
}

/** Fallback budget: base64 stays in the persisted queue for the newest `max` entries only. The
 *  older ones keep their bytes in MEM for this session (`bytes: 'mem'`); nothing is marked lost
 *  here. Pure. */
export function trimPhotos(list, max = MAX_PHOTOS) {
  const withPhoto = (list || []).filter((e) => e.base64);
  if (withPhoto.length <= max) return list || [];
  const strip = new Set(withPhoto.slice(0, withPhoto.length - max).map((e) => e.k));
  return (list || []).map((e) => (strip.has(e.k) ? { ...e, base64: null, bytes: 'mem' } : e));
}

/** All entries that may run now, oldest first. */
export function due(list, now) { return (list || []).filter((e) => runnable(e, now)); }

/* ---------------- storage (browser) ---------------- */

const MEM = new Map();   // job key -> base64, this session
let SHADOW = null;       // the queue as it should be, while localStorage refuses it

const hasLS = () => {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
};
const photos = () => import('./outbox-photos.js');

export function readQueue() {
  if (SHADOW) return SHADOW;
  if (!hasLS()) return [];
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function persist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); SHADOW = null; return true; } catch { return false; }
}

/**
 * Persist. Returns the list the session now reads. A quota refusal never sheds a photo here: the
 * queue stays whole in memory and storage-guard.js evicts the throwaway caches, reports
 * `storage_quota`, and calls retryWrite().
 */
export function writeQueue(list) {
  for (const e of list || []) if (e.base64 && !MEM.has(e.k)) MEM.set(e.k, e.base64);
  const out = trimPhotos(list || []);
  if (!hasLS() || persist(out)) return out;
  SHADOW = out;
  void import('./storage-guard.js').then((g) => g.onQuota('outbox', retryWrite), () => {});
  return out;
}

/** Second attempt after eviction. Still full: drop the bytes riding in localStorage (fallback
 *  mode only; their copies stay in MEM for this session) and try the lean queue. */
export function retryWrite() {
  if (!SHADOW) return true;
  return persist(SHADOW) || persist(SHADOW.map((e) => (e.base64 ? { ...e, base64: null, bytes: 'mem' } : e)));
}

/** Enqueue a job. Its bytes go to MEM now and to IndexedDB next; the queue keeps `bytes: 'idb'`. */
export function putJob(entry) {
  const b = entry.base64;
  if (b) { MEM.set(entry.k, b); entry = { ...entry, base64: null, bytes: 'idb' }; }
  const out = writeQueue(enqueue(readQueue(), entry));
  if (b) void photos().then((m) => m.stash(entry.k, b), () => fallback(entry.k, b));
  return out;
}

/** No IndexedDB: the bytes ride in the queue itself (the pre-2026-09-26 behaviour). */
export function fallback(k, b) {
  if (MEM.get(k) === b && readQueue().some((e) => e.k === k)) writeQueue(patchJob(readQueue(), k, { base64: b, bytes: null }));
}

export function removeJob(k) {
  MEM.delete(k);
  void photos().then((m) => m.drop(k), () => {});
  return writeQueue(dropJob(readQueue(), k));
}
export function updateJob(k, patch) { return writeQueue(patchJob(readQueue(), k, patch)); }
export function getJob(k) { return readQueue().find((e) => e.k === k) || null; }

/** Can this job still reach its photo bytes, as far as the queue knows? Synchronous. */
export function hasPhoto(job) { return !!job && (MEM.has(job.k) || !!job.base64 || job.bytes === 'idb'); }

/** The job's photo bytes (MEM, then the queue, then IndexedDB); null when none is left; UNDEFINED
 *  when IndexedDB did not answer (error or timeout). Undefined is "unknown, try again later", never
 *  "lost": shedding on a transient storage error would destroy a photo that still exists. */
export async function photoFor(job) {
  if (!job) return null;
  const b = MEM.get(job.k) || job.base64;
  if (b || job.bytes !== 'idb') return b || null;
  try { return (await (await photos()).load(job.k)) || null; } catch { return undefined; }
}

/** First drain of a session: legacy base64 moves to IndexedDB, orphaned bytes are deleted. */
export function migratePhotos() { return photos().then((m) => m.migrate(), () => {}); }

/** Tests only. */
export function _resetOutboxMemory() { MEM.clear(); SHADOW = null; }
