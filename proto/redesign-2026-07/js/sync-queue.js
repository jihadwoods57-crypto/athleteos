/* OnStandard — the small-writes outbox (2026-08-05).
   The meal outbox (meal-outbox.js) made the PRIMARY log durable; everything around it still
   died silently offline: a roll-call "I'm Up" in a dead-signal gym never reached the server and
   left no local trace, and the meals-table mirror of a correction was awaited once and dropped.
   This queue holds exactly those two shapes — idempotent RPCs and meals-row patches — written
   BEFORE the outcome is known (meal-outbox lesson (a): durable from the first instant).

   Same discipline as meal-outbox, same reasons:
   · seconds-first backoff (the common failure is one flaky read, not a dead network)
   · every failure costs a try (lesson (d): or the self-timer becomes a hot loop)
   · entries are user-scoped and SURVIVE sign-out wipes — the drain filters by uid instead
   · replace-not-append per key: re-tapping "I'm Up" or re-correcting a meal must never
     stack duplicate jobs
   Pure functions above the storage line; Node-importable for tests. */

export const MAX_TRIES = 5;
const CAP_MIN = 32;

/** 3s, 12s, 48s, 3m 12s, 12m 48s — capped. Mirrors meal-outbox.backoffMs. */
export function backoffMs(tries) {
  return Math.min(3 * 4 ** (tries || 0), CAP_MIN * 60) * 1000;
}

/** One job per (user, kind, ref): a newer ack/patch for the same target replaces the old one.
    For 'meal-update' the FIELDS MERGE (newest key wins) so a second correction that touches a
    different field can't erase the first while both are still queued. */
export function keyOf(e) { return `${e.uid}|${e.kind}|${e.ref}`; }
export function enqueue(list, entry) {
  const out = [];
  let merged = { ...entry, tries: 0, lastTryAt: 0, queuedAt: entry.queuedAt || 0 };
  for (const e of list) {
    if (keyOf(e) !== keyOf(entry)) { out.push(e); continue; }
    if (entry.kind === 'meal-update') {
      merged = { ...merged, fields: { ...(e.fields || {}), ...(entry.fields || {}) } };
    }
  }
  out.push(merged);
  return out;
}

/** Not exhausted, has backoff-due work. Exhausted entries stay in the list as a record until a
    successful drain of the same key replaces them — they are never retried. */
export function runnable(e, now) {
  if (!e || e.tries >= MAX_TRIES) return false;
  return now - (e.lastTryAt || 0) >= (e.tries ? backoffMs(e.tries) : 0);
}
export function due(list, now) { return list.filter((e) => runnable(e, now)); }

/** Queue-worthiness of a failure: an unreachable server is retryable; a server that answered
    "no" is not (an RLS refusal or a closed roll-call window replays into the same "no" five
    times and then lies in the queue as if the tap were saved). Thrown fetches and the offline
    flag are the retry signals; error MESSAGES are matched narrowly. */
export function retryable(errMsg, threw, offline) {
  if (offline || threw) return true;
  return /fetch|network|timeout|timed out|load failed|socket|ECONN/i.test(String(errMsg || ''));
}

/* ---------------- storage (browser only below this line) ---------------- */
const KEY = 'onstd-proto-sync-outbox-v1';
const hasLS = () => { try { return typeof localStorage !== 'undefined'; } catch { return false; } };

export function readQueue() {
  if (!hasLS()) return [];
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
export function writeQueue(list) {
  if (!hasLS()) return list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* tiny rows; a quota loss here is acceptable */ }
  return list;
}
export function putJob(entry) { return writeQueue(enqueue(readQueue(), entry)); }
export function removeJob(key) { return writeQueue(readQueue().filter((e) => keyOf(e) !== key)); }
export function patchJob(key, fields) {
  return writeQueue(readQueue().map((e) => (keyOf(e) === key ? { ...e, ...fields } : e)));
}
