import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimPhotos, runnable, backoffMs, enqueue, jobKey } from './meal-outbox.js';

const job = (k, over = {}) => ({
  k, uid: 'u1', date: '2026-08-15', slot: 'lunch',
  base64: 'AAAA', needUpload: true, needInsert: false, needAnalysis: true,
  tries: 0, lastTryAt: 0, ...over,
});

test('trimPhotos strips the OLDEST photos past the budget and marks them dead', () => {
  const list = [job('a'), job('b'), job('c')];
  const out = trimPhotos(list, 2);
  assert.equal(out[0].dead, 'quota');
  assert.equal(out[0].base64, null);
  assert.equal(out[1].dead, undefined);
  assert.equal(out[2].dead, undefined);
});

test('a stripped entry preserves whether its photo had already uploaded (lostPhoto)', () => {
  // 'a' never uploaded: its bytes died with the strip. 'b' uploaded first: recoverable.
  const list = [job('a', { needUpload: true }), job('b', { needUpload: false }), job('c'), job('d')];
  const out = trimPhotos(list, 2);
  assert.equal(out[0].lostPhoto, true);   // bytes gone forever
  assert.equal(out[1].lostPhoto, false);  // photo lives in storage; a re-read can recover it
  assert.equal(out[0].needUpload, false); // the strip overwrites this — which is why lostPhoto exists
});

test('a dead entry is never runnable, no matter how due it is', () => {
  const e = trimPhotos([job('a'), job('b'), job('c')], 2)[0];
  assert.equal(runnable(e, Date.now() + 10 * 60_000), false);
});

test('backoff starts in seconds and caps in minutes', () => {
  assert.equal(backoffMs(0), 3000);
  assert.equal(backoffMs(1), 12000);
  assert.ok(backoffMs(10) <= 32 * 60 * 1000);
});

test('enqueue replaces by key, never duplicates a slot', () => {
  const k = jobKey('u1', '2026-08-15', 'lunch');
  const out = enqueue([job(k, { tries: 2 })], job(k, { tries: 0 }));
  assert.equal(out.length, 1);
  assert.equal(out[0].tries, 0);
});
