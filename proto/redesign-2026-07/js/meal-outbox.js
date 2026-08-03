/* Durable meal outbox — the work that must survive a closed app.
 *
 * WHY THIS EXISTS. Logging a meal used to be three fire-and-forget calls made while the athlete
 * watched a spinner: upload the photo (un-awaited, ZERO retry — a failure left the `meals` row
 * pointing at an object that was never stored), insert the row, run the analysis. Kill the app
 * mid-flow, or log from a cafeteria with no signal, and the photo was gone: it lived only in
 * sessionStorage, which a fresh launch correctly discards.
 *
 * So this queue holds ONE entry per logged meal carrying the WHOLE remaining job — upload, insert,
 * analyse, and any clarifying answers — not just the photo. The entry is written before any network
 * call, so the work is durable from the first instant. It is modelled on the roll-call ack queue
 * (src/lib/notify/rollcall.ts), which solves the same shape for a different signal.
 *
 * QUOTA. localStorage is ~5MB and a capture is 150-250KB of base64, so photos are the one thing
 * that can genuinely overflow it. Policy: at most MAX_PHOTOS entries carry base64; when a write
 * fails we drop the OLDEST photo (not the newest — the newest is the one the athlete is looking
 * at) and keep that entry's metadata so its thread state stays honest rather than vanishing.
 *
 * The pure half (queue math) is exported separately from the storage half so it can be unit-tested
 * in Node with no browser.
 */

const KEY = 'onstd-proto-outbox-v1';
const MAX_PHOTOS = 2;      // entries allowed to carry base64 at once
const MAX_TRIES = 3;       // analysis attempts before it becomes a visible, manual retry
const CAP_MIN = 32;        // backoff ceiling, minutes

/* ---------------- pure queue math (no browser) ---------------- */

/** Entry key: one job per athlete-day-slot. Re-logging the same slot replaces, never duplicates. */
export function jobKey(uid, date, slot) { return `${uid}/${date}/${slot}`; }

/**
 * Retry delay: 3s, 12s, 48s, 3m, 13m, 32m, 32m…
 *
 * The first attempts are in SECONDS on purpose. This used to start at a full MINUTE and double,
 * which is the right shape for an entry waiting on a dead network — and exactly the wrong one for
 * the case that actually happens: an athlete still standing over their plate, watching the thread
 * for their numbers, whose first read hit a cold edge function. A single blip read as a hang,
 * because the next attempt was two minutes away. Seconds first, minutes later, same ceiling.
 */
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
 * Enforce the photo budget. Returns a NEW list with base64 stripped from the oldest entries
 * beyond MAX_PHOTOS. A stripped entry can no longer upload or analyse, so it is marked dead with
 * a reason the UI can explain honestly — it is not silently forgotten.
 */
export function trimPhotos(list, max = MAX_PHOTOS) {
  const withPhoto = (list || []).filter((e) => e.base64);
  if (withPhoto.length <= max) return list || [];
  const strip = new Set(withPhoto.slice(0, withPhoto.length - max).map((e) => e.k));
  return (list || []).map((e) =>
    strip.has(e.k) ? { ...e, base64: null, needUpload: false, needAnalysis: false, dead: 'quota' } : e);
}

/** All entries that may run now, oldest first. */
export function due(list, now) { return (list || []).filter((e) => runnable(e, now)); }

/* ---------------- storage (browser) ---------------- */

const hasLS = () => {
  try { return typeof localStorage !== 'undefined'; } catch { return false; }
};

export function readQueue() {
  if (!hasLS()) return [];
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

/**
 * Persist, shedding photos if the store refuses. Returns the list actually written, which may
 * differ from the one passed in — callers should use the return value, not their input.
 */
export function writeQueue(list) {
  if (!hasLS()) return list || [];
  let out = trimPhotos(list || []);
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
    return out;
  } catch {
    // Quota: shed every photo but keep the jobs, so the thread can still say what happened.
    out = out.map((e) => (e.base64 ? { ...e, base64: null, needUpload: false, needAnalysis: false, dead: 'quota' } : e));
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* in-memory only from here */ }
    return out;
  }
}

export function putJob(entry) { return writeQueue(enqueue(readQueue(), entry)); }
export function removeJob(k) { return writeQueue(dropJob(readQueue(), k)); }
export function updateJob(k, patch) { return writeQueue(patchJob(readQueue(), k, patch)); }
export function getJob(k) { return readQueue().find((e) => e.k === k) || null; }
