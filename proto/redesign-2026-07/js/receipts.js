/* Receipts an athlete has cleared off Home.
 *
 * A receipt is proof something already happened: a coach opened your day, you answered the roll
 * call. It is true when it appears and clutter an hour later, and until now there was no way to
 * get rid of one - at 11:59 AM an 8:30 AM check-in was still sitting under the score.
 *
 * WHAT CAN BE CLEARED, AND WHAT CANNOT. Only SETTLED, POSITIVE receipts: a coach view, an answered
 * roll call, a completed commitment. A missed or late-and-unresolved item is not a receipt, it is
 * an open fact, and letting an athlete tidy their own miss off their own screen would quietly undo
 * the thing this product is for. `canClear` is the one place that line is drawn.
 *
 * LOCAL, AND PER DAY. This is a reading state, not a record: it never touches the server, and the
 * receipt itself is untouched - the roll-call screen and the coach's board still show everything.
 * Keys are scoped to the athlete AND the day, so tomorrow starts clean without anyone tapping
 * anything, and the store prunes itself to two days so it cannot grow forever.
 *
 * Dependency-free so the rules are unit tested rather than inferred from a screen.
 */

const KEY = 'onstd.receipts.v1';
/** Today and yesterday. Yesterday survives so a receipt cleared at 11:50 PM stays cleared at
 *  12:10 AM, when the athlete's day has rolled over but they are still looking at the same screen. */
const KEEP_DAYS = 2;

/** In-memory mirror, so a repaint never pays for a parse. Null = not loaded yet. */
let cache = null;

function store() {
  if (cache) return cache;
  cache = {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
  } catch {
    cache = {}; // unreadable or absent storage reads as "nothing cleared", never as a throw
  }
  return cache;
}

function persist() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode, quota, no storage at all: the clear still works for this session */
  }
}

/** `uid|date`. Both are required, so one athlete's clears can never hide another's receipts on a
 *  shared device, and a stale day can never hide today's. */
export function bucketOf(uid, dayISO) {
  return `${uid || 'anon'}|${dayISO || ''}`;
}

/** Drop every bucket whose day is not one of the last KEEP_DAYS. Runs on write, not on read. */
function prune(dayISO) {
  const keep = new Set();
  const base = Date.parse(`${dayISO}T00:00:00`);
  if (isFinite(base)) {
    for (let i = 0; i < KEEP_DAYS; i++) {
      keep.add(new Date(base - i * 86400000).toISOString().slice(0, 10));
    }
  } else {
    keep.add(dayISO);
  }
  for (const k of Object.keys(cache)) {
    const day = k.slice(k.indexOf('|') + 1);
    if (!keep.has(day)) delete cache[k];
  }
}

/**
 * Whether this receipt is the kind an athlete may clear.
 *
 * @param {{stage?:string, verdict?:string}|null} d a derived commitment, or `{stage:'seen'}` for
 *   the coach-view receipt.
 * @returns {boolean} false for anything still open, and for a miss.
 */
export function canClear(d) {
  if (!d) return false;
  const stage = String(d.stage || '');
  if (stage === 'seen') return true;                 // a coach opened your day; nothing is pending
  if (stage !== 'acknowledged' && stage !== 'completed') return false;
  // A LATE answer is still an answer and still clearable - it is settled, and the verdict is kept
  // on the roll-call screen, the board and the score either way. A MISS is not settled: nothing
  // was recorded, and hiding it would be the athlete tidying away their own open fact.
  return String(d.verdict || '') !== 'missed';
}

/** Has this receipt been cleared? */
export function isCleared(uid, dayISO, id) {
  if (!id) return false;
  const b = store()[bucketOf(uid, dayISO)];
  return Array.isArray(b) && b.includes(String(id));
}

/**
 * Clear one or more receipts for a day. Idempotent.
 * @returns {number} how many were newly cleared.
 */
export function clearReceipts(uid, dayISO, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '')).filter(Boolean);
  if (!list.length) return 0;
  const s = store();
  const key = bucketOf(uid, dayISO);
  const have = Array.isArray(s[key]) ? s[key] : [];
  const next = have.slice();
  let added = 0;
  for (const id of list) if (!next.includes(id)) { next.push(id); added++; }
  if (!added) return 0;
  s[key] = next;
  prune(dayISO);
  persist();
  return added;
}

/** Everything cleared for one day. Device QA and tests. */
export function clearedFor(uid, dayISO) {
  const b = store()[bucketOf(uid, dayISO)];
  return Array.isArray(b) ? b.slice() : [];
}

/** Test seam: forget everything, in memory and on disk. */
export function _resetReceipts() {
  cache = {};
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY); } catch { /* fine */ }
}
