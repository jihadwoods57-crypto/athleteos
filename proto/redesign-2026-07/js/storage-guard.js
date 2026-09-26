/* localStorage housekeeping, and what happens when it is full (2026-09-26).
 *
 * WHY. On 2026-09-26 the founder's breakfast photo was dropped before it uploaded, because
 * localStorage (~5MB for the whole app, and WebKit counts 2 bytes a character once a string holds
 * any non-Latin-1 text) was full. What filled it was day.js's offline day cache: one key per user
 * PER DATE, each carrying ~35 days of history jsonb (~145K characters by week five), and nothing
 * ever removed an old date. 38 dates of one athlete measured 2.5M characters (≈5MB). See
 * storage-footprint.test.mjs for the whole snapshot.
 *
 * Lazy: nothing here is on the boot path. Callers import it after a write is refused, or once a
 * day (day.js) to sweep old dates.
 *
 * Never touched: the meal outbox, the RT state, today's day for the signed-in user, receipts,
 * consent, blocks and every other small preference. Only rebuildable caches go. */
import { track, EVENTS } from './analytics.js';

const DAY_P = 'onstd-day-';
const DAY_RE = /^onstd-day-(.+)-(\d{4}-\d{2}-\d{2})$/;
const SYNC_KEY = 'onstd-proto-sync-outbox-v1';
const BUF_KEY = 'onstd-analytics-buf-v1';

/** Key -> a short class label for reporting. Never the key itself: keys carry user ids. */
const LABELS = [
  [DAY_P, 'day'], ['onstd-launch-', 'launch'], ['onstd-proto-rt-v1', 'rt'], ['onstd-proto-outbox-v1', 'outbox'],
  [SYNC_KEY, 'sync'], [BUF_KEY, 'abuf'], ['os.planIdeas.', 'ideas'], ['onstd.receipts', 'rcpt'],
  ['os.weekFocus.', 'focus'], ['os.blocks.', 'blocks'], ['os.foodPrefs.', 'prefs'], ['os.ts', 'tsugg'], ['sb-', 'auth'],
];
export function labelOf(k) { const hit = LABELS.find(([p]) => String(k).startsWith(p)); return hit ? hit[1] : 'other'; }

const keysOf = (ls) => { const out = []; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k != null) out.push(k); } return out; };
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const signedIn = (ls) => { try { return (JSON.parse(ls.getItem('onstd-proto-rt-v1') || '{}') || {}).userId || null; } catch { return null; } };

/** Every key's size in characters (key + value), largest first. */
export function sizes(ls) {
  return keysOf(ls).map((k) => ({ k, label: labelOf(k), n: k.length + String(ls.getItem(k) || '').length }))
    .sort((a, b) => b.n - a.n);
}

/** The storage_quota props: where, the total, and the top 8 keys as `label:thousands-of-chars`,
 *  two per prop (t1..t4), so all of it fits the analytics firewall: 6 props, enum-shaped strings
 *  of at most 24 characters. Sizes and labels only, never a key or a value. */
export function quotaProps(where, list) {
  const k = (n) => Math.min(99999, Math.round(n / 1000));
  const top = list.slice(0, 8).map((s) => `${s.label}:${k(s.n)}`);
  const p = { where, total_k: k(list.reduce((a, s) => a + s.n, 0)) };
  for (let i = 0; i < top.length; i += 2) p[`t${i / 2 + 1}`] = top.slice(i, i + 2).join('.').slice(0, 24);
  return p;
}

/** Day caches for any date but today. Never read again (day.js reads only today's key). */
export function sweepDays(ls = localStorage, today = localDay()) {
  let n = 0;
  for (const k of keysOf(ls)) { const m = DAY_RE.exec(k); if (m && m[2] !== today) { ls.removeItem(k); n++; } }
  return n;
}

/** The eviction ladder, cheapest loss first. Each step returns true when it removed anything. */
export function ladder(ls, today = localDay(), uid = signedIn(ls)) {
  const drop = (pred) => { let hit = false; for (const k of keysOf(ls)) if (pred(k)) { ls.removeItem(k); hit = true; } return hit; };
  const rewrite = (key, fn) => {
    try {
      const j = JSON.parse(ls.getItem(key) || '[]');
      if (!Array.isArray(j)) return false;
      const next = fn(j);
      if (next.length === j.length) return false;
      ls.setItem(key, JSON.stringify(next));
      return true;
    } catch { return false; }
  };
  return [
    ['old_days', () => sweepDays(ls, today) > 0],
    ['launch', () => drop((k) => k.startsWith('onstd-launch-'))],
    ['ideas', () => drop((k) => k.startsWith('os.planIdeas.'))],
    ['abuf', () => rewrite(BUF_KEY, (b) => b.slice(-50))],
    ['sync_dead', () => rewrite(SYNC_KEY, (q) => q.filter((e) => !(e && e.tries >= 5 && e.kind !== 'correction-outcome')))],
    ['other_days', () => drop((k) => { const m = DAY_RE.exec(k); return !!m && m[1] !== uid; })],
  ];
}

/** Free the throwaway caches one step at a time until `retry()` succeeds. Returns the steps that
 *  ran and whether the write finally landed. */
export function evictUntil(ls, retry, today, uid) {
  const ran = [];
  for (const [name, step] of ladder(ls, today, uid)) {
    if (!step()) continue;
    ran.push(name);
    if (retry()) return { ran, ok: true };
  }
  return { ran, ok: !!retry() };
}

const reported = new Set();
/**
 * A write was refused for lack of space. Measure first (the sizes that caused it), evict, report
 * once per session per `where` (after the eviction, so the event itself has room to land), retry.
 */
export function onQuota(where, retry) {
  let ls;
  try { ls = localStorage; } catch { return false; }
  const before = sizes(ls);
  const { ok } = evictUntil(ls, retry || (() => false));
  if (!reported.has(where)) {
    reported.add(where);
    try { track(EVENTS.STORAGE_QUOTA, quotaProps(where, before)); } catch { /* never let reporting break a write */ }
  }
  return ok;
}
