/* What goes when localStorage is full, in what order, and what we learn about it (2026-09-26).
 * Also the sync-queue bound: exhausted records used to be kept forever.
 * Run: node --test proto/redesign-2026-07/js/storage-guard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
const ls = {
  get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
};
globalThis.localStorage = ls;
globalThis.window = { location: { hash: '' }, addEventListener() {} };

const G = await import('./storage-guard.js');
const SQ = await import('./sync-queue.js');
const { EVENTS } = await import('./analytics.js');

const ME = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const TODAY = '2026-09-26';
function fullPhone() {
  mem.clear();
  mem.set('onstd-proto-rt-v1', JSON.stringify({ userId: ME, profile: { name: 'Jihad Woods' } }));
  mem.set(`onstd-day-${ME}-${TODAY}`, 'today-mine');
  mem.set(`onstd-day-${ME}-2026-09-25`, 'x'.repeat(5000));
  mem.set(`onstd-day-${OTHER}-${TODAY}`, 'y'.repeat(4000));
  mem.set(`onstd-launch-${ME}`, 'L'.repeat(3000));
  mem.set(`os.planIdeas.${ME}`, 'I'.repeat(2000));
  mem.set('onstd-analytics-buf-v1', JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ n: 'app_open', t: i }))));
  mem.set('onstd-proto-sync-outbox-v1', JSON.stringify([
    { uid: ME, kind: 'rpc', ref: 'a', tries: 5, lastTryAt: 1 },
    { uid: ME, kind: 'correction-outcome', ref: 'b', tries: 5, lastTryAt: 1 },
    { uid: ME, kind: 'meal-update', ref: 'c', tries: 1, lastTryAt: 1 },
  ]));
  mem.set('onstd-proto-outbox-v1', '[{"k":"job"}]');
  mem.set('onstd.receipts.v1', '{}');
}

test('the eviction ladder: cheapest loss first, one rung at a time, stopping as soon as the write lands', () => {
  fullPhone();
  const order = [];
  let need = 6;   // the write lands after the sixth rung
  const res = G.evictUntil(ls, () => { order.push('retry'); return --need <= 0; }, TODAY, ME);
  assert.deepEqual(res.ran, ['old_days', 'launch', 'ideas', 'abuf', 'sync_dead', 'other_days']);
  assert.equal(res.ok, true);
  assert.equal(mem.has(`onstd-day-${ME}-2026-09-25`), false, 'rung 1: other dates (never read again)');
  assert.equal(mem.has(`onstd-launch-${ME}`), false, 'rung 2: the launch cache');
  assert.equal(mem.has(`os.planIdeas.${ME}`), false, 'rung 3: plan ideas');
  assert.equal(JSON.parse(mem.get('onstd-analytics-buf-v1')).length, 50, 'rung 4: analytics keeps the newest 50');
  assert.equal(JSON.parse(mem.get('onstd-analytics-buf-v1'))[49].t, 499);
  assert.deepEqual(JSON.parse(mem.get('onstd-proto-sync-outbox-v1')).map((e) => e.ref), ['b', 'c'], 'rung 5: exhausted records (a correction receipt is kept)');
  assert.equal(mem.has(`onstd-day-${OTHER}-${TODAY}`), false, 'rung 6: another account\'s today');
  // Never touched, whatever happens.
  for (const k of [`onstd-day-${ME}-${TODAY}`, 'onstd-proto-rt-v1', 'onstd-proto-outbox-v1', 'onstd.receipts.v1']) assert.ok(mem.has(k), k);
});

test('the ladder stops early: one freed rung that makes room keeps everything after it', () => {
  fullPhone();
  const res = G.evictUntil(ls, () => true, TODAY, ME);
  assert.deepEqual(res.ran, ['old_days']);
  assert.ok(mem.has(`onstd-launch-${ME}`));
});

test('storage_quota: one event per session per surface, top 8 key sizes, labels only', () => {
  fullPhone();
  for (let i = 0; i < 6; i++) mem.set(`onstd-day-${ME}-2026-08-0${i + 1}`, 'z'.repeat(1000 * (i + 1)));
  mem.delete('onstd-analytics-buf-v1');   // start the buffer empty so the event is easy to find
  assert.equal(G.onQuota('outbox', () => true), true);
  G.onQuota('outbox', () => true);        // a second refusal in the same session does not re-report
  const buf = JSON.parse(mem.get('onstd-analytics-buf-v1') || '[]').filter((e) => e.n === EVENTS.STORAGE_QUOTA);
  assert.equal(buf.length, 1);
  const p = buf[0].p;
  assert.equal(p.where, 'outbox');
  assert.equal(typeof p.total_k, 'number');
  assert.ok(Object.keys(p).length <= 6, 'fits the analytics firewall');
  const pairs = [p.t1, p.t2, p.t3, p.t4].filter(Boolean).join('.').split('.');
  assert.equal(pairs.length, 8, 'the top eight keys');
  assert.equal(pairs[0], 'day:6', 'largest first, in thousands of characters');
  for (const s of pairs) assert.match(s, /^[a-z]+:\d+$/, 'a label and a size, nothing else');
  const raw = JSON.stringify(buf[0]);
  assert.ok(!raw.includes(ME) && !raw.includes('Jihad'), 'no user id, no user data');
});

test('quotaProps keeps every prop inside the firewall even at absurd sizes', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ label: 'launch', n: 1e9 - i }));
  const p = G.quotaProps('outbox', list);
  for (const v of Object.values(p)) if (typeof v === 'string') assert.match(v, /^[a-z0-9_.:-]{1,24}$/);
});

test('labels never leak a key: unknown keys read as "other"', () => {
  assert.equal(G.labelOf(`onstd-day-${ME}-${TODAY}`), 'day');
  assert.equal(G.labelOf('some.private.key.with.name'), 'other');
});

test('sync-queue: exhausted records age out (7 days; a correction receipt 30) and the list is capped', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const day = 864e5;
  const list = [
    { uid: ME, kind: 'rpc', ref: 'old-dead', tries: 5, lastTryAt: now - 8 * day },
    { uid: ME, kind: 'rpc', ref: 'new-dead', tries: 5, lastTryAt: now - 2 * day },
    { uid: ME, kind: 'correction-outcome', ref: 'receipt', tries: 5, lastTryAt: now - 20 * day },
    { uid: ME, kind: 'correction-outcome', ref: 'old-receipt', tries: 5, lastTryAt: now - 31 * day },
    { uid: ME, kind: 'meal-update', ref: 'live', tries: 2, lastTryAt: now - 90 * day },
  ];
  assert.deepEqual(SQ.prune(list, now).map((e) => e.ref), ['new-dead', 'receipt', 'live'], 'live work is never dropped for age');
  const many = Array.from({ length: SQ.MAX_KEEP + 25 }, (_, i) => ({ uid: ME, kind: 'rpc', ref: `r${i}`, tries: 0 }));
  const out = SQ.prune(many, now);
  assert.equal(out.length, SQ.MAX_KEEP);
  assert.equal(out[out.length - 1].ref, `r${SQ.MAX_KEEP + 24}`, 'the newest are kept');
  // The writer applies it.
  mem.set('onstd-proto-sync-outbox-v1', '[]');
  SQ.writeQueue(list);
  assert.ok(!JSON.parse(mem.get('onstd-proto-sync-outbox-v1')).some((e) => e.ref === 'old-dead'));
});
