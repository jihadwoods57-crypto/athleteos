import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimPhotos, shedPhoto, runnable, backoffMs, enqueue, jobKey } from './meal-outbox.js';

const job = (k, over = {}) => ({
  k, uid: 'u1', date: '2026-08-15', slot: 'lunch',
  base64: 'AAAA', needUpload: true, needInsert: false, needAnalysis: true,
  tries: 0, lastTryAt: 0, ...over,
});

test('trimPhotos (localStorage fallback) keeps base64 for the newest two and marks nothing lost', () => {
  // 2026-09-26: the old trim marked the oldest entries dead on the spot, which is how a photo the
  // athlete could still have uploaded this session was thrown away. Now the older entries keep
  // their bytes in memory ('mem'); whether a photo is really gone is decided at drain time.
  const out = trimPhotos([job('a'), job('b'), job('c')], 2);
  assert.equal(out[0].base64, null);
  assert.equal(out[0].bytes, 'mem');
  assert.equal(out[0].dead, undefined);
  assert.equal(out[0].needUpload, true, 'still owed: nothing was decided here');
  assert.equal(out[1].base64, 'AAAA');
  assert.equal(out[2].base64, 'AAAA');
});

test('shedPhoto: a photo that never uploaded ends the job (no insert: 0251 needs a real photo)', () => {
  const e = shedPhoto(job('a', { needUpload: true, needInsert: true }));
  assert.equal(e.dead, 'lost');
  assert.equal(e.lostPhoto, true);
  assert.equal(e.needInsert, false);
  assert.equal(e.needAnalysis, false);
  assert.equal(runnable(e, Date.now() + 10 * 60_000), false, 'a dead entry is never runnable');
});

test('shedPhoto: a photo already in storage still gets its meals row; only the read is lost', () => {
  const e = shedPhoto(job('b', { needUpload: false, needInsert: true }));
  assert.equal(e.dead, undefined);
  assert.equal(e.lostPhoto, false);
  assert.equal(e.readLost, true);
  assert.equal(e.needInsert, true, 'the insert still runs');
  assert.equal(e.needAnalysis, false);
  assert.equal(runnable(e, Date.now()), true);
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
