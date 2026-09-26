/* What fills localStorage in normal use (root cause of the 2026-09-26 lost breakfast photo).
 *
 * The founder logged breakfast from a gallery photo; the thread said the photo "couldn't be kept on
 * this device", and prod has days.meals.breakfast = true but no meals row and no analyze-meal call.
 * The old meal outbox shed every photo when localStorage refused a write. A downscaled photo is
 * ~270K characters of base64, so the store had to be nearly full already. This test rebuilds a
 * realistic snapshot of a founder-like device and measures it.
 *
 * THE MODEL. One phone, two accounts (the t01 athlete, used daily since 2026-08-20, and the coach
 * account). The day-cache sizes are the REAL per-date history weights measured on prod for that
 * athlete (sum of meals + checkin + signals + quick_added text over the 35-day heavy window each
 * date's cache carries, plus row overhead). Sizes only, no data. Everything else is sized from the
 * code that writes it.
 *
 * WEBKIT ACCOUNTING. The quota is 5MB per origin, charged per string at 1 byte a character for a
 * Latin-1 string and 2 for any string holding a character above U+00FF. The day cache carries AI
 * prose (’ — …), so it is charged double. `bytes()` below models that.
 *
 * FINDINGS (printed by the first test):
 *   day caches (onstd-day-<uid>-<date>): one key per user PER DATE, never removed. By 09-26 the
 *     athlete's 38 dates held ~2.6M characters, ~5.3MB as WebKit counts it: the whole quota.
 *   launch cache: 16 photo thumbnails + rows, ~0.23M: the largest single key, but bounded (newest
 *     16) and dropped on sign-out.
 *   RT: one key, ~50K (avatar dataURL ~27K), bounded.
 *   analytics buffer: capped at 500 events, ~55K.
 *   sync-queue: exhausted records were kept forever (now pruned: sync-queue.js prune()).
 *   everything else: a few K.
 * Run: node --test proto/redesign-2026-07/js/storage-footprint.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const QUOTA = 5 * 1024 * 1024;
const wide = (s) => /[^\u0000-ÿ]/.test(s);
const bytes = (m) => [...m].reduce((a, [k, v]) => a + (k.length + v.length) * (wide(k) || wide(v) ? 2 : 1), 0);
const chars = (m) => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);

/** A localStorage stand-in that refuses writes past the WebKit quota. */
function quotaStore(limit = QUOTA) {
  const m = new Map();
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const next = new Map(m); next.set(k, String(v));
      if (bytes(next) > limit) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
  };
}

// Measured on prod for the athlete (2026-09-26): the heavy-history characters each date's cache
// carried, 2026-08-20 .. 2026-09-26.
const HEAVY = [0, 3624, 7758, 7758, 7758, 7758, 7758, 7758, 9397, 16703, 21833, 22342, 22342, 28722, 33852,
  37547, 44226, 48128, 53920, 60651, 66735, 71438, 71438, 73960, 75629, 81118, 86946, 93325, 99154,
  106458, 112100, 117069, 123628, 131577, 136467, 142332, 144273, 144309];
const DAY_BASE = 4000;   // today's own fields, passes, targets
const ATH = '4c580c5e-0000-4000-8000-000000000001', COACH = '90f459a6-0000-4000-8000-000000000002';
const dateOf = (i) => { const d = new Date(Date.UTC(2026, 7, 20 + i)); return d.toISOString().slice(0, 10); };
const filler = (n, ch = 'x') => ch.repeat(Math.max(0, n));
const prose = (n) => filler(n - 1) + '’';   // AI text: one curly quote makes the whole string 2-byte

function founderPhone() {
  const ls = quotaStore(Infinity);
  HEAVY.forEach((h, i) => ls.setItem(`onstd-day-${ATH}-${dateOf(i)}`, prose(DAY_BASE + h)));
  HEAVY.forEach((_, i) => ls.setItem(`onstd-day-${COACH}-${dateOf(i)}`, filler(DAY_BASE)));   // the coach's Home loads a day too
  ls.setItem(`onstd-launch-${ATH}`, filler(16 * 13500 + 9000));        // 16 thumbnails (200px, q0.6) + past rows
  ls.setItem('onstd-proto-rt-v1', JSON.stringify({ userId: ATH, pad: filler(23000) + 'data:image/jpeg;base64,' + filler(27000) }));
  ls.setItem('onstd-analytics-buf-v1', filler(500 * 110));
  ls.setItem('onstd-proto-sync-outbox-v1', filler(40 * 250));
  ls.setItem(`os.planIdeas.${ATH}`, filler(3000));
  ls.setItem('onstd.receipts.v1', filler(800));
  ls.setItem(`os.weekFocus.${ATH}`, filler(900));
  ls.setItem(`os.foodPrefs.${ATH}`, filler(1200));
  ls.setItem('onstd-analytics-sid', filler(24));
  return ls;
}

const { sizes, sweepDays, onQuota } = await import('./storage-guard.js');

test('the snapshot: day caches fill the quota, and nothing else is close', () => {
  const ls = founderPhone();
  const all = sizes(ls);
  const byLabel = {};
  for (const s of all) byLabel[s.label] = (byLabel[s.label] || 0) + s.n;
  const dayBytes = bytes(new Map([...ls.m].filter(([k]) => k.startsWith('onstd-day-'))));
  console.log('characters by class:', Object.fromEntries(Object.entries(byLabel).map(([k, v]) => [k, `${Math.round(v / 1000)}K`])));
  console.log(`total ${Math.round(chars(ls.m) / 1000)}K chars, ${(bytes(ls.m) / 1048576).toFixed(2)}MB as WebKit counts it; day caches ${(dayBytes / 1048576).toFixed(2)}MB in ${all.filter((s) => s.label === 'day').length} keys`);
  assert.ok(bytes(ls.m) > QUOTA, 'the device is over quota before the photo is even written');
  assert.ok(dayBytes > 0.9 * QUOTA, 'day caches alone are ~the whole quota');
  assert.ok(byLabel.day > 0.8 * chars(ls.m), 'and the day caches are the bulk of it');
  // The launch cache is the single largest key (bounded at 16 thumbnails); the next seven are days.
  assert.deepEqual(all.slice(0, 8).map((s) => s.label), ['launch', 'day', 'day', 'day', 'day', 'day', 'day', 'day']);
});

test('sweeping old dates bounds the day cache to one key per user, whatever the weeks of use', () => {
  const ls = founderPhone();
  const today = dateOf(HEAVY.length - 1);
  sweepDays(ls, today);
  const days = [...ls.m.keys()].filter((k) => k.startsWith('onstd-day-'));
  assert.deepEqual(days.sort(), [`onstd-day-${ATH}-${today}`, `onstd-day-${COACH}-${today}`].sort());
  assert.ok(bytes(ls.m) < 1024 * 1024, `after the sweep the whole store is ${(bytes(ls.m) / 1048576).toFixed(2)}MB`);
  // Room left for photos in the fallback path: at least ten 270K-character captures.
  assert.ok(QUOTA - bytes(ls.m) > 10 * 270000);
});

test('the real day.js writer sweeps old dates as the calendar moves (and keeps other users\' today)', async () => {
  const ls = quotaStore();
  globalThis.localStorage = ls;
  globalThis.window = { location: { hash: '' }, addEventListener() {}, __render() {} };
  const { DAY, pushDay } = await import('./day.js');
  for (let i = 0; i < 6; i++) {
    DAY.date = dateOf(i);
    pushDay('u-a');                                   // writes today's cache, sweeps once per date
    ls.setItem(`onstd-day-u-b-${dateOf(i)}`, '{}');   // another account on the phone, same day
    await new Promise((r) => setTimeout(r, 5));
  }
  const days = [...ls.m.keys()].filter((k) => k.startsWith('onstd-day-')).sort();
  assert.deepEqual(days, [`onstd-day-u-a-${dateOf(5)}`, `onstd-day-u-b-${dateOf(5)}`]);
});

test('the founder\'s full phone: a refused write frees the old day caches first and then lands', () => {
  const ls = quotaStore();
  for (const [k, v] of founderPhone().m) { try { ls.setItem(k, v); } catch { /* the store fills; exactly the device */ } }
  globalThis.localStorage = ls;
  const launchBefore = ls.getItem(`onstd-launch-${ATH}`);
  const photoQueue = JSON.stringify([{ k: 'x', base64: filler(270000) }]);
  const put = () => { try { ls.setItem('onstd-proto-outbox-v1', photoQueue); return true; } catch { return false; } };
  assert.equal(put(), false, 'the outbox write is refused on the full device');
  assert.equal(onQuota('outbox', put), true, 'after eviction the same write lands');
  assert.equal(ls.getItem(`onstd-launch-${ATH}`), launchBefore, 'the first rung (old dates) was enough: the launch cache survived');
});
