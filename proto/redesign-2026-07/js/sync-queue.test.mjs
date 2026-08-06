/* node --test — pure half of sync-queue.js (the storage half needs a browser). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, enqueue, keyOf, runnable, due, retryable, MAX_TRIES } from './sync-queue.js';

test('backoff is seconds-first and capped', () => {
  assert.equal(backoffMs(0), 3000);
  assert.equal(backoffMs(1), 12000);
  assert.equal(backoffMs(2), 48000);
  assert.equal(backoffMs(10), 32 * 60 * 1000); // cap
});

test('enqueue replaces per (uid, kind, ref) — a re-tap never stacks a duplicate', () => {
  const a = { uid: 'u1', kind: 'rpc', ref: 'ack_commitment:i1', rpc: 'ack_commitment', args: { p_instance: 'i1' } };
  let q = enqueue([], a);
  q = enqueue(q, { ...a, tries: 3 }); // re-tap resets the entry
  assert.equal(q.length, 1);
  assert.equal(q[0].tries, 0);
});

test('enqueue keeps other users and other refs', () => {
  let q = enqueue([], { uid: 'u1', kind: 'rpc', ref: 'a:1' });
  q = enqueue(q, { uid: 'u2', kind: 'rpc', ref: 'a:1' });
  q = enqueue(q, { uid: 'u1', kind: 'rpc', ref: 'a:2' });
  assert.equal(q.length, 3);
});

test('meal-update fields MERGE on replace — the newest key wins, older keys survive', () => {
  let q = enqueue([], { uid: 'u1', kind: 'meal-update', ref: 'm1', fields: { protein: 20, note: 'first' } });
  q = enqueue(q, { uid: 'u1', kind: 'meal-update', ref: 'm1', fields: { note: 'second' } });
  assert.equal(q.length, 1);
  assert.equal(q[0].fields.protein, 20);
  assert.equal(q[0].fields.note, 'second');
});

test('runnable: fresh entries run immediately, failed ones wait out their backoff', () => {
  const now = 1_000_000;
  assert.equal(runnable({ tries: 0, lastTryAt: 0 }, now), true);
  assert.equal(runnable({ tries: 1, lastTryAt: now - 1000 }, now), false);
  assert.equal(runnable({ tries: 1, lastTryAt: now - 13_000 }, now), true);
  assert.equal(runnable({ tries: MAX_TRIES, lastTryAt: 0 }, now), false, 'exhausted entries never retry');
});

test('due filters to the runnable subset', () => {
  const now = 1_000_000;
  const q = [
    { uid: 'u1', kind: 'rpc', ref: 'a', tries: 0, lastTryAt: 0 },
    { uid: 'u1', kind: 'rpc', ref: 'b', tries: MAX_TRIES, lastTryAt: 0 },
  ];
  assert.equal(due(q, now).length, 1);
});

test('retryable: unreachable yes, refused no', () => {
  assert.equal(retryable('TypeError: Failed to fetch', false, false), true);
  assert.equal(retryable('network request timed out', false, false), true);
  assert.equal(retryable(null, true, false), true, 'a thrown fetch is retryable');
  assert.equal(retryable(null, false, true), true, 'offline flag is retryable');
  assert.equal(retryable('permission denied for table days', false, false), false);
  assert.equal(retryable('roll call window is closed', false, false), false);
});
