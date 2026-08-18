// run: node --test proto/redesign-2026-07/js/id-chunk.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { chunkIds, ID_CHUNK_SIZE } from './id-chunk.js';

test('empty/non-array input yields no chunks', () => {
  assert.deepEqual(chunkIds([]), []);
  assert.deepEqual(chunkIds(null), []);
  assert.deepEqual(chunkIds(undefined), []);
  assert.deepEqual(chunkIds('not-an-array'), []);
});

test('under the chunk size returns exactly one chunk, untouched', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(ids);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], ids);
});

test('exactly at the boundary is one chunk, one past it is two', () => {
  const at = Array.from({ length: ID_CHUNK_SIZE }, (_, i) => `id-${i}`);
  assert.equal(chunkIds(at).length, 1);
  const over = Array.from({ length: ID_CHUNK_SIZE + 1 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(over);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, ID_CHUNK_SIZE);
  assert.equal(chunks[1].length, 1);
});

test('preserves order and every id exactly once across chunks', () => {
  const ids = Array.from({ length: 205 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(ids, 60);
  assert.equal(chunks.length, 4); // 60, 60, 60, 25
  assert.deepEqual(chunks.map((c) => c.length), [60, 60, 60, 25]);
  assert.deepEqual(chunks.flat(), ids);
});

test('a custom size is honored', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
  assert.equal(chunkIds(ids, 3).length, 4);
});
